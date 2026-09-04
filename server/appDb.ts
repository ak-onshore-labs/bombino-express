import { randomUUID } from "node:crypto";
import type { CreateShipmentResponse } from "./itd.js";
import { supabase } from "./supabaseClient.js";
import type { ChatMessage } from "./supportTypes.js";
import type { CompanyCategory } from "../shared/accountSpec.js";

type Json = Record<string, unknown> | unknown[] | null;

type AddressInsert = {
  user_id: string;
  type: "sender" | "recipient";
  full_name: string;
  company: string | null;
  email: string | null;
  phone: string;
  address_line_1: string;
  city: string;
  state: string | null;
  pincode: string | null;
  country_code: string;
  country_name: string | null;
};

type ShipmentInsert = {
  user_id: string;
  awb_number: string;
  sender_address_id: string;
  recipient_address_id: string;
  sender_name: string;
  sender_company: string | null;
  sender_phone: string;
  sender_city: string;
  sender_state: string | null;
  sender_country: string | null;
  consignee_name: string;
  consignee_company: string | null;
  consignee_phone: string;
  consignee_city: string;
  consignee_state: string | null;
  consignee_country: string | null;
  service_name: string | null;
  service_code: string | null;
  product_code: string | null;
  origin_country: string;
  destination_country: string;
  weight_kg: number | null;
  pieces: number | null;
  declared_value: number | null;
  currency: string;
  invoice_number: string | null;
  contents_description: string | null;
  total_amount: number | null;
  other_charges: number | null;
  current_status: string;
  booking_date: string;
  itd_response: CreateShipmentResponse;
};

function logSupabaseError(operation: string, error: { message?: string; code?: string } | null): void {
  console.error("[appDb] supabase operation failed (non-fatal):", {
    operation,
    message: error?.message,
    code: error?.code,
  });
}

function getSupabaseClient() {
  if (!supabase) {
    console.error("[appDb] supabase client is not configured");
    return null;
  }
  return supabase;
}

export async function findItdUserIdByCustomerId(
  itdCustomerId: string
): Promise<{ id: string } | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("itd_users")
    .select("id")
    .eq("itd_customer_id", itdCustomerId)
    .maybeSingle();

  if (error) {
    logSupabaseError("findItdUserIdByCustomerId", error);
    return null;
  }
  return data;
}

export async function findItdUserIdByPhone(phone: string): Promise<{ id: string } | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("itd_users")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();

  if (error) {
    logSupabaseError("findItdUserIdByPhone", error);
    return null;
  }
  return data;
}

type UpsertItdUserInput = {
  itd_customer_id: string;
  itd_customer_code: string;
  email: string;
  full_name: string;
  username: string;
  role: string;
  itd_token?: string | null;
  itd_token_expires_at?: string | null;
  itd_password_encrypted?: string | null;
  encryption_iv?: string | null;
  phone?: string | null;
  account_type?: "personal" | "company";
  company_name?: string | null;
  gstin?: string | null;
  company_category?: CompanyCategory | null;
  contract_head?: string | null;
  group_code?: string | null;
  contact_person?: string | null;
  lut_no?: string | null;
  iec_branch_code?: string | null;
  bank_account_no?: string | null;
  bank_ad_code?: string | null;
  contract_signed_name?: string | null;
  contract_version?: string | null;
  contract_accepted_at?: string | null;
  contract_accepted_ip?: string | null;
};

export async function upsertItdUserAndReturnId(
  payload: UpsertItdUserInput
): Promise<{ id: string } | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const now = new Date().toISOString();
  const {
    itd_token,
    itd_token_expires_at,
    itd_password_encrypted,
    encryption_iv,
    phone,
    account_type,
    company_name,
    gstin,
    company_category,
    contract_head,
    group_code,
    contact_person,
    lut_no,
    iec_branch_code,
    bank_account_no,
    bank_ad_code,
    contract_signed_name,
    contract_version,
    contract_accepted_at,
    contract_accepted_ip,
    ...rest
  } = payload;
  const optionalCols: Record<string, string | null | undefined> = {};
  if (itd_token !== undefined) optionalCols.itd_token = itd_token;
  if (itd_token_expires_at !== undefined) optionalCols.itd_token_expires_at = itd_token_expires_at;
  if (itd_password_encrypted !== undefined) {
    optionalCols.itd_password_encrypted = itd_password_encrypted;
  }
  if (encryption_iv !== undefined) optionalCols.encryption_iv = encryption_iv;
  if (phone !== undefined) optionalCols.phone = phone;
  if (account_type !== undefined) optionalCols.account_type = account_type;
  if (company_name !== undefined) optionalCols.company_name = company_name;
  if (gstin !== undefined) optionalCols.gstin = gstin;
  if (company_category !== undefined) optionalCols.company_category = company_category;
  if (contract_head !== undefined) optionalCols.contract_head = contract_head;
  if (group_code !== undefined) optionalCols.group_code = group_code;
  if (contact_person !== undefined) optionalCols.contact_person = contact_person;
  if (lut_no !== undefined) optionalCols.lut_no = lut_no;
  if (iec_branch_code !== undefined) optionalCols.iec_branch_code = iec_branch_code;
  if (bank_account_no !== undefined) optionalCols.bank_account_no = bank_account_no;
  if (bank_ad_code !== undefined) optionalCols.bank_ad_code = bank_ad_code;
  if (contract_signed_name !== undefined) optionalCols.contract_signed_name = contract_signed_name;
  if (contract_version !== undefined) optionalCols.contract_version = contract_version;
  if (contract_accepted_at !== undefined) optionalCols.contract_accepted_at = contract_accepted_at;
  if (contract_accepted_ip !== undefined) optionalCols.contract_accepted_ip = contract_accepted_ip;

  const { data, error } = await client
    .from("itd_users")
    .upsert(
      {
        ...rest,
        ...optionalCols,
        last_login_at: now,
        updated_at: now,
      },
      { onConflict: "itd_customer_id" }
    )
    .select("id")
    .single();

  if (error) {
    logSupabaseError("upsertItdUserAndReturnId", error);
    return null;
  }
  return data;
}

export type CreatedStaffUser = {
  id: string;
  phone: string;
  full_name: string;
  role: string;
};

export type StaffUserRow = {
  id: string;
  full_name: string;
  phone: string | null;
  role: string;
  is_active: boolean;
};

export type InsertStaffUserInput = {
  full_name: string;
  phone: string;
  role: "agent" | "admin";
  hub_id: number;
};

/**
 * Mint a staff row the same way the seed scripts do: synthetic local-* ITD
 * ids, is_active true, account_type left to the DB default (`personal`).
 * Returns `"taken"` on itd_users_phone_key (23505) so a raced insert is 409.
 */
export async function insertStaffUser(
  input: InsertStaffUserInput
): Promise<CreatedStaffUser | "taken" | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const syntheticId = `local-${randomUUID()}`;
  const now = new Date().toISOString();

  const { data, error } = await client
    .from("itd_users")
    .insert({
      itd_customer_id: syntheticId,
      itd_customer_code: syntheticId,
      full_name: input.full_name,
      email: "",
      username: input.phone,
      phone: input.phone,
      role: input.role,
      is_active: true,
      metadata: {
        created_by: "ops_console",
        created_at: now,
        hub_id: input.hub_id,
      },
    })
    .select("id, phone, full_name, role")
    .single();

  if (error) {
    if (error.code === "23505") return "taken";
    logSupabaseError("insertStaffUser", error);
    return null;
  }
  if (!data?.id || typeof data.full_name !== "string" || typeof data.role !== "string") {
    return null;
  }
  return {
    id: data.id,
    phone: typeof data.phone === "string" ? data.phone : input.phone,
    full_name: data.full_name,
    role: data.role,
  };
}

export async function listStaffUsers(): Promise<StaffUserRow[] | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("itd_users")
    .select("id, full_name, phone, role, is_active")
    .in("role", ["agent", "admin", "super_admin"])
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    logSupabaseError("listStaffUsers", error);
    return null;
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    full_name: String(row.full_name ?? ""),
    phone: typeof row.phone === "string" ? row.phone : null,
    role: String(row.role ?? ""),
    is_active: row.is_active !== false,
  }));
}

const OPS_CUSTOMER_COLUMNS =
  "id, full_name, phone, account_type, company_name, company_category, gstin, created_at";

const OPS_CUSTOMER_LIST_LIMIT = 200;

export type OpsCustomerRow = {
  id: string;
  full_name: string;
  phone: string | null;
  account_type: "personal" | "company";
  company_name: string | null;
  company_category: string | null;
  gstin: string | null;
  created_at: string;
};

export type ListCustomersForOpsInput = {
  q?: string;
  account_type?: "personal" | "company";
  kyc?: "on_file" | "none";
  limit?: number;
};

/** Strip PostgREST `.or()` metacharacters so a typed name cannot break the filter. */
function sanitizeCustomerSearch(raw: string): string {
  return raw.trim().slice(0, 80).replace(/[,()"\\]/g, " ").replace(/\s+/g, " ").trim();
}

function escapeIlikePattern(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function mapOpsCustomerRow(row: {
  id?: unknown;
  full_name?: unknown;
  phone?: unknown;
  account_type?: unknown;
  company_name?: unknown;
  company_category?: unknown;
  gstin?: unknown;
  created_at?: unknown;
}): OpsCustomerRow {
  return {
    id: String(row.id ?? ""),
    full_name: String(row.full_name ?? ""),
    phone: typeof row.phone === "string" ? row.phone : null,
    account_type: row.account_type === "company" ? "company" : "personal",
    company_name: typeof row.company_name === "string" ? row.company_name : null,
    company_category: typeof row.company_category === "string" ? row.company_category : null,
    gstin: typeof row.gstin === "string" ? row.gstin : null,
    created_at: String(row.created_at ?? ""),
  };
}

/**
 * Ops customer directory. Customers only — staff never appear here.
 * Search, account_type, and KYC filters run in SQL (ops_list_customers),
 * then the 200 newest matches are returned.
 */
export async function listCustomersForOps(
  input: ListCustomersForOpsInput = {}
): Promise<OpsCustomerRow[] | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const limit = input.limit ?? OPS_CUSTOMER_LIST_LIMIT;
  const q = typeof input.q === "string" ? sanitizeCustomerSearch(input.q) : "";

  const { data, error } = await client.rpc("ops_list_customers", {
    p_q: q || null,
    p_account_type: input.account_type ?? null,
    p_kyc: input.kyc ?? null,
    p_limit: limit,
  });

  if (error) {
    logSupabaseError("listCustomersForOps", error);
    return null;
  }

  const raw = Array.isArray(data) ? data : [];
  return raw
    .map((row) => mapOpsCustomerRow(row as Parameters<typeof mapOpsCustomerRow>[0]))
    .filter((row) => row.id !== "");
}

/** One customer by id. Null when missing or not role=customer. */
export async function getCustomerForOps(id: string): Promise<OpsCustomerRow | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("itd_users")
    .select(OPS_CUSTOMER_COLUMNS)
    .eq("id", id)
    .eq("role", "customer")
    .maybeSingle();

  if (error) {
    logSupabaseError("getCustomerForOps", error);
    return null;
  }
  if (!data) return null;
  const row = mapOpsCustomerRow(data);
  return row.id ? row : null;
}

/**
 * One staff row that is an active pickup agent. Used to validate an ops
 * assignment target — `orders.agent_id` FK only proves the id exists, not
 * the role or that the account is still live.
 *
 * Returns null when the id is missing, not an agent, or not `is_active`.
 */
export async function findActiveAgentById(id: string): Promise<StaffUserRow | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("itd_users")
    .select("id, full_name, phone, role, is_active")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    logSupabaseError("findActiveAgentById", error);
    return null;
  }
  if (!data?.id) return null;

  const role = String(data.role ?? "");
  if (role !== "agent" || data.is_active !== true) return null;

  return {
    id: String(data.id),
    full_name: String(data.full_name ?? ""),
    phone: typeof data.phone === "string" ? data.phone : null,
    role,
    is_active: true,
  };
}

/**
 * Merge a patch into `itd_users.metadata` (the §4 escape hatch).
 *
 * Read-modify-write, not a `jsonb ||` in SQL — supabase-js cannot express one.
 * Safe for the signup path it was written for (the row was created moments
 * earlier by the same request, so nothing else is racing it). If a concurrent
 * writer ever touches this column, move the merge into a Postgres function.
 *
 * Non-fatal by contract: returns false and logs on failure. Signup must not
 * fail because attribution context could not be recorded.
 */
export async function mergeItdUserMetadataById(
  userId: string,
  patch: Record<string, unknown>
): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;

  const { data: existing, error: readError } = await client
    .from("itd_users")
    .select("metadata")
    .eq("id", userId)
    .maybeSingle();

  if (readError) {
    logSupabaseError("mergeItdUserMetadataById:read", readError);
    return false;
  }

  const current =
    existing?.metadata && typeof existing.metadata === "object" && !Array.isArray(existing.metadata)
      ? (existing.metadata as Record<string, unknown>)
      : {};

  const { error: writeError } = await client
    .from("itd_users")
    .update({ metadata: { ...current, ...patch }, updated_at: new Date().toISOString() })
    .eq("id", userId);

  if (writeError) {
    logSupabaseError("mergeItdUserMetadataById:write", writeError);
    return false;
  }
  return true;
}

export type ItdUserTokenSecretsRow = {
  itd_token_expires_at: string | null;
  itd_password_encrypted: string | null;
  encryption_iv: string | null;
};

export async function getItdUserTokenAndSecretsById(
  userId: string
): Promise<ItdUserTokenSecretsRow | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("itd_users")
    .select("itd_token_expires_at, itd_password_encrypted, encryption_iv")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    logSupabaseError("getItdUserTokenAndSecretsById", error);
    return null;
  }
  return data;
}

export async function updateItdUserTokenById(
  userId: string,
  token: string,
  expiresAtIso: string
): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;

  const { error } = await client
    .from("itd_users")
    .update({
      itd_token: token,
      itd_token_expires_at: expiresAtIso,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);

  if (error) {
    logSupabaseError("updateItdUserTokenById", error);
    return false;
  }
  return true;
}

/**
 * Move an account onto a different phone number.
 *
 * Callers must have verified an OTP sent to the NEW number — the phone is the
 * primary sign-in credential, so writing one the caller has not proven they
 * control hands the account to whoever owns that number.
 *
 * Returns "taken" on a collision with itd_users_phone_key rather than a bare
 * false, so the route can say which of the two failures happened.
 */
export async function updateItdUserPhoneById(
  userId: string,
  phone: string
): Promise<"ok" | "taken" | "error"> {
  const client = getSupabaseClient();
  if (!client) return "error";

  const { error } = await client
    .from("itd_users")
    .update({ phone, updated_at: new Date().toISOString() })
    .eq("id", userId);

  if (error) {
    // 23505 = unique_violation
    if (error.code === "23505") return "taken";
    logSupabaseError("updateItdUserPhoneById", error);
    return "error";
  }
  return "ok";
}

/**
 * Rename an account's display username.
 *
 * Display only — nothing in this app authenticates, looks up, or calls ITD with
 * this column. (`itd.ts` builds its own `username` form field for the rate API
 * from the email; unrelated.)
 *
 * Caveat worth knowing: for ITD-provisioned accounts, POST /api/auth/link/itd
 * upserts `username` from ITD's login response, so re-linking replaces whatever
 * was set here. Signing in by phone does not — mintItdSession only touches the
 * token — so an edit survives ordinary use.
 */
export async function updateItdUserUsernameById(
  userId: string,
  username: string
): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;

  const { error } = await client
    .from("itd_users")
    .update({ username, updated_at: new Date().toISOString() })
    .eq("id", userId);

  if (error) {
    logSupabaseError("updateItdUserUsernameById", error);
    return false;
  }
  return true;
}

/**
 * Whether this account has an ITD password on file.
 *
 * Returns a boolean, never the ciphertext — callers only ever need to know
 * whether a password step applies, and ITD_USER_PUBLIC_COLUMNS deliberately
 * keeps the credential columns away from anything browser-facing.
 */
export async function itdUserHasStoredPassword(userId: string): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;

  const { data, error } = await client
    .from("itd_users")
    .select("itd_password_encrypted")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    logSupabaseError("itdUserHasStoredPassword", error);
    return false;
  }
  return Boolean(data?.itd_password_encrypted);
}

/**
 * Detach the phone number from an account and drop the ITD credential it was
 * standing in for.
 *
 * The stored password exists only to mint ITD tokens on phone-only sign-ins
 * (see mintItdSession). With no phone there are no such sign-ins, so keeping a
 * decryptable password would be holding a credential nothing uses. Re-linking
 * asks for it again anyway — POST /api/auth/link/itd re-authenticates against
 * ITD rather than trusting anything stored.
 *
 * The live session keeps whatever token it already had; it simply will not be
 * refreshed once that one lapses.
 */
export async function clearItdUserPhoneById(userId: string): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;

  const { error } = await client
    .from("itd_users")
    .update({
      phone: null,
      itd_password_encrypted: null,
      encryption_iv: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);

  if (error) {
    logSupabaseError("clearItdUserPhoneById", error);
    return false;
  }
  return true;
}

export async function insertLoginAuditLog(input: {
  user_id: string;
  metadata: Json;
  ip_address: string | null;
}): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;

  const { error } = await client.from("audit_log").insert({
    user_id: input.user_id,
    action: "login",
    metadata: input.metadata,
    ip_address: input.ip_address,
  });

  if (error) {
    logSupabaseError("insertLoginAuditLog", error);
    return false;
  }
  return true;
}

/**
 * Columns safe to hand to a browser.
 *
 * Deliberately an allowlist, not `select("*")` minus a denylist: a `*` here
 * shipped `itd_password_encrypted`, `encryption_iv` and `itd_token` straight
 * to the client via GET /api/user/profile. With an allowlist, a future column
 * is invisible until someone opts it in.
 *
 * Never add: itd_token, itd_token_expires_at, itd_password_encrypted,
 * encryption_iv.
 */
const ITD_USER_PUBLIC_COLUMNS = [
  "id",
  "itd_customer_id",
  "itd_customer_code",
  "full_name",
  "email",
  "username",
  "phone",
  "role",
  "account_type",
  "company_name",
  "gstin",
  "metadata",
  "created_at",
  "updated_at",
  "last_login_at",
].join(", ");

export async function getItdUserProfileById(id: string): Promise<any | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("itd_users")
    .select(ITD_USER_PUBLIC_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    logSupabaseError("getItdUserProfileById", error);
    return null;
  }
  return data;
}

export async function listShipmentsByUserId(userId: string): Promise<any[] | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("shipments")
    .select(
      "awb_number, consignee_name, consignee_city, consignee_country, service_name, total_amount, currency, current_status, booking_date, created_at, updated_at, consignee_phone, sender_city, contents_description, weight_kg, declared_value"
    )
    .eq("user_id", userId)
    // Most recently moved first: a tracking update should surface a shipment
    // above one booked later but untouched since.
    .order("updated_at", { ascending: false });

  if (error) {
    logSupabaseError("listShipmentsByUserId", error);
    return null;
  }
  return data ?? [];
}

/** Last 5 shipments for BIA support; plain text for AI. null on DB error. */
export async function getRecentShipmentsByUserId(
  userId: string
): Promise<string | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("shipments")
    .select(
      "awb_number, consignee_name, consignee_city, consignee_country, current_status, booking_date, service_name"
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) {
    logSupabaseError("getRecentShipmentsByUserId", error);
    return null;
  }

  const rows = data ?? [];
  if (rows.length === 0) {
    return "No shipments found.";
  }

  const formatBooked = (d: string | null | undefined): string => {
    if (!d) return "—";
    try {
      return new Date(d).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
    } catch {
      return "—";
    }
  };

  return rows
    .map((row: Record<string, unknown>) => {
      const awb = String(row.awb_number ?? "—");
      const city = String(row.consignee_city ?? "").trim();
      const country = String(row.consignee_country ?? "").trim();
      const to = [city, country].filter(Boolean).join(", ") || "—";
      const status = String(row.current_status ?? "—");
      const booked = formatBooked(row.booking_date as string | undefined);
      const svc = String(row.service_name ?? "—");
      return `AWB: ${awb} | To: ${to} | Status: ${status} | Booked: ${booked} | Service: ${svc}`;
    })
    .join("\n");
}

// ITD returns every printable as an entry in `labels`:
//   [0] vendor_shipper_copy.pdf                    (AWB label — always)
//   [1] vendor_box_label.pdf                       (box label — always)
//   [2] freeform_invoice.pdf                       (invoice — only when one was raised)
//   [3] <ts>_<seq>_<tracking>_label[_n].pdf        (carrier / postal service label — only
//                                                   for postal-service shipments)
// The count varies per shipment, so match on filename and only fall back to
// position for older rows that were stored without filenames.
export type ShipmentDocumentKind = "label" | "boxLabel" | "postalLabel" | "invoice";

export const SHIPMENT_DOCUMENT_KINDS: ShipmentDocumentKind[] = [
  "label",
  "boxLabel",
  "postalLabel",
  "invoice",
];

const DOCUMENT_MATCHERS: Record<
  ShipmentDocumentKind,
  { pattern: RegExp; fallbackIndex: number }
> = {
  label: { pattern: /shipper_copy/i, fallbackIndex: 0 },
  boxLabel: { pattern: /box_label/i, fallbackIndex: 1 },
  // Carrier label: anything label-ish that is neither a vendor_* printable nor the invoice.
  postalLabel: { pattern: /^(?!vendor_)(?!.*invoice).*label/i, fallbackIndex: 3 },
  invoice: { pattern: /invoice/i, fallbackIndex: 2 },
};

interface ITDLabelEntry {
  label?: unknown;
  filename?: unknown;
  file_type?: unknown;
}

function pickDocument(
  labels: ITDLabelEntry[],
  kind: ShipmentDocumentKind
): string | null {
  const { pattern, fallbackIndex } = DOCUMENT_MATCHERS[kind];

  const named = labels.filter((e) => typeof e?.filename === "string" && e.filename);
  const entry =
    named.length > 0
      ? named.find((e) => pattern.test(e.filename as string))
      : labels[fallbackIndex];

  const doc = entry?.label;
  return typeof doc === "string" && doc ? doc : null;
}

async function fetchShipmentLabels(
  awbNumber: string,
  userId: string,
  caller: string
): Promise<ITDLabelEntry[] | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("shipments")
    .select("itd_response")
    .eq("awb_number", awbNumber)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    logSupabaseError(caller, error);
    return null;
  }

  if (!data?.itd_response) return null;

  const response = data.itd_response as { labels?: ITDLabelEntry[] };
  return Array.isArray(response?.labels) ? response.labels : null;
}

export async function getShipmentDocument(
  awbNumber: string,
  userId: string,
  kind: ShipmentDocumentKind
): Promise<string | null> {
  const labels = await fetchShipmentLabels(awbNumber, userId, "getShipmentDocument");
  if (!labels) return null;

  return pickDocument(labels, kind);
}

// Which printables this shipment actually has — lets the UI hide buttons that
// would 404 (invoice and postal label are not present on every shipment).
export async function listShipmentDocumentKinds(
  awbNumber: string,
  userId: string
): Promise<ShipmentDocumentKind[]> {
  const labels = await fetchShipmentLabels(awbNumber, userId, "listShipmentDocumentKinds");
  if (!labels) return [];

  return SHIPMENT_DOCUMENT_KINDS.filter((kind) => pickDocument(labels, kind) !== null);
}

// ─── BIA support_sessions ───────────────────────────────────────────────────

function parseMessagesJson(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const m = item as Record<string, unknown>;
    const role = m.role;
    const content = m.content;
    if (role !== "user" && role !== "assistant") continue;
    if (typeof content !== "string") continue;
    out.push({ role, content });
  }
  return out;
}

export function generateSessionTitle(firstUserMessage: string): string {
  const t = firstUserMessage.trim().replace(/\s+/g, " ");
  if (!t) return "Support chat";
  if (t.length <= 50) return t;
  const slice = t.slice(0, 50);
  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace >= 20) return slice.slice(0, lastSpace).trimEnd();
  return slice.trimEnd();
}

export async function getOrCreateSupportSession(userId: string): Promise<{
  id: string;
  messages: ChatMessage[];
  title: string | null;
} | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data: existing, error: findError } = await client
    .from("support_sessions")
    .select("id, messages, title")
    .eq("user_id", userId)
    .eq("resolved", false)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (findError) {
    logSupabaseError("getOrCreateSupportSession_select", findError);
    return null;
  }

  if (existing?.id) {
    return {
      id: String(existing.id),
      messages: parseMessagesJson(existing.messages),
      title: existing.title != null ? String(existing.title) : null,
    };
  }

  const now = new Date().toISOString();
  const { data: inserted, error: insertError } = await client
    .from("support_sessions")
    .insert({
      user_id: userId,
      messages: [],
      resolved: false,
      escalated: false,
      session_started_at: now,
      updated_at: now,
    })
    .select("id")
    .single();

  if (insertError) {
    logSupabaseError("getOrCreateSupportSession_insert", insertError);
    return null;
  }

  return {
    id: String(inserted.id),
    messages: [],
    title: null,
  };
}

export async function updateSupportSessionMessages(
  sessionId: string,
  messages: ChatMessage[],
  title?: string
): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;

  const now = new Date().toISOString();

  const { error: msgErr } = await client
    .from("support_sessions")
    .update({ messages, updated_at: now })
    .eq("id", sessionId);

  if (msgErr) {
    logSupabaseError("updateSupportSessionMessages_messages", msgErr);
    return;
  }

  if (title !== undefined && title.length > 0) {
    const { data: row, error: selErr } = await client
      .from("support_sessions")
      .select("title")
      .eq("id", sessionId)
      .maybeSingle();

    if (selErr) {
      logSupabaseError("updateSupportSessionMessages_select_title", selErr);
      return;
    }

    if (row?.title == null || String(row.title).trim() === "") {
      const { error: titleErr } = await client
        .from("support_sessions")
        .update({ title, updated_at: new Date().toISOString() })
        .eq("id", sessionId);

      if (titleErr) {
        logSupabaseError("updateSupportSessionMessages_title", titleErr);
      }
    }
  }
}

export async function resolveSupportSession(sessionId: string): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;

  const now = new Date().toISOString();
  const { error } = await client
    .from("support_sessions")
    .update({
      resolved: true,
      session_ended_at: now,
      updated_at: now,
    })
    .eq("id", sessionId);

  if (error) {
    logSupabaseError("resolveSupportSession", error);
    return false;
  }
  return true;
}

export async function createNewSupportSession(
  userId: string
): Promise<{ id: string } | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const now = new Date().toISOString();

  const { error: resolveErr } = await client
    .from("support_sessions")
    .update({
      resolved: true,
      session_ended_at: now,
      updated_at: now,
    })
    .eq("user_id", userId)
    .eq("resolved", false);

  if (resolveErr) {
    logSupabaseError("createNewSupportSession_resolve_open", resolveErr);
    return null;
  }

  const { data: inserted, error: insertError } = await client
    .from("support_sessions")
    .insert({
      user_id: userId,
      messages: [],
      resolved: false,
      escalated: false,
      session_started_at: now,
      updated_at: now,
    })
    .select("id")
    .single();

  if (insertError) {
    logSupabaseError("createNewSupportSession_insert", insertError);
    return null;
  }

  return { id: String(inserted.id) };
}

export async function countUnreadNotifications(userId: string): Promise<number | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { count, error } = await client
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .or("is_read.is.null,is_read.eq.false");

  if (error) {
    logSupabaseError("countUnreadNotifications", error);
    return null;
  }
  return count ?? 0;
}

export async function listNotificationsByUserId(userId: string): Promise<any[] | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    logSupabaseError("listNotificationsByUserId", error);
    return null;
  }
  return data ?? [];
}

export async function listAddressesByUserIdAndType(
  userId: string,
  type: "sender" | "recipient"
): Promise<
  {
    id: string;
    full_name: string;
    company: string | null;
    phone: string;
    address_line_1: string;
    city: string;
    state: string | null;
    pincode: string | null;
    type: "sender" | "recipient";
  }[] | null
> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("addresses")
    .select("id, full_name, company, phone, address_line_1, city, state, pincode, type, country_code")
    .eq("user_id", userId)
    .eq("type", type)
    .order("use_count", { ascending: false })
    .order("last_used_at", { ascending: false });

  if (error) {
    logSupabaseError("listAddressesByUserIdAndType", error);
    return null;
  }
  return data ?? [];
}

export async function markNotificationRead(
  notificationId: string,
  userId: string
): Promise<{ id: string }[] | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("notifications")
    .update({
      is_read: true,
      read_at: new Date().toISOString(),
    })
    .eq("id", notificationId)
    .eq("user_id", userId)
    .select("id");

  if (error) {
    logSupabaseError("markNotificationRead", error);
    return null;
  }
  return data ?? [];
}

export async function insertAddressAndReturnId(
  input: AddressInsert
): Promise<{ id: string } | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("addresses")
    .insert(input)
    .select("id")
    .single();

  if (error) {
    logSupabaseError("insertAddressAndReturnId", error);
    return null;
  }
  return data;
}

export async function findOrCreateAddress(
  input: AddressInsert
): Promise<{ id: string } | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  let query = client
    .from("addresses")
    .select("id, address_line_1, city")
    .eq("user_id", input.user_id)
    .eq("type", input.type)
    .eq("phone", input.phone);

  if (input.pincode == null) {
    query = query.is("pincode", null);
  } else {
    query = query.eq("pincode", input.pincode);
  }

  const { data: candidates, error } = await query;
  if (error) {
    logSupabaseError("findOrCreateAddress:select", error);
    return null;
  }

  if (candidates && candidates.length > 0) {
    const normalizedInputLine = input.address_line_1.trim().toLowerCase();
    const normalizedInputCity = input.city.trim().toLowerCase();

    const match = candidates.find((row) => {
      const rowLine = (row.address_line_1 ?? "").trim().toLowerCase();
      const rowCity = (row.city ?? "").trim().toLowerCase();
      return rowLine === normalizedInputLine && rowCity === normalizedInputCity;
    });

    if (match) {
      void client
        .from("addresses")
        .update({
          last_used_at: new Date().toISOString(),
        })
        .eq("id", match.id)
        .then(({ error: updateErr }) => {
          if (updateErr) {
            logSupabaseError("findOrCreateAddress:updateUsage", updateErr);
          }
        });

      return { id: match.id };
    }
  }

  return insertAddressAndReturnId(input);
}

export async function insertShipmentAndReturnId(
  input: ShipmentInsert
): Promise<{ id: string } | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("shipments")
    .insert(input)
    .select("id")
    .single();

  if (error) {
    logSupabaseError("insertShipmentAndReturnId", error);
    return null;
  }
  return data;
}

/**
 * Notify a customer that their order moved.
 *
 * `shipment_id` is deliberately left null: a pre-docket order has no shipment
 * row yet, and the order id travels in `data` instead so the client can deep
 * link to it.
 *
 * Non-fatal by contract — a missed notification must never fail the lifecycle
 * action that triggered it.
 */
export async function insertOrderStatusNotification(input: {
  user_id: string;
  title: string;
  body: string;
  data: Json;
}): Promise<boolean> {
  return insertNotification({ ...input, type: "order_status" });
}

/**
 * General notification insert. `type` defaults to the order_status value the
 * only previous caller hardcoded, so existing behaviour is unchanged.
 *
 * NOTE: the `notifications` table predates migrations/ and is not described in
 * this repo, so a CHECK constraint on `type` cannot be ruled out here. A
 * rejected value fails soft — logged, returns false — in keeping with the
 * non-fatal contract below.
 *
 * Non-fatal by contract — a missed notification must never fail the action
 * that triggered it.
 */
export async function insertNotification(input: {
  user_id: string;
  title: string;
  body: string;
  data: Json;
  type?: string;
}): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;

  const { error } = await client.from("notifications").insert({
    user_id: input.user_id,
    type: input.type ?? "order_status",
    title: input.title,
    body: input.body,
    data: input.data,
  });

  if (error) {
    logSupabaseError("insertNotification", error);
    return false;
  }
  return true;
}

export async function insertShipmentCreatedNotification(input: {
  user_id: string;
  title: string;
  body: string;
  data: Json;
  shipment_id: string;
}): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;

  const { error } = await client.from("notifications").insert({
    user_id: input.user_id,
    type: "shipment_created",
    title: input.title,
    body: input.body,
    data: input.data,
    shipment_id: input.shipment_id,
  });

  if (error) {
    logSupabaseError("insertShipmentCreatedNotification", error);
    return false;
  }
  return true;
}

export async function insertShipmentCreatedAuditLog(input: {
  user_id: string;
  entity_id: string;
  metadata: Json;
  ip_address: string | null;
}): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;

  const { error } = await client.from("audit_log").insert({
    user_id: input.user_id,
    action: "shipment_created",
    entity_type: "shipment",
    entity_id: input.entity_id,
    metadata: input.metadata,
    ip_address: input.ip_address,
  });

  if (error) {
    logSupabaseError("insertShipmentCreatedAuditLog", error);
    return false;
  }
  return true;
}

export async function upsertTrackingEvents(awbNumber: string, events: unknown[]): Promise<void> {
  const client = getSupabaseClient();
  if (!client || !Array.isArray(events) || events.length === 0) {
    return;
  }

  const rows: {
    awb_number: string;
    event_at: string;
    event_type: string | null;
    event_description: string | null;
    event_location: string | null;
    raw_event: Json;
  }[] = [];

  for (const ev of events) {
    if (!ev || typeof ev !== "object") continue;
    const e = ev as Record<string, unknown>;
    const eventAt = typeof e.event_at === "string" ? e.event_at.trim() : "";
    if (!eventAt) continue;
    rows.push({
      awb_number: awbNumber,
      event_at: eventAt,
      event_type: typeof e.event_type === "string" ? e.event_type : null,
      event_description: typeof e.event_description === "string" ? e.event_description : null,
      event_location: typeof e.event_location === "string" ? e.event_location : null,
      raw_event: ev as Json,
    });
  }

  if (rows.length === 0) return;

  try {
    const { error } = await client.from("tracking_events").upsert(rows, {
      onConflict: "awb_number,event_at",
      ignoreDuplicates: true,
    });
    if (error) {
      logSupabaseError("upsertTrackingEvents", error);
    }
  } catch (err) {
    console.error("[appDb] upsertTrackingEvents failed:", err);
  }
}

export async function updateShipmentTrackingStatus(
  awbNumber: string,
  currentStatus: string,
  lastTrackedAt: string
): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;

  try {
    const { error } = await client
      .from("shipments")
      .update({
        current_status: currentStatus,
        last_tracked_at: lastTrackedAt,
      })
      .eq("awb_number", awbNumber);

    if (error) {
      logSupabaseError("updateShipmentTrackingStatus", error);
    }
  } catch (err) {
    console.error("[appDb] updateShipmentTrackingStatus failed:", err);
  }
}

export type LastKnownTrackingRow = {
  currentStatus: string;
  lastTrackedAt: string;
};

export async function getLastKnownTracking(awbNumber: string): Promise<LastKnownTrackingRow | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  try {
    const { data, error } = await client
      .from("shipments")
      .select("current_status, last_tracked_at")
      .eq("awb_number", awbNumber)
      .maybeSingle();

    if (error) {
      logSupabaseError("getLastKnownTracking", error);
      return null;
    }
    if (!data) return null;

    const lastTrackedAt =
      data.last_tracked_at != null ? String(data.last_tracked_at) : "";
    if (!lastTrackedAt) return null;

    return {
      currentStatus:
        data.current_status != null && String(data.current_status).trim() !== ""
          ? String(data.current_status)
          : "INTRANSIT",
      lastTrackedAt,
    };
  } catch (err) {
    console.error("[appDb] getLastKnownTracking failed:", err);
    return null;
  }
}
