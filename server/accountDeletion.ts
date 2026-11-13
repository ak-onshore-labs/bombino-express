/**
 * In-app account deletion for customers and guests.
 *
 * Anonymises in place inside one Postgres transaction. The itd_users row is
 * never deleted: orders, payments and reward_ledger cascade from it. Guests
 * have no row to keep — their profile goes, and guest contact fields on
 * orders are replaced so the phone can never re-adopt them.
 */

import type { PoolClient } from "pg";
import { deliveryOutcome, fyOf, pointsUsedOf, toCollect } from "../shared/rewards.js";
import { getOpenApplicationByPhone } from "./accountApplicationsDb.js";
import { invalidateDeletedCache } from "./deletedAccount.js";
import { sendMail } from "./mailer.js";
import { getApplicationAlertRecipients } from "./opsSettings.js";
import { getSharedPgPool } from "./pgPool.js";
import { supabase } from "./supabaseClient.js";
import { toWaMsisdn } from "./whatsapp.js";

export type DeletionBlocker = { order_no: string | null; reason: string };

export type DeletionPreflight = {
  allowed: boolean;
  blockers: DeletionBlocker[];
  phone_last4: string | null;
};

export type DeletionSubject =
  | {
      kind: "account";
      userId: string;
      phone: string;
      role: string | null;
      itdCustomerId: string | null;
      itdCustomerCode: string | null;
      guestRefs: string[];
    }
  | {
      kind: "guest";
      guestRef: string;
      phone: string;
      guestRefs: string[];
      userId: null;
    };

type OrderRow = {
  id: string;
  order_no: string;
  status: string;
  awb_no: string | null;
  payment_status: string | null;
  payment_method: string | null;
  is_cod: boolean | null;
  quoted_amount: number | null;
  final_amount: number | null;
  metadata: unknown;
  guest_ref: string | null;
  guest_phone: string | null;
};

function last4(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}

function amountStillDue(order: OrderRow): number | null {
  if (order.is_cod || order.payment_method === "cod") return null;
  const due = order.final_amount ?? order.quoted_amount;
  if (typeof due !== "number" || due <= 0) return null;
  const rest = toCollect(due, pointsUsedOf(order.metadata));
  return rest != null && rest > 0 ? rest : null;
}

async function trackingSaysDelivered(awb: string | null): Promise<boolean> {
  if (!awb || !supabase) return false;

  const { data: shipment } = await supabase
    .from("shipments")
    .select("current_status")
    .eq("awb_number", awb)
    .maybeSingle();
  if (shipment && deliveryOutcome(shipment.current_status as string | null) === "delivered") {
    return true;
  }

  const { data: events } = await supabase
    .from("tracking_events")
    .select("raw_event, event_type, event_at")
    .eq("awb_number", awb)
    .order("event_at", { ascending: false })
    .limit(20);

  for (const row of events ?? []) {
    const raw = row.raw_event as Record<string, unknown> | null;
    const state =
      (typeof raw?.event_state === "string" ? raw.event_state : null) ??
      (typeof row.event_type === "string" ? row.event_type : null);
    if (deliveryOutcome(state) === "delivered") return true;
  }
  return false;
}

async function loadOrdersForSubject(subject: DeletionSubject): Promise<OrderRow[]> {
  if (!supabase) return [];

  if (subject.kind === "account") {
    const { data, error } = await supabase
      .from("orders")
      .select(
        "id, order_no, status, awb_no, payment_status, payment_method, is_cod, quoted_amount, final_amount, metadata, guest_ref, guest_phone"
      )
      .eq("user_id", subject.userId);
    if (error) {
      console.error("[accountDeletion] loadOrders account:", error.message);
      return [];
    }
    return (data ?? []) as OrderRow[];
  }

  const byRef = await supabase
    .from("orders")
    .select(
      "id, order_no, status, awb_no, payment_status, payment_method, is_cod, quoted_amount, final_amount, metadata, guest_ref, guest_phone"
    )
    .eq("guest_ref", subject.guestRef);
  const byPhone = await supabase
    .from("orders")
    .select(
      "id, order_no, status, awb_no, payment_status, payment_method, is_cod, quoted_amount, final_amount, metadata, guest_ref, guest_phone"
    )
    .eq("guest_phone", subject.phone);
  if (byRef.error) {
    console.error("[accountDeletion] loadOrders guest ref:", byRef.error.message);
  }
  if (byPhone.error) {
    console.error("[accountDeletion] loadOrders guest phone:", byPhone.error.message);
  }
  const byId = new Map<string, OrderRow>();
  for (const row of [...(byRef.data ?? []), ...(byPhone.data ?? [])] as OrderRow[]) {
    byId.set(row.id, row);
  }
  return Array.from(byId.values());
}

/** Reasons deletion cannot proceed, with the order numbers that cause them. */
export async function findDeletionBlockers(
  subject: DeletionSubject
): Promise<DeletionBlocker[]> {
  const blockers: DeletionBlocker[] = [];

  const openApp = await getOpenApplicationByPhone(subject.phone);
  if (openApp) {
    blockers.push({
      order_no: null,
      reason: "Account application still open",
    });
  }

  const orders = await loadOrdersForSubject(subject);
  for (const order of orders) {
    if (order.payment_status === "refund_due") {
      blockers.push({
        order_no: order.order_no,
        reason: "A refund is still pending on this shipment",
      });
    }

    const due = amountStillDue(order);
    if (due != null) {
      blockers.push({
        order_no: order.order_no,
        reason: `₹${due} is still due on this shipment`,
      });
    }

    if (order.status === "cancelled") continue;

    const delivered =
      order.status === "dispatched" ? await trackingSaysDelivered(order.awb_no) : false;

    if (delivered) continue;

    if (order.is_cod || order.payment_method === "cod") {
      blockers.push({
        order_no: order.order_no,
        reason: "Cash on Delivery shipment is still open",
      });
      continue;
    }

    blockers.push({
      order_no: order.order_no,
      reason:
        order.status === "dispatched"
          ? "Shipment is in transit and not yet delivered"
          : "Shipment is still open",
    });
  }

  return blockers;
}

export async function buildPreflight(subject: DeletionSubject): Promise<DeletionPreflight> {
  const blockers = await findDeletionBlockers(subject);
  return {
    allowed: blockers.length === 0,
    blockers,
    phone_last4: last4(subject.phone),
  };
}

/** Load the signed-in customer as a deletion subject, or an error shape. */
export async function loadAccountSubject(
  userId: string
): Promise<
  | { ok: true; subject: Extract<DeletionSubject, { kind: "account" }> }
  | { ok: false; status: number; message: string; code: string }
> {
  if (!supabase) {
    return { ok: false, status: 503, message: "Service unavailable", code: "DB_UNAVAILABLE" };
  }

  const { data, error } = await supabase
    .from("itd_users")
    .select("id, phone, role, metadata, itd_customer_id, itd_customer_code")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, status: 502, message: "Could not load your account", code: "DB_UNAVAILABLE" };
  }

  const role = typeof data.role === "string" ? data.role : null;
  if (role && role !== "customer") {
    return {
      ok: false,
      status: 403,
      message: "Only a customer account can be deleted here.",
      code: "FORBIDDEN",
    };
  }

  const metadata = data.metadata;
  if (
    metadata &&
    typeof metadata === "object" &&
    typeof (metadata as Record<string, unknown>).deleted_at === "string"
  ) {
    return {
      ok: false,
      status: 401,
      message: "This account has already been deleted.",
      code: "ACCOUNT_DELETED",
    };
  }

  const phone = typeof data.phone === "string" ? data.phone.trim() : "";
  if (!phone) {
    return {
      ok: false,
      status: 400,
      message: "This account has no phone number on file.",
      code: "INVALID_REQUEST",
    };
  }

  const { data: profiles } = await supabase
    .from("guest_profiles")
    .select("guest_ref")
    .eq("phone", phone);
  const guestRefs = (profiles ?? [])
    .map((row) => (row as { guest_ref: string }).guest_ref)
    .filter(Boolean);

  return {
    ok: true,
    subject: {
      kind: "account",
      userId,
      phone,
      role,
      itdCustomerId:
        typeof data.itd_customer_id === "string" ? data.itd_customer_id : null,
      itdCustomerCode:
        typeof data.itd_customer_code === "string" ? data.itd_customer_code : null,
      guestRefs,
    },
  };
}

export function guestSubject(guestRef: string, phone: string): Extract<DeletionSubject, { kind: "guest" }> {
  return {
    kind: "guest",
    guestRef,
    phone,
    guestRefs: [guestRef],
    userId: null,
  };
}

async function hasDispatchedOrDeliveredOrder(
  client: PoolClient,
  subject: DeletionSubject
): Promise<boolean> {
  if (subject.kind === "account") {
    const { rows } = await client.query<{ status: string; awb_no: string | null }>(
      `SELECT status, awb_no FROM orders WHERE user_id = $1 AND status = 'dispatched'`,
      [subject.userId]
    );
    if (rows.length > 0) return true;
    return false;
  }
  const { rows } = await client.query<{ status: string }>(
    `SELECT status FROM orders
      WHERE (guest_ref = $1 OR guest_phone = $2) AND status = 'dispatched'`,
    [subject.guestRef, subject.phone]
  );
  return rows.length > 0;
}

async function anonymiseAddresses(
  client: PoolClient,
  subject: DeletionSubject
): Promise<void> {
  if (subject.kind === "account") {
    await client.query(
      `DELETE FROM addresses a
         WHERE a.user_id = $1
           AND NOT EXISTS (
             SELECT 1 FROM orders o WHERE o.origin_address_id = a.id
           )`,
      [subject.userId]
    );
    await client.query(
      `UPDATE addresses SET full_name = '', phone = '', company = NULL
         WHERE user_id = $1`,
      [subject.userId]
    );
  }

  for (const ref of subject.guestRefs) {
    await client.query(
      `DELETE FROM addresses a
         WHERE a.guest_ref = $1
           AND NOT EXISTS (
             SELECT 1 FROM orders o WHERE o.origin_address_id = a.id
           )`,
      [ref]
    );
    await client.query(
      `UPDATE addresses SET full_name = '', phone = '', company = NULL
         WHERE guest_ref = $1`,
      [ref]
    );
  }
}

async function deleteOwnedRows(
  client: PoolClient,
  subject: DeletionSubject
): Promise<void> {
  const userId = subject.kind === "account" ? subject.userId : null;
  const refs = subject.guestRefs;

  if (userId) {
    await client.query(`DELETE FROM notifications WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM support_sessions WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM bia_nudges WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM bia_nudge_optouts WHERE user_id = $1`, [userId]);
  }

  for (const ref of refs) {
    await client.query(`DELETE FROM notifications WHERE guest_ref = $1`, [ref]);
    await client.query(`DELETE FROM support_sessions WHERE guest_ref = $1`, [ref]);
    await client.query(`DELETE FROM bia_nudges WHERE guest_ref = $1`, [ref]);
    await client.query(`DELETE FROM bia_nudge_optouts WHERE guest_ref = $1`, [ref]);
    await client.query(`DELETE FROM guest_profiles WHERE guest_ref = $1`, [ref]);
  }

  await client.query(`DELETE FROM guest_profiles WHERE phone = $1`, [subject.phone]);

  const msisdn = toWaMsisdn(subject.phone);
  await client.query(`DELETE FROM whatsapp_alt_numbers WHERE phone = $1`, [subject.phone]);
  if (msisdn) {
    await client.query(`DELETE FROM whatsapp_bia_conversations WHERE wa_number = $1`, [
      msisdn,
    ]);
    await client.query(`DELETE FROM whatsapp_alt_numbers WHERE alt_phone = $1`, [
      subject.phone.replace(/\D/g, "").slice(-10),
    ]);
  }

  await client.query(`DELETE FROM otp_codes WHERE phone = $1`, [subject.phone]);
}

async function redactWhatsapp(
  client: PoolClient,
  subject: DeletionSubject
): Promise<void> {
  if (subject.kind === "account") {
    await client.query(
      `UPDATE whatsapp_messages
          SET to_phone = 'deleted', variables = '{"redacted":true}'::jsonb
        WHERE user_id = $1`,
      [subject.userId]
    );
  }
  await client.query(
    `UPDATE whatsapp_messages
        SET to_phone = 'deleted', variables = '{"redacted":true}'::jsonb
      WHERE to_phone = $1 OR to_phone = $2`,
    [subject.phone, toWaMsisdn(subject.phone) ?? subject.phone]
  );
}

async function handleKyc(
  client: PoolClient,
  subject: DeletionSubject,
  keep: boolean
): Promise<void> {
  if (keep) return;

  if (subject.kind === "account") {
    await client.query(`DELETE FROM kyc_documents WHERE user_id = $1`, [subject.userId]);
    await client.query(`DELETE FROM account_documents WHERE user_id = $1`, [subject.userId]);
    await client.query(`DELETE FROM identity_verifications WHERE user_id = $1`, [
      subject.userId,
    ]);
  }
  for (const ref of subject.guestRefs) {
    await client.query(`DELETE FROM kyc_documents WHERE guest_ref = $1`, [ref]);
    await client.query(
      `DELETE FROM account_documents WHERE signup_ref = $1`,
      [ref]
    );
    await client.query(
      `DELETE FROM identity_verifications WHERE signup_ref = $1`,
      [ref]
    );
  }
}

async function zeroRewards(client: PoolClient, userId: string): Promise<void> {
  const { rows } = await client.query<{ sum: string | null }>(
    `SELECT COALESCE(SUM(points), 0)::text AS sum FROM reward_ledger WHERE user_id = $1`,
    [userId]
  );
  const balance = Number(rows[0]?.sum ?? "0");
  if (!Number.isFinite(balance) || balance === 0) return;

  await client.query(
    `INSERT INTO reward_ledger (user_id, order_id, kind, points, weight_kg, fy, note, created_by, metadata)
     VALUES ($1, NULL, 'adjust', $2, 0, $3, 'Account deleted', $1, $4::jsonb)`,
    [
      userId,
      -balance,
      fyOf(),
      JSON.stringify({ source: "account_deletion" }),
    ]
  );
}

async function anonymiseGuestOrders(
  client: PoolClient,
  subject: DeletionSubject
): Promise<void> {
  await client.query(
    `UPDATE orders
        SET guest_name = 'Deleted customer',
            guest_phone = 'deleted',
            guest_email = NULL
      WHERE guest_phone = $1
         OR guest_ref = ANY($2::uuid[])`,
    [subject.phone, subject.guestRefs]
  );
}

async function purgeSessions(
  client: PoolClient,
  subject: DeletionSubject
): Promise<void> {
  if (subject.kind === "account") {
    await client.query(
      `DELETE FROM session
        WHERE sess->>'dbUserId' = $1
           OR sess->>'guestRef' = ANY($2::text[])`,
      [subject.userId, subject.guestRefs]
    );
  } else {
    await client.query(
      `DELETE FROM session WHERE sess->>'guestRef' = $1`,
      [subject.guestRef]
    );
  }
}

/**
 * Run the deletion. Callers must have already checked blockers and OTP.
 * Returns ok:false when the pool is missing or blockers reappear inside the tx.
 */
export async function runAccountDeletion(
  subject: DeletionSubject
): Promise<
  | { ok: true }
  | { ok: false; status: number; message: string; code: string; blockers?: DeletionBlocker[] }
> {
  const pool = getSharedPgPool();
  if (!pool) {
    return {
      ok: false,
      status: 503,
      message: "Account deletion is temporarily unavailable.",
      code: "DB_UNAVAILABLE",
    };
  }

  // Fresh blocker check outside the tx so we can return order numbers cleanly.
  const blockers = await findDeletionBlockers(subject);
  if (blockers.length > 0) {
    return {
      ok: false,
      status: 409,
      message: "This account cannot be deleted yet.",
      code: "DELETION_BLOCKED",
      blockers,
    };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    if (subject.kind === "account") {
      const locked = await client.query<{ metadata: unknown; role: string | null }>(
        `SELECT metadata, role FROM itd_users WHERE id = $1 FOR UPDATE`,
        [subject.userId]
      );
      if (locked.rows.length === 0) {
        await client.query("ROLLBACK");
        return {
          ok: false,
          status: 404,
          message: "Account not found",
          code: "NOT_FOUND",
        };
      }
      const role = locked.rows[0].role;
      if (role && role !== "customer") {
        await client.query("ROLLBACK");
        return {
          ok: false,
          status: 403,
          message: "Only a customer account can be deleted here.",
          code: "FORBIDDEN",
        };
      }
      const meta = locked.rows[0].metadata;
      if (
        meta &&
        typeof meta === "object" &&
        typeof (meta as Record<string, unknown>).deleted_at === "string"
      ) {
        await client.query("ROLLBACK");
        return {
          ok: false,
          status: 401,
          message: "This account has already been deleted.",
          code: "ACCOUNT_DELETED",
        };
      }
    }

    const keepKyc = await hasDispatchedOrDeliveredOrder(client, subject);
    const deletedAt = new Date().toISOString();

    await anonymiseGuestOrders(client, subject);
    await anonymiseAddresses(client, subject);
    await deleteOwnedRows(client, subject);
    await redactWhatsapp(client, subject);
    await handleKyc(client, subject, keepKyc);

    if (subject.kind === "account") {
      await zeroRewards(client, subject.userId);
      await client.query(
        `UPDATE itd_users SET
            phone = NULL,
            email = NULL,
            itd_token = NULL,
            itd_password_encrypted = NULL,
            encryption_iv = NULL,
            company_name = NULL,
            gstin = NULL,
            username = NULL,
            full_name = 'Deleted customer',
            is_active = false,
            metadata = $2::jsonb,
            updated_at = now()
          WHERE id = $1`,
        [
          subject.userId,
          JSON.stringify({ deleted_at: deletedAt, deleted_by: "self" }),
        ]
      );
    }

    await purgeSessions(client, subject);
    await client.query("COMMIT");

    if (subject.kind === "account") {
      invalidateDeletedCache(subject.userId);
      void notifyOpsOfDeletion(subject).catch((err) =>
        console.warn(
          "[accountDeletion] ops notify failed:",
          err instanceof Error ? err.message : String(err)
        )
      );
    }

    console.warn("[accountDeletion] completed", {
      kind: subject.kind,
      userId: subject.kind === "account" ? subject.userId : null,
      guestRef: subject.kind === "guest" ? subject.guestRef : null,
      keepKyc,
    });

    return { ok: true };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    console.error(
      "[accountDeletion] transaction failed:",
      err instanceof Error ? err.message : String(err)
    );
    return {
      ok: false,
      status: 502,
      message: "Could not delete the account. Please try again.",
      code: "DELETION_FAILED",
    };
  } finally {
    client.release();
  }
}

/** Email ops so they close the ITD login by hand. Never throws. */
export async function notifyOpsOfDeletion(
  subject: Extract<DeletionSubject, { kind: "account" }>
): Promise<void> {
  console.warn("[accountDeletion] notify ops — close ITD login", {
    userId: subject.userId,
    itdCustomerId: subject.itdCustomerId,
    itdCustomerCode: subject.itdCustomerCode,
  });

  try {
    const recipients = await getApplicationAlertRecipients();
    if (recipients.emails.length === 0) {
      console.warn("[accountDeletion] no ops email recipients configured");
      return;
    }
    const text = [
      "A customer deleted their Bombino account in the app.",
      "",
      `User id: ${subject.userId}`,
      `ITD customer id: ${subject.itdCustomerId ?? "(none)"}`,
      `ITD customer code: ${subject.itdCustomerCode ?? "(none)"}`,
      "",
      "Please close or disable their ITD login by hand. Their phone number has been cleared in Bombino and can sign up again as a new account.",
    ].join("\n");

    const html = `<pre style="font-family:sans-serif;white-space:pre-wrap">${text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")}</pre>`;
    for (const to of recipients.emails) {
      await sendMail({
        to,
        subject: "Bombino: customer deleted their account — close ITD login",
        text,
        html,
      });
    }
  } catch (err) {
    console.warn(
      "[accountDeletion] notifyOpsOfDeletion error:",
      err instanceof Error ? err.message : String(err)
    );
  }
}
