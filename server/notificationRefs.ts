/**
 * Filling in a bell row's references at read time.
 *
 * A shipment card shows the Order ID and the AWB side by side, but rows are
 * written with whatever was known at that moment: an order update before the
 * docket has only the order number, a "Shipment Booked" row has only the AWB,
 * and rows from before `orderNoticeData` have neither the AWB nor where the
 * parcel is going. Looking the order up when the bell is read fills in the
 * rest — including an AWB issued after the row was written.
 *
 * Read-time only. Nothing is written back; the stored row stays as it was.
 */

import { listOrderRefsForOwner, type OrderRef } from "./ordersDb.js";

type Owner = { userId: string } | { guestRef: string };
type Row = { data?: unknown; [key: string]: unknown };

/** "City, Country" from the booking's consignee blob, or null. */
export function destinationOf(consignee: unknown): string | null {
  if (!consignee || typeof consignee !== "object") return null;
  const c = consignee as { city?: unknown; country_name?: unknown };
  const parts = [c.city, c.country_name]
    .filter((v): v is string => typeof v === "string" && v.trim() !== "")
    .map((v) => v.trim());
  return parts.length ? parts.join(", ") : null;
}

function dataOf(row: Row): Record<string, unknown> | null {
  return row.data && typeof row.data === "object" ? (row.data as Record<string, unknown>) : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

/** Pure: merge the looked-up refs into each row's `data`. Exported for tests. */
export function applyOrderRefs<T extends Row>(rows: T[], refs: OrderRef[]): T[] {
  if (refs.length === 0) return rows;
  const byNo = new Map(refs.map((r) => [r.order_no, r]));
  const byAwb = new Map(refs.filter((r) => r.awb_no).map((r) => [r.awb_no as string, r]));

  return rows.map((row) => {
    const d = dataOf(row);
    if (!d || d.kind === "bia_nudge") return row;
    const orderNo = str(d.order_no);
    const awb = str(d.awb);
    const ref = (orderNo && byNo.get(orderNo)) || (awb && byAwb.get(awb)) || null;
    if (!ref) return row;

    const destination = str(d.destination) ?? destinationOf(ref.consignee);
    return {
      ...row,
      data: {
        ...d,
        order_no: orderNo ?? ref.order_no,
        ...(awb ?? ref.awb_no ? { awb: awb ?? ref.awb_no } : {}),
        ...(destination ? { destination } : {}),
      },
    };
  });
}

/** Look up the owner's orders the rows mention, and fill in what is missing. */
export async function withOrderRefs<T extends Row>(rows: T[], owner: Owner): Promise<T[]> {
  const orderNos: string[] = [];
  const awbs: string[] = [];
  for (const row of rows) {
    const d = dataOf(row);
    if (!d) continue;
    // Nudges name an order too, but their card is about BIA, not the parcel.
    if (d.kind === "bia_nudge") continue;
    const orderNo = str(d.order_no);
    const awb = str(d.awb);
    if (orderNo && (!awb || !str(d.destination))) orderNos.push(orderNo);
    else if (!orderNo && awb) awbs.push(awb);
  }
  if (orderNos.length === 0 && awbs.length === 0) return rows;

  try {
    return applyOrderRefs(rows, await listOrderRefsForOwner(owner, { orderNos, awbs }));
  } catch (error) {
    // The bell without the extra fields beats no bell.
    console.error("[notifications] ref lookup threw (swallowed)", error instanceof Error ? error.message : error);
    return rows;
  }
}
