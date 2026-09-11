/**
 * Every tool BIA has, gathered from the module files, and which of them one
 * turn is offered.
 *
 * A turn gets the general tools plus those of the modules that are both
 * switched on (BIA_MODULES) and relevant to the screen (shared/biaModules.ts).
 * Fewer tools per turn keeps gpt-4o-mini choosing well, and a module that is
 * still dark is never offered — nor run, if the model names it anyway.
 *
 * To add a tool: put it in its module's list (GENERAL_TOOLS, ORDER_TOOLS, …)
 * and, for a new module file, add that list to ALL_TOOLS below.
 */

import type OpenAI from "openai";
import { GENERAL_TOOLS } from "./supportGeneral.js";
import { ORDER_TOOLS } from "./supportOrders.js";
import type { BiaTool, SupportChatContext, ToolOutcome } from "./supportTypes.js";
import { modulesForScreen, parseBiaModules, type BiaModule } from "../shared/biaModules.js";
import type { BiaScreen } from "../shared/biaScreen.js";

export const ALL_TOOLS: readonly BiaTool[] = [...GENERAL_TOOLS, ...ORDER_TOOLS];

const FALLBACK_DISPATCHER =
  "Something went wrong. Please try again or contact support from the app menu.";

/** BIA_MODULES from the environment, read on each call so a restart isn't the only way to see a change in tests. */
export function enabledBiaModules(): BiaModule[] {
  return parseBiaModules(process.env.BIA_MODULES);
}

export function toolName(tool: BiaTool): string {
  return tool.definition.type === "function" ? tool.definition.function.name : "";
}

/**
 * The modules and tools one turn gets. Someone we can't look orders up for
 * (not signed in, no verified phone) isn't offered the order tools: they
 * could only answer "not signed in", and the prompt already says that.
 */
export function toolsForTurn(
  screen: BiaScreen | null,
  enabled: readonly BiaModule[] = enabledBiaModules(),
  canLookUpOrders = true
): { modules: BiaModule[]; tools: BiaTool[] } {
  const modules = modulesForScreen(screen?.surface, enabled).filter((m) => canLookUpOrders || m !== "orders");
  const tools = ALL_TOOLS.filter((t) => t.module === "general" || modules.includes(t.module));
  return { modules, tools };
}

/** What the OpenAI call is told about the offered tools. */
export function toolDefinitions(tools: readonly BiaTool[]): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return tools.map((t) => t.definition);
}

/**
 * Run a tool the model called — only if this turn offered it. Never throws;
 * an unknown or withheld tool gets the same safe reply.
 */
export async function dispatchTool(
  name: string,
  args: unknown,
  context: SupportChatContext,
  offered: readonly BiaTool[] = ALL_TOOLS
): Promise<ToolOutcome> {
  const tool = offered.find((t) => toolName(t) === name || t.aliases?.includes(name));
  if (!tool) return { content: FALLBACK_DISPATCHER };
  try {
    const raw = args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
    return await tool.run(raw, context);
  } catch {
    return { content: FALLBACK_DISPATCHER };
  }
}
