/**
 * ── The KYC verification hold, bypassed ─────────────────────────────────────
 *
 *   KYC_VERIFICATION_BYPASS=1
 *
 * TEMPORARY. Delete this flag and every call to it once Cashfree's VRS
 * products are provisioned and documents actually come back with a verdict.
 *
 * Two different things are called "KYC" in this app, and only one of them is
 * wired to a verifier:
 *
 *   - `kyc_documents` — the identity document filed WITH the docket. It is
 *     uploaded, stored encrypted, and read by `kycForOrder` at docket time.
 *     This exists and works.
 *   - `account_documents` — the signup document set, whose `ocr_status` is
 *     written by Cashfree Smart OCR. `verificationState` in
 *     shared/accountSpec.ts reads it, and that is what stamps
 *     `orders.metadata.kyc_verified` at booking.
 *
 * With no Cashfree account yet, the second never reaches a verdict, so
 * `kyc_verified` is stamped `false` on every booking, `isKycHeld` reads true
 * forever, and BOTH docket paths refuse: `docketAtBooking` skips at booking and
 * ops' `generate_docket` is guarded off at `settled`. No AWB is ever issued and
 * nothing on either screen says why, because a skip is not a failure and writes
 * no `docket_error`.
 *
 * This flag stands the hold down to what can actually be checked today: an
 * identity document has to BE THERE. `kycForOrder` still runs, still refuses a
 * docket with no document on file, and still records `docket_error` when it
 * does — so the document reaching customs is the same document either way. The
 * only thing given up is the assurance that something machine-read it.
 *
 * That assurance is the whole point of the hold, so this is not a small thing
 * to leave on: a docket carries the customer's identity number to Indian
 * customs as `shipper_gstin_no`, and once filed ITD permits no amendment.
 *
 * Not gated on NODE_ENV, for the same reason PAYMENTS_TEST_MODE and OCR_BYPASS
 * are not: the client tests on a deployed staging build where NODE_ENV is
 * production, and that is the environment this is for.
 */

export function isKycVerificationBypassEnabled(): boolean {
  return process.env.KYC_VERIFICATION_BYPASS === "1";
}

/**
 * Should this order be held back from a docket because its KYC is not verified?
 *
 * The single place both docket paths ask, so they can never disagree about who
 * is held — `docketAtBooking` in server/routes.ts and the `generate_docket`
 * guard in server/orderLifecycle.ts.
 *
 * `held` is `metadata.kyc_verified === false`, already computed by
 * `isKycHeld`; this only decides whether to honour it.
 */
export function shouldHoldForKyc(held: boolean): boolean {
  if (!held) return false;
  return !isKycVerificationBypassEnabled();
}

/** Called once at boot. Silent when the flag is off. */
export function warnIfKycVerificationBypassEnabled(): void {
  if (!isKycVerificationBypassEnabled()) return;

  const where =
    process.env.NODE_ENV === "production" ? "a PRODUCTION build" : "development";

  console.warn(
    [
      "",
      "  ############################################################",
      "  ##  KYC_VERIFICATION_BYPASS=1",
      "  ##  Dockets are filed on an UNVERIFIED identity document.",
      "  ##  Presence is checked; nothing has read it.",
      `  ##  Running in ${where}.`,
      "  ##  Unset this once Cashfree VRS is provisioned.",
      "  ############################################################",
      "",
    ].join("\n")
  );
}
