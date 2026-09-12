/**
 * Support cases (BIA 3.0, package 4.1): an escalation that reaches someone.
 *
 * With the handoff module on, escalate_support opens a case instead of only
 * showing the contact buttons: a case number (BIA-1001 onwards), the owner
 * (an account or a guest — never a signed-out visitor), the order it's about
 * when the caller owns one, a category, a three-line summary for ops, and the
 * conversation as it stood. Ops answer from the console's Cases tab (4.2).
 *
 * One open case per owner and order a day: asking again finds the case that's
 * already open rather than opening a second.
 *
 * Storage is behind CaseStore. The database store writes support_cases
 * (migrations/create_support_cases.sql) and throws until that has run, which
 * the caller turns into the old "contact our team" answer. The eval runner
 * and the unit tests use the in-memory store, so neither writes to the
 * shared database.
 */

import OpenAI from "openai";
import { supabase } from "./supabaseClient.js";
import { maskSensitive } from "./supportPrivacy.js";
import type { ChatMessage } from "./supportTypes.js";

export const CASE_CATEGORIES = ["damaged", "lost", "delayed", "refund", "customs", "rider", "cancel", "other"] as const;

export type CaseCategory = (typeof CASE_CATEGORIES)[number];

export function isCaseCategory(value: unknown): value is CaseCategory {
  return (CASE_CATEGORIES as readonly unknown[]).includes(value);
}

/** How a category reads on the case card. */
export const CASE_TOPICS: Record<CaseCategory, string> = {
  damaged: "Damaged parcel",
  lost: "Missing parcel",
  delayed: "Delayed delivery",
  refund: "Refund or charge",
  customs: "Customs hold",
  rider: "Rider or pickup",
  cancel: "Cancelling a booking",
  other: "Help from our team",
};

export type CaseOwner = { kind: "account"; userId: string } | { kind: "guest"; guestRef: string };

export interface SupportCase {
  caseNo: string;
  status: "open" | "answered" | "closed";
  orderNo: string | null;
  category: CaseCategory;
  createdAt: string;
  /** What our team wrote back (the Cases tab, 4.2); null until they have. */
  reply: string | null;
  answeredAt: string | null;
}

export interface NewCase {
  owner: CaseOwner;
  orderNo: string | null;
  category: CaseCategory;
  summary: string;
  transcript: ChatMessage[];
  turnId: string | null;
}

export interface CaseStore {
  /** The owner's open case for this order (or for no order) opened since `sinceIso`. */
  findOpen(owner: CaseOwner, orderNo: string | null, sinceIso: string): Promise<SupportCase | null>;
  /** Opens a case. Throws when it can't be stored. */
  insert(c: NewCase): Promise<SupportCase>;
  /** The owner's cases, newest first: just `caseNo` when given (never another owner's). */
  listForOwner(owner: CaseOwner, caseNo: string | null, limit: number): Promise<SupportCase[]>;
}

// ─── Stores ──────────────────────────────────────────────────────────────────

interface CaseRow {
  case_no: string;
  status: SupportCase["status"];
  order_no: string | null;
  category: string;
  created_at: string;
  ops_reply?: string | null;
  answered_at?: string | null;
}

function fromRow(row: CaseRow): SupportCase {
  return {
    caseNo: row.case_no,
    status: row.status,
    orderNo: row.order_no,
    category: isCaseCategory(row.category) ? row.category : "other",
    createdAt: row.created_at,
    reply: row.ops_reply ?? null,
    answeredAt: row.answered_at ?? null,
  };
}

const CASE_COLUMNS = "case_no, status, order_no, category, created_at, ops_reply, answered_at";

export const databaseCaseStore: CaseStore = {
  async findOpen(owner, orderNo, sinceIso) {
    if (!supabase) throw new Error("no database");
    let query = supabase.from("support_cases").select(CASE_COLUMNS).eq("status", "open").gte("created_at", sinceIso);
    query = owner.kind === "account" ? query.eq("user_id", owner.userId) : query.eq("guest_ref", owner.guestRef);
    query = orderNo ? query.eq("order_no", orderNo) : query.is("order_no", null);
    const { data, error } = await query.order("created_at", { ascending: false }).limit(1);
    if (error) throw new Error(error.message);
    const row = (data ?? [])[0] as CaseRow | undefined;
    return row ? fromRow(row) : null;
  },
  async insert(c) {
    if (!supabase) throw new Error("no database");
    const { data, error } = await supabase
      .from("support_cases")
      .insert({
        user_id: c.owner.kind === "account" ? c.owner.userId : null,
        guest_ref: c.owner.kind === "guest" ? c.owner.guestRef : null,
        order_no: c.orderNo,
        category: c.category,
        summary: c.summary,
        transcript: c.transcript,
        turn_id: c.turnId,
      })
      .select(CASE_COLUMNS)
      .single();
    if (error || !data) throw new Error(error?.message ?? "no row");
    return fromRow(data as CaseRow);
  },
  async listForOwner(owner, caseNo, limit) {
    if (!supabase) throw new Error("no database");
    let query = supabase.from("support_cases").select(CASE_COLUMNS);
    query = owner.kind === "account" ? query.eq("user_id", owner.userId) : query.eq("guest_ref", owner.guestRef);
    if (caseNo) query = query.eq("case_no", caseNo);
    const { data, error } = await query.order("created_at", { ascending: false }).limit(limit);
    if (error) throw new Error(error.message);
    return ((data ?? []) as CaseRow[]).map(fromRow);
  },
};

/** Cases kept in memory, numbered from BIA-1001: for the eval runner and tests. */
export function memoryCaseStore(): CaseStore & { cases: (NewCase & SupportCase)[] } {
  const cases: (NewCase & SupportCase)[] = [];
  const sameOwner = (a: CaseOwner, b: CaseOwner): boolean =>
    a.kind === "account" ? b.kind === "account" && a.userId === b.userId : b.kind === "guest" && a.guestRef === b.guestRef;
  const view = (c: NewCase & SupportCase): SupportCase => ({
    caseNo: c.caseNo,
    status: c.status,
    orderNo: c.orderNo,
    category: c.category,
    createdAt: c.createdAt,
    reply: c.reply,
    answeredAt: c.answeredAt,
  });
  return {
    cases,
    async findOpen(owner, orderNo, sinceIso) {
      const hit = [...cases]
        .reverse()
        .find((c) => c.status === "open" && sameOwner(c.owner, owner) && c.orderNo === orderNo && c.createdAt >= sinceIso);
      return hit ? view(hit) : null;
    },
    async insert(c) {
      const opened: NewCase & SupportCase = {
        ...c,
        caseNo: `BIA-${1001 + cases.length}`,
        status: "open",
        createdAt: new Date().toISOString(),
        reply: null,
        answeredAt: null,
      };
      cases.push(opened);
      return view(opened);
    },
    async listForOwner(owner, caseNo, limit) {
      return [...cases]
        .reverse()
        .filter((c) => sameOwner(c.owner, owner) && (!caseNo || c.caseNo === caseNo))
        .slice(0, limit)
        .map(view);
    },
  };
}

let store: CaseStore = databaseCaseStore;

/** Where cases go. Only the eval runner and tests change it. */
export function replaceCaseStore(next: CaseStore | null): void {
  store = next ?? databaseCaseStore;
}

// ─── The summary ─────────────────────────────────────────────────────────────

const SUMMARY_PROMPT = `You write the note our support team reads first on a customer's case.
Exactly three short lines, plain text, no labels, no markdown:
1. What happened, in facts from the conversation only.
2. The order number if one is given below, otherwise "No order named".
3. What the customer wants.
Never add advice, promises, apologies or guesses. No names, phone numbers or ID numbers.`;

/** The last part of the conversation, capped, for the summary and the snapshot. */
function recent(transcript: readonly ChatMessage[], max = 16): ChatMessage[] {
  return transcript.slice(-max).map((m) => ({ role: m.role, content: maskSensitive(m.content).slice(0, 1200) }));
}

/** Three lines from the conversation; a plain fallback when the model can't be reached. */
export async function summarizeForCase(
  transcript: readonly ChatMessage[],
  orderNo: string | null,
  client: OpenAI | null
): Promise<string> {
  const convo = recent(transcript);
  const lastUser = [...convo].reverse().find((m) => m.role === "user")?.content ?? "";
  const fallback = [
    lastUser.replace(/\s+/g, " ").slice(0, 200) || "The customer asked for our team.",
    orderNo ?? "No order named",
    "Help from our team.",
  ].join("\n");
  if (!client) return fallback;
  try {
    const res = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 160,
      messages: [
        { role: "system", content: SUMMARY_PROMPT },
        {
          role: "user",
          content: `Order: ${orderNo ?? "none"}\n\n${convo.map((m) => `${m.role === "user" ? "Customer" : "BIA"}: ${m.content}`).join("\n")}`,
        },
      ],
    });
    const text = (res.choices[0]?.message?.content ?? "").trim();
    const lines = text.split(/\n+/).map((l) => l.replace(/^\s*(?:\d[.)]|[-•])\s*/, "").trim()).filter(Boolean).slice(0, 3);
    return lines.length === 3 ? maskSensitive(lines.join("\n")) : fallback;
  } catch {
    return fallback;
  }
}

function openAiClient(): OpenAI | null {
  const key = process.env.OPENAI_API_KEY;
  return key && key.trim() ? new OpenAI({ apiKey: key, timeout: 15_000 }) : null;
}

// ─── Opening one ─────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

export interface OpenedCase extends SupportCase {
  /** Already open from the last day, so no new case was made. */
  existing: boolean;
}

/**
 * The owner's case for this order: the one already open from the last day,
 * or a new one. Throws when cases can't be stored (the migration not run).
 */
export async function openSupportCase(input: {
  owner: CaseOwner;
  orderNo: string | null;
  category: CaseCategory;
  transcript: readonly ChatMessage[];
  turnId: string | null;
}): Promise<OpenedCase> {
  const since = new Date(Date.now() - DAY_MS).toISOString();
  const already = await store.findOpen(input.owner, input.orderNo, since);
  if (already) return { ...already, existing: true };
  const summary = await summarizeForCase(input.transcript, input.orderNo, openAiClient());
  const opened = await store.insert({
    owner: input.owner,
    orderNo: input.orderNo,
    category: input.category,
    summary,
    transcript: recent(input.transcript, 40),
    turnId: input.turnId,
  });
  return { ...opened, existing: false };
}

/**
 * The owner's own cases, for BIA to answer "did the team reply?" (4.3): the one
 * named, or the latest few. Throws when cases can't be read (the migration not
 * run).
 */
export async function findOwnerCases(owner: CaseOwner, caseNo: string | null): Promise<SupportCase[]> {
  return store.listForOwner(owner, caseNo, caseNo ? 1 : 3);
}
