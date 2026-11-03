/**
 * Test orders: bookings made by the team's test numbers, kept apart from real
 * customers' orders in the one shared database.
 *
 * An order is a test order when `metadata.test === true`, stamped at booking
 * from the booker's phone (server/testOrders.ts). A test order:
 *
 *   - gets a test AWB (`TEST` + the order number's digits) instead of a real
 *     ITD docket, because ITD has no sandbox and a docket filed there is a
 *     real shipment that can never be amended;
 *   - is never tracked against ITD (`isTestAwb`);
 *   - is hidden from ops boards, exports and the payments ledger for real
 *     staff (super admin included), and shown only to test staff;
 *   - can only be assigned to a test agent, and a real order never to one.
 *
 * Pure, so the client can read the same rules.
 */

/** Whether an order's metadata marks it as a test order. */
export function isTestOrderMetadata(metadata: unknown): boolean {
  return (
    !!metadata &&
    typeof metadata === "object" &&
    (metadata as Record<string, unknown>).test === true
  );
}

const TEST_AWB_PREFIX = "TEST";

/** The test AWB for an order: BOM-100345 → TEST100345. */
export function testAwbFor(orderNo: string): string {
  const digits = orderNo.replace(/\D/g, "");
  return `${TEST_AWB_PREFIX}${digits || orderNo.replace(/[^A-Za-z0-9]/g, "").toUpperCase()}`;
}

/** Whether an AWB is one of ours for a test order, never ITD's. */
export function isTestAwb(awb: string | null | undefined): boolean {
  return typeof awb === "string" && /^TEST/i.test(awb.trim());
}
