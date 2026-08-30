/**
 * Cashfree VRS number verification — what is left of it.
 *
 *   POST {base}/verification/gstin { GSTIN, businessName? }
 *   headers: x-client-id, x-client-secret
 *
 * ONE NUMBER IS STILL CHECKED WITH AN AUTHORITY: the GSTIN. The GST portal
 * answers with the legal and trade names of the business and a registration
 * status, and a name that does not match the account, or a status other than
 * Active, refuses the account.
 *
 * AADHAAR AND PAN ARE SELF-ASSERTED. Neither has a function in this file any
 * more. Three lookups were removed in turn:
 *
 *   Offline Aadhaar   never provisioned on this Cashfree account
 *   DigiLocker        dropped as too much friction for a courier signup —
 *                     a second tab, a sign-in, a nine-minute poll
 *   PAN (Income Tax)  dropped deliberately; see the PAN section below
 *
 * So both take the same route: the customer types the number, and the
 * document they upload has to carry it. Smart OCR proves the file reads as
 * that number, and Cashfree's tamper flags refuse an edited one.
 *
 * WHAT THAT DOES NOT PROVE. Nothing establishes that the number belongs to
 * the person signing up. Smart OCR compares numbers and never names, so a
 * genuine PAN card or Aadhaar card belonging to somebody else, uploaded
 * against that person's number, earns a clean `match`. The check is internal
 * consistency, not ownership. Such rows are recorded `self_declared` rather
 * than `verified`, so the distinction survives into the data and is never
 * conflated with `bypassed`, which means nobody looked at all.
 *
 * The practical shape of it: a COMPANY account carries one authority-backed
 * number, its GSTIN. A PERSONAL account carries none.
 *
 * Ordering still matters for all three. The number is recorded first, so the
 * OCR comparison is against a value the customer can no longer change by the
 * time the file arrives — which is why routes.ts overrides whatever
 * `document_no` an upload carries with the recorded one. For the two
 * self-asserted kinds that substitution is the whole of the check.
 *
 * The GSTIN failure policy differs from OCR's on purpose. An OCR miss is
 * often the camera and costs the customer a retake; a portal answer is a
 * statement by an authority, and there is nothing to retake. So:
 *
 *   • A cancelled GSTIN, or one registered to an unrelated business —
 *     refused. There is no "unverified but stored" state for a number that
 *     was checked, because unlike a file there is nothing to store.
 *   • An outage, no credentials, an empty balance — the customer is told to
 *     try again shortly. Nothing is recorded, so nothing is claimed.
 */

const SANDBOX_BASE = "https://sandbox.cashfree.com";
const PRODUCTION_BASE = "https://api.cashfree.com";
/**
 * Nothing sends this today — /gstin is unversioned, and /pan, the only
 * endpoint that read it, is gone. Kept because the plumbing is one boolean
 * and the next versioned endpoint will want it, and because
 * CASHFREE_VRS_API_VERSION is documented in .env.example.
 */
const DEFAULT_API_VERSION = "2024-12-01";
/** Comfortably past the vendor's own latency; a slow lookup must not hang a step. */
const REQUEST_TIMEOUT_MS = 25_000;

/**
 * The three numbers signup collects. Only `gstin` is checked with an
 * authority; `aadhaar` and `pan` are self-asserted and never appear in a
 * call from this file. Both stay in the union because
 * identity_verifications records all three and every consumer keys on this
 * type.
 */
export type IdentityKind = "aadhaar" | "pan" | "gstin";

/**
 * Why a check did not succeed.
 *
 *   rejected     the authority answered, and the answer was no. Terminal for
 *                these inputs — the customer must correct what they typed.
 *   unavailable  we never got an answer: not configured, timed out, out of
 *                balance, 5xx. Ours, not theirs — retryable as-is.
 *
 * `expired` went with DigiLocker: nothing left in this file has a window that
 * can close. routes.ts still maps it to 410 for the OTP step, which owns its
 * own expiry.
 */
export type IdentityFailure = "rejected" | "expired" | "unavailable";

export interface IdentityError {
  ok: false;
  failure: IdentityFailure;
  /** Shown to the customer. Actionable, and never blames them for our outage. */
  message: string;
  /** Server log only — carries the HTTP status or the vendor's own wording. */
  detail: string | null;
}

export interface GstinVerified {
  ok: true;
  gstin: string;
  /** The name the GST portal holds. Authoritative; the typed one is not. */
  legalName: string;
  /** What the business trades as, where that differs from the legal name. */
  tradeName: string | null;
  /** "Active" — anything else is refused. See verifyGstin. */
  gstStatus: string | null;
  taxpayerType: string | null;
  dateOfRegistration: string | null;
  constitutionOfBusiness: string | null;
  principalPlaceAddress: string | null;
  details: Record<string, unknown>;
  referenceId: string | null;
}

interface CashfreeConfig {
  clientId: string;
  clientSecret: string;
  base: string;
  apiVersion: string;
}

function getConfig(): CashfreeConfig | null {
  const clientId = process.env.CASHFREE_VRS_CLIENT_ID?.trim();
  const clientSecret = process.env.CASHFREE_VRS_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;

  return {
    clientId,
    clientSecret,
    // Same fail-safe as cashfreeOcr.getConfig: anything but an explicit
    // "production" is sandbox, because getting it wrong spends real money.
    base: process.env.CASHFREE_VRS_ENV?.trim() === "production" ? PRODUCTION_BASE : SANDBOX_BASE,
    apiVersion: process.env.CASHFREE_VRS_API_VERSION?.trim() || DEFAULT_API_VERSION,
  };
}

export function isIdentityConfigured(): boolean {
  return getConfig() !== null;
}

/**
 * The numbers a bypass can apply to.
 *
 * Aadhaar and PAN are deliberately absent. Both are self-asserted by design
 * now, not by configuration — there is no lookup behind either to switch
 * off, so "bypassing" one would name a call that does not exist. An
 * environment still carrying `IDENTITY_BYPASS=aadhaar` or `=pan` is told the
 * token is obsolete rather than being silently obeyed or silently ignored.
 */
const BYPASSABLE_KINDS = ["gstin"] as const;
type BypassableKind = (typeof BYPASSABLE_KINDS)[number];

function isBypassableKind(value: string): value is BypassableKind {
  return (BYPASSABLE_KINDS as readonly string[]).includes(value);
}

/**
 * Tokens already complained about.
 *
 * bypassedKinds re-reads the environment on every call — deliberately, so a
 * flag change does not need a restart to take effect — and isIdentityBypassed
 * is called on every upload. Without this, one stale token in IDENTITY_BYPASS
 * prints a paragraph per request until somebody notices, which is how a
 * warning stops being read.
 */
const warnedTokens = new Set<string>();

function warnOnce(token: string, message: string): void {
  if (warnedTokens.has(token)) return;
  warnedTokens.add(token);
  console.error(message);
}

/**
 * TEMPORARY — the identity-verification bypass.
 *
 *   IDENTITY_BYPASS=gstin          skip the GST portal lookup
 *   IDENTITY_BYPASS=1              same thing (legacy spelling)
 *
 * GSTIN is the only check left to bypass. `aadhaar` and `pan` both named
 * lookups that have since been removed, and both are now reported as obsolete
 * tokens rather than obeyed.
 *
 * A bypassed number is recorded with status `bypassed` rather than `verified`,
 * so an ops query finds every account that opened on an unchecked number, and
 * the customer is told on screen that it was not checked. That is a different
 * thing from `self_declared`, which is the designed state for Aadhaar and PAN
 * rather than a switch someone left on — see the file header.
 *
 * A BYPASSED GSTIN IS CHECKED AGAINST NOTHING beyond its mod-36 checksum, and
 * bypassing it also switches off the certificate check, since with no
 * confirmed GSTIN there is nothing to match the uploaded file against.
 *
 * Not gated on NODE_ENV, for the same reason PAYMENTS_TEST_MODE and OCR_BYPASS
 * are not: the client tests on a deployed staging build where NODE_ENV is
 * production, and that is the environment this is for. Unset it before this
 * environment has real customers, and delete the flag once every VRS product
 * this app uses is provisioned.
 */
function bypassedKinds(): Set<BypassableKind> {
  const raw = process.env.IDENTITY_BYPASS?.trim().toLowerCase();
  if (!raw) return new Set();
  // "1" predates the per-check spelling and still means everything, so an
  // environment already carrying it does not quietly start verifying again.
  if (raw === "1" || raw === "all" || raw === "true") {
    return new Set<BypassableKind>(BYPASSABLE_KINDS);
  }

  const kinds = new Set<BypassableKind>();
  for (const token of raw.split(/[,\s]+/).filter(Boolean)) {
    if (isBypassableKind(token)) {
      kinds.add(token);
    } else if (token === "aadhaar" || token === "pan") {
      // Named lookups that no longer exist — the DigiLocker journey and the
      // Income Tax PAN check. Loud, because an environment carrying either
      // believes it is switching something off.
      warnOnce(
        token,
        `[cashfreeIdentity] IDENTITY_BYPASS contains "${token}", which no longer means anything: ` +
          `the ${token === "aadhaar" ? "Aadhaar" : "PAN"} number is self-asserted by design and ` +
          "there is no lookup to skip. The uploaded document is still matched against it — " +
          "OCR_BYPASS=1 is what switches that off. Drop the token."
      );
    } else {
      // A typo'd value must not silently bypass nothing *or* everything.
      warnOnce(
        token,
        `[cashfreeIdentity] IDENTITY_BYPASS contains "${token}", which is not a check name. ` +
          `Expected some of: ${BYPASSABLE_KINDS.join(", ")} (or 1 for all). Ignoring that token.`
      );
    }
  }
  return kinds;
}

/**
 * Aadhaar and PAN always answer false: neither is checked with an authority,
 * so neither is ever bypassed. Callers ask about them freely — the answer
 * just says nothing was switched off, which is true.
 */
export function isIdentityBypassed(kind: IdentityKind): boolean {
  return isBypassableKind(kind) && bypassedKinds().has(kind);
}

/** Called once at boot. Silent when nothing is bypassed. */
export function warnIfIdentityBypassEnabled(): void {
  const kinds = bypassedKinds();
  if (kinds.size === 0) return;

  const where = process.env.NODE_ENV === "production" ? "a PRODUCTION build" : "development";
  console.warn(
    [
      "",
      "  ############################################################",
      `  ##  IDENTITY_BYPASS=${process.env.IDENTITY_BYPASS?.trim()}`,
      "  ##  GSTIN accepted WITHOUT being checked against the GST",
      "  ##  portal, and the GST certificate is not read either.",
      `  ##  Running in ${where}.`,
      "  ##  Unset this before this environment has real customers.",
      "  ############################################################",
      "",
    ]
      .filter((line): line is string => line !== null)
      .join("\n")
  );
}

function unavailable(detail: string): IdentityError {
  return {
    ok: false,
    failure: "unavailable",
    message: "We could not reach the verification service just now. Please try again in a moment.",
    detail,
  };
}

/**
 * VRS products are provisioned per account, and an un-provisioned one answers
 * 200 with an ordinary-looking message rather than a 4xx.
 *
 * That is an outage as far as the customer is concerned, so it stays
 * `unavailable`. But it is an outage nobody fixes by waiting, so it gets its
 * own log line naming the thing to go and enable.
 */
function notEnabled(product: string, message: string): IdentityError {
  console.error(
    `[cashfreeIdentity] ${product} is not enabled on this Cashfree account. ` +
      `Ask Cashfree to provision it, or set IDENTITY_BYPASS=1 to test without it. Vendor said: ${message}`
  );
  return {
    ok: false,
    failure: "unavailable",
    message: "Identity verification is not available right now. Please try again shortly.",
    detail: `product not enabled: ${message}`,
  };
}

function rejected(message: string, detail: string | null = null): IdentityError {
  return { ok: false, failure: "rejected", message, detail };
}

interface CashfreeCall {
  path: string;
  body: Record<string, unknown>;
  /** /pan wants it; the Aadhaar endpoints ignore it. */
  sendApiVersion: boolean;
}

type CashfreeAnswer =
  | { ok: true; status: number; body: Record<string, unknown> }
  | { ok: false; error: IdentityError };

/**
 * One JSON call to VRS. Never throws.
 *
 * A non-2xx is returned rather than converted, because these APIs put the
 * *verification* verdict in 4xx bodies as often as in the 200 body — a wrong
 * OTP is a 400 with a message, not an exception. Only the statuses that are
 * unambiguously ours (401/403 config, 422 balance, 429 rate, 5xx outage) are
 * turned into `unavailable` here, so each caller reads only its own verdicts.
 */
async function callCashfree(call: CashfreeCall): Promise<CashfreeAnswer> {
  const config = getConfig();
  if (!config) {
    return {
      ok: false,
      error: {
        ok: false,
        failure: "unavailable",
        message: "Identity verification is not switched on, so this cannot be checked yet.",
        detail: "CASHFREE_VRS_CLIENT_ID/SECRET not configured",
      },
    };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-client-id": config.clientId,
    "x-client-secret": config.clientSecret,
  };
  if (call.sendApiVersion) headers["x-api-version"] = config.apiVersion;

  let res: Response;
  try {
    res = await fetch(`${config.base}/verification${call.path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(call.body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "network error";
    console.error(`[cashfreeIdentity] ${call.path} request failed:`, detail);
    return { ok: false, error: unavailable(detail) };
  }

  return readAnswer(call.path, res);
}

/**
 * Turn one VRS response into an answer, or into `unavailable`.
 *
 * The status class is decided *before* the body is parsed. A gateway error
 * comes back as an HTML page, and parsing that first would report an
 * unparseable response — true, but it buries the 504 that explains it.
 *
 * Everything left is handed back with its status intact, including 4xx: these
 * APIs put the verification verdict in a 4xx body as often as in a 200 one
 * (a denied consent, an expired session), so each caller reads its own.
 */
async function readAnswer(path: string, res: Response): Promise<CashfreeAnswer> {
  const raw = await res.text().catch(() => "");

  // Our problems, in every case: bad credentials, an un-whitelisted IP, an
  // empty VRS balance, our own rate limit, their outage. None of these are
  // anything the customer did, so none of them may read as a rejection.
  const isOurs =
    res.status === 401 ||
    res.status === 403 ||
    res.status === 422 ||
    res.status === 429 ||
    res.status >= 500;

  let body: Record<string, unknown> = {};
  let parsed = true;
  if (raw) {
    try {
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      parsed = false;
    }
  }

  if (isOurs) {
    const detail = parsed ? String(body.message ?? "") : raw.replace(/\s+/g, " ").trim();
    console.error(`[cashfreeIdentity] ${path} HTTP ${res.status}:`, detail.slice(0, 300));
    return { ok: false, error: unavailable(`HTTP ${res.status}: ${detail.slice(0, 200)}`) };
  }

  if (!parsed) {
    // A 2xx/4xx we cannot read is an outage shape, not a verdict.
    console.error(`[cashfreeIdentity] ${path} unparseable body:`, raw.slice(0, 300));
    return { ok: false, error: unavailable(`unparseable response (HTTP ${res.status})`) };
  }

  return { ok: true, status: res.status, body };
}

function messageOf(body: Record<string, unknown>): string {
  return typeof body.message === "string" ? body.message : "";
}

function statusOf(body: Record<string, unknown>): string {
  return typeof body.status === "string" ? body.status.toUpperCase() : "";
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/* ── Aadhaar ───────────────────────────────────────────────────
 *
 * No vendor call, and no code here either. The number is typed by the
 * customer and checked only for self-consistency, by the same validator the
 * signup form uses — shared/aadhaar.ts — so the two cannot disagree about what
 * the form is allowed to submit. What proves the number is the card uploaded
 * at the next step, which Smart OCR must read as this same number. See the
 * file header for what that does and does not establish.
 *
 * Re-exported rather than imported directly by routes.ts so that every
 * identity-number validator still arrives from one place.
 */
export { isValidAadhaarNumber } from "../shared/aadhaar.js";

/* ── PAN ─────────────────────────────────────────────────────────
 *
 * No vendor call, for the same reason Aadhaar has none: the Income Tax
 * lookup was dropped, so a PAN is typed by the customer and backed only by
 * the card uploaded at the documents step, which Smart OCR must read as this
 * same number. Recorded `self_declared`.
 *
 * WHAT WENT WITH IT. verifyPan asked /verification/pan and got back the name
 * the PAN is registered to, graded against the account name; NO_MATCH refused
 * the account. That was the check that stopped someone opening an account on
 * an unrelated person's PAN — and the document match does NOT replace it,
 * because Smart OCR reads the *number* off a PAN card and never the name. A
 * genuine card belonging to somebody else now passes. Also lost: pan_status
 * (a deleted or fake PAN), pan_type (Individual vs Company, which is how a
 * company account was held to a company PAN), and aadhaar_seeding_status.
 *
 * GSTIN is now the only number any authority confirms, so a company account
 * has one real check and a personal account has none.
 */

export function isValidPanNumber(value: string): boolean {
  return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(value.trim().toUpperCase());
}

/**
 * Our own name check, for when Cashfree declines to grade one.
 *
 * Only GSTIN uses this now. It arrived as verifyPan's fallback; the PAN
 * lookup is gone and this stayed, because the GST portal never grades a name
 * at all and somebody has to.
 *
 * `name_match_result` is documented on this endpoint but is not always
 * returned — the GST portal does not grade a name at all, so there is never
 * one to read. Trusting the absence would make the whole name check
 * decoration: anyone could claim a GSTIN that is not theirs and the API
 * would say yes.
 *
 * So one word in common decides it. That is deliberately the weakest
 * possible test, because business names disagree with the register
 * constantly — a trading name against a legal one, "PRIVATE LIMITED"
 * against "Pvt Ltd" — and a stricter rule costs real customers. What it
 * does catch is the case worth catching: a GSTIN belonging to an unrelated
 * business, which shares nothing.
 *
 * Tokens under three characters are ignored, so an initial cannot carry a
 * match on its own.
 */
function sharesAnyNameToken(a: string, b: string): boolean {
  const tokens = (v: string): string[] =>
    v
      .toUpperCase()
      .split(/[^A-Z0-9]+/)
      .filter((t) => t.length >= 3);
  const left = new Set(tokens(a));
  if (left.size === 0) return true; // Nothing to compare on; do not invent a refusal.
  return tokens(b).some((token) => left.has(token));
}

/* ── GSTIN ────────────────────────────────────────────────────────────────── */

/**
 * Verify a GSTIN exists, is active, and belongs to this company.
 *
 *   POST {base}/verification/gstin  { GSTIN, businessName? }
 *
 * Note the casing: `GSTIN` upper, `businessName` camel. Cashfree is snake_case
 * everywhere else in this file; this one endpoint is not, and sending
 * `gstin`/`business_name` gets a 400 that reads like the number is wrong.
 *
 * The shape of the answer differs from PAN's in two ways that matter:
 *
 *   • There is no `valid` boolean in practice. The schema documents one, and
 *     the live sandbox omits it on both the valid and the invalid response.
 *     What actually separates them is `legal_name_of_business`: present on a
 *     real GSTIN, absent alongside "GSTIN Doesn't Exist" on a fake one.
 *   • There is no name-match grade at all, not even sometimes. So the company
 *     name is compared here, by the same one-shared-word rule verifyPan falls
 *     back to — against the trade name as well as the legal one, because a
 *     business commonly signs up under the name it trades as.
 *
 * `shared/gstin.ts` has already checked the format and the mod-36 checksum
 * before anything reaches here; this is the registry lookup that checksum
 * cannot be a substitute for.
 */
export async function verifyGstin(
  gstin: string,
  companyName: string
): Promise<GstinVerified | IdentityError> {
  const normalized = gstin.trim().toUpperCase();
  if (!isValidGstinFormat(normalized)) {
    return rejected("Enter a valid 15-character GST number.");
  }

  const answer = await callCashfree({
    path: "/gstin",
    body: { GSTIN: normalized, businessName: companyName.trim().slice(0, 100) },
    sendApiVersion: false,
  });
  if (!answer.ok) return answer.error;

  const { body } = answer;
  const message = messageOf(body);
  const legalName = stringOrNull(body.legal_name_of_business);
  const tradeName = stringOrNull(body.trade_name_of_business);

  // Explicitly false wins if it is ever actually sent; otherwise the legal
  // name is the tell. Both, so this keeps working if they start sending it.
  if (body.valid === false || !legalName) {
    if (/not enabled/i.test(message)) return notEnabled("GSTIN Verification", message);
    return rejected(
      "This GST number was not found on the GST portal. Please check it and try again.",
      message || "no legal_name_of_business"
    );
  }

  // A GSTIN that exists but has been cancelled or suspended cannot be filed
  // under, so it is refused with its own wording rather than folded into
  // "not found" — the customer's next move is different.
  const status = stringOrNull(body.gst_in_status);
  if (status && status.toUpperCase() !== "ACTIVE") {
    return rejected(
      `This GST number is ${status.toLowerCase()} on the GST portal and cannot be used. Please use an active GST registration.`,
      `gst_in_status=${status}`
    );
  }

  // No grade is ever returned here, so the check is ours or it is nothing.
  // Trade name counts: plenty of businesses sign up as what they trade as.
  const matchesLegal = sharesAnyNameToken(companyName, legalName);
  const matchesTrade = tradeName ? sharesAnyNameToken(companyName, tradeName) : false;
  if (!matchesLegal && !matchesTrade) {
    return rejected(
      `This GST number is registered to "${legalName}". Please enter the GST number that belongs to this company.`,
      `name mismatch: provided="${companyName}" legal="${legalName}" trade="${tradeName ?? "-"}"`
    );
  }

  return {
    ok: true,
    gstin: stringOrNull(body.GSTIN) ?? normalized,
    legalName,
    tradeName,
    gstStatus: status,
    taxpayerType: stringOrNull(body.taxpayer_type),
    dateOfRegistration: stringOrNull(body.date_of_registration),
    constitutionOfBusiness: stringOrNull(body.constitution_of_business),
    principalPlaceAddress: stringOrNull(body.principal_place_address),
    details: body,
    referenceId: body.reference_id != null ? String(body.reference_id) : null,
  };
}

/**
 * The 15-character GSTIN shape.
 *
 * Format only — `validateGstin` in shared/gstin.ts owns the checksum, and both
 * the form and the signup route run it before this is reached. Duplicated as a
 * shape test here so a direct call to verifyGstin cannot spend a billed lookup
 * on something that was never a GSTIN.
 */
export function isValidGstinFormat(value: string): boolean {
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(value.trim().toUpperCase());
}
