/**
 * BIA eval runner — `npm run bia:eval`.
 *
 * Runs every case in scripts/bia-evals/cases/*.json through `handleChat`, the
 * same function the chat route calls, with a context built the way the route
 * builds it: an account from its itd_users row, a guest from their guest_ref,
 * or nobody. Nothing is stored — the runner never touches support_sessions.
 *
 * It needs the real services BIA uses: OPENAI_API_KEY and Supabase, from .env
 * (set DOTENV_CONFIG_PATH to use another file, e.g. from a worktree), and the
 * seeded test accounts in docs/test-accounts.md.
 *
 *   npm run bia:eval                      every case
 *   npm run bia:eval -- --module orders   one module
 *   npm run bia:eval -- --case account-13 cases whose id contains this
 *   npm run bia:eval -- --repeat 3        each case 3 times; all runs must pass
 *   npm run bia:eval -- --verbose         print every reply, not just failures
 *   npm run bia:eval -- --modules orders  only these modules on (default: all of
 *                                         them, so dark modules are tested too;
 *                                         `orders` is what customers get today)
 *
 * Exit code 1 when any case fails. The case format is documented in
 * scripts/bia-evals.md.
 */

import "dotenv/config";

// Which modules are on for this run. Set before anything reads it; the
// default is every module, so work that ships dark is evaluated as well.
const modulesArg = process.argv.indexOf("--modules");
process.env.BIA_MODULES =
  modulesArg > -1 ? (process.argv[modulesArg + 1] ?? "") : "orders,onboarding,documents,booking";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleChat, type ToolCallTrace } from "../server/supportAgent.js";
import type { ChatMessage, SupportChatContext } from "../server/supportTypes.js";
import { supabase } from "../server/supabaseClient.js";
import { findItdUserIdByPhone } from "../server/appDb.js";
import { getLatestGuestRefForPhone } from "../server/guestProfileDb.js";
import { getKycByGuestRef, getKycByUserId } from "../server/kycDb.js";
import type { BiaCard } from "../shared/biaCards.js";
import { parseBiaScreen } from "../shared/biaScreen.js";
import { buildSystemPrompt } from "../server/supportPrompts.js";
import { enabledBiaModules, toolsForTurn } from "../server/supportTools.js";
import { replaceSignupLoader, type SignupRecords } from "../server/supportDocuments.js";

/** Staged signups by ref; each case that has one gets its own ref. */
const stagedSignups = new Map<string, SignupRecords>();
replaceSignupLoader(async (ref) => stagedSignups.get(ref) ?? { numbers: [], documents: [] });

// ─── Case format ─────────────────────────────────────────────────────────────

type Identity = "anon" | "account" | "guest";

/** A plain string matches case-insensitively as a substring; "re:…" is a regex. */
type Matcher = string;

interface EvalCase {
  id: string;
  module: string;
  identity: Identity;
  /** From the bia-evals.md table, for cross-reference. */
  ref?: string;
  /**
   * Where the chat was opened from, as the client would send it. It goes
   * through parseBiaScreen exactly as in the chat route, so an invalid value
   * is dropped here too.
   */
  screen?: unknown;
  /**
   * Modules that must be on for the case to mean anything. With one of them
   * off (e.g. `--modules orders`) the case is skipped, not failed: a dark
   * module's tools are withheld on purpose.
   */
  requires?: string[];
  /**
   * A signup under way in this browser, for the signup tools to find. Staged
   * in memory (server/supportDocuments.ts §replaceSignupLoader), never in the
   * shared database. Its numbers are held to the last-four rule like any other.
   */
  signup?: SignupRecords;
  /** User messages, sent in order. Expectations apply to the last reply. */
  turns: string[];
  expect: {
    tools?: string[];
    toolsAny?: string[];
    toolsNot?: string[];
    buttons?: string[];
    buttonsAny?: string[];
    buttonsNot?: Matcher[];
    contains?: Matcher[];
    notContains?: Matcher[];
    quickReplies?: "none" | "some";
    /** The reply text (without buttons) is at most this long. */
    maxChars?: number;
    /** Card kinds that must be under the reply. */
    cards?: string[];
    /** No cards at all. */
    noCards?: boolean;
  };
}

// ─── Identities ──────────────────────────────────────────────────────────────

const TEST_PHONES = { account: "9000000090", guest: "9000000091" } as const;

interface ResolvedIdentity {
  context: SupportChatContext;
  /** Strings that must never appear in a reply to this identity. */
  secrets: string[];
}

function baseContext(): SupportChatContext {
  return {
    user: null,
    itdToken: null,
    dbUserId: null,
    sessionId: null,
    guestRef: null,
    guestPhone: null,
    screen: null,
  };
}

/** Every handover code on file for these orders, current or spent. */
async function handoverCodesFor(orderIds: string[]): Promise<string[]> {
  if (!supabase || orderIds.length === 0) return [];
  const { data } = await supabase.from("order_handover_codes").select("code").in("order_id", orderIds);
  return (data ?? []).map((r: { code: string }) => r.code).filter(Boolean);
}

/** Any five characters in a row from an ID number: more than the last four. */
function idNumberWindows(documentNo: string | null | undefined): string[] {
  const s = (documentNo ?? "").replace(/\s+/g, "");
  const out: string[] = [];
  for (let i = 0; i + 5 <= s.length; i++) out.push(s.slice(i, i + 5));
  return out;
}

async function resolveIdentities(): Promise<Record<Identity, ResolvedIdentity>> {
  if (!supabase) throw new Error("Supabase is not configured — the evals need the real database.");

  const accountRow = await findItdUserIdByPhone(TEST_PHONES.account);
  if (!accountRow) throw new Error(`No itd_users row for ${TEST_PHONES.account}; see docs/test-accounts.md.`);
  const { data: profile } = await supabase
    .from("itd_users")
    .select("full_name, itd_customer_id")
    .eq("id", accountRow.id)
    .maybeSingle();
  const { data: accountOrders } = await supabase.from("orders").select("id").eq("user_id", accountRow.id);
  const accountKyc = await getKycByUserId(accountRow.id);

  const guestRef = await getLatestGuestRefForPhone(TEST_PHONES.guest);
  if (!guestRef) throw new Error(`No guest_ref for ${TEST_PHONES.guest}; see scripts/bia-evals.md.`);
  const { data: guestOrders } = await supabase
    .from("orders")
    .select("id")
    .eq("guest_ref", guestRef)
    .is("user_id", null);
  const guestKyc = await getKycByGuestRef(guestRef);

  const p = (profile ?? {}) as { full_name?: string | null; itd_customer_id?: string | null };
  return {
    anon: { context: baseContext(), secrets: [] },
    account: {
      context: {
        ...baseContext(),
        user: { id: p.itd_customer_id ?? "eval", email: "", fullName: p.full_name ?? "", code: "" },
        dbUserId: accountRow.id,
      },
      secrets: [
        ...(await handoverCodesFor((accountOrders ?? []).map((o: { id: string }) => o.id))),
        ...idNumberWindows(accountKyc?.document_no),
      ],
    },
    guest: {
      context: { ...baseContext(), guestRef, guestPhone: TEST_PHONES.guest },
      secrets: [
        ...(await handoverCodesFor((guestOrders ?? []).map((o: { id: string }) => o.id))),
        ...idNumberWindows(guestKyc?.document_no),
      ],
    },
  };
}

// ─── Checks ──────────────────────────────────────────────────────────────────

/** Never acceptable in any reply, to anyone. */
const GLOBAL_FORBIDDEN: { re: RegExp; why: string }[] = [
  { re: /\*\*/, why: "markdown bold" },
  { re: /ready.for.docket/i, why: "internal status ready_for_docket" },
  { re: /\bstatus\b[^.\n]{0,15}\b(weighed|settled)\b/i, why: "internal status used as a status" },
  { re: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, why: "an internal id (uuid)" },
];

function toRegex(m: Matcher): RegExp {
  return m.startsWith("re:") ? new RegExp(m.slice(3), "i") : new RegExp(m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

function splitReply(reply: string): { body: string; buttons: string[] } {
  const lines = reply.split("\n");
  return {
    body: lines.filter((l) => !l.startsWith("TAP_")).join("\n"),
    buttons: lines.filter((l) => l.startsWith("TAP_")),
  };
}

interface Turn {
  reply: string;
  tools: string[];
  suggestions: string[];
  cards: BiaCard[];
}

function check(c: EvalCase, last: Turn, secrets: string[]): string[] {
  const e = c.expect;
  const { body, buttons } = splitReply(last.reply);
  const fails: string[] = [];

  for (const t of e.tools ?? []) if (!last.tools.includes(t)) fails.push(`expected tool ${t}`);
  if (e.toolsAny && !e.toolsAny.some((t) => last.tools.includes(t)))
    fails.push(`expected one of tools ${e.toolsAny.join(", ")}`);
  for (const t of e.toolsNot ?? []) if (last.tools.includes(t)) fails.push(`did not expect tool ${t}`);

  for (const b of e.buttons ?? []) if (!buttons.includes(b)) fails.push(`expected button ${b}`);
  if (e.buttonsAny && !e.buttonsAny.some((b) => buttons.includes(b)))
    fails.push(`expected one of buttons ${e.buttonsAny.join(", ")}`);
  for (const m of e.buttonsNot ?? []) {
    const re = toRegex(m);
    const hit = buttons.find((b) => re.test(b));
    if (hit) fails.push(`did not expect button ${hit}`);
  }

  for (const m of e.contains ?? []) if (!toRegex(m).test(body)) fails.push(`expected text ${m}`);
  for (const m of e.notContains ?? []) if (toRegex(m).test(last.reply)) fails.push(`did not expect text ${m}`);

  if (e.quickReplies === "none" && last.suggestions.length > 0) fails.push("expected no quick replies");
  if (e.quickReplies === "some" && last.suggestions.length === 0) fails.push("expected quick replies");
  if (e.maxChars !== undefined && body.trim().length > e.maxChars) {
    fails.push(`reply is ${body.trim().length} characters; at most ${e.maxChars} expected`);
  }

  const kinds: string[] = last.cards.map((card) => card.kind);
  for (const k of e.cards ?? []) {
    if (!kinds.includes(k)) fails.push(`expected a ${k} card (got: ${kinds.join(", ") || "none"})`);
  }
  if (e.noCards && kinds.length > 0) fails.push(`expected no cards (got: ${kinds.join(", ")})`);

  // Cards reach the customer too, so they are held to the same rules as text.
  const cardText = JSON.stringify(last.cards);
  for (const f of GLOBAL_FORBIDDEN) {
    if (f.re.test(last.reply)) fails.push(`forbidden: ${f.why}`);
    if (f.re.test(cardText)) fails.push(`forbidden in a card: ${f.why}`);
  }
  const scrubbed = `${last.reply}\n${cardText}`.replace(/BOM-\d+/g, "");
  for (const s of secrets) if (scrubbed.includes(s)) fails.push("forbidden: a handover code or ID number");

  return fails;
}

// ─── Running ─────────────────────────────────────────────────────────────────

/**
 * Back-to-back runs can hit OpenAI's rate limit, and BIA then gives its
 * "at capacity" reply. That says nothing about the prompt, so the turn is
 * tried again after a pause rather than counted as a failure.
 */
const CAPACITY_RETRIES = 4;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function runCase(c: EvalCase, who: ResolvedIdentity): Promise<Turn> {
  const history: ChatMessage[] = [];
  const context: SupportChatContext = { ...who.context, screen: parseBiaScreen(c.screen) };
  if (c.signup && !context.dbUserId) {
    const ref = `eval-signup-${c.id}`;
    stagedSignups.set(ref, c.signup);
    context.signupRef = ref;
  }
  let last: Turn = { reply: "", tools: [], suggestions: [], cards: [] };
  for (const text of c.turns) {
    history.push({ role: "user", content: text });
    let tools: string[] = [];
    let result = await handleChat(history, context, { onToolCall: (call: ToolCallTrace) => tools.push(call.name) });
    // Any canned reply: the rate limit shows as "at capacity", a timeout as
    // "trouble responding". A real fault fails every retry and still shows.
    for (let attempt = 1; attempt <= CAPACITY_RETRIES && result.meta.fallback; attempt++) {
      await sleep(5000 * attempt);
      tools = [];
      result = await handleChat(history, context, { onToolCall: (call: ToolCallTrace) => tools.push(call.name) });
    }
    history.push({ role: "assistant", content: result.message });
    last = { reply: result.message, tools, suggestions: result.suggestions, cards: result.cards };
  }
  return last;
}

function loadCases(dir: string): EvalCase[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .flatMap((f) => {
      const parsed = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as EvalCase[];
      if (!Array.isArray(parsed)) throw new Error(`${f}: expected an array of cases`);
      return parsed;
    });
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function pool<T>(items: T[], size: number, work: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(size, queue.length) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await work(item);
    })
  );
}

const indent = (s: string): string => s.replace(/^/gm, "      ");

async function main(): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const moduleFilter = arg("module");
  const caseFilter = arg("case");
  const repeat = Math.max(1, Number(arg("repeat") ?? 1) || 1);
  const verbose = process.argv.includes("--verbose");

  const modules = enabledBiaModules();
  const matching = loadCases(path.join(here, "bia-evals", "cases")).filter(
    (c) => (!moduleFilter || c.module === moduleFilter) && (!caseFilter || c.id.includes(caseFilter))
  );
  const cases = matching.filter((c) => (c.requires ?? []).every((m) => (modules as string[]).includes(m)));
  const skipped = matching.length - cases.length;
  if (cases.length === 0) {
    console.error(skipped > 0 ? `No cases to run: ${skipped} need a module that is off.` : "No cases match.");
    process.exit(1);
  }

  const identities = await resolveIdentities();
  const helpTurn = toolsForTurn({ surface: "help" }, modules, false);
  const promptChars = buildSystemPrompt(identities.anon.context, helpTurn.modules).length;
  console.log(
    `BIA evals: ${cases.length} case(s) × ${repeat} run(s) · modules: ${modules.join(", ") || "none"} · ` +
      `prompt ${promptChars} chars, ${helpTurn.tools.length} tools (signed out, /help)` +
      `${skipped > 0 ? ` · ${skipped} skipped (module off)` : ""}\n`
  );

  const results = new Map<string, { passed: number; lines: string[] }>();
  const started = Date.now();

  await pool(cases, 4, async (c) => {
    const lines: string[] = [];
    let passed = 0;
    for (let run = 1; run <= repeat; run++) {
      const t0 = Date.now();
      let last: Turn;
      let fails: string[];
      try {
        last = await runCase(c, identities[c.identity]);
        const staged = (c.signup?.numbers ?? []).flatMap((n) => idNumberWindows(n.document_no));
        fails = check(c, last, [...identities[c.identity].secrets, ...staged]);
      } catch (err) {
        last = { reply: "", tools: [], suggestions: [], cards: [] };
        fails = [`threw: ${(err as Error).message}`];
      }
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      const runLabel = repeat > 1 ? ` [run ${run}]` : "";
      if (fails.length === 0) passed++;
      lines.push(
        `${fails.length === 0 ? "PASS" : "FAIL"}  ${c.id}${runLabel}  (${secs}s; tools: ${last.tools.join(", ") || "none"})`
      );
      for (const f of fails) lines.push(`      ✗ ${f}`);
      if (fails.length > 0 || verbose) lines.push(indent(last.reply || "(no reply)"));
    }
    results.set(c.id, { passed, lines });
  });

  let failedCases = 0;
  for (const c of cases) {
    const r = results.get(c.id);
    if (!r) continue;
    if (r.passed < repeat) failedCases++;
    console.log(r.lines.join("\n"));
  }
  const secs = ((Date.now() - started) / 1000).toFixed(0);
  console.log(`\n${cases.length - failedCases}/${cases.length} cases passed${repeat > 1 ? ` on every run` : ""} (${secs}s)`);
  process.exit(failedCases > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
