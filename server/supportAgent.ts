/**
 * BIA — the Bombino AI support agent: the conversation loop.
 *
 * Read-only by design. BIA answers from live data and points at the screen
 * where the customer can act; it never changes an order, takes a payment or
 * issues a code. What it knows and can call is assembled per turn:
 *
 *   supportTools.ts    which tools this turn is offered (modules × screen)
 *   supportPrompts.ts  the system prompt for those modules, the user, the screen
 *   supportGeneral.ts  general tools · supportOrders.ts  order tools
 *   supportCta.ts      every button checked before the reply leaves
 *
 * handleChat never throws: a failure becomes a canned reply.
 */

import OpenAI from "openai";
import { finalizeReply, sectionsAskedAbout, tokensIn } from "./supportCta.js";
import { ownerOf } from "./supportOrders.js";
import { buildSystemPrompt } from "./supportPrompts.js";
import { dispatchTool, enabledBiaModules, toolDefinitions, toolsForTurn } from "./supportTools.js";
import type { ChatMessage, SupportChatContext, SupportChatResult, SupportTurnMeta } from "./supportTypes.js";
import { MAX_BIA_CARDS, biaCardKey, type BiaCard } from "../shared/biaCards.js";
import { parseBiaButton } from "../shared/biaCta.js";
import { explainError } from "../shared/errorCatalog.js";

const FALLBACK_CHAT =
  "I'm having trouble responding right now. Please try again in a moment or use the app menu to contact support.";
const SUPPORT_CHAT_MAX_TOOL_ITERATIONS = 5;

/** "Can I talk to someone", "customer care", "a real person". */
export const ASKS_FOR_A_PERSON =
  /\b(speak|talk|chat)\s+(to|with)\s+(someone|somebody|a\s+(real\s+)?(person|human)|an?\s+(agent|executive)|your\s+(team|staff|support)|support|customer\s+care)\b|\bcustomer\s+care\b|\b(real|actual)\s+(person|human)\b|\bcall\s+me\b/i;

function getOpenAIClient(): OpenAI | null {
  const key = process.env.OPENAI_API_KEY;
  if (!key || typeof key !== "string" || key.trim() === "") return null;
  return new OpenAI({ apiKey: key, timeout: 30_000 });
}

/** Quick replies offered under the reply, keyed by the last tool the turn used. */
const QUICK_REPLIES: Partial<Record<string, string[]>> = {
  get_order_status: ["Show all my orders", "How do payments work?", "Talk to a person"],
  get_tracking_summary: ["When will it arrive?", "Talk to a person"],
  get_rates: ["Is pickup available at my pincode?", "How do I book?"],
  check_pickup: ["Get a rate", "How do I book?"],
  get_my_kyc_status: ["Show my orders"],
  get_shipment_guidance: ["Show my orders", "Get a rate"],
  recommend_account: ["Can I book as a guest instead?", "Get a rate"],
};

/** A tool call as the model made it, reported to `HandleChatOptions.onToolCall`. */
export interface ToolCallTrace {
  name: string;
  args: unknown;
}

export interface HandleChatOptions {
  /**
   * Told about every tool call, in the order they run. The eval runner
   * (scripts/bia-eval.ts) uses it to check which tools a prompt reached; the
   * chat route passes nothing. It must not throw — an error here is swallowed.
   */
  onToolCall?: (call: ToolCallTrace) => void;
}

/** One card per thing it shows (shared/biaCards.ts §biaCardKey). */
function dedupeCards(cards: BiaCard[]): BiaCard[] {
  const seen = new Set<string>();
  return cards.filter((card) => {
    const key = biaCardKey(card);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function handleChat(
  messages: ChatMessage[],
  context: SupportChatContext,
  options: HandleChatOptions = {}
): Promise<SupportChatResult> {
  // What this turn may use: the enabled modules that fit the screen, and the
  // order tools only for someone whose orders we can look up.
  const { modules, tools } = toolsForTurn(context.screen, enabledBiaModules(), !!ownerOf(context));

  // What the turn log records. Filled in as the turn goes.
  const meta: SupportTurnMeta = { modules: [...modules], tools: [], fallback: false, promptTokens: 0, completionTokens: 0 };
  const fallback = (message: string = FALLBACK_CHAT): SupportChatResult => ({
    message,
    suggestions: [],
    cards: [],
    meta: { ...meta, fallback: true },
  });

  const client = getOpenAIClient();
  if (!client) return fallback();

  let currentMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemPrompt(context, modules) },
    ...messages.map((m) =>
      m.role === "user"
        ? { role: "user" as const, content: m.content }
        : { role: "assistant" as const, content: m.content }
    ),
  ];

  const owner = ownerOf(context);
  const ownedOrderNos = new Set<string>();
  /** Order-page sections the tools offered this turn ("BOM-100107#cancel"). */
  const offeredSections = new Set<string>();
  let lastTool: string | null = null;
  let lastToolTokens: string[] = [];
  /** The cards from the latest round of tool calls that produced any. */
  let turnCards: BiaCard[] = [];
  /**
   * The button for the error on screen, when this turn is the customer asking
   * about it ("Ask BIA" sends its title). Stands in, like a tool's buttons, if
   * the reply forgets it; a later question in the same chat doesn't get it.
   */
  const screenError = explainError(context.screen?.errorCode);
  const lastUserText = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const errorButton = screenError?.button && lastUserText.includes(screenError.title) ? screenError.button : null;
  /**
   * Someone asking for a person always leaves with a way to reach one. The
   * model sometimes says "use the WhatsApp or call buttons" and then leaves
   * them off; this stands in, like the error button, only when the reply has
   * no buttons at all.
   */
  const personButton = ASKS_FOR_A_PERSON.test(lastUserText) ? "TAP_CONTACT_US" : null;

  try {
    for (let iteration = 0; iteration < SUPPORT_CHAT_MAX_TOOL_ITERATIONS; iteration++) {
      const response = await client.chat.completions.create({
        model: "gpt-4o-mini",
        // Low, not zero: a support answer should come out the same way twice.
        // At the default of 1 the evals showed the same prompt skipping a tool
        // or asking the customer to confirm what they had just said.
        temperature: 0.2,
        messages: currentMessages,
        tools: toolDefinitions(tools),
        tool_choice: "auto",
      });

      meta.promptTokens += response.usage?.prompt_tokens ?? 0;
      meta.completionTokens += response.usage?.completion_tokens ?? 0;
      const message = response.choices?.[0]?.message;
      if (!message) return fallback();

      const toolCalls = message.tool_calls;
      if (!toolCalls || toolCalls.length === 0) {
        if (typeof message.content !== "string") return fallback();
        const final = await finalizeReply(message.content, {
          owner,
          ownedOrderNos,
          fallbackTokens:
            lastToolTokens.length > 0 ? lastToolTokens : errorButton ? [errorButton] : personButton ? [personButton] : [],
          offeredSections,
          askedSections: sectionsAskedAbout(lastUserText),
        });
        // A lookup that found nothing offers no buttons; follow-ups about the
        // thing it did not find would be noise.
        const foundNothing =
          (lastTool === "get_tracking_summary" || lastTool === "get_order_status") &&
          lastToolTokens.length === 0;
        const replies = (!foundNothing && lastTool && QUICK_REPLIES[lastTool]) || [];
        return {
          message: final || FALLBACK_CHAT,
          // Nothing about "my orders" for someone we cannot look orders up for.
          suggestions: owner ? replies : replies.filter((r) => !/\bmy orders\b/i.test(r)),
          cards: foundNothing ? [] : turnCards.slice(0, MAX_BIA_CARDS),
          meta: { ...meta, fallback: !final },
        };
      }

      const assistantMsg: OpenAI.Chat.Completions.ChatCompletionMessageParam = {
        role: "assistant",
        content: message.content ?? null,
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.function?.name ?? "", arguments: tc.function?.arguments ?? "" },
        })),
      };
      const outcomes = await Promise.all(
        toolCalls.map(async (tc) => {
          const name = tc.function?.name ?? "";
          meta.tools.push(name);
          let args: unknown = {};
          try {
            args = JSON.parse(tc.function?.arguments ?? "{}");
          } catch {
            args = {};
          }
          try {
            options.onToolCall?.({ name, args });
          } catch {
            /* a tracer never breaks a reply */
          }
          // Only what this turn offered runs; a dark module's tool does not.
          const outcome = await dispatchTool(name, args, context, tools);
          for (const orderNo of outcome.orderNos ?? []) ownedOrderNos.add(orderNo);
          for (const token of tokensIn(outcome.content)) {
            const button = parseBiaButton(token);
            if (button?.name === "TAP_VIEW_ORDER" && button.arg.includes("#")) offeredSections.add(button.arg);
          }
          return { id: tc.id, outcome };
        })
      );
      const toolResults: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = outcomes.map(
        ({ id, outcome }) => ({ role: "tool" as const, tool_call_id: id, content: outcome.content })
      );
      const roundCards = dedupeCards(outcomes.flatMap(({ outcome }) => outcome.cards ?? []));
      if (roundCards.length > 0) turnCards = roundCards;
      currentMessages = [...currentMessages, assistantMsg, ...toolResults];
      lastTool = toolCalls[toolCalls.length - 1]?.function?.name ?? lastTool;
      const lastResult = toolResults[toolResults.length - 1];
      lastToolTokens =
        lastResult && typeof lastResult.content === "string" ? tokensIn(lastResult.content) : [];
    }

    return fallback();
  } catch (err) {
    const msg = (err as Error)?.message ?? "";
    if (msg.includes("429") || /quota|rate limit/i.test(msg)) {
      return fallback(
        "Our AI support is temporarily at capacity. Please try again in a few minutes or contact support from the app menu."
      );
    }
    return fallback();
  }
}
