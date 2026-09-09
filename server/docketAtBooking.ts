/**
 * ── Docket at booking ───────────────────────────────────────────────────────
 *
 *   ITD_DOCKET_AT_BOOKING=1
 *
 * Files a real ITD docket the moment an ITD-credentialled customer books,
 * instead of waiting for ops to do it at `settled`. Who that applies to, and
 * why it applies to nobody else, is documented on `docketAtBooking` in
 * server/routes.ts.
 *
 * OFF unless explicitly set, and it must be turned on per environment rather
 * than defaulted, because THERE IS NO ITD SANDBOX. `ADMIN_BASE` in
 * server/itd.ts points at https://admin.bombinoexp.com — production. Every
 * docket this fires is a real shipment against real customer accounts, and ITD
 * permits no amendment to one once filed.
 *
 * Two things are worth knowing before switching it on:
 *
 *   - The weight sent is the customer's own declared estimate, taken from the
 *     booking form, not a hub scale reading. Docketing at booking means the
 *     reprice at the hub can no longer reach ITD.
 *   - `shipment_invoice_no` is still hardcoded to 'TESTINV01' in
 *     client/src/pages/CreateShipment.tsx, and it goes to Indian customs.
 *
 * Like PAYMENTS_TEST_MODE this is honoured in production builds, because the
 * deployed staging environment runs NODE_ENV=production and is exactly where
 * this needs exercising first.
 */

export function isDocketAtBookingEnabled(): boolean {
  return process.env.ITD_DOCKET_AT_BOOKING === "1";
}

/** Called once at boot. Silent when the flag is off. */
export function warnIfDocketAtBookingEnabled(): void {
  if (!isDocketAtBookingEnabled()) return;

  const where =
    process.env.NODE_ENV === "production" ? "a PRODUCTION build" : "development";

  console.warn(
    [
      "",
      "  ############################################################",
      "  ##  ITD_DOCKET_AT_BOOKING=1",
      "  ##  Bookings by ITD-linked accounts file a REAL ITD docket",
      "  ##  immediately. ITD has no sandbox and permits no amendment.",
      `  ##  Running in ${where}.`,
      "  ##  The weight filed is the customer's booking estimate.",
      "  ############################################################",
      "",
    ].join("\n")
  );
}
