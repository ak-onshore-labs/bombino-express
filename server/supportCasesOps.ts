/**
 * Support cases, from ops' side (BIA 3.0, package 4.2): the queue, one case,
 * a reply that reaches the customer's bell, and closing it.
 *
 * Cases are opened by BIA (server/supportCases.ts) once BIA_MODULES includes
 * "handoff". Every read here fails soft: until migrations/create_support_cases.sql
 * has run, the queue answers `null` and the console says cases aren't set up.
 *
 * Staff only: the routes (server/routes/opsCases.ts) sit behind the same role
 * guard as the rest of the ops console.
 */

import { insertNotification } from "./appDb.js";
import { supabase } from "./supabaseClient.js";

export const CASE_STATUSES = ["open", "answered", "closed"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export function isCaseStatus(value: unknown): value is CaseStatus {
  return (CASE_STATUSES as readonly unknown[]).includes(value);
}

export interface OpsCaseSummary {
  id: string;
  caseNo: string;
  status: CaseStatus;
  category: string;
  orderNo: string | null;
  /** The first line of the summary, for the queue. */
  headline: string;
  owner: "account" | "guest";
  customerName: string | null;
  createdAt: string;
}

export interface OpsCaseDetail extends OpsCaseSummary {
  summary: string;
  transcript: { role: "user" | "assistant"; content: string }[];
  opsReply: string | null;
  answeredAt: string | null;
  closedAt: string | null;
  customerPhone: string | null;
  /** The ops order page's id for `orderNo`, when the order exists. */
  orderId: string | null;
}

interface CaseRow {
  id: string;
  case_no: string;
  status: string;
  category: string;
  order_no: string | null;
  summary: string;
  user_id: string | null;
  guest_ref: string | null;
  created_at: string;
  transcript?: unknown;
  ops_reply?: string | null;
  answered_at?: string | null;
  closed_at?: string | null;
  itd_users?: { full_name: string | null; phone: string | null } | null;
}

const LIST_COLUMNS = "id, case_no, status, category, order_no, summary, user_id, guest_ref, created_at, itd_users(full_name, phone)";

function toSummary(row: CaseRow): OpsCaseSummary {
  return {
    id: row.id,
    caseNo: row.case_no,
    status: isCaseStatus(row.status) ? row.status : "open",
    category: row.category,
    orderNo: row.order_no,
    headline: row.summary.split("\n")[0] ?? "",
    owner: row.user_id ? "account" : "guest",
    customerName: row.itd_users?.full_name ?? null,
    createdAt: row.created_at,
  };
}

function transcriptOf(value: unknown): OpsCaseDetail["transcript"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((m) => {
    if (!m || typeof m !== "object") return [];
    const { role, content } = m as { role?: unknown; content?: unknown };
    return (role === "user" || role === "assistant") && typeof content === "string" ? [{ role, content }] : [];
  });
}

/** The queue, newest first; `null` when cases can't be read (the migration not run). */
export async function listCasesForOps(status: CaseStatus | null): Promise<OpsCaseSummary[] | null> {
  if (!supabase) return null;
  let query = supabase.from("support_cases").select(LIST_COLUMNS).order("created_at", { ascending: false }).limit(200);
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) {
    console.warn(`[ops/cases] could not list cases: ${error.message} (has migrations/create_support_cases.sql been run?)`);
    return null;
  }
  return ((data ?? []) as unknown as CaseRow[]).map(toSummary);
}

/** One case; "missing" when there's no such case, `null` when cases can't be read. */
export async function getCaseForOps(id: string): Promise<OpsCaseDetail | "missing" | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("support_cases")
    .select(`${LIST_COLUMNS}, transcript, ops_reply, answered_at, closed_at`)
    .eq("id", id)
    .maybeSingle();
  if (error) return null;
  if (!data) return "missing";
  const row = data as unknown as CaseRow;
  let orderId: string | null = null;
  if (row.order_no) {
    const { data: order } = await supabase.from("orders").select("id").eq("order_no", row.order_no).maybeSingle();
    orderId = (order as { id?: string } | null)?.id ?? null;
  }
  return {
    ...toSummary(row),
    summary: row.summary,
    transcript: transcriptOf(row.transcript),
    opsReply: row.ops_reply ?? null,
    answeredAt: row.answered_at ?? null,
    closedAt: row.closed_at ?? null,
    customerPhone: row.itd_users?.phone ?? null,
    orderId,
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Answer a case: the reply is saved, the case reads "answered", and the
 * customer's bell gets it. "missing" for no such case; "closed" for one
 * already closed; `null` when it couldn't be saved.
 */
export async function replyToCase(
  id: string,
  reply: string,
  staffId: string | null
): Promise<{ caseNo: string; notified: boolean } | "missing" | "closed" | null> {
  if (!supabase) return null;
  const { data: found, error: findError } = await supabase
    .from("support_cases")
    .select("case_no, status, user_id, guest_ref")
    .eq("id", id)
    .maybeSingle();
  if (findError) return null;
  if (!found) return "missing";
  const row = found as { case_no: string; status: string; user_id: string | null; guest_ref: string | null };
  if (row.status === "closed") return "closed";

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("support_cases")
    .update({
      ops_reply: reply,
      status: "answered",
      answered_at: now,
      answered_by: staffId && UUID_RE.test(staffId) ? staffId : null,
      updated_at: now,
    })
    .eq("id", id);
  if (error) return null;

  const note = {
    title: `Reply on your case ${row.case_no}`,
    body: reply.length > 240 ? `${reply.slice(0, 237)}...` : reply,
    data: { kind: "support_case", caseNo: row.case_no, caseId: id },
  };
  const owner = row.user_id ? { user_id: row.user_id } : row.guest_ref ? { guest_ref: row.guest_ref } : null;
  let notified = false;
  if (owner) {
    // "support_case" says what it is; if the live table only takes the types
    // it already knows, the reply still goes out as an ordinary update.
    notified = await insertNotification({ ...owner, ...note, type: "support_case" });
    if (!notified) notified = await insertNotification({ ...owner, ...note, type: "order_status" });
  }
  return { caseNo: row.case_no, notified };
}

/** Close a case. "missing" for no such case; `null` when it couldn't be saved. */
export async function closeCase(id: string): Promise<true | "missing" | null> {
  if (!supabase) return null;
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("support_cases")
    .update({ status: "closed", closed_at: now, updated_at: now })
    .eq("id", id)
    .select("id");
  if (error) return null;
  return data && data.length > 0 ? true : "missing";
}
