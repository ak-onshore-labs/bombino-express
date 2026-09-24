/**
 * Account applications, server-side (migrations/add_account_applications.sql).
 *
 * Every status change is a conditional UPDATE: `.in("status", from)` in the
 * WHERE clause, so two reviewers pressing the same button get one winner and
 * one null. The allowed-from table in shared/applicationStatus.ts decides which
 * buttons to show; this is what makes them safe to press at once.
 *
 * Nothing in this module ever sees a password.
 */

import { supabase } from "./supabaseClient.js";
import {
  OPEN_APPLICATION_STATUSES,
  customerCanEdit,
  type ApplicationStatus,
  type CustomerApplicationView,
  type RequestedChanges,
} from "../shared/applicationStatus.js";

/** The signup form as submitted. Company keys are absent on a personal one. */
export interface ApplicationDetails {
  full_name?: string;
  email: string;
  company_name?: string;
  gstin?: string;
  contact_person?: string;
  address?: string;
  pincode?: string;
  city?: string;
  state?: string;
  hub_id?: number;
  lut_no?: string | null;
  iec_branch_code?: string | null;
  bank_account_no?: string | null;
  bank_ad_code?: string | null;
}

export interface ApplicationRow {
  id: string;
  phone: string;
  signup_ref: string;
  account_type: "personal" | "company";
  company_category: string | null;
  details: ApplicationDetails;
  contract_signed_name: string;
  contract_version: string;
  contract_accepted_at: string;
  contract_accepted_ip: string | null;
  status: ApplicationStatus;
  reviewer_id: string | null;
  claimed_at: string | null;
  requested_changes: RequestedChanges | null;
  decision_note: string | null;
  resubmission_count: number;
  user_id: string | null;
  itd_customer_id: string | null;
  finalize_error: string | null;
  finalized_at: string | null;
  email_sent_at: string | null;
  email_error: string | null;
  whatsapp_sent_at: string | null;
  submitted_at: string;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApplicationEventRow {
  id: string;
  application_id: string;
  event: string;
  actor_id: string | null;
  note: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

const COLUMNS =
  "id, phone, signup_ref, account_type, company_category, details, contract_signed_name, " +
  "contract_version, contract_accepted_at, contract_accepted_ip, status, reviewer_id, claimed_at, " +
  "requested_changes, decision_note, resubmission_count, user_id, itd_customer_id, finalize_error, " +
  "finalized_at, email_sent_at, email_error, whatsapp_sent_at, submitted_at, decided_at, created_at, updated_at";

function getClient() {
  if (!supabase) {
    console.error("[accountApplicationsDb] supabase client is not configured");
    return null;
  }
  return supabase;
}

function logError(operation: string, error: { message?: string; code?: string } | null): void {
  console.error("[accountApplicationsDb] operation failed:", {
    operation,
    message: error?.message,
    code: error?.code,
  });
}

/** What the customer is shown. Reviewer identity and finalize state stay server-side. */
export function toCustomerView(row: ApplicationRow): CustomerApplicationView {
  return {
    id: row.id,
    status: row.status,
    account_type: row.account_type,
    company_category: row.company_category,
    submitted_at: row.submitted_at,
    decided_at: row.decided_at,
    requested_changes: row.status === "changes_requested" ? row.requested_changes : null,
    decision_note: row.status === "rejected" ? row.decision_note : null,
    can_edit: customerCanEdit(row.status),
  };
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function getApplicationById(id: string): Promise<ApplicationRow | null> {
  const client = getClient();
  if (!client) return null;
  const { data, error } = await client.from("account_applications").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) {
    logError("getApplicationById", error);
    return null;
  }
  return (data as unknown as ApplicationRow | null) ?? null;
}

/** The one open application on this number, if any. */
export async function getOpenApplicationByPhone(phone: string): Promise<ApplicationRow | null> {
  const client = getClient();
  if (!client) return null;
  const { data, error } = await client
    .from("account_applications")
    .select(COLUMNS)
    .eq("phone", phone)
    .in("status", [...OPEN_APPLICATION_STATUSES])
    .maybeSingle();
  if (error) {
    logError("getOpenApplicationByPhone", error);
    return null;
  }
  return (data as unknown as ApplicationRow | null) ?? null;
}

/**
 * The newest application on this number, open or not.
 *
 * What a guest's screen shows: an open one, or else the last decision, so a
 * rejected customer sees why rather than a blank profile.
 */
export async function getLatestApplicationByPhone(phone: string): Promise<ApplicationRow | null> {
  const client = getClient();
  if (!client) return null;
  const { data, error } = await client
    .from("account_applications")
    .select(COLUMNS)
    .eq("phone", phone)
    .order("submitted_at", { ascending: false })
    .limit(1);
  if (error) {
    logError("getLatestApplicationByPhone", error);
    return null;
  }
  return ((data ?? [])[0] as unknown as ApplicationRow | undefined) ?? null;
}

export interface ListApplicationsInput {
  statuses?: ApplicationStatus[];
  limit?: number;
}

/** The ops queue. Oldest first, so the longest wait is at the top. */
export async function listApplications(input: ListApplicationsInput = {}): Promise<ApplicationRow[]> {
  const client = getClient();
  if (!client) return [];
  let query = client
    .from("account_applications")
    .select(COLUMNS)
    .order("submitted_at", { ascending: true })
    .limit(Math.min(input.limit ?? 200, 500));
  if (input.statuses && input.statuses.length > 0) query = query.in("status", input.statuses);
  const { data, error } = await query;
  if (error) {
    logError("listApplications", error);
    return [];
  }
  return (data ?? []) as unknown as ApplicationRow[];
}

/**
 * Every ref with an open application. The retention sweep leaves these alone.
 *
 * Throws rather than answering empty: an empty set reads as "sweep everything",
 * and a sweep that cannot tell must delete nothing.
 */
export async function listOpenApplicationRefs(): Promise<Set<string>> {
  const client = getClient();
  if (!client) throw new Error("supabase client is not configured");
  const { data, error } = await client
    .from("account_applications")
    .select("signup_ref")
    .in("status", [...OPEN_APPLICATION_STATUSES]);
  if (error) throw new Error(`account_applications: ${error.message}`);
  return new Set((data ?? []).map((row) => (row as { signup_ref: string }).signup_ref));
}

/** Rejected or withdrawn before the cutoff: their personal data has served its purpose. */
export async function listClosedApplicationsBefore(cutoffIso: string): Promise<ApplicationRow[]> {
  const client = getClient();
  if (!client) return [];
  const { data, error } = await client
    .from("account_applications")
    .select(COLUMNS)
    .in("status", ["rejected", "withdrawn"])
    .lt("decided_at", cutoffIso);
  if (error) {
    logError("listClosedApplicationsBefore", error);
    return [];
  }
  return (data ?? []) as unknown as ApplicationRow[];
}

// ── Writes ───────────────────────────────────────────────────────────────────

export interface InsertApplicationInput {
  phone: string;
  signup_ref: string;
  account_type: "personal" | "company";
  company_category: string | null;
  details: ApplicationDetails;
  contract_signed_name: string;
  contract_version: string;
  contract_accepted_at: string;
  contract_accepted_ip: string | null;
}

export type InsertApplicationResult =
  | { ok: true; row: ApplicationRow }
  | { ok: false; reason: "open_exists" | "error" };

export async function insertApplication(input: InsertApplicationInput): Promise<InsertApplicationResult> {
  const client = getClient();
  if (!client) return { ok: false, reason: "error" };
  const { data, error } = await client.from("account_applications").insert(input).select(COLUMNS).single();
  if (error) {
    // 23505: the one-open-per-phone index. Another tab filed first.
    if (error.code === "23505") return { ok: false, reason: "open_exists" };
    logError("insertApplication", error);
    return { ok: false, reason: "error" };
  }
  return { ok: true, row: data as unknown as ApplicationRow };
}

/**
 * Move an application on, but only from one of `from`.
 *
 * Returns the updated row, or null when it was not in one of those statuses
 * any more (someone else acted first) or the write failed. Callers treat both
 * as "refresh and look again".
 */
export async function updateApplicationFrom(
  id: string,
  from: readonly ApplicationStatus[],
  patch: Partial<Omit<ApplicationRow, "id" | "created_at">>
): Promise<ApplicationRow | null> {
  const client = getClient();
  if (!client) return null;
  const { data, error } = await client
    .from("account_applications")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .in("status", [...from])
    .select(COLUMNS)
    .maybeSingle();
  if (error) {
    logError("updateApplicationFrom", error);
    return null;
  }
  return (data as unknown as ApplicationRow | null) ?? null;
}

/** Bookkeeping on an approved application: finalize and email state. Status unchanged. */
export async function patchApprovedApplication(
  id: string,
  patch: Pick<
    Partial<ApplicationRow>,
    "finalize_error" | "finalized_at" | "email_sent_at" | "email_error" | "whatsapp_sent_at"
  >
): Promise<boolean> {
  return (await updateApplicationFrom(id, ["approved"], patch)) !== null;
}

export async function insertApplicationEvent(input: {
  application_id: string;
  event: string;
  actor_id?: string | null;
  note?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const client = getClient();
  if (!client) return;
  const { error } = await client.from("account_application_events").insert({
    application_id: input.application_id,
    event: input.event,
    actor_id: input.actor_id ?? null,
    note: input.note ?? null,
    metadata: input.metadata ?? {},
  });
  // History is worth a log line when it fails, never a failed request.
  if (error) logError("insertApplicationEvent", error);
}

export async function listApplicationEvents(applicationId: string): Promise<ApplicationEventRow[]> {
  const client = getClient();
  if (!client) return [];
  const { data, error } = await client
    .from("account_application_events")
    .select("id, application_id, event, actor_id, note, metadata, created_at")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: true });
  if (error) {
    logError("listApplicationEvents", error);
    return [];
  }
  return (data ?? []) as unknown as ApplicationEventRow[];
}

/** Delete closed applications the retention sweep picked out. Events go with them (ON DELETE CASCADE). */
export async function deleteApplicationsByIds(ids: string[]): Promise<number> {
  const client = getClient();
  if (!client || ids.length === 0) return 0;
  const { data, error } = await client.from("account_applications").delete().in("id", ids).select("id");
  if (error) {
    logError("deleteApplicationsByIds", error);
    return 0;
  }
  return (data ?? []).length;
}

// ── Duplicates ───────────────────────────────────────────────────────────────

export interface ApplicationDuplicate {
  kind: "account" | "application";
  /** Which field matched. */
  field: "gstin" | "email";
  id: string;
  label: string;
  status: string | null;
}

/**
 * Accounts and other applications carrying the same GSTIN or email.
 *
 * Shown to the reviewer, never used to refuse. The same company adding a
 * second mobile number is the ordinary reason, and whether to link it to the
 * existing ITD customer is the team's call.
 */
export async function findApplicationDuplicates(row: ApplicationRow): Promise<ApplicationDuplicate[]> {
  const client = getClient();
  if (!client) return [];
  const out: ApplicationDuplicate[] = [];
  const checks: Array<{ field: "gstin" | "email"; value: string | undefined }> = [
    { field: "gstin", value: row.details.gstin?.toUpperCase() },
    { field: "email", value: row.details.email?.toLowerCase() },
  ];

  for (const { field, value: raw } of checks) {
    if (!raw) continue;
    // Case-insensitive equality, not a pattern: `_` is common in an email and
    // is a wildcard to ILIKE.
    const value = raw.replace(/[\\%_]/g, (c) => `\\${c}`);

    const { data: accounts, error: accountError } = await client
      .from("itd_users")
      .select("id, full_name, phone")
      .ilike(field, value)
      .eq("role", "customer")
      .limit(5);
    if (accountError) logError(`findApplicationDuplicates/itd_users/${field}`, accountError);
    for (const a of (accounts ?? []) as Array<{ id: string; full_name: string; phone: string | null }>) {
      out.push({ kind: "account", field, id: a.id, label: `${a.full_name}${a.phone ? ` · ${a.phone}` : ""}`, status: null });
    }

    const { data: apps, error: appError } = await client
      .from("account_applications")
      .select("id, phone, status, details")
      .neq("id", row.id)
      .filter(`details->>${field}`, "ilike", value)
      .limit(5);
    if (appError) logError(`findApplicationDuplicates/applications/${field}`, appError);
    for (const a of (apps ?? []) as Array<{ id: string; phone: string; status: string }>) {
      out.push({ kind: "application", field, id: a.id, label: a.phone, status: a.status });
    }
  }
  return out;
}
