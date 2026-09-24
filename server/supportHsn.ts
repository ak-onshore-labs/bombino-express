/**
 * "What's the HS code for …?" (BIA 3.0, package 3.2), answered from Bombino's
 * own contents list (shared/hsn.ts) — the list the booking form's "Shipment
 * Content" search offers, and the code the form fills from it.
 *
 * BIA suggests; the customer chooses. Nothing here touches the form: the card
 * lists up to three entries, and the customer picks one in the form themselves.
 *
 * An item typed exactly as an entry's description is a sure match. Anything
 * else goes to the model, which picks from the numbered list, and only entries
 * that exist come back — never a code it made up. Word matches stand in when
 * the model can't answer. Nothing fits: our team, and the contact button.
 */

import OpenAI from "openai";
import type { BiaTool, SupportChatContext, ToolOutcome } from "./supportTypes.js";
import type { HsnCard } from "../shared/biaCards.js";
import { HSN_CODE_MAP, getHsnCode } from "../shared/hsn.js";

export interface HsnEntry {
  description: string;
  /** The code the form fills for this description (getHsnCode: the first listed). */
  code: string;
}

/** Each description once, with the code the form would use for it. */
export const HSN_ENTRIES: readonly HsnEntry[] = Array.from(new Set(HSN_CODE_MAP.map((row) => row.description))).map(
  (description) => ({ description, code: getHsnCode(description) })
);

const STOP_WORDS = new Set(["and", "of", "for", "with", "the", "a", "an", "made", "other", "set", "sets", "item", "items"]);

function stem(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && /(s|x|z|ch|sh)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !STOP_WORDS.has(w))
    .map(stem);
}

/** An entry's own words: its description before any "(…)" explanation. */
function entryWords(entry: HsnEntry): string[] {
  return words(entry.description.split("(")[0]);
}

const MAX_CANDIDATES = 3;

/**
 * The item typed as an entry's description is a sure match (its full name
 * first: "BED SHEETS" before "BED SHEET(…)", which carries another code).
 * Otherwise, entries sharing all their words with the item, or containing all
 * of the item's: a fallback only, since words alone can't tell a cotton kurta
 * from raw cotton.
 */
export function matchHsn(item: string): { sure: boolean; entries: HsnEntry[] } {
  const typedWords = words(item);
  const typed = typedWords.join(" ");
  if (!typed) return { sure: false, entries: [] };
  const exact =
    HSN_ENTRIES.find((e) => words(e.description).join(" ") === typed) ??
    HSN_ENTRIES.find((e) => entryWords(e).join(" ") === typed);
  if (exact) return { sure: true, entries: [exact] };
  const have = new Set(typedWords);
  const hits = HSN_ENTRIES.map((entry) => ({ entry, own: entryWords(entry) }))
    .filter(({ own }) => own.length > 0 && (own.every((w) => have.has(w)) || typedWords.every((w) => own.includes(w))))
    .sort((a, b) => b.own.filter((w) => have.has(w)).length - a.own.filter((w) => have.has(w)).length)
    .map(({ entry }) => entry);
  return { sure: false, entries: hits.slice(0, MAX_CANDIDATES) };
}

const PICK_PROMPT = `You match an item a customer wants to ship to entries in a numbered list of shipment contents.
Reply with the numbers of up to three entries that are the closest reasonable description of the item, best first, separated by commas. They need not be exact: an entry for the kind of thing it is, or what it's made of, counts (a small brass idol: GOD IDOL, BRASSWARE, ARTIFACTS).
Only numbers from the list. Reply NONE only when nothing on the list is a reasonable description (live animals, for example). No other text.`;

/** Up to three entries the model picks from the numbered list; none when it can't. */
export async function pickHsnWithModel(item: string, client: OpenAI | null): Promise<HsnEntry[]> {
  if (!client) return [];
  try {
    const res = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 20,
      messages: [
        { role: "system", content: PICK_PROMPT },
        { role: "user", content: `Item: ${item}\n\nList:\n${HSN_ENTRIES.map((e, i) => `${i + 1}. ${e.description}`).join("\n")}` },
      ],
    });
    const text = res.choices[0]?.message?.content ?? "";
    if (/none/i.test(text)) return [];
    const picked: HsnEntry[] = [];
    for (const n of text.match(/\d+/g) ?? []) {
      const entry = HSN_ENTRIES[Number(n) - 1];
      if (entry && !picked.includes(entry)) picked.push(entry);
    }
    return picked.slice(0, MAX_CANDIDATES);
  } catch {
    return [];
  }
}

function openAiClient(): OpenAI | null {
  const key = process.env.OPENAI_API_KEY;
  return key && key.trim() ? new OpenAI({ apiKey: key, timeout: 15_000 }) : null;
}

let picker: (item: string) => Promise<HsnEntry[]> = (item) => pickHsnWithModel(item, openAiClient());

/** Tests replace the model's pick; null puts it back. */
export function replaceHsnPicker(next: ((item: string) => Promise<HsnEntry[]>) | null): void {
  picker = next ?? ((item) => pickHsnWithModel(item, openAiClient()));
}

export async function executeSuggestHsn(args: { item?: unknown }, context: SupportChatContext): Promise<ToolOutcome> {
  const item = typeof args.item === "string" ? args.item.trim().slice(0, 120) : "";
  if (!item) return { content: "Ask what they're sending." };

  const byWords = matchHsn(item);
  const sure = byWords.sure;
  // Typed exactly: that entry. Otherwise the model reads the whole list; the
  // word matches stand in only if it can't answer.
  let entries = byWords.entries;
  if (!sure) {
    const picked = await picker(item);
    if (picked.length > 0) entries = picked;
  }

  if (entries.length === 0) {
    return {
      content: `Nothing on Bombino's contents list fits "${item}". Say our team can tell them the right description and HS code, and don't suggest one yourself.\nTAP_CONTACT_US`,
    };
  }

  const card: HsnCard = { kind: "hsn", item, sure, candidates: entries.map((e) => ({ description: e.description, code: e.code })) };
  const lines = [
    `From Bombino's contents list, ${sure ? "an exact match" : "the closest entries"} for "${item}":`,
    ...entries.map((e) => `- ${e.description}: HS code ${e.code}`),
    `They choose it themselves in "Shipment Content" on the package step, and the form fills in its HS code. Suggest the best fit in a sentence; the card under your reply lists them. It's their choice: never say you filled anything in, and never offer a code that isn't listed here.`,
  ];
  if (context.screen?.productType === "CSB V") {
    lines.push(
      "Important: they're filing CSB V, whose form asks for a 10-digit HS code. Tell them these are 8 digits, so the full 10-digit code comes from their shipping bill or our team."
    );
  }
  return { content: lines.join("\n"), cards: [card] };
}

export const HSN_TOOLS: readonly BiaTool[] = [
  {
    module: "booking",
    definition: {
      type: "function",
      function: {
        name: "suggest_hsn",
        description:
          "Which entry on Bombino's contents list, and so which HS code, fits an item they're sending. Suggests only; they choose it in the booking form.",
        parameters: {
          type: "object",
          properties: { item: { type: "string", description: "What they're sending, in their words." } },
          required: ["item"],
        },
      },
    },
    run: (args, context) => executeSuggestHsn(args, context),
  },
];
