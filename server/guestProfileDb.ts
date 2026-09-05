/**
 * The guest profile, server-side.
 *
 * A guest is a verified phone number with things attached to it: staged
 * identity documents, orders, and — from here — a name and an email. Every one
 * of those already lived in Postgres except the last two, which is what
 * `guest_profiles` adds (migrations/create_guest_profiles.sql).
 *
 * Reads are by `guest_ref` only. The ref is minted exclusively by
 * `signupRefForPhone` after an OTP on the number, so possession of one is
 * itself the proof of the phone — no route in this module re-checks a phone
 * from a request body, and none should start.
 */

import { supabase } from "./supabaseClient.js";
import { decryptField } from "./fieldCrypto.js";

export type GuestProfileRow = {
  guest_ref: string;
  phone: string;
  full_name: string | null;
  email: string | null;
  /** 'personal' | 'company', or null until they choose. */
  account_type: string | null;
  /** Company shape only. See shared/accountSpec.ts §COMPANY_CATEGORIES. */
  company_category: string | null;
  company_name: string | null;
  gstin: string | null;
  /** The GST registry's own spelling, not what the customer typed. */
  gstin_verified_name: string | null;
  contact_person: string | null;
  address_line_1: string | null;
  pincode: string | null;
  city: string | null;
  state: string | null;
  hub_id: string | null;
  /** Category extras, keyed by shared/accountSpec.ts §ExtraField. */
  extras: Record<string, string> | null;
  created_at: string;
  updated_at: string;
};

/** One of the guest's bookings, in the terms the profile screen shows. */
export type GuestOrderSummary = {
  order_no: string;
  order_id: string;
  status: string;
  payment_status: string;
  payment_method: string;
  awb_no: string | null;
  created_at: string;
  /** From the consignee blob — where the parcel is going. */
  destination: string | null;
  /**
   * What this particular booking declared. The profile falls back to the
   * newest one for a guest who booked before `guest_profiles` existed, so
   * their name comes back rather than reading as never given.
   */
  guest_name: string | null;
  guest_email: string | null;
};

function getClient() {
  if (!supabase) {
    console.error("[guestProfileDb] supabase client is not configured");
    return null;
  }
  return supabase;
}

function logError(operation: string, error: { message?: string; code?: string } | null): void {
  console.error("[guestProfileDb] operation failed:", {
    operation,
    message: error?.message,
    code: error?.code,
  });
}

const PROFILE_COLUMNS =
  "guest_ref, phone, full_name, email, account_type, company_category, company_name, " +
  "gstin, gstin_verified_name, contact_person, address_line_1, pincode, city, state, " +
  "hub_id, extras, created_at, updated_at";

export async function getGuestProfile(guestRef: string): Promise<GuestProfileRow | null> {
  const client = getClient();
  if (!client) return null;

  const { data, error } = await client
    .from("guest_profiles")
    .select(PROFILE_COLUMNS)
    .eq("guest_ref", guestRef)
    .maybeSingle();

  if (error) {
    logError("getGuestProfile", error);
    return null;
  }
  return (data as unknown as GuestProfileRow | null) ?? null;
}

/**
 * Create or update the row for this ref.
 *
 * `undefined` leaves a column alone; `null` clears it. That distinction is the
 * whole reason this takes a patch rather than a whole row — the profile screen
 * sends one field at a time, and a missing name must not wipe a stored one.
 */
/**
 * Everything a guest may tell us, all optional.
 *
 * `undefined` leaves a column alone, which is what makes one-field-at-a-time
 * saving possible: the profile screen sends the row that was just answered and
 * nothing else.
 */
export interface GuestProfilePatchInput {
  guest_ref: string;
  phone: string;
  full_name?: string | null;
  email?: string | null;
  account_type?: 'personal' | 'company' | null;
  company_category?: string | null;
  company_name?: string | null;
  gstin?: string | null;
  gstin_verified_name?: string | null;
  contact_person?: string | null;
  address_line_1?: string | null;
  pincode?: string | null;
  city?: string | null;
  state?: string | null;
  hub_id?: string | null;
  /** Merged into the stored object, not swapped for it. */
  extras?: Record<string, string>;
}

const PATCHABLE_COLUMNS = [
  'full_name',
  'email',
  'account_type',
  'company_category',
  'company_name',
  'gstin',
  'gstin_verified_name',
  'contact_person',
  'address_line_1',
  'pincode',
  'city',
  'state',
  'hub_id',
] as const;

export async function upsertGuestProfile(
  input: GuestProfilePatchInput
): Promise<GuestProfileRow | null> {
  const client = getClient();
  if (!client) return null;

  const patch: Record<string, unknown> = {
    guest_ref: input.guest_ref,
    phone: input.phone,
    updated_at: new Date().toISOString(),
  };
  for (const column of PATCHABLE_COLUMNS) {
    const value = input[column];
    if (value !== undefined) patch[column] = value;
  }

  // Merged, not replaced: the extras are answered one at a time like every
  // other row, and an upsert of the whole column would wipe the ones already
  // given. Read-then-write, which is safe here because the only writer is the
  // customer's own screen.
  if (input.extras) {
    const existing = await getGuestProfile(input.guest_ref);
    patch.extras = { ...(existing?.extras ?? {}), ...input.extras };
  }

  // Switching to a personal account clears what only a company owes.
  //
  // Left behind, a GSTIN and a registered address would sit on the row unread
  // — hidden by the profile screen and ignored by signup — until the customer
  // switched back, at which point months-old details would reappear as though
  // freshly given. Clearing at the moment of the switch keeps the row honest
  // about what this person has actually told us.
  if (input.account_type === 'personal') {
    patch.company_category = null;
    patch.company_name = null;
    patch.gstin = null;
    patch.gstin_verified_name = null;
    patch.contact_person = null;
    patch.address_line_1 = null;
    patch.pincode = null;
    patch.city = null;
    patch.state = null;
    patch.hub_id = null;
    patch.extras = {};
  }

  const { data, error } = await client
    .from("guest_profiles")
    .upsert(patch, { onConflict: "guest_ref" })
    .select(PROFILE_COLUMNS)
    .single();

  if (error) {
    logError("upsertGuestProfile", error);
    return null;
  }
  return data as unknown as GuestProfileRow;
}

/**
 * Every order this guest placed, newest first.
 *
 * Guests have no `/api/orders` of their own — that endpoint answers to an
 * account — so this is the only way the order numbers they were shown at
 * booking come back to them on a second visit.
 */
export async function listGuestOrders(guestRef: string): Promise<GuestOrderSummary[]> {
  const client = getClient();
  if (!client) return [];

  const { data, error } = await client
    .from("orders")
    .select(
      "id, order_no, status, payment_status, payment_method, awb_no, consignee, guest_name, guest_email, created_at"
    )
    .eq("guest_ref", guestRef)
    .order("created_at", { ascending: false })
    // A guest with more bookings than this has long since needed an account,
    // and the profile screen is not a paginated orders list.
    .limit(25);

  if (error) {
    logError("listGuestOrders", error);
    return [];
  }

  return (data ?? []).map((row) => {
    const r = row as {
      id: string;
      order_no: string;
      status: string;
      payment_status: string;
      payment_method: string;
      awb_no: string | null;
      consignee: unknown;
      guest_name: string | null;
      guest_email: string | null;
      created_at: string;
    };
    return {
      order_no: r.order_no,
      order_id: r.id,
      status: r.status,
      payment_status: r.payment_status,
      payment_method: r.payment_method,
      awb_no: r.awb_no,
      created_at: r.created_at,
      destination: destinationOf(r.consignee),
      guest_name: r.guest_name,
      guest_email: r.guest_email,
    };
  });
}

/**
 * "Springfield, IL" — or the country when the city is missing.
 *
 * The consignee is stored as jsonb exactly as booking sent it, so this reads
 * defensively: an older row, or one from a future form, must not throw here
 * and take the whole profile screen down with it.
 */
function destinationOf(consignee: unknown): string | null {
  if (!consignee || typeof consignee !== "object") return null;
  const c = consignee as Record<string, unknown>;
  const city = typeof c.city === "string" ? c.city.trim() : "";
  const state = typeof c.state === "string" ? c.state.trim() : "";
  const country = typeof c.country_name === "string" ? c.country_name.trim() : "";

  const local = [city, state].filter(Boolean).join(", ");
  if (local && country) return `${local}, ${country}`;
  return local || country || null;
}

/**
 * Push corrected contact details onto the guest's own orders.
 *
 * The docket prints what the order carries, not what this table holds, so a
 * name fixed on the profile screen has to reach the orders that have not been
 * docketed yet — otherwise the customer sees their correction take effect and
 * the parcel still ships under the typo.
 *
 * Scoped deliberately:
 *   - `guest_ref` only, so one guest can never touch another's rows;
 *   - `awb_no IS NULL`, because once a docket exists the declared name is part
 *     of a filed customs record and is not ours to rewrite;
 *   - `user_id IS NULL`, so an order already claimed by an account is left to
 *     that account.
 *
 * Best-effort by contract: returns a count and throws nothing. A customer
 * whose profile saved should not see a 500 because this follow-up lost a race.
 */
export async function updateGuestContactOnOrders(
  guestRef: string,
  contact: { full_name?: string | null; email?: string | null }
): Promise<number> {
  const client = getClient();
  if (!client) return 0;

  const patch: Record<string, unknown> = {};
  // guest_name is NOT NULL for guest orders (orders_guest_contact_present), so
  // a cleared name is not pushed — the profile may forget it, the order may not.
  if (contact.full_name) patch.guest_name = contact.full_name;
  if (contact.email !== undefined) patch.guest_email = contact.email;
  if (Object.keys(patch).length === 0) return 0;

  const { data, error } = await client
    .from("orders")
    .update(patch)
    .eq("guest_ref", guestRef)
    .is("user_id", null)
    .is("awb_no", null)
    .select("id");

  if (error) {
    logError("updateGuestContactOnOrders", error);
    return 0;
  }
  return (data ?? []).length;
}

/**
 * The guest's identity document, as the profile screen needs to describe it.
 *
 * Its own read rather than `getKycByGuestRef`: that function selects a fixed
 * metadata column list which does not include `ocr_status`, and widening it
 * would change the shape every other consumer of `KycDocumentMeta` sees for
 * the sake of one screen. Three columns, decrypted here the same way kycDb
 * decrypts its own.
 */
export async function getGuestKycSummary(guestRef: string): Promise<{
  document_type: string;
  last_four: string;
  ocr_status: string | null;
} | null> {
  const client = getClient();
  if (!client) return null;

  const { data, error } = await client
    .from("kyc_documents")
    .select("document_type, document_no, ocr_status")
    .eq("guest_ref", guestRef)
    .maybeSingle();

  if (error) {
    logError("getGuestKycSummary", error);
    return null;
  }
  if (!data) return null;

  const row = data as { document_type: string; document_no: string; ocr_status: string | null };
  // Stored encrypted. Only the last four ever leave this function — the full
  // number has no business on a profile screen.
  const documentNo = decryptField(row.document_no) ?? "";

  return {
    document_type: row.document_type,
    last_four: documentNo.slice(-4),
    ocr_status: row.ocr_status,
  };
}

/**
 * The ref a returning guest already has for this number, if any.
 *
 * Without this, "kept on the server" is only half true. `signupRefForPhone`
 * mints a FRESH ref whenever a browser has no matching one — a new device,
 * cleared cookies, a different browser — so a guest who comes back would prove
 * the same number by OTP and be handed an empty profile, with their real one
 * sitting in Postgres under the ref their old session happened to hold.
 *
 * Only ever called after an OTP on this exact number has been proved, and it
 * matches on that number alone. That is the whole authorisation: the phone is
 * what identifies a guest, and proving it is what earns their records back.
 *
 * Falls back to their orders, so a guest who booked before `guest_profiles`
 * existed is still recognised.
 */
export async function getLatestGuestRefForPhone(phone: string): Promise<string | null> {
  const client = getClient();
  if (!client) return null;

  const { data: profiles, error: profileError } = await client
    .from("guest_profiles")
    .select("guest_ref")
    .eq("phone", phone)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (profileError) logError("getLatestGuestRefForPhone/profiles", profileError);
  const fromProfile = (profiles ?? [])[0] as { guest_ref: string } | undefined;
  if (fromProfile?.guest_ref) return fromProfile.guest_ref;

  // Unclaimed orders only: once a number opens an account its orders belong to
  // that account, and handing the guest ref back would reopen a door the
  // signup closed.
  const { data: orders, error: orderError } = await client
    .from("orders")
    .select("guest_ref")
    .eq("guest_phone", phone)
    .is("user_id", null)
    .not("guest_ref", "is", null)
    .order("created_at", { ascending: false })
    .limit(1);

  if (orderError) logError("getLatestGuestRefForPhone/orders", orderError);
  const fromOrder = (orders ?? [])[0] as { guest_ref: string | null } | undefined;
  return fromOrder?.guest_ref ?? null;
}

/**
 * Drop the guest profile once its person has an account.
 *
 * The row exists to hold a name, an email and a company's details for someone
 * who has nowhere else to keep them. An account is that somewhere: signup
 * writes all of it to `itd_users`, and claiming moves the orders, addresses,
 * payments and identity document across. What is left here afterwards is a
 * second copy of a customer's personal data with no reader, which is the exact
 * shape of thing server/retention.ts exists to remove.
 *
 * Matched on both the ref and the phone. The ref covers the profile this
 * browser was using; the phone covers one written under an older ref on
 * another device, which is the same person and the same account.
 *
 * Best-effort by contract: it returns a count and throws nothing. The account
 * is already correct by the time this runs, and a signup must not fail over
 * bookkeeping.
 */
export async function deleteGuestProfilesFor(
  phone: string,
  refs: string[] = []
): Promise<number> {
  const client = getClient();
  if (!client) return 0;

  const conditions = [`phone.eq.${phone}`];
  if (refs.length > 0) conditions.push(`guest_ref.in.(${refs.join(",")})`);

  const { data, error } = await client
    .from("guest_profiles")
    .delete()
    .or(conditions.join(","))
    .select("guest_ref");

  if (error) {
    logError("deleteGuestProfilesFor", error);
    return 0;
  }
  return (data ?? []).length;
}

/**
 * Guest profiles nobody came back for.
 *
 * Swept only when the ref owns no orders. A profile with a booking behind it
 * belongs to a real customer who may return to it months later — their orders
 * are reachable by verifying the number, and deleting the name attached to
 * them would leave the orders looking like a stranger's. What this removes is
 * the other kind: a number verified once, a name half typed, and nothing
 * since.
 *
 * Returns the count and collects errors rather than throwing, matching the
 * rest of the sweep.
 */
export async function listAbandonedGuestProfileRefs(cutoffIso: string): Promise<string[]> {
  const client = getClient();
  if (!client) return [];

  const { data: stale, error } = await client
    .from("guest_profiles")
    .select("guest_ref")
    .lt("updated_at", cutoffIso);

  if (error) {
    logError("listAbandonedGuestProfileRefs", error);
    return [];
  }

  const refs = (stale ?? []).map((row) => (row as { guest_ref: string }).guest_ref);
  if (refs.length === 0) return [];

  const { data: withOrders, error: orderError } = await client
    .from("orders")
    .select("guest_ref")
    .in("guest_ref", refs);

  if (orderError) {
    // Unknown which are safe, so none are. A sweep that cannot tell a customer
    // from an abandonment does nothing.
    logError("listAbandonedGuestProfileRefs:orders", orderError);
    return [];
  }

  const booked = new Set(
    (withOrders ?? []).map((row) => (row as { guest_ref: string | null }).guest_ref)
  );
  return refs.filter((ref) => !booked.has(ref));
}

/** Delete the rows `listAbandonedGuestProfileRefs` picked out. */
export async function deleteGuestProfilesByRefs(refs: string[]): Promise<number> {
  const client = getClient();
  if (!client || refs.length === 0) return 0;

  const { data, error } = await client
    .from("guest_profiles")
    .delete()
    .in("guest_ref", refs)
    .select("guest_ref");

  if (error) {
    logError("deleteGuestProfilesByRefs", error);
    return 0;
  }
  return (data ?? []).length;
}
