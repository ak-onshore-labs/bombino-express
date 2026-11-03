/**
 * Parcels coming TO a phone: the receiver's side of an order.
 *
 * Everything else about an order answers to whoever booked it (an account, or
 * a guest's ref). This answers to the number it is going to, proved by OTP
 * like any other sign-in, and shows far less: where it is, who sent it (first
 * name and city), and nothing about money, phones, addresses or the codes the
 * sender and the agent exchange.
 *
 * Who counts as the receiver is decided in shared/receiving.ts. The query
 * below narrows by the same rules in SQL, and every row is checked again
 * against the pure function before it leaves here, so a filter that matches
 * too much cannot leak a stranger's parcel.
 *
 * The phone always comes from the session, never from a request.
 */

import { dbClient, logDbError, type DbError } from "./db/client.js";
import { customerStatusForStatus } from "../shared/orderContract.js";
import { isTestOrderMetadata } from "../shared/testOrders.js";
import {
  receiverAppPhoneOf,
  type ReceivingDetail,
  type ReceivingEvent,
  type ReceivingParcel,
} from "../shared/receiving.js";
import { isTestPhone } from "./testOrders.js";
import { listOrderEvents } from "./ordersDb.js";

const getClient = () => dbClient("receivingDb");
const logError = (operation: string, error: DbError): void => logDbError("receivingDb", operation, error);

const LIST_LIMIT = 50;

const COLUMNS =
  "id, order_no, user_id, guest_phone, guest_name, status, consignee, items, awb_no, metadata, created_at, updated_at, origin_address:addresses(full_name, city)";

/** Who is looking: their verified number, and the account they are signed in to, if any. */
export type ReceivingViewer = { phone: string; userId: string | null };

export type ReceivingRow = {
  id: string;
  order_no: string;
  user_id: string | null;
  guest_phone: string | null;
  guest_name: string | null;
  status: string;
  consignee: unknown;
  items: unknown;
  awb_no: string | null;
  metadata: unknown;
  created_at: string;
  updated_at: string | null;
  origin_address: { full_name: string | null; city: string | null } | null;
};

/**
 * PostgREST filter for "might be going to this phone". Wide on purpose; the
 * pure check in `isReceiverOf` is what decides.
 */
function receiverFilter(phone: string): string {
  return [
    `consignee->>app_phone.eq.${phone}`,
    `consignee->>phone.in.("91${phone}","+91${phone}","+91 ${phone}")`,
    `and(consignee->>country_code.eq.IN,consignee->>phone.eq.${phone})`,
  ].join(",");
}

/**
 * Whether this viewer may see this order as its receiver.
 *
 * Not when it is cancelled, not when they sent it themselves (it is already
 * under Sending), and not a test order unless they are on a test phone: a
 * tester typing a real receiver number must not put a fake parcel in front of
 * a real person.
 */
export function isReceiverOf(row: ReceivingRow, viewer: ReceivingViewer): boolean {
  if (receiverAppPhoneOf(row.consignee) !== viewer.phone) return false;
  if (row.status === "cancelled") return false;
  if (viewer.userId && row.user_id === viewer.userId) return false;
  if (!row.user_id && row.guest_phone && row.guest_phone.replace(/\D/g, "").slice(-10) === viewer.phone) {
    return false;
  }
  if (isTestOrderMetadata(row.metadata) && !isTestPhone(viewer.phone)) return false;
  return true;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstName(name: string | null): string | null {
  return name ? name.split(/\s+/)[0] ?? null : null;
}

/** The row as the receiver sees it. Built field by field, so nothing else rides along. */
export function toReceivingParcel(row: ReceivingRow): ReceivingParcel {
  const consignee =
    row.consignee && typeof row.consignee === "object" ? (row.consignee as Record<string, unknown>) : {};
  const items = row.items && typeof row.items === "object" ? (row.items as Record<string, unknown>) : {};
  return {
    order_no: row.order_no,
    awb_no: row.awb_no,
    status: row.status,
    customer_status: customerStatusForStatus(row.status),
    sender_first_name: firstName(text(row.guest_name) ?? text(row.origin_address?.full_name)),
    sender_city: text(row.origin_address?.city),
    receiver_city: text(consignee.city),
    receiver_country: text(consignee.country_name),
    service: text(items.api_service_code),
    created_at: row.created_at,
    updated_at: row.updated_at ?? row.created_at,
  };
}

/** Every parcel coming to this viewer's number, newest first. */
export async function listReceivingParcels(viewer: ReceivingViewer): Promise<ReceivingParcel[] | null> {
  const client = getClient();
  if (!client) return null;

  const { data, error } = await client
    .from("orders")
    .select(COLUMNS)
    .or(receiverFilter(viewer.phone))
    .neq("status", "cancelled")
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);

  if (error) {
    logError("listReceivingParcels", error);
    return null;
  }
  return ((data ?? []) as unknown as ReceivingRow[])
    .filter((row) => isReceiverOf(row, viewer))
    .map(toReceivingParcel);
}

/** How many parcels are coming to this number. Zero on any failure. */
export async function countReceivingParcels(viewer: ReceivingViewer): Promise<number> {
  return (await listReceivingParcels(viewer))?.length ?? 0;
}

/**
 * One incoming parcel with its history. A miss, someone else's parcel and a
 * DB error all return null, so a caller cannot tell them apart.
 */
export async function findReceivingParcel(
  viewer: ReceivingViewer,
  orderNo: string
): Promise<ReceivingDetail | null> {
  const client = getClient();
  if (!client) return null;

  const { data, error } = await client
    .from("orders")
    .select(COLUMNS)
    .eq("order_no", orderNo)
    .or(receiverFilter(viewer.phone))
    .limit(1)
    .maybeSingle();

  if (error) {
    logError("findReceivingParcel", error);
    return null;
  }
  const row = data as unknown as ReceivingRow | null;
  if (!row || !isReceiverOf(row, viewer)) return null;

  const events = await listOrderEvents(row.id);
  return { parcel: toReceivingParcel(row), events: toReceivingEvents(events ?? []) };
}

/**
 * The order's status changes, once each, oldest first. Notes and who did it
 * are left out: they are written for the sender and for ops.
 */
export function toReceivingEvents(events: { status: string; created_at: string }[]): ReceivingEvent[] {
  const out: ReceivingEvent[] = [];
  for (const event of events) {
    if (!event.status || event.status === "cancelled") continue;
    if (out.length > 0 && out[out.length - 1].status === event.status) continue;
    out.push({ status: event.status, customer_status: customerStatusForStatus(event.status), at: event.created_at });
  }
  return out;
}
