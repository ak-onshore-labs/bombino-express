/**
 * One-off: mark the orders already booked on test numbers as test orders.
 *
 * New bookings are marked at POST /api/orders (server/testOrders.ts). This
 * finds the ones from before: an order whose account's phone, or whose guest
 * phone, is a test phone, and that is not yet marked. It sets
 * `metadata.test = true` and nothing else. An AWB already on the order stays
 * as it is; the list says which of them are real ITD AWBs, since those
 * shipments exist in ITD and can't be undone from here.
 *
 * Read-only unless --apply is passed.
 *
 *   npx tsx --env-file=.env scripts/mark-test-orders.ts
 *   npx tsx --env-file=.env scripts/mark-test-orders.ts --apply
 */
import { createClient } from "@supabase/supabase-js";

import { isTestPhone } from "../server/testOrders.js";
import { isTestAwb, isTestOrderMetadata } from "../shared/testOrders.js";

const apply = process.argv.includes("--apply");
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
const db = createClient(url, key, { auth: { persistSession: false } });

type OrderRow = {
  id: string;
  order_no: string;
  user_id: string | null;
  guest_phone: string | null;
  status: string;
  awb_no: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
};

async function all<T>(table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return out;
  }
}

const users = await all<{ id: string; phone: string | null }>("itd_users", "id, phone");
const phoneOf = new Map(users.map((u) => [u.id, u.phone]));
const orders = await all<OrderRow>(
  "orders",
  "id, order_no, user_id, guest_phone, status, awb_no, created_at, metadata"
);

const found = orders
  .map((o) => ({ ...o, phone: o.user_id ? phoneOf.get(o.user_id) ?? null : o.guest_phone }))
  .filter((o) => isTestPhone(o.phone) && !isTestOrderMetadata(o.metadata))
  .sort((a, b) => a.order_no.localeCompare(b.order_no));

console.log(`${found.length} order(s) booked on test numbers and not yet marked:\n`);
for (const o of found) {
  const awb = o.awb_no ? (isTestAwb(o.awb_no) ? `test AWB ${o.awb_no}` : `REAL ITD AWB ${o.awb_no}`) : "no AWB";
  console.log(
    [o.order_no, o.created_at.slice(0, 10), o.phone, o.user_id ? "account" : "guest", o.status, awb].join(" | ")
  );
}

if (!apply) {
  console.log("\nNothing written. Run again with --apply to mark these.");
} else {
  let done = 0;
  for (const o of found) {
    const { error } = await db
      .from("orders")
      .update({ metadata: { ...(o.metadata ?? {}), test: true } })
      .eq("id", o.id);
    if (error) console.error(`${o.order_no}: ${error.message}`);
    else done += 1;
  }
  console.log(`\nMarked ${done} of ${found.length}.`);
}
