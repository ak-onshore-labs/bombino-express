import type { Express, NextFunction, Request, Response } from "express";
import {
  countUnreadNotifications,
  createNewSupportSession,
  findItdUserIdByCustomerId,
  findItdUserIdByPhone,
  findOrCreateAddress,
  generateSessionTitle,
  getAccountShapeById,
  getItdUserProfileById,
  getItdUserTokenAndSecretsById,
  getOrCreateSupportSession,
  insertLoginAuditLog,
  resolveSupportSession,
  listAddressesByUserIdAndType,
  getShipmentDocument,
  listShipmentDocumentKinds,
  listNotificationsByUserId,
  listShipmentsByUserId,
  insertNotification,
  markNotificationRead,
  mergeItdUserMetadataById,
  updateSupportSessionMessages,
  clearItdUserPhoneById,
  itdUserHasStoredPassword,
  updateItdUserPhoneById,
  updateItdUserUsernameById,
  upsertItdUserAndReturnId,
  upsertTrackingEvents,
  updateShipmentTrackingStatus,
  getLastKnownTracking,
} from "./appDb.js";
import type { ShipmentDocumentKind } from "./appDb.js";
import {
  getOrderById,
  getOrderByNumberForUser,
  getUserContactsByIds,
  claimGuestOrdersForUser,
  insertOrderAndReturnRow,
  refreshKycVerifiedOnOpenOrders,
  insertOrderEvent,
  listOrderEvents,
  listCancellationOrdersByUserId,
  listOrdersByUserId,
  listPaymentsByOrderId,
  markCancellationRequestDecided,
  recordCancellationRequest,
  toOrder,
} from "./ordersDb.js";
import {
  availableActions,
  findTransition,
  isKnownAction,
} from "./orderLifecycle.js";
import {
  notifyAgentOfCancellationRequest,
  notifyAgentsOfNewJob,
  notifyCancellationDeclined,
  notifyHandoverCodeReissued,
  notifyOrderBooked,
  notifyOrderTransition,
} from "./notify.js";
import {
  advanceOrderStatus,
  claimPickup,
  recordCollectedPayment,
  transitionOrderStatus,
} from "./agentDb.js";
import {
  burnCodeForOverride,
  getCodeForOwner,
  issueCode,
  verifyCode,
  HANDOVER_CODE_PATTERN,
  type HandoverKind,
} from "./handoverCodes.js";
import { ensureDbUser, requireRole, requireUser } from "./routeGuards.js";
import { registerAgentRoutes } from "./routes/agent.js";
import { registerPaymentRoutes } from "./routes/payments.js";
import { registerWhatsappRoutes } from "./routes/whatsapp.js";
import { registerWhatsappScheduleRoutes } from "./routes/whatsappSchedule.js";
import { registerOpsRoutes } from "./routes/ops.js";
import { handleGenerateDocket, handleSettle, handleWeigh } from "./opsActions.js";
import { isIndiaHubId } from "../shared/hubs.js";
import {
  cancellationState,
  deriveCustomerStatus,
  isInternalOnlyStatus,
  isRole,
  readCancellationRequest,
} from "../shared/orderContract.js";
import type { Order, OrderStatus, Role } from "../shared/orderContract.js";
import { earliestPickupDate } from "../shared/istTime.js";
import {
  formatCutoffHour,
  formatPickupCities,
  getPickupServiceability,
  pickupCutoffHour,
} from "../shared/pickupPincodes.js";
import {
  generateOtp,
  hashOtp,
  deliverOtp,
  OTP_TTL_MINUTES,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_REQUESTS_PER_HOUR,
  OTP_VERIFICATION_WINDOW_MINUTES,
} from "./otp.js";
import type { OtpPurpose } from "./otpDb.js";
import {
  countRecentRequests,
  insertOtpCode,
  hasRecentVerification,
} from "./otpDb.js";
import { consumeOtp, verifyOtp } from "./otpVerify.js";
import { decryptPassword, encryptPassword, isEncryptionConfigured } from "./crypto.js";
import {
  itdTokenExpiryIso,
  mintItdSession,
  refreshItdTokenIfNeeded,
  withTimeout,
} from "./itdTokenRefresh.js";
import type { Server } from "http";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import multer from "multer";
import { z } from "zod";
import { itdClient } from "./itd.js";
import type { CreateShipmentPayload, RateParams } from "./itd.js";
import { handleChat } from "./supportAgent.js";
import { supportChatRateLimit } from "./supportRateLimit.js";
import type { ChatMessage } from "./supportTypes.js";
import { persistShipmentAfterCreate } from "./persistShipment.js";
import { lookupPostal } from "./postalLookup.js";
import {
  getKycByCapabilityId,
  getKycByGuestRef,
  getKycByUserId,
  getKycFileByGuestRef,
  getKycFileByUserId,
  upsertKycDocument,
} from "./kycDb.js";
import {
  buildItdKycPayload,
  toKycSummary,
} from "../shared/kyc.js";
import {
  bypassedOcr,
  ocrTypeForDocSlot,
  ACCOUNT_SLOT_FOR_KYC_TYPE,
  ocrTypeForKycDocumentType,
  runSmartOcr,
  skippedOcr,
  type OcrResult,
} from "./cashfreeOcr.js";
import {
  isIdentityBypassed,
  isValidAadhaarNumber,
  isValidGstinFormat,
  isValidPanNumber,
  verifyGstin,
} from "./cashfreeIdentity.js";
import { checkGstCertificate } from "./gstCertificate.js";
import { signContractPdf } from "./contractPdf.js";
import { sweepAbandonedSignups, ABANDONED_SIGNUP_RETENTION_DAYS } from "./retention.js";
import { logDocumentAccess } from "./documentAccessLog.js";
import {
  claimSignupIdentityVerifications,
  deleteIdentityVerificationsBySignupRef,
  listIdentityVerificationsBySignupRef,
  upsertIdentityVerification,
  type IdentityKind,
} from "./identityDb.js";
import {
  toOcrColumns,
  claimSignupDocuments,
  deleteAllSignupDocuments,
  deleteSignupDocument,
  getAccountDocumentByCapabilityId,
  deleteUserDocument,
  getSignupDocumentWithFile,
  getUserDocumentWithFile,
  getVerificationState,
  listDocumentsByUserId,
  listDocumentsBySignupRef,
  upsertAccountDocument,
} from "./accountDocsDb.js";
import {
  CONTRACT_VERSION,
  isValidSignature,
  SIGNATURE_ERROR,
  SIGNATURE_MAX_LENGTH,
} from "../shared/contract.js";
import {
  COMPANY_CATEGORIES,
  COMPANY_CATEGORY_SPECS,
  DOC_SLOT_SPECS,
  EXTRA_FIELD_SPECS,
  IDENTITY_CHECK_LABELS,
  isDocSlot,
  isOcrCheckedSlot,
  isVerifiedDocSlot,
  VERIFIED_DOC_SLOTS,
  missingDocuments,
  requiredDocuments,
  requiredExtraFields,
  requiredIdentityChecks,
  verificationState,
  type CompanyCategory,
  type DocSlot,
  type ExtraField,
  type VerifiedDocSlot,
} from "../shared/accountSpec.js";
import { validateGstin } from "../shared/gstin.js";
import {
  SUPPORT_CHAT_MAX_MESSAGES,
  SUPPORT_CHAT_MAX_CONTENT_LENGTH,
} from "./supportTypes.js";

// Matches the refresh path's ceiling (itdTokenRefresh.ts). The legacy
// POST /api/auth/login has no timeout and can hang on a stalled ITD.
const ITD_LINK_TIMEOUT_MS = 10_000;

const kycUpload = multer({
  storage: multer.memoryStorage(),
  // 4MB, not 5: a serverless request body is capped at 4.5MB on Vercel and the
  // platform rejects the request before multer ever sees it — which surfaces as
  // a bare 413 with no JSON body and no way to say why. Staying under the cap
  // keeps the error ours. Raise this only if the host is a long-lived server,
  // and change client/src/components/KycUpload.tsx to match.
  limits: { fileSize: 4 * 1024 * 1024 }, // 4MB
  fileFilter: (_req, file, cb) => {
    const allowed = new Set(["application/pdf", "image/jpeg", "image/png"]);
    if (allowed.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF, JPEG, and PNG files are accepted."));
    }
  },
});

// ─── Route registration ───────────────────────────────────────────────────────

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // ── Self-registering route modules (M0 item 1) ───────────────────────────
  // Agent read endpoints. Transitions stay on the uniform action endpoint
  // below, so this file keeps the state machine and `routes/agent.ts` stays
  // read-only.
  registerAgentRoutes(app);

  // Razorpay (A4). Self-contained: gateway order, verify, webhook. The webhook
  // is unauthenticated by design — its signature is its authentication.
  registerPaymentRoutes(app);

  // WhatsApp delivery receipts, and the STOP word. Unauthenticated by design
  // too — the secret in the path is what the provider was given.
  registerWhatsappRoutes(app);

  // The agent digest and slot reminders, driven by an external scheduler.
  registerWhatsappScheduleRoutes(app);

  // Ops console: board + detail reads, the transactions ledger, and staff
  // users. Admin/super_admin gated inside the module; writes go through the
  // uniform action endpoint below.
  registerOpsRoutes(app);

  // ── Auth ──────────────────────────────────────────────────────────────────

  // POST /api/auth/login — authenticate via ITD; store token + user in session
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) {
      res.status(400).json({ message: "email and password are required" });
      return;
    }

    try {
      const { token, user } = await itdClient.loginUser(email, password);
      req.session.itdToken = token;
      req.session.user = user;
      // Non-blocking DB sync — never affects login response
      void (async () => {
        try {
          const tokenExpiresAt = new Date(
            Date.now() + 24 * 60 * 60 * 1000
          ).toISOString();
          const enc = encryptPassword(password);
          const dbRow = await upsertItdUserAndReturnId({
            itd_customer_id: user.id,
            itd_customer_code: user.customerId,
            email: user.email,
            full_name: user.fullName,
            username: user.username,
            role: user.role,
            itd_token: token,
            itd_token_expires_at: tokenExpiresAt,
            ...(enc.encrypted && enc.iv
              ? {
                  itd_password_encrypted: enc.encrypted,
                  encryption_iv: enc.iv,
                }
              : {}),
          });
          if (dbRow?.id) {
            void insertLoginAuditLog({
              user_id: dbRow.id,
              metadata: {
                itd_customer_code: user.customerId,
                role: user.role,
              },
              ip_address: req.ip ?? null,
            });
          }
        } catch (e: any) {
          console.error("[login] DB sync error (non-fatal):", e.message);
        }
      })();
      req.session.save((err) => {
        if (err) {
          console.error("[login] session save error:", err);
        }
        res.json(user);
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Login failed";
      res.status(401).json({ message });
    }
  });

  app.get("/api/debug/session", (req, res) => {
    res.json({
      hasSession: !!req.session,
      hasItdToken: !!req.session.itdToken,
      hasUser: !!req.session.user,
      hasDbUserId: !!req.session.dbUserId,
      sessionID: req.sessionID,
      cookieSettings: req.session.cookie,
    });
  });

  // POST /api/auth/logout — destroy session
  app.post("/api/auth/logout", (req: Request, res: Response) => {
    req.session.destroy((err) => {
      if (err) {
        res.status(500).json({ message: "Logout failed" });
        return;
      }
      res.json({ message: "Logged out" });
    });
  });

  // GET /api/auth/me — return session user
  app.get("/api/auth/me", (req: Request, res: Response) => {
    if (!req.session.user) {
      res.status(401).json({ message: "Not authenticated" });
      return;
    }
    res.json(req.session.user);
  });

  // ── Signup: OTP + personal/company account creation (A2) ─────────────────

  const otpPurposeSchema = z.enum([
    "signup_personal",
    "signup_company",
    "login",
    // The unified entry point (/api/auth/phone/continue). Deliberately its own
    // purpose rather than a reuse of "login": hasRecentVerification(phone,
    // purpose, …) is the security boundary, and one code that authorises
    // sign-in, account creation *and* ITD credential linking is the kind of
    // conflation that survives review unnoticed.
    "auth",
  ]);
  const phoneSchema = z.string().trim().regex(/^\d{10}$/, "Enter a valid 10-digit phone number");

  // POST /api/auth/otp/request
  app.post("/api/auth/otp/request", async (req: Request, res: Response) => {
    const parsed = z
      .object({ phone: phoneSchema, purpose: otpPurposeSchema })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid request" });
      return;
    }
    const { phone, purpose } = parsed.data;

    const recentCount = await countRecentRequests(phone, 60);
    if (recentCount !== null && recentCount >= OTP_MAX_REQUESTS_PER_HOUR) {
      res.status(429).json({ message: "Too many OTP requests. Please try again later." });
      return;
    }

    const code = generateOtp();
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60_000).toISOString();
    const inserted = await insertOtpCode({
      phone,
      code_hash: hashOtp(code),
      purpose,
      expires_at: expiresAt,
    });
    if (!inserted) {
      res.status(502).json({ message: "Could not send OTP. Please try again." });
      return;
    }

    await deliverOtp(phone, code);
    res.json({ message: "OTP sent" });
  });

  // POST /api/auth/otp/verify
  app.post("/api/auth/otp/verify", async (req: Request, res: Response) => {
    const parsed = z
      .object({
        phone: phoneSchema,
        purpose: otpPurposeSchema,
        code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code"),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid request" });
      return;
    }
    const { phone, purpose, code } = parsed.data;

    const result = await consumeOtp(phone, purpose as OtpPurpose, code);
    if (!result.ok) {
      res.status(result.status).json({ message: result.message });
      return;
    }
    res.json({ verified: true });
  });

  // ── Onboarding documents ──────────────────────────────────────────────────
  //
  // The accounts department compels a document set before an account opens
  // (shared/accountSpec.ts), so these uploads happen *before* there is a user
  // row to hang them on. They are staged against a `signupRef` held in the
  // session and claimed by the account at creation.
  //
  // Authorisation is the verified phone number: the caller must have passed
  // the OTP for the number they are opening the account under. That is the
  // same proof /api/auth/signup/* asks for a moment later.

  /** Mint the staging handle on first use; reuse it for the rest of the signup. */
  /**
   * The handle this signup's staged rows are owned by, for this phone.
   *
   * Documents and identity verifications belong to a NUMBER, not to a browser.
   * The ref used to be minted once per session and never revisited, so
   * verifying a phone, proving an Aadhaar, then starting again with a
   * different number left the second signup holding the first one's verified
   * identity and uploaded files — and an account could open for one person on
   * another person's Aadhaar and PAN.
   *
   * So the ref is bound to the phone that proved it. When the phone changes
   * the old ref is abandoned, its rows are deleted, and a fresh one is minted.
   * Deletion is best-effort: an orphaned row is recoverable, but handing it to
   * the wrong person is not, and the new ref already guarantees the second
   * part regardless of whether the delete lands.
   *
   * Every staging and reading endpoint goes through here, so there is one
   * place where the binding can be got wrong.
   */
  async function signupRefForPhone(req: Request, phone: string): Promise<string> {
    if (req.session.signupPhone === phone && req.session.signupRef) {
      return req.session.signupRef;
    }

    const abandoned = req.session.signupPhone !== undefined ? req.session.signupRef : undefined;

    req.session.signupRef = crypto.randomUUID();
    req.session.signupPhone = phone;

    if (abandoned) {
      console.warn(`[signup] phone changed mid-signup — discarding staged rows for ${abandoned}`);
      try {
        await Promise.all([
          deleteAllSignupDocuments(abandoned),
          deleteIdentityVerificationsBySignupRef(abandoned),
        ]);
      } catch (err) {
        console.error("[signup] failed to discard abandoned signup rows:", err);
      }
    }

    return req.session.signupRef;
  }

  /**
   * The ref for a read, without minting one.
   *
   * Returns null when this session has nothing staged for that phone, which
   * the readers answer as an empty list. A GET must never hand back rows
   * proved by a different number just because the same browser asked.
   */
  function signupRefForReading(req: Request, phone: string | undefined): string | null {
    if (!phone || req.session.signupPhone !== phone) return null;
    return req.session.signupRef ?? null;
  }

  /**
   * The signup endpoints have no session to authenticate against — the account
   * does not exist yet — so a recent OTP on the number is what authorises
   * them. That authorisation expires after OTP_VERIFICATION_WINDOW_MINUTES,
   * and filling in a documents screen takes longer than ten minutes often
   * enough that it is a normal thing to happen rather than an edge case.
   *
   * Both refusals carry `code: "phone_unverified"` so the form can act on it
   * without reading the prose. It sends the customer back to re-request a
   * code instead of leaving them on a screen where every button fails.
   */
  const PHONE_UNVERIFIED = "phone_unverified";

  async function assertPhoneVerified(
    phone: unknown,
    res: Response
  ): Promise<string | null> {
    const parsed = phoneSchema.safeParse(phone);
    if (!parsed.success) {
      res
        .status(400)
        .json({ message: "A verified phone number is required", code: PHONE_UNVERIFIED });
      return null;
    }
    const verified = await hasRecentVerification(
      parsed.data,
      "auth",
      OTP_VERIFICATION_WINDOW_MINUTES
    );
    if (!verified) {
      res.status(400).json({
        message: `Your phone verification has expired. Please request a new code.`,
        code: PHONE_UNVERIFIED,
      });
      return null;
    }
    return parsed.data;
  }

  /**
   * Validate the number printed on a document, where the slot asks for one.
   * Returns the value to store, or an error message. The patterns are the
   * ones the form enforces — shared/accountSpec.ts is the single source.
   */
  function normalizeDocumentNo(
    slot: DocSlot,
    raw: unknown
  ): { ok: true; value: string | null } | { ok: false; message: string } {
    const field = DOC_SLOT_SPECS[slot].numberField;
    if (!field) return { ok: true, value: null };

    const trimmed = typeof raw === "string" ? raw.trim() : "";
    if (!trimmed) {
      return { ok: false, message: `${field.label} is required` };
    }
    const value = field.uppercase ? trimmed.toUpperCase() : trimmed;
    if (!field.pattern.test(value)) {
      return { ok: false, message: field.error };
    }
    return { ok: true, value };
  }

  /**
   * Read the document and check it says what the customer said it says.
   *
   * Refuses the upload when OCR reads a contradicting number, the wrong kind
   * of document, or a tamper signal. Everything else — an unreadable scan, an
   * outage, no credentials — is allowed through and recorded as unverified,
   * because those failures are ours and a customer cannot photograph their way
   * out of them. See server/cashfreeOcr.ts for the full policy.
   */
  async function verifyDocumentOrRefuse(
    res: Response,
    args: {
      cashfreeType: ReturnType<typeof ocrTypeForDocSlot>;
      typedNumber: string | null;
      file: Express.Multer.File;
      tag: string;
    }
  ): Promise<OcrResult | null> {
    if (!args.cashfreeType || !args.typedNumber) {
      return skippedOcr("No OCR check applies to this document.");
    }

    const result = await runSmartOcr({
      documentType: args.cashfreeType,
      typedNumber: args.typedNumber,
      file: args.file.buffer,
      filename: args.file.originalname,
      mimeType: args.file.mimetype,
      tag: args.tag,
    });

    if (result.blocking) {
      // 422: the request was well-formed and we understood it — the document
      // itself is the problem.
      res.status(422).json({
        message: result.message,
        ocr: { status: result.status, verification_id: result.verification_id },
      });
      return null;
    }
    return result;
  }

  /* ── Identity numbers ────────────────────────────────────────────────────
   *
   * The step ahead of the document upload. Each number is collected here, and
   * the documents screen then makes the uploaded file agree with it.
   *
   *   GSTIN   proved by the GST portal returning the legal and trade names of
   *           the business, and a status of Active. The only one of the
   *           three that reaches an authority.
   *   Aadhaar not proved by anyone. Typed, checked for its Verhoeff check
   *           digit, recorded `self_declared`.
   *   PAN     not proved by anyone either, since the Income Tax lookup was
   *           removed. Typed, checked for shape, recorded `self_declared`.
   *
   * What stands behind the last two is the document uploaded at the next
   * step, which Smart OCR must read as the same number — see the header of
   * server/cashfreeIdentity.ts for what that does and does not establish.
   * The ordering still matters for all three: the number is recorded
   * first, so the OCR comparison is against a value the customer can no
   * longer change by the time the file arrives.
   *
   * Rows are staged against the session's signup_ref exactly like documents,
   * and claimed by the account at creation. See server/cashfreeIdentity.ts for
   * the vendor contract and the refusal policy.
   */

  const IDENTITY_KIND_BY_SLOT: Record<VerifiedDocSlot, IdentityKind> = {
    aadhaar_card: "aadhaar",
    pan_card: "pan",
    gst_certificate: "gstin",
  };

  /**
   * The number recorded for each kind on this signup.
   *
   * "Recorded", not "proved" — an Aadhaar row is self_declared and nobody
   * confirmed it. The distinction does not change what this function is for:
   * whatever is here is the value the uploaded document has to agree with,
   * and the client does not get to supply a different one.
   */
  async function recordedIdentityNumbers(req: Request, phone: string): Promise<Map<IdentityKind, string>> {
    const signupRef = signupRefForReading(req, phone);
    if (!signupRef) return new Map();
    const rows = await listIdentityVerificationsBySignupRef(signupRef);
    return new Map(rows.map((row) => [row.kind, row.document_no]));
  }

  /**
   * Answer an identity failure.
   *
   * `rejected` is 422 — the request was understood perfectly and the authority
   * simply said no. `expired` is 410, which the form reads as "offer a fresh
   * OTP" rather than "retype". `unavailable` is 503, so nothing about it can
   * be mistaken for the customer's fault.
   */
  function sendIdentityFailure(
    res: Response,
    err: { failure: string; message: string; detail: string | null }
  ): void {
    if (err.detail) console.error("[signup/identity]", err.failure, "-", err.detail);
    const status = err.failure === "rejected" ? 422 : err.failure === "expired" ? 410 : 503;
    res.status(status).json({ message: err.message, failure: err.failure });
  }

  /**
   * Write one confirmed number against the in-flight signup.
   *
   * Answers the request itself on failure and returns false, so callers read
   * as a straight line. Minting the signup_ref here rather than at the first
   * upload is what lets identity verification come *before* any document.
   */
  async function recordIdentity(
    req: Request,
    res: Response,
    phone: string,
    input: {
      kind: IdentityKind;
      document_no: string;
      status: "verified" | "self_declared" | "bypassed";
      reference_id: string | null;
      verified_name: string | null;
      name_submitted?: string | null;
      name_match_result?: string | null;
      name_match_score?: number | null;
      details: Record<string, unknown> | null;
    }
  ): Promise<boolean> {
    try {
      const saved = await upsertIdentityVerification({
        signup_ref: await signupRefForPhone(req, phone),
        ...input,
      });
      if (!saved) {
        res.status(500).json({ message: "Could not record the verification. Please try again." });
        return false;
      }
      return true;
    } catch (err) {
      console.error(`[signup/identity] failed to record ${input.kind}:`, err);
      res.status(500).json({ message: "Could not record the verification. Please try again." });
      return false;
    }
  }

  /**
   * POST /api/signup/contract/preview — the contract with the signature on it
   *
   * Answers the PDF itself, so the signing screen can show the customer the
   * document they are about to sign with their own name already in the
   * signature block — rather than a description of it, or the blank form with
   * the name alongside.
   *
   * Generated per request and never stored. Nothing here is a record: the
   * account does not exist yet, the customer may still change the name, and a
   * preview kept on disk would be one more copy to keep in step with the
   * acceptance that actually counts. The stored copy, when there is one, is
   * made from the same function at account creation.
   *
   * Authorised the same way every other pre-account endpoint is, by a recent
   * OTP on the phone. Without that this would hand anyone a contract with any
   * name they liked stamped on it.
   */
  app.post("/api/signup/contract/preview", async (req: Request, res: Response) => {
    const phone = await assertPhoneVerified(req.body?.phone, res);
    if (!phone) return;

    const signedName =
      typeof req.body?.signed_name === "string" ? req.body.signed_name.trim() : "";
    if (!isValidSignature(signedName)) {
      res.status(400).json({ message: SIGNATURE_ERROR });
      return;
    }

    const accountName =
      typeof req.body?.account_name === "string"
        ? req.body.account_name.trim().slice(0, SIGNATURE_MAX_LENGTH)
        : "";

    try {
      const pdf = await signContractPdf({
        signedName,
        accountName,
        // The preview is dated now; the copy that counts is dated when the
        // account is written, from contractColumns.
        signedAt: new Date(),
      });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Length", String(pdf.length));
      // Rendered in the page, not downloaded, and never cached: the name on
      // it changes as the customer edits the field.
      res.setHeader("Content-Disposition", 'inline; filename="contract-2026.pdf"');
      res.setHeader("Cache-Control", "no-store");
      res.end(pdf);
    } catch (err) {
      console.error("[signup/contract] preview failed:", err);
      res.status(500).json({ message: "Could not prepare the contract. Please try again." });
    }
  });

  /**
   * GET /api/signup/identity — what this signup has recorded so far
   *
   * The signup form no longer reads this. It used to, to prefill the identity
   * step on the way back into it, and that is exactly the behaviour the
   * customer objected to: a number typed on an earlier attempt reappearing on
   * a later one. See POST /api/signup/identity/reset.
   *
   * Kept because it is the only way to ask what a signup holds without
   * creating anything, which support and the account-creation path both want.
   */
  app.get("/api/signup/identity", async (req: Request, res: Response) => {
    // Scoped to the phone the caller names: a browser that has moved on to a
    // different number must not be handed what the previous one proved.
    const phone = typeof req.query.phone === "string" ? req.query.phone : undefined;
    const signupRef = signupRefForReading(req, phone);
    if (!signupRef) {
      res.set("Cache-Control", "no-store");
      res.json({ verifications: [] });
      return;
    }
    const rows = await listIdentityVerificationsBySignupRef(signupRef);
    res.set("Cache-Control", "no-store");
    res.json({
      verifications: rows.map((row) => ({
        kind: row.kind,
        // Session-scoped: the only reader is the browser that typed it, which
        // is also the browser the OTP went to.
        document_no: row.document_no,
        status: row.status,
        verified_name: row.verified_name,
        name_submitted: row.name_submitted,
        name_match_result: row.name_match_result,
        verified_at: row.verified_at,
      })),
    });
  });

  /**
   * POST /api/signup/identity/reset — start the identity step clean
   *
   * Called by the form every time the customer arrives at the collection
   * step, whether that is the first time, a step back from the review screen,
   * or a fresh run through signup in the same browser.
   *
   * WHY THIS EXISTS. Staged rows are keyed by a signup_ref that lives as long
   * as the session and the phone behind it, so a second run through signup on
   * the same number used to find the first run's numbers still there and show
   * them back. An Aadhaar somebody typed earlier reappearing on a later
   * attempt is not a convenience; on a shared device it is somebody else's
   * Aadhaar on a stranger's screen.
   *
   * It clears the identity rows AND the documents that carry those numbers.
   * The two are one thing on screen now — a number and its card live in the
   * same slot — so clearing the number while leaving the card behind would
   * show a verified upload above an empty field, and account creation would
   * then refuse the pair anyway.
   *
   * The slots that carry no number are deliberately left alone: an electricity
   * bill or an authorization letter cannot go stale when a number changes, and
   * making somebody re-upload one buys nothing.
   *
   * Idempotent, and safe when there is nothing staged: with no signup_ref for
   * this phone it deletes nothing and says so.
   */
  app.post("/api/signup/identity/reset", async (req: Request, res: Response) => {
    const phone = await assertPhoneVerified(req.body?.phone, res);
    if (!phone) return;

    // Deliberately the reading form, which does not mint a ref. Arriving at
    // the identity step is not a reason to create a signup that does not
    // exist yet — the first POST that records something does that.
    const signupRef = signupRefForReading(req, phone);
    if (!signupRef) {
      res.json({ cleared: false });
      return;
    }

    try {
      await Promise.all([
        deleteIdentityVerificationsBySignupRef(signupRef),
        ...VERIFIED_DOC_SLOTS.map((slot) => deleteSignupDocument(signupRef, slot)),
      ]);
    } catch (err) {
      // Not fatal to the customer: they are about to retype every number, and
      // each write replaces whatever survived. Worth a log, because a reset
      // that silently fails is how a stale row reaches account creation.
      console.error("[signup/identity] reset failed:", err);
      res.status(500).json({ message: "Could not start the identity step. Please try again." });
      return;
    }

    res.json({ cleared: true });
  });

  /**
   * POST /api/signup/identity/aadhaar — record the number the customer typed
   *
   * There is no authority behind this one. DigiLocker was removed and Offline
   * Aadhaar Verification was never provisioned, so nothing is asked and
   * nothing answers: the number is checked for its Verhoeff check digit and
   * written as `self_declared`.
   *
   * What makes it worth anything is the next step. The card uploaded against
   * the aadhaar_card slot is read by Smart OCR and must carry this number —
   * and because the upload path takes the number from this row rather than
   * from the request, a client cannot type one number here and claim another
   * there. A card that reads differently is refused, and without a `match`
   * the account does not open.
   *
   * That proves the customer holds a card bearing the number they typed. It
   * does not prove the card is theirs. See server/cashfreeIdentity.ts.
   */
  app.post("/api/signup/identity/aadhaar", async (req: Request, res: Response) => {
    const phone = await assertPhoneVerified(req.body?.phone, res);
    if (!phone) return;

    const aadhaar =
      typeof req.body?.aadhaar_number === "string"
        ? req.body.aadhaar_number.replace(/\s/g, "")
        : "";
    if (!isValidAadhaarNumber(aadhaar)) {
      res.status(400).json({ message: "Enter a valid 12-digit Aadhaar number" });
      return;
    }

    const banked = await recordIdentity(req, res, phone, {
      kind: "aadhaar",
      document_no: aadhaar,
      status: "self_declared",
      reference_id: null,
      verified_name: null,
      details: null,
    });
    if (!banked) return;

    // Explicit, for the same reason every other identity write is: the
    // documents step reads signupRef, and without this it can race ahead of
    // the store write and find a signup with nothing recorded against it.
    req.session.save((err) => {
      if (err) console.error("[signup/identity] session save error:", err);
      res.json({
        state: "verified",
        kind: "aadhaar",
        document_no: aadhaar,
        self_declared: true,
      });
    });
  });

  /**
   * POST /api/signup/identity/pan — record the number the customer typed
   *
   * Nothing is asked and nothing answers. The Income Tax lookup this endpoint
   * used to make was removed, so the PAN is checked for its ten-character
   * shape and written as `self_declared`, exactly like the Aadhaar above.
   *
   * What backs it is the next step: the card uploaded against the pan_card
   * slot is read by Smart OCR and must carry this number, and the upload path
   * takes the number from this row rather than from the request, so a client
   * cannot type one PAN here and claim another there.
   *
   * That proves the customer holds a card bearing the PAN they typed. It does
   * not prove the card is theirs — OCR reads the number off a PAN card and
   * never the name, so somebody else's genuine card passes. See
   * server/cashfreeIdentity.ts.
   *
   * No `name` is taken any more. It existed to be graded against the Income
   * Tax Department's registered name and stored as name_submitted for the
   * re-check at account creation; with no grader there is nothing to compare
   * it to, and storing it would suggest a check that does not happen.
   */
  app.post("/api/signup/identity/pan", async (req: Request, res: Response) => {
    const phone = await assertPhoneVerified(req.body?.phone, res);
    if (!phone) return;

    const pan = typeof req.body?.pan === "string" ? req.body.pan.trim().toUpperCase() : "";
    if (!isValidPanNumber(pan)) {
      res.status(400).json({ message: "Enter a valid 10-character PAN" });
      return;
    }

    const banked = await recordIdentity(req, res, phone, {
      kind: "pan",
      document_no: pan,
      status: "self_declared",
      reference_id: null,
      verified_name: null,
      details: null,
    });
    if (!banked) return;

    req.session.save((err) => {
      if (err) console.error("[signup/identity] session save error:", err);
      res.json({
        state: "verified",
        kind: "pan",
        document_no: pan,
        self_declared: true,
      });
    });
  });

  // POST /api/signup/identity/gstin — verify a GST number against the GST portal
  app.post("/api/signup/identity/gstin", async (req: Request, res: Response) => {
    const phone = await assertPhoneVerified(req.body?.phone, res);
    if (!phone) return;

    const gstin = typeof req.body?.gstin === "string" ? req.body.gstin.trim().toUpperCase() : "";
    // Shape and mod-36 checksum first, so a typo never costs a billed lookup.
    const shapeCheck = validateGstin(gstin);
    if (!shapeCheck.valid) {
      res.status(400).json({ message: shapeCheck.message ?? "Enter a valid 15-character GST number" });
      return;
    }

    // The company's own name. Stored as name_submitted and re-checked when the
    // account is written, so verifying under one name and registering under
    // another does not get through.
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!name) {
      res.status(400).json({ message: "Enter the company name this account is for" });
      return;
    }

    if (isIdentityBypassed("gstin")) {
      console.warn(`[signup/identity] IDENTITY_BYPASS — GSTIN recorded unchecked (${gstin})`);
      const banked = await recordIdentity(req, res, phone, {
        kind: "gstin",
        document_no: gstin,
        status: "bypassed",
        reference_id: null,
        verified_name: null,
        name_submitted: name,
        details: null,
      });
      if (!banked) return;
      req.session.save((err) => {
        if (err) console.error("[signup/identity] session save error:", err);
        res.json({ verified: true, bypassed: true, kind: "gstin", document_no: gstin });
      });
      return;
    }

    const result = await verifyGstin(gstin, name);
    if (!result.ok) {
      sendIdentityFailure(res, result);
      return;
    }

    const banked = await recordIdentity(req, res, phone, {
      kind: "gstin",
      document_no: result.gstin,
      status: "verified",
      reference_id: result.referenceId,
      verified_name: result.legalName,
      name_submitted: name,
      details: result.details,
    });
    if (!banked) return;

    req.session.save((err) => {
      if (err) console.error("[signup/identity] session save error:", err);
      res.json({
        verified: true,
        bypassed: false,
        kind: "gstin",
        document_no: result.gstin,
        // The GST portal's own spelling, plus the trading name where it
        // differs — a business often knows itself by the latter.
        verified_name: result.legalName,
        trade_name: result.tradeName,
      });
    });
  });

  /** Names differ in spacing, case and punctuation far more often than in fact. */
  function sameName(a: string, b: string): boolean {
    const norm = (v: string): string => v.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    return norm(a) === norm(b);
  }

  /**
   * Refuse the account until every identity number it needs has been recorded.
   *
   * Presence, not grade: a `self_declared` Aadhaar counts, because that is the
   * only state an Aadhaar row ever has, and a `bypassed` row counts for the
   * same reason a `bypassed` OCR verdict does — a flag said not to ask. What
   * makes the weaker two worth anything is the document gate that follows in
   * assertDocumentsStaged, which still demands an OCR `match`.
   *
   * Runs before assertDocumentsStaged, mirroring the order on screen: the
   * number first, the paper second.
   */
  async function assertIdentityVerified(
    req: Request,
    res: Response,
    accountType: "personal" | "company",
    category: CompanyCategory | null,
    accountName: string,
    /** What the customer is being refused, so the copy names the right thing. */
    intent: "account" | "booking" = "account"
  ): Promise<boolean> {
    const required = requiredIdentityChecks(accountType, category);
    if (required.length === 0) return true;

    const signupRef = req.session.signupRef;
    const rows = signupRef ? await listIdentityVerificationsBySignupRef(signupRef) : [];
    const byKind = new Map(rows.map((row) => [row.kind, row]));

    const missing = required.filter((slot) => !byKind.has(IDENTITY_KIND_BY_SLOT[slot]));
    if (missing.length > 0) {
      res.status(422).json({
        message: `Please enter your ${missing
          .map((slot) => IDENTITY_CHECK_LABELS[slot])
          .join(" and ")} before ${
          intent === "booking" ? "booking a shipment" : "creating the account"
        }.`,
        unverified_identity: missing.map((slot) => IDENTITY_KIND_BY_SLOT[slot]),
      });
      return false;
    }

    // The GSTIN was verified against a name the client chose. Nothing stops
    // that client from then submitting a different one here, so the two are
    // tied together at the only point that matters — the account being
    // written.
    //
    // PAN used to be in this loop and is not any more: with the Income Tax
    // lookup gone there is no registered name to have verified it against,
    // and its rows carry no name_submitted. A PAN belonging to somebody else
    // is no longer caught anywhere.
    //
    // Kept keyed on name_submitted rather than on kind, so a PAN row written
    // before the lookup was removed is still held to the name it was proved
    // under. Those rows are real and there is no reason to stop honouring
    // them.
    for (const kind of ["pan", "gstin"] as const) {
      const row = byKind.get(kind);
      if (row?.name_submitted && !sameName(row.name_submitted, accountName)) {
        res.status(422).json({
          message: `Your ${kind === "pan" ? "PAN" : "GST number"} was verified for "${row.name_submitted}". Please verify it again for "${accountName}".`,
          unverified_identity: [kind],
        });
        return false;
      }
    }

    return true;
  }

  /**
   * Read an uploaded GST certificate and check it carries the verified GSTIN.
   *
   * Same contract as verifyDocumentOrRefuse: answers the request itself and
   * returns null when the document must be refused, so the caller reads as a
   * straight line. A certificate for somebody else's GSTIN is blocking, for
   * the same reason a PAN card for a different PAN is — it is bad data, and it
   * reaches Indian customs if we let it through.
   */
  async function checkGstCertificateOrRefuse(
    res: Response,
    file: Express.Multer.File,
    verifiedGstin: string
  ): Promise<OcrResult | null> {
    // The bypass covers the certificate as well as the number: with no GSTIN
    // proved there is nothing to compare against, and refusing every upload
    // would defeat the flag entirely.
    if (isIdentityBypassed("gstin")) {
      console.warn("[signup/documents] IDENTITY_BYPASS — GST certificate stored unchecked");
      return bypassedOcr();
    }

    const check = await checkGstCertificate({
      file: file.buffer,
      mimeType: file.mimetype,
      verifiedGstin,
    });

    if (check.source) {
      console.log(`[signup/documents] GST certificate read via ${check.source}: ${check.status}`);
    }

    if (check.blocking) {
      // 422: the request was well-formed and we understood it — the document
      // itself is the problem.
      res.status(422).json({ message: check.message, ocr: { status: check.status } });
      return null;
    }
    return check;
  }

  // POST /api/signup/documents — stage one document of an in-flight signup
  app.post(
    "/api/signup/documents",
    kycUpload.single("file"),
    async (req: Request, res: Response) => {
      const phone = await assertPhoneVerified(req.body?.phone, res);
      if (!phone) return;

      if (!req.file) {
        res.status(400).json({ message: "No file uploaded." });
        return;
      }

      const slot = typeof req.body?.doc_slot === "string" ? req.body.doc_slot.trim() : "";
      if (!isDocSlot(slot)) {
        res.status(400).json({ message: "Unknown document type" });
        return;
      }

      // For the slots that carry an identity number, the number OCR is asked
      // to agree with is the one recorded at the identity step — not whatever
      // this request carried. The form shows the field read-only for the same
      // reason, but the form is not the control: a client that recorded
      // Aadhaar A and then uploaded a card for Aadhaar B, typing B, would
      // otherwise earn a clean `match` on a number it chose twice.
      //
      // This is what carries Aadhaar and PAN now that nothing verifies
      // either number. Both rows are self_declared, so the only thing between
      // a typed number and an account is that the card has to read as it —
      // and that is worth nothing at all if the client can move the target.
      //
      // Resolved ahead of normalizeDocumentNo so a client that omits the
      // field entirely — correctly, since the server supplies it — is not
      // turned away for leaving out a value it does not get to choose.
      let documentNo: string | null;
      if (isVerifiedDocSlot(slot)) {
        const proved = (await recordedIdentityNumbers(req, phone)).get(IDENTITY_KIND_BY_SLOT[slot]);
        if (!proved) {
          res.status(422).json({
            message: `Please enter your ${IDENTITY_CHECK_LABELS[slot]} number before uploading the document.`,
            unverified_identity: [IDENTITY_KIND_BY_SLOT[slot]],
          });
          return;
        }
        documentNo = proved;
      } else {
        const parsed = normalizeDocumentNo(slot, req.body?.document_no);
        if (!parsed.ok) {
          res.status(400).json({ message: parsed.message });
          return;
        }
        documentNo = parsed.value;
      }

      // Two readers, one verdict shape. Cashfree Smart OCR handles the two
      // identity cards; it has no GST certificate type at all, so that slot
      // is read locally — the PDF's own text layer, falling back to a vision
      // call for a photograph. See server/gstCertificate.ts.
      const ocr =
        slot === "gst_certificate"
          ? await checkGstCertificateOrRefuse(res, req.file, documentNo!)
          : await verifyDocumentOrRefuse(res, {
              cashfreeType: ocrTypeForDocSlot(slot),
              typedNumber: documentNo,
              file: req.file,
              tag: `signup-${slot}`,
            });
      if (!ocr) return;

      try {
        const saved = await upsertAccountDocument({
          signup_ref: await signupRefForPhone(req, phone),
          doc_slot: slot,
          document_no: documentNo,
          original_filename: req.file.originalname,
          mime_type: req.file.mimetype,
          file_size_bytes: req.file.size,
          file_data: req.file.buffer.toString("base64"),
          ocr: toOcrColumns(ocr),
        });
        if (!saved) {
          res.status(500).json({ message: "Failed to save document." });
          return;
        }
        // The session now carries the handle these rows are keyed by; without
        // an explicit save the next request can race ahead of the store write
        // and look like a signup with no documents at all.
        req.session.save((err) => {
          if (err) console.error("[signup/documents] session save error:", err);
          res.json({
            doc_slot: saved.doc_slot,
            capability_id: saved.capability_id,
            original_filename: saved.original_filename,
            mime_type: saved.mime_type,
            file_size_bytes: saved.file_size_bytes,
            updated_at: saved.updated_at,
            // The form tells the customer when a document went in unverified,
            // so "Uploaded" never over-promises.
            ocr: { status: ocr.status, message: ocr.message },
          });
        });
      } catch (err) {
        console.error("[POST /api/signup/documents] failed:", err);
        res.status(500).json({ message: "Failed to save document." });
      }
    }
  );

  /**
   * POST /api/admin/retention/sweep — delete abandoned signups' documents
   *
   * Driven by the same external scheduler as the WhatsApp digests, with the
   * same bearer secret, rather than a setInterval: a dyno that sleeps or a
   * second instance would otherwise mean the sweep never runs or runs twice.
   * Daily is ample for a fourteen-day window.
   *
   * Deliberately reachable by hand as well, because the first thing anyone
   * asks of a retention policy is proof that it ran. It answers with what it
   * deleted, and it is safe to call repeatedly — a second call in the same
   * minute finds nothing left to do.
   */
  app.post("/api/admin/retention/sweep", async (req: Request, res: Response) => {
    const expected = process.env.WA_CRON_SECRET;
    if (!expected) {
      res.status(503).json({ message: "Scheduler secret is not configured." });
      return;
    }
    const header = req.header("authorization") ?? "";
    const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
    // Length check first: timingSafeEqual throws on a length mismatch.
    if (
      presented.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(presented), Buffer.from(expected))
    ) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    try {
      const result = await sweepAbandonedSignups();
      res.json({
        retention_days: ABANDONED_SIGNUP_RETENTION_DAYS,
        ...result,
        ok: result.errors.length === 0,
      });
    } catch (err) {
      console.error("[retention] sweep failed:", err);
      res.status(500).json({ message: "Sweep failed." });
    }
  });

  // GET /api/signup/documents — what this signup has staged so far
  app.get("/api/signup/documents", async (req: Request, res: Response) => {
    const phone = typeof req.query.phone === "string" ? req.query.phone : undefined;
    const signupRef = signupRefForReading(req, phone);
    if (!signupRef) {
      res.set("Cache-Control", "no-store");
      res.json({ documents: [] });
      return;
    }
    const rows = await listDocumentsBySignupRef(signupRef);
    res.set("Cache-Control", "no-store");
    res.json({
      documents: rows.map((row) => ({
        doc_slot: row.doc_slot,
        capability_id: row.capability_id,
        // Echoed back so that stepping away from the documents screen and
        // returning restores the form instead of asking for the file again.
        // Session-scoped: the only reader is the browser that typed it.
        document_no: row.document_no,
        original_filename: row.original_filename,
        mime_type: row.mime_type,
        file_size_bytes: row.file_size_bytes,
        updated_at: row.updated_at,
        // The form marks an unverified identity document as still outstanding,
        // because account creation will refuse it.
        ocr_status: row.ocr_status,
      })),
    });
  });

  // DELETE /api/signup/documents/:slot — drop a staged document
  app.delete("/api/signup/documents/:slot", async (req: Request, res: Response) => {
    const signupRef = req.session.signupRef;
    if (!signupRef) {
      res.status(404).json({ message: "Nothing to remove" });
      return;
    }
    if (!isDocSlot(req.params.slot)) {
      res.status(400).json({ message: "Unknown document type" });
      return;
    }
    const ok = await deleteSignupDocument(signupRef, req.params.slot);
    if (!ok) {
      res.status(500).json({ message: "Failed to remove document." });
      return;
    }
    res.json({ removed: req.params.slot });
  });

  /**
   * Copy a verified Aadhaar into `kyc_documents`.
   *
   * `kyc_documents` is what the shipment path reads to build ITD's
   * `kyc_details`, and it is one row per user by UNIQUE constraint;
   * `account_documents` is the onboarding file, which for a corporate account
   * holds six. The two are not interchangeable, so a personal Aadhaar has to
   * exist in both.
   *
   * Called from two places — at signup, and again from the document centre when
   * a document is replaced. Non-fatal by design in both: the document is safe
   * in `account_documents` either way and the customer can re-upload, so losing
   * an account (or a 200) over the copy would be the worse trade.
   */
  /**
   * The KYC document behind an order, whoever booked it.
   *
   * An account order's document is owned by its user; a guest order's by the
   * ref it was staged under. Both produce the same row, because a guest is
   * compelled to produce the same documents — the difference is only where the
   * row hangs.
   *
   * This is what the docket path should use. It does not yet: that path reads
   * the *caller's* KYC, which is a documented bug predating guest booking (see
   * docs/final-phase/markdowns/open-items.md §4.0). When M5 wires the real
   * createShipment() through ops, this is the function to call — reaching for
   * `order.user_id` directly would refuse every guest docket.
   */
  async function kycForOrder(order: Pick<Order, "user_id" | "guest_ref">) {
    if (order.user_id) return getKycByUserId(order.user_id);
    if (order.guest_ref) return getKycByGuestRef(order.guest_ref);
    return null;
  }

  /**
   * Who a KYC document belongs to: the signed-in account, or a guest.
   *
   * The account wins whenever there is one. Otherwise this browser must be
   * mid-guest-booking: a signupRef bound to a phone, which `signupRefForPhone`
   * only ever mints after an OTP on that number, and discards the moment the
   * number changes. The ref is re-checked against a live verification here so
   * that a session left open overnight cannot still upload against a number
   * proved yesterday — the ten-minute window is the point of it.
   *
   * Returns null when neither holds, which the caller answers as 401.
   */
  async function resolveKycOwner(
    req: Request
  ): Promise<{ userId: string; guestRef: null } | { userId: null; guestRef: string } | null> {
    if (req.session.dbUserId) return { userId: req.session.dbUserId, guestRef: null };

    // A guest names the number they proved, and it is checked here rather than
    // trusted — the same shape /api/signup/documents uses. Falls back to the
    // session's own phone so a repeat upload need not resend it.
    const claimed =
      typeof req.body?.phone === "string" ? req.body.phone.trim() : req.session.signupPhone;
    if (!claimed) return null;

    const verified = await hasRecentVerification(claimed, "auth", OTP_VERIFICATION_WINDOW_MINUTES);
    if (!verified) return null;

    // A number with an account is not a guest, however it got here. Refusing
    // before the write keeps an identity document from being stored against a
    // guest ref when the person it belongs to already has somewhere to keep it.
    if (await findItdUserIdByPhone(claimed)) return null;

    // Mints on first upload and returns the same ref afterwards, discarding
    // anything staged under a different number. This is the only thing that
    // creates a guest's ref: they never touch the signup endpoints, so without
    // it there would be nothing to own the document or, later, the order.
    const ref = await signupRefForPhone(req, claimed);
    return { userId: null, guestRef: ref };
  }

  async function mirrorAadhaarToKyc(
    owner: { userId: string; guestRef?: null } | { userId: null; guestRef: string },
    aadhaar: { document_no: string | null; original_filename: string; mime_type: string; file_size_bytes: number; file_data: string } | null,
    tag: string
  ): Promise<void> {
    // NOT NULL on kyc_documents.document_no — a slot without a typed number
    // cannot be mirrored, and the Aadhaar slot always asks for one.
    if (!aadhaar?.document_no) return;

    const mirrored = await upsertKycDocument({
      user_id: owner.userId,
      guest_ref: owner.guestRef ?? null,
      capability_id: crypto.randomUUID(),
      document_type: "Aadhaar Number",
      document_no: aadhaar.document_no,
      original_filename: aadhaar.original_filename,
      mime_type: aadhaar.mime_type,
      file_size_bytes: aadhaar.file_size_bytes,
      file_data: aadhaar.file_data,
    });
    if (!mirrored) {
      console.error(
        `[${tag}] KYC mirror failed for`,
        owner.userId ? `user ${owner.userId}` : `guest ${owner.guestRef}`
      );
    }
  }

  /**
   * Refuse the account until every compelled document is present and verified.
   *
   * Returns null when the set falls short, having already answered the request;
   * `missing_documents` / `unverified_documents` are echoed back so the form can
   * mark the gaps rather than making the customer hunt for them.
   *
   * The verdict itself comes from `verificationState` in shared/accountSpec.ts,
   * which the banner, the docket guard and the ops queue also read. This
   * function owns only the HTTP shape of the refusal.
   *
   * Whatever is staged is returned even when the gate is waived, because the
   * caller mirrors the Aadhaar out of it — a customer who uploaded one document
   * and skipped the other should keep the one they gave us.
   */
  /**
   * Whether a document's number is still the number of record.
   *
   * Masking can arrive from either side and means the same thing it does in
   * cashfreeOcr.compareNumbers: a masked value discloses only its last four
   * digits, so that is all an honest comparison can use. Two unmasked values
   * are compared whole.
   */
  function sameIdentityNumber(documentNo: string | null, recorded: string): boolean {
    if (!documentNo) return false;
    const a = documentNo.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    const b = recorded.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    if (!a || !b) return false;
    if (a === b) return true;

    const masked = (v: string): boolean => /X{2,}/.test(v);
    if (!masked(a) && !masked(b)) return false;

    const tail = (v: string): string => v.replace(/[^0-9]/g, "").slice(-4);
    return tail(a).length === 4 && tail(a) === tail(b);
  }

  async function assertDocumentsStaged(
    req: Request,
    res: Response,
    accountType: "personal" | "company",
    category: CompanyCategory | null,
    phone: string
  ): Promise<Map<DocSlot, { document_no: string | null; capability_id: string }> | null> {
    const signupRef = req.session.signupRef;
    const staged = signupRef ? await listDocumentsBySignupRef(signupRef) : [];
    const stagedBySlot = new Map(
      staged.map((row) => [
        row.doc_slot,
        { document_no: row.document_no, capability_id: row.capability_id },
      ])
    );

    const { missing, unverified } = verificationState(accountType, category, staged);

    if (missing.length > 0) {
      res.status(400).json({
        message: `Please upload: ${missing.map((s) => DOC_SLOT_SPECS[s].label).join(", ")}`,
        missing_documents: missing,
      });
      return null;
    }

    // Present is not the same as verified. A document that was never actually
    // read — a blurred scan, an unreachable Cashfree, a GST certificate with
    // no legible number — is refused here rather than opening an account on a
    // document nobody has checked.
    //
    // This makes verification load-bearing: while the readers are unreachable,
    // no account can open. That is the deliberate trade.
    //
    // Which slots that covers, and why `bypassed` passes, is decided once in
    // verificationState (shared/accountSpec.ts) so this gate, the customer's
    // banner and the docket guard cannot answer differently. Note the GST
    // certificate IS covered: Cashfree has no OCR type for one, but
    // server/gstCertificate.ts reads it and writes a real verdict.
    if (unverified.length > 0) {
      res.status(422).json({
        message:
          `We could not verify your ${unverified
            .map((slot) => DOC_SLOT_SPECS[slot].label)
            .join(" and ")}. Please upload a clear photo of the original and check the number you entered.`,
        unverified_documents: unverified,
      });
      return null;
    }

    // A staged document carries the number it was checked against at the time
    // it was uploaded. That number can since have changed: the identity step
    // is cleared and retyped on every arrival, so a customer who goes back and
    // enters a different Aadhaar leaves a card for the old one behind.
    //
    // The OCR verdict above does not catch it — that row says `match`, and it
    // was a match, against a number nobody uses now. So the two are compared
    // directly here. Without this an account can open on a document for one
    // number and an identity row for another, which is exactly the bad data
    // the whole document check exists to keep out of Indian customs.
    //
    // Compared on the last four digits for the same reason compareNumbers is:
    // an Aadhaar recorded through DigiLocker is masked, and comparing a masked
    // value in full would refuse a document that is perfectly good.
    const recorded = await recordedIdentityNumbers(req, phone);
    const outdated = staged
      .filter((row) => {
        if (!isVerifiedDocSlot(row.doc_slot)) return false;
        const now = recorded.get(IDENTITY_KIND_BY_SLOT[row.doc_slot]);
        return !now || !sameIdentityNumber(row.document_no, now);
      })
      .map((row) => row.doc_slot);

    if (outdated.length > 0) {
      res.status(422).json({
        message: `Your ${outdated
          .map((slot) => DOC_SLOT_SPECS[slot].label)
          .join(" and ")} was uploaded for a different number. Please upload it again.`,
        outdated_documents: outdated,
      });
      return null;
    }

    return stagedBySlot;
  }

  /**
   * The typed signature that closes signup.
   *
   * Personal accounts sign here instead of handing over a signed copy, so this
   * is the whole of their contract record — refuse the account outright rather
   * than let one through unsigned. Corporate accounts sign here *and* upload
   * the countersigned authorization letter.
   */
  const contractAcceptanceSchema = z.object({
    contract_accepted: z.literal(true, {
      errorMap: () => ({ message: "Please accept the contract to continue" }),
    }),
    contract_signed_name: z.string().trim().max(SIGNATURE_MAX_LENGTH, SIGNATURE_ERROR),
  });

  /** The columns an acceptance writes, with the evidence to go alongside it. */
  function contractColumns(
    req: Request,
    signedName: string
  ): {
    contract_signed_name: string;
    contract_version: string;
    contract_accepted_at: string;
    contract_accepted_ip: string | null;
  } {
    return {
      contract_signed_name: signedName.trim(),
      contract_version: CONTRACT_VERSION,
      contract_accepted_at: new Date().toISOString(),
      // Behind a proxy this is only as good as `trust proxy`, which is why it
      // is evidence alongside the timestamp rather than proof on its own.
      contract_accepted_ip: req.ip ?? null,
    };
  }

  /** Move the staged documents onto the new account; never fatal to signup. */
  async function claimDocumentsForUser(req: Request, userId: string): Promise<void> {
    const signupRef = req.session.signupRef;
    if (!signupRef) return;
    try {
      await claimSignupDocuments(signupRef, userId);
      // The proved numbers move with the files they belong to. A failure here
      // leaves the rows on the signup_ref side — recoverable, and the account
      // still stands, same trade as the documents themselves.
      await claimSignupIdentityVerifications(signupRef, userId);
    } catch (err) {
      console.error("[signup] claiming staged signup rows failed:", err);
      return;
    }
    delete req.session.signupRef;
    delete req.session.signupPhone;
  }

  /**
   * Hand this account everything it booked as a guest on the same number.
   *
   * Runs after the account exists and after its own staged rows are claimed.
   * Best-effort by design: an unclaimed order is still a real order, tracked
   * by its number and visible to ops, and failing a signup over it would be
   * the worse trade. The next signup on that number would claim it anyway.
   *
   * The guest session is cleared either way — the browser is signed in now,
   * and leaving a guest ref behind would let a later payment be authorised by
   * the weaker of the two identities.
   */
  async function claimGuestBookingsForUser(req: Request, phone: string, userId: string): Promise<void> {
    try {
      const claimed = await claimGuestOrdersForUser(phone, userId);
      if (claimed.orders > 0) {
        console.log(`[signup] claimed ${claimed.orders} guest order(s) for ${userId}`);
      }
    } catch (err) {
      console.error("[signup] claiming guest orders failed:", err);
    }
    delete req.session.guestRef;
    delete req.session.guestPhone;
  }

  // GET /api/account/documents/:id/file — capability URL, same contract as the
  // KYC one: the unguessable id in the path is the authorisation, so ITD can
  // fetch a document without holding a Bombino session.
  app.get("/api/account/documents/:id/file", async (req: Request, res: Response) => {
    try {
      const doc = await getAccountDocumentByCapabilityId(req.params.id);
      if (!doc) {
        logDocumentAccess(req, {
          source: "account",
          capabilityId: req.params.id,
          outcome: "not_found",
        });
        res.status(404).json({ message: "Document not found." });
        return;
      }
      logDocumentAccess(req, {
        source: "account",
        capabilityId: req.params.id,
        outcome: "served",
        documentId: doc.id,
        userId: doc.user_id,
      });
      const buffer = Buffer.from(doc.file_data, "base64");
      res.set({
        "Content-Type": doc.mime_type,
        "Content-Length": String(buffer.length),
        // Re-uploads keep the capability_id, so a cached copy would go stale.
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow, noarchive",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Content-Disposition": `inline; filename="${doc.original_filename}"`,
      });
      res.send(buffer);
    } catch (err) {
      console.error("[GET /api/account/documents/:id/file] failed:", err);
      res.status(500).json({ message: "Failed to retrieve document." });
    }
  });

  // ── The document centre: finishing verification after the account exists ──
  //
  // Twins of the three /api/signup/documents endpoints, keyed on user_id
  // instead of the session's signupRef. Signup compels the whole set, so an
  // account arrives here verified — these exist for what happens afterwards: a
  // document replaced because it expired or was rejected, and an intake taken
  // by staff at the hub. /api/kyc/upload cannot do either: that endpoint writes
  // one row to kyc_documents, and a document set is two slots for a personal
  // account and up to six for a corporate one.
  //
  // The upload rules are identical to signup's — same OCR policy, same
  // refusals. Only the owner column and the authorisation differ (a session
  // here, a recently verified phone there).

  /** The account's shape, defaulted the same way the client defaults it. */
  async function accountShapeFor(userId: string): Promise<{
    accountType: "personal" | "company";
    category: CompanyCategory | null;
    gstin: string | null;
  }> {
    const row = await getAccountShapeById(userId);
    // Undefined account_type — legacy ITD password logins — reads as personal,
    // matching client/src/lib/store.ts and CreateShipment.tsx. Personal is the
    // stricter of the two here as well: it is the only shape that compels an
    // OCR-checked slot the customer may not have.
    const accountType = row?.account_type === "company" ? "company" : "personal";
    const raw = row?.company_category;
    const category =
      accountType === "company" && raw && (COMPANY_CATEGORIES as readonly string[]).includes(raw)
        ? (raw as CompanyCategory)
        : null;
    return { accountType, category, gstin: row?.gstin ?? null };
  }

  // GET /api/account/verification — what this account still owes.
  //
  // The banner reads this on every customer route, so it answers for verified
  // accounts too rather than 404ing: "nothing outstanding" is a real answer.
  app.get(
    "/api/account/verification",
    requireUser,
    ensureDbUser,
    async (req: Request, res: Response) => {
      if (!req.session.dbUserId) {
        res.status(401).json({ message: "Not authenticated" });
        return;
      }
      try {
        const { accountType, category } = await accountShapeFor(req.session.dbUserId);

        // Only customers owe documents. Staff rows carry account_type
        // 'personal' because the column is NOT NULL and every row must be one
        // or the other (see open-items.md §4.4) — reading that literally would
        // tell every agent and admin to go verify an Aadhaar they were never
        // asked for. `role` is the discriminator that matters.
        const role = req.session.user?.role;
        if (role && role !== "customer") {
          res.set("Cache-Control", "no-store");
          res.json({
            verified: true,
            missing: [],
            unverified: [],
            account_type: accountType,
            company_category: category,
            required: [],
          });
          return;
        }

        const state = await getVerificationState(req.session.dbUserId, accountType, category);
        res.set("Cache-Control", "no-store");
        res.json({
          ...state,
          account_type: accountType,
          company_category: category,
          required: requiredDocuments(accountType, category),
        });
      } catch (err) {
        console.error("[GET /api/account/verification] failed:", err);
        res.status(500).json({ message: "Could not read verification status." });
      }
    }
  );

  // GET /api/account/documents — this account's own documents, metadata only
  app.get(
    "/api/account/documents",
    requireUser,
    ensureDbUser,
    async (req: Request, res: Response) => {
      if (!req.session.dbUserId) {
        res.status(401).json({ message: "Not authenticated" });
        return;
      }
      const rows = await listDocumentsByUserId(req.session.dbUserId);
      res.set("Cache-Control", "no-store");
      res.json({
        documents: rows.map((row) => ({
          doc_slot: row.doc_slot,
          capability_id: row.capability_id,
          document_no: row.document_no,
          original_filename: row.original_filename,
          mime_type: row.mime_type,
          file_size_bytes: row.file_size_bytes,
          updated_at: row.updated_at,
          ocr_status: row.ocr_status,
        })),
      });
    }
  );

  // POST /api/account/documents — upload one slot against the signed-in account
  app.post(
    "/api/account/documents",
    requireUser,
    ensureDbUser,
    kycUpload.single("file"),
    async (req: Request, res: Response) => {
      const userId = req.session.dbUserId;
      if (!userId) {
        res.status(401).json({ message: "Not authenticated" });
        return;
      }
      if (!req.file) {
        res.status(400).json({ message: "No file uploaded." });
        return;
      }

      const slot = typeof req.body?.doc_slot === "string" ? req.body.doc_slot.trim() : "";
      if (!isDocSlot(slot)) {
        res.status(400).json({ message: "Unknown document type" });
        return;
      }

      // Only the slots this account actually owes. Without this an ecommerce
      // customer could stash an electricity bill their category never asked
      // for, and the ops queue would show a document nobody can action.
      const { accountType, category, gstin } = await accountShapeFor(userId);
      if (!requiredDocuments(accountType, category).includes(slot)) {
        res.status(400).json({ message: "That document is not required for this account." });
        return;
      }

      const docNo = normalizeDocumentNo(slot, req.body?.document_no);
      if (!docNo.ok) {
        res.status(400).json({ message: docNo.message });
        return;
      }

      // Two readers, one verdict shape, exactly as at signup: Cashfree Smart
      // OCR has no GST certificate type, so that slot is read locally instead
      // (server/gstCertificate.ts). Sending it through verifyDocumentOrRefuse
      // would come back `skipped` — and since verificationState counts the
      // certificate, a corporate account finishing its documents here could
      // never reach verified, leaving its orders held at `generate_docket`
      // with nothing on screen to fix.
      //
      // Checked against the GSTIN the account was opened on, not one supplied
      // with the request: that number was proved against the GST portal at
      // signup, and letting the upload name its own would undo that.
      let ocr: OcrResult | null;
      if (slot === "gst_certificate") {
        if (!gstin) {
          res.status(409).json({
            message:
              "This account has no GST number on file, so its certificate cannot be checked. Please contact support.",
          });
          return;
        }
        ocr = await checkGstCertificateOrRefuse(res, req.file, gstin);
      } else {
        ocr = await verifyDocumentOrRefuse(res, {
          cashfreeType: ocrTypeForDocSlot(slot),
          typedNumber: docNo.value,
          file: req.file,
          tag: `account-${slot}`,
        });
      }
      if (!ocr) return;

      try {
        const saved = await upsertAccountDocument({
          user_id: userId,
          doc_slot: slot,
          document_no: docNo.value,
          original_filename: req.file.originalname,
          mime_type: req.file.mimetype,
          file_size_bytes: req.file.size,
          file_data: req.file.buffer.toString("base64"),
          ocr: toOcrColumns(ocr),
        });
        if (!saved) {
          res.status(500).json({ message: "Failed to save document." });
          return;
        }

        // The Aadhaar is the one document customs reads, so a personal account
        // finishing it here has to reach kyc_documents exactly as it would have
        // at signup — otherwise the order still cannot be docketed.
        if (slot === "aadhaar_card" && ocr.status === "match") {
          const withFile = await getUserDocumentWithFile(userId, "aadhaar_card");
          await mirrorAadhaarToKyc({ userId }, withFile, "account/documents");
        }

        const state = await getVerificationState(userId, accountType, category);

        // Release (or re-apply) the hold on anything this customer already
        // booked. Best-effort: their document is saved either way, and a lost
        // race here costs a stale flag that the next upload corrects — not the
        // upload itself.
        void refreshKycVerifiedOnOpenOrders(userId, state.verified);

        res.json({
          doc_slot: saved.doc_slot,
          capability_id: saved.capability_id,
          original_filename: saved.original_filename,
          mime_type: saved.mime_type,
          file_size_bytes: saved.file_size_bytes,
          updated_at: saved.updated_at,
          ocr: { status: ocr.status, message: ocr.message },
          // Returned with the upload so the banner can clear on the same round
          // trip rather than after a refetch the customer has to wait for.
          verification: state,
        });
      } catch (err) {
        console.error("[POST /api/account/documents] failed:", err);
        res.status(500).json({ message: "Failed to save document." });
      }
    }
  );

  // DELETE /api/account/documents/:slot — replace-by-removing, same as signup
  app.delete(
    "/api/account/documents/:slot",
    requireUser,
    ensureDbUser,
    async (req: Request, res: Response) => {
      if (!req.session.dbUserId) {
        res.status(401).json({ message: "Not authenticated" });
        return;
      }
      if (!isDocSlot(req.params.slot)) {
        res.status(400).json({ message: "Unknown document type" });
        return;
      }
      const ok = await deleteUserDocument(req.session.dbUserId, req.params.slot);
      if (!ok) {
        res.status(500).json({ message: "Failed to remove document." });
        return;
      }
      res.json({ removed: req.params.slot });
    }
  );

  const signupPersonalSchema = z
    .object({
      full_name: z.string().trim().min(1, "Full name is required"),
      email: z.string().trim().email("Enter a valid email"),
      phone: phoneSchema,
    })
    .merge(contractAcceptanceSchema);

  // POST /api/auth/signup/personal
  app.post("/api/auth/signup/personal", async (req: Request, res: Response) => {
    const parsed = signupPersonalSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid request" });
      return;
    }
    const { full_name, email, phone, contract_signed_name } = parsed.data;

    if (!isValidSignature(contract_signed_name)) {
      res.status(400).json({ message: SIGNATURE_ERROR });
      return;
    }

    const existing = await findItdUserIdByPhone(phone);
    if (existing) {
      res.status(409).json({ message: "This phone number is already registered. Please sign in instead." });
      return;
    }

    // "auth" — the unified entry point issues one code before it knows whether
    // the number ends in a sign-in, a link, or this. See otpPurposeSchema.
    const verified = await hasRecentVerification(phone, "auth", OTP_VERIFICATION_WINDOW_MINUTES);
    if (!verified) {
      res.status(400).json({
        message: "Your phone verification has expired. Please request a new code.",
        code: PHONE_UNVERIFIED,
      });
      return;
    }

    // Aadhaar and PAN both, before the account exists — the numbers are a
    // precondition of opening it, and so is the document set. In that order,
    // though neither number is checked with an authority any more: recording
    // them first is what makes the OCR match that follows mean anything, by
    // fixing the value the card has to carry before the card arrives.
    if (!(await assertIdentityVerified(req, res, "personal", null, full_name))) return;

    const staged = await assertDocumentsStaged(req, res, "personal", null, phone);
    if (!staged) return;

    const itdCustomerId = `local-${crypto.randomUUID()}`;
    const row = await upsertItdUserAndReturnId({
      itd_customer_id: itdCustomerId,
      itd_customer_code: itdCustomerId,
      email,
      full_name,
      username: phone,
      role: "customer",
      phone,
      account_type: "personal",
      ...contractColumns(req, contract_signed_name),
    });
    if (!row?.id) {
      res.status(502).json({ message: "Could not create account. Please try again." });
      return;
    }

    // Mirror the Aadhaar into kyc_documents. That table is what the shipment
    // path reads to build ITD's `kyc_details` (buildItdKycPayload), and it
    // stays the one KYC document of record; account_documents is the
    // onboarding file, not a second source of truth for customs.
    //
    // Present in the ordinary case — signup refuses without it. Guarded anyway
    // rather than asserted: if it ever is absent, the document centre runs the
    // same mirror on the same helper later.
    const aadhaar = req.session.signupRef
      ? await getSignupDocumentWithFile(req.session.signupRef, "aadhaar_card")
      : null;
    await claimDocumentsForUser(req, row.id);
    await mirrorAadhaarToKyc({ userId: row.id }, aadhaar, "signup/personal");
    await claimGuestBookingsForUser(req, phone, row.id);

    const user = {
      id: itdCustomerId,
      customerId: itdCustomerId,
      code: itdCustomerId,
      email,
      fullName: full_name,
      username: phone,
      role: "customer",
      account_type: "personal" as const,
    };
    req.session.user = user;
    req.session.dbUserId = row.id;
    req.session.save((err) => {
      if (err) {
        console.error("[signup/personal] session save error:", err);
      }
      res.json(user);
    });
  });

  const signupCompanySchema = z.object({
    phone: phoneSchema,
    company_name: z.string().trim().min(1, "Company name is required"),
    gstin: z.string().trim().length(15, "GST number must be 15 characters"),
    // Which of the four the account is. Optional so that a client built before
    // the categories existed still opens a plain corporate account rather than
    // failing at the schema.
    company_category: z.enum(COMPANY_CATEGORIES).default("corporate"),
    contact_person: z.string().trim().min(1, "Contact person is required"),
    email: z.string().trim().email("Enter a valid email"),
    // Only e-commerce asks for these; validated per category below, against
    // the same patterns the form uses.
    lut_no: z.string().trim().optional(),
    iec_branch_code: z.string().trim().optional(),
    bank_account_no: z.string().trim().optional(),
    bank_ad_code: z.string().trim().optional(),
    // ITD add_customer — collected on the company details step alongside the
    // onboarding matrix. company_id / location_code live in itd.ts.
    address: z.string().trim().min(1, "Address is required").max(200),
    pincode: z.string().trim().regex(/^\d{6}$/, "Enter a 6-digit pincode"),
    city: z.string().trim().min(1, "City is required").max(80),
    state: z.string().trim().min(1, "State is required").max(80),
    hub_id: z.coerce.number().int().refine(isIndiaHubId, "Select a valid hub"),
  }).merge(contractAcceptanceSchema);

  /**
   * The export-paperwork fields, checked against shared/accountSpec.ts.
   * Categories that do not ask for a field store null rather than whatever
   * the customer had typed before switching category.
   */
  function collectExtraFields(
    category: CompanyCategory,
    body: Partial<Record<ExtraField, string | undefined>>
  ): { ok: true; values: Record<ExtraField, string | null> } | { ok: false; message: string } {
    const required = requiredExtraFields(category);
    const values = {
      lut_no: null,
      iec_branch_code: null,
      bank_account_no: null,
      bank_ad_code: null,
    } as Record<ExtraField, string | null>;

    for (const field of required) {
      const spec = EXTRA_FIELD_SPECS[field];
      const raw = (body[field] ?? "").trim();
      if (!raw) return { ok: false, message: `${spec.label} is required` };
      const value = spec.uppercase ? raw.toUpperCase() : raw;
      if (!spec.pattern.test(value)) return { ok: false, message: spec.error };
      values[field] = value;
    }
    return { ok: true, values };
  }

  // POST /api/auth/signup/company
  app.post("/api/auth/signup/company", async (req: Request, res: Response) => {
    const parsed = signupCompanySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid request" });
      return;
    }
    const {
      phone,
      company_name,
      gstin: rawGstin,
      company_category,
      contact_person,
      email,
      contract_signed_name,
      address,
      pincode,
      city,
      state,
      hub_id,
    } = parsed.data;
    const gstin = rawGstin.toUpperCase();

    if (!isValidSignature(contract_signed_name)) {
      res.status(400).json({ message: SIGNATURE_ERROR });
      return;
    }

    const gstinCheck = validateGstin(gstin);
    if (!gstinCheck.valid) {
      res.status(400).json({ message: gstinCheck.message ?? "Invalid GST number" });
      return;
    }

    const extras = collectExtraFields(company_category, parsed.data);
    if (!extras.ok) {
      res.status(400).json({ message: extras.message });
      return;
    }

    const existing = await findItdUserIdByPhone(phone);
    if (existing) {
      res.status(409).json({ message: "This phone number is already registered. Please sign in instead." });
      return;
    }

    const verified = await hasRecentVerification(phone, "auth", OTP_VERIFICATION_WINDOW_MINUTES);
    if (!verified) {
      res.status(400).json({
        message: "Your phone verification has expired. Please request a new code.",
        code: PHONE_UNVERIFIED,
      });
      return;
    }

    const categorySpec = COMPANY_CATEGORY_SPECS[company_category];

    // The company PAN, verified against the company's own name — every
    // corporate category compels a PAN card, none compels an Aadhaar.
    if (!(await assertIdentityVerified(req, res, "company", company_category, company_name))) return;

    // The GSTIN this request wants to open the account on must be the one the
    // GST portal actually confirmed. Unlike the PAN and Aadhaar numbers, this
    // one is not typed at the identity step — it comes from the details form,
    // a step earlier and editable afterwards — so nothing else ties the two
    // together. Without this a client can have GSTIN A verified, then submit
    // an account for GSTIN B and have it written unchecked.
    //
    // The form makes this unreachable, because walking back to the details
    // step passes through the identity step, which clears what was recorded.
    // The form is not the control.
    const recordedGstin = (await recordedIdentityNumbers(req, phone)).get("gstin");
    if (recordedGstin && recordedGstin.toUpperCase() !== gstin) {
      res.status(422).json({
        message: `Your GST number was verified as ${recordedGstin}. Please verify ${gstin} before creating the account.`,
        unverified_identity: ["gstin"],
      });
      return;
    }

    const staged = await assertDocumentsStaged(req, res, "company", company_category, phone);
    if (!staged) return;

    const itdCustomerId = `local-${crypto.randomUUID()}`;
    const row = await upsertItdUserAndReturnId({
      itd_customer_id: itdCustomerId,
      itd_customer_code: itdCustomerId,
      email,
      full_name: company_name,
      username: phone,
      role: "customer",
      phone,
      account_type: "company",
      company_name,
      gstin,
      company_category,
      // Denormalised from the spec at creation time: a later change to the
      // mapping must not silently restate what an existing account signed.
      contract_head: categorySpec.contractHead,
      group_code: categorySpec.groupCode ?? null,
      contact_person,
      ...extras.values,
      ...contractColumns(req, contract_signed_name),
    });
    if (!row?.id) {
      res.status(502).json({ message: "Could not create account. Please try again." });
      return;
    }

    await claimDocumentsForUser(req, row.id);
    // A guest books as an individual, but the number is the number: if this
    // company account was opened on it, the orders behind it are theirs.
    await claimGuestBookingsForUser(req, phone, row.id);

    let itdRegistered = false;
    let addCustomerResponse: unknown = null;
    let addCustomerError: string | null = null;
    try {
      const addCustomerResult = await withTimeout(
        itdClient.addCustomer({
          name: company_name,
          contact_no: phone,
          gst_number: gstin,
          email,
          address,
          pincode,
          city,
          state,
          contact_person,
          hub_id,
        }),
        ITD_LINK_TIMEOUT_MS,
        "ITD addCustomer"
      );
      itdRegistered = !!addCustomerResult.success;
      addCustomerResponse = addCustomerResult;
    } catch (err) {
      addCustomerError = err instanceof Error ? err.message : "addCustomer failed";
      console.error("[signup/company] itdClient.addCustomer failed (non-fatal):", err);
    }

    // Persist the attribution context. Without this the ITD registration is
    // invisible to everything downstream — M5 has to know, days later, whether
    // this company exists inside ITD and under what identity. `add_customer`
    // returns no id of its own (§7), so the synthetic `local-<uuid>` we minted
    // above is the only stable handle either side has; record it explicitly
    // rather than leaving it implicit in the `itd_customer_id` column.
    // Non-fatal: a failure here must not cost the customer their account.
    void mergeItdUserMetadataById(row.id, {
      itd_registered: itdRegistered,
      itd_customer_id: itdCustomerId,
      // add_customer has no field for either, so the only record of which
      // contract this account opened under lives on our side.
      company_category,
      contract_head: categorySpec.contractHead,
      ...(categorySpec.groupCode ? { group_code: categorySpec.groupCode } : {}),
      itd_registration_attempted_at: new Date().toISOString(),
      itd_add_customer_response: addCustomerResponse,
      email,
      address,
      pincode,
      city,
      state,
      contact_person,
      hub_id,
      ...(addCustomerError ? { itd_add_customer_error: addCustomerError } : {}),
    });

    const user = {
      id: itdCustomerId,
      customerId: itdCustomerId,
      code: itdCustomerId,
      email,
      fullName: company_name,
      username: phone,
      role: "customer",
      account_type: "company" as const,
    };
    req.session.user = user;
    req.session.dbUserId = row.id;
    req.session.save((err) => {
      if (err) {
        console.error("[signup/company] session save error:", err);
      }
      res.json({ ...user, itdRegistered });
    });
  });

  /** Shape a stored profile row into the session/client user object. */
  function toSessionUser(profile: {
    itd_customer_id: string;
    itd_customer_code: string;
    email: string | null;
    full_name: string;
    username: string;
    role: string;
    account_type?: string | null;
  }) {
    return {
      id: profile.itd_customer_id,
      customerId: profile.itd_customer_id,
      code: profile.itd_customer_code,
      email: profile.email ?? "",
      fullName: profile.full_name,
      username: profile.username,
      role: profile.role,
      // Persisted at signup; drives the client's KYC branch on re-login.
      account_type:
        profile.account_type === "company" ? ("company" as const) : ("personal" as const),
    };
  }

  // POST /api/auth/phone/continue — the single entry point.
  //
  // Verifies the OTP and resolves what happens next in one round trip:
  // either the number is already attached to an account (sign in, minting an
  // ITD token where the account has ITD credentials) or it is not (the client
  // then branches to linking an existing ITD account, or creating a new one).
  //
  // The phone lookup deliberately happens *after* verification. Resolving it
  // earlier would turn the entry screen into an oracle for which numbers are
  // registered, answerable without proving ownership of any of them.
  //
  // Replaces the old two-call sequence (POST /otp/verify then POST /login/otp),
  // which established a session carrying no ITD token at all.
  /**
   * Prove a phone number for a GUEST booking, and refuse it if it has an account.
   *
   * Separate from /api/auth/phone/continue on purpose. That endpoint signs the
   * customer in the moment it recognises the number — correct for the login
   * screen, wrong here: a guest booking that quietly became an account booking
   * leaves the browser showing one thing while the server does another. This
   * one never touches the session.
   *
   * A number that already belongs to an account is refused with 409. That is
   * not a leak: the code is checked first, so only the owner of the number can
   * ever see the answer. Somebody guessing numbers learns nothing, because they
   * cannot get past the OTP to ask. This is the same ordering
   * /api/auth/phone/continue documents — the lookup happens after proof of
   * ownership, never before, so no screen becomes an oracle for which numbers
   * are registered.
   *
   * Refusing rather than adopting is deliberate. Their orders, addresses and
   * identity document already exist under that account, and booking beside it
   * as a stranger would split one customer across two records that nothing
   * later reconciles.
   *
   * On that refusal the code is deliberately NOT spent. It is a valid sign-in
   * code for the number that just proved it, so the client can hand it straight
   * to /api/auth/phone/continue and take them where they were always going.
   * Spending it would have cost them a second SMS to be told to use the door
   * they are standing at.
   */
  app.post("/api/guest/phone/verify", async (req: Request, res: Response) => {
    const parsed = z
      .object({
        phone: phoneSchema,
        code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code"),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid request" });
      return;
    }
    const { phone, code } = parsed.data;

    // Checked but not spent yet: whether it should be depends on the lookup
    // below, and a wrong code is rejected here either way.
    const otp = await verifyOtp(phone, "auth", code, { consume: false });
    if (!otp.ok) {
      res.status(otp.status).json({ message: otp.message });
      return;
    }

    const existing = await findItdUserIdByPhone(phone);
    if (existing) {
      res.status(409).json({
        message: "This number already has a Bombino account.",
        code: "ACCOUNT_EXISTS",
        // The code is still live. The client offers to sign them in with it
        // rather than sending them off to ask for another.
        code_reusable: true,
      });
      return;
    }

    // Spend it now. That leaves hasRecentVerification(phone, "auth", …) true
    // for the next few minutes, which is what authorises the document upload
    // and the booking that follow. No session is created.
    const spent = await consumeOtp(phone, "auth", code);
    if (!spent.ok) {
      res.status(spent.status).json({ message: spent.message });
      return;
    }

    // Bind this browser to the number it just proved, and to nothing else.
    //
    // Without this the session could still be carrying a signupRef minted for
    // a DIFFERENT number — an abandoned signup, or the last person to use a
    // shared device. Everything downstream resolves a guest by that ref when
    // the request has no phone of its own to offer (GET /api/kyc/me has no
    // body), so the stale one would have been read as this guest's: their KYC
    // card would show a stranger's document, and the booking gate would find a
    // row and wave the order through on it.
    //
    // signupRefForPhone is exactly the fix — it returns the existing ref when
    // the phone matches and mints a fresh one otherwise, discarding whatever
    // the old number had staged.
    await signupRefForPhone(req, phone);

    req.session.save((err) => {
      if (err) console.error("[guest/phone/verify] session save error:", err);
      res.json({ status: "verified" as const });
    });
  });

  app.post("/api/auth/phone/continue", async (req: Request, res: Response) => {
    const parsed = z
      .object({
        phone: phoneSchema,
        code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code"),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid request" });
      return;
    }
    const { phone, code } = parsed.data;

    const otp = await consumeOtp(phone, "auth", code);
    if (!otp.ok) {
      res.status(otp.status).json({ message: otp.message });
      return;
    }

    const existing = await findItdUserIdByPhone(phone);
    if (!existing) {
      // Consuming the code above still leaves hasRecentVerification(phone,
      // "auth", …) true for the next few minutes, so the follow-up link or
      // signup call can prove ownership of this number without a second SMS.
      res.json({ status: "needs_account" as const });
      return;
    }

    const profile = await getItdUserProfileById(existing.id);
    if (!profile) {
      res.status(502).json({ message: "Could not sign in. Please try again." });
      return;
    }

    let user = toSessionUser(profile);
    req.session.dbUserId = existing.id;

    // Accounts linked to ITD get a live ITD token here. Without this the
    // session would look valid but ITD-backed routes would either 401
    // (/api/shipments) or silently fall back to the shared company token and
    // query the wrong customer scope (/api/track).
    const itdUser = await mintItdSession(req, existing.id, user.email);
    if (itdUser) {
      // ITD's response, not the stored row, is authoritative for identity —
      // `code` in particular has no column in itd_users and is what tracking
      // sends as customer_code. Keep account_type, which is Bombino-side only.
      user = { ...user, ...itdUser, account_type: user.account_type };
    }
    req.session.user = user;

    req.session.save((err) => {
      if (err) {
        console.error("[phone/continue] session save error:", err);
      }
      res.json({ status: "signed_in" as const, user });
    });
  });

  // POST /api/auth/link/itd — attach a verified phone number to an existing
  // ITD account, proven by that account's own email + password.
  //
  // The only place email/password is accepted. ITD has no endpoint to create a
  // login user, so an ITD credential can only ever be proven, never issued —
  // this endpoint is how an existing ITD customer moves onto phone sign-in.
  app.post("/api/auth/link/itd", async (req: Request, res: Response) => {
    const parsed = z
      .object({
        phone: phoneSchema,
        email: z.string().trim().email("Enter a valid email"),
        password: z.string().min(1, "Password is required"),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid request" });
      return;
    }
    const { phone, email, password } = parsed.data;

    const verified = await hasRecentVerification(phone, "auth", OTP_VERIFICATION_WINDOW_MINUTES);
    if (!verified) {
      res.status(400).json({ message: "Please verify your phone number first" });
      return;
    }

    // Hard failure, not a warning. The encrypted password *is* the link: ITD
    // issues no refresh token, so replaying it is the only way to mint a token
    // on future phone-only sign-ins. encryptPassword() returns empty strings
    // when the key is missing, so without this guard the link would appear to
    // succeed while storing nothing, and the customer would be unable to reach
    // ITD ever again — discovered days later, with no trace of the cause.
    if (!isEncryptionConfigured()) {
      console.error("[link/itd] ENCRYPTION_KEY missing — refusing to link without storable credentials");
      res.status(503).json({
        message: "Account linking is temporarily unavailable. Please try again later.",
      });
      return;
    }

    let itdUser;
    let itdToken: string;
    try {
      const result = await withTimeout(
        itdClient.loginUser(email, password),
        ITD_LINK_TIMEOUT_MS,
        "ITD loginUser (link)"
      );
      itdUser = result.user;
      itdToken = result.token;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not verify those credentials";
      res.status(401).json({ message });
      return;
    }

    // The phone column is uniquely indexed (itd_users_phone_key). Catching the
    // clash here turns what would otherwise be an opaque 502 from a failed
    // upsert into something the customer can act on.
    const phoneOwner = await findItdUserIdByPhone(phone);
    if (phoneOwner) {
      const owningProfile = await getItdUserProfileById(phoneOwner.id);
      if (owningProfile && owningProfile.itd_customer_id !== itdUser.id) {
        res.status(409).json({
          message:
            "This mobile number is already linked to a different account. Sign in with it, or contact support to move it.",
        });
        return;
      }
    }

    const enc = encryptPassword(password);
    const row = await upsertItdUserAndReturnId({
      itd_customer_id: itdUser.id,
      itd_customer_code: itdUser.customerId,
      email: itdUser.email,
      full_name: itdUser.fullName,
      username: itdUser.username,
      role: itdUser.role,
      phone,
      itd_token: itdToken,
      itd_token_expires_at: itdTokenExpiryIso(),
      itd_password_encrypted: enc.encrypted,
      encryption_iv: enc.iv,
    });
    if (!row?.id) {
      res.status(502).json({ message: "Could not link your account. Please try again." });
      return;
    }

    // Straight from ITD, not round-tripped through the row we just wrote:
    // itd_users has no column for ITD's `code`, so rebuilding identity from
    // storage would silently substitute `customer_id` for it.
    const user = { ...itdUser, account_type: "personal" as const };
    req.session.user = user;
    req.session.dbUserId = row.id;
    req.session.itdToken = itdToken;

    void insertNotification({
      user_id: row.id,
      type: "account",
      title: "Mobile number linked",
      body: `${phone} is now linked to your Bombino account. You can sign in with this number from now on, and change it later in Settings.`,
      data: { phone, itd_customer_id: itdUser.id },
    });

    void insertLoginAuditLog({
      user_id: row.id,
      metadata: { itd_customer_code: itdUser.customerId, role: itdUser.role, linked_phone: phone },
      ip_address: req.ip ?? null,
    });

    req.session.save((err) => {
      if (err) {
        console.error("[link/itd] session save error:", err);
      }
      res.json(user);
    });
  });

  app.get(
    "/api/user/profile",
    requireUser,
    ensureDbUser,
    async (req: Request, res: Response) => {
      if (!req.session.dbUserId) {
        return res.status(404).json({
          error: "Profile not found",
        });
      }
      const profile = await getItdUserProfileById(req.session.dbUserId);
      if (!profile) {
        return res.status(404).json({
          error: "Profile not found",
        });
      }
      // Derived, not the column itself — drives whether the "change number"
      // flow asks for a password. Accounts created here have none.
      const has_password = await itdUserHasStoredPassword(req.session.dbUserId);
      return res.json({ ...profile, has_password });
    }
  );

  // PATCH /api/user/profile — edit the fields a customer owns.
  //
  // Only `username` for now, and only because it is display text: nothing
  // authenticates or looks up by it. Identity fields (email, phone, role,
  // itd_customer_id) stay out — they are either ITD's to define or carry
  // security meaning, and each needs its own proof-of-ownership step rather
  // than a general-purpose edit.
  const usernameSchema = z
    .string()
    .trim()
    .min(2, "Username must be at least 2 characters")
    .max(50, "Username must be 50 characters or fewer")
    // Deliberately not an allowlist of Latin letters: customers have names in
    // Devanagari and other scripts, and \p{L} needs an ES6 target this project
    // does not set. Excluding angle brackets and control characters is enough —
    // nothing here is interpolated into markup unescaped.
    .regex(/^[^<>\r\n\t]+$/, "Username cannot contain < or >");

  app.patch(
    "/api/user/profile",
    requireUser,
    ensureDbUser,
    async (req: Request, res: Response) => {
      const parsed = z.object({ username: usernameSchema }).safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid request" });
        return;
      }
      const { username } = parsed.data;

      if (!req.session.dbUserId) {
        res.status(404).json({ message: "Profile not found" });
        return;
      }

      const ok = await updateItdUserUsernameById(req.session.dbUserId, username);
      if (!ok) {
        res.status(502).json({ message: "Could not save your username. Please try again." });
        return;
      }

      // Keep the session copy in step, or /api/auth/me and anything reading
      // req.session.user would serve the old value until the next sign-in.
      if (req.session.user) {
        req.session.user = { ...req.session.user, username };
      }
      req.session.save((err) => {
        if (err) {
          console.error("[PATCH /api/user/profile] session save error:", err);
        }
        res.json({ username });
      });
    }
  );

  // POST /api/user/phone/unlink — detach the phone number from this account.
  //
  // Only offered to accounts ITD provisioned, and the reason is a one-way door:
  // the phone is the sole sign-in credential this app has. An ITD customer can
  // always get back in through /api/auth/link/itd with their email and
  // password, so unlinking costs them a re-link. An account created here has no
  // password anywhere — no ITD login user is ever issued for one (ITD exposes
  // no endpoint that mints them) — so unlinking would lock it shut for good.
  // Hence the refusal below rather than a warning.
  app.post(
    "/api/user/phone/unlink",
    requireUser,
    ensureDbUser,
    async (req: Request, res: Response) => {
      if (!req.session.dbUserId) {
        res.status(404).json({ message: "Profile not found" });
        return;
      }

      const profile = await getItdUserProfileById(req.session.dbUserId);
      if (!profile) {
        res.status(404).json({ message: "Profile not found" });
        return;
      }

      if (!profile.phone) {
        res.status(400).json({ message: "No mobile number is linked to this account." });
        return;
      }

      // Synthetic ids are minted by our own signup paths; a real ITD id is not
      // shaped like this. See /api/auth/signup/personal.
      const isLocalAccount = String(profile.itd_customer_id ?? "").startsWith("local-");
      if (isLocalAccount) {
        res.status(409).json({
          message:
            "This number is the only way to sign in to your account, so it cannot be removed. Contact support if you need to change it.",
        });
        return;
      }

      const ok = await clearItdUserPhoneById(req.session.dbUserId);
      if (!ok) {
        res.status(502).json({ message: "Could not unlink your number. Please try again." });
        return;
      }

      void insertNotification({
        user_id: req.session.dbUserId,
        type: "account",
        title: "Mobile number unlinked",
        body: `${profile.phone} is no longer linked to your account. Sign in with your email and password to link a number again.`,
        data: { phone: profile.phone },
      });

      res.json({ unlinked: true, phone: profile.phone });
    }
  );

  // POST /api/user/phone/change — move the account onto a different number.
  //
  // Two independent proofs are required, and both matter: an active session
  // (you are the account holder) and a fresh OTP on the NEW number (you
  // control where sign-in codes will land from now on). Skipping the second
  // would let anyone signed in point their account at someone else's number —
  // or, worse, at a number they are about to hand back to a carrier.
  app.post(
    "/api/user/phone/change",
    requireUser,
    ensureDbUser,
    async (req: Request, res: Response) => {
      const parsed = z
        .object({ phone: phoneSchema, password: z.string().optional() })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid request" });
        return;
      }
      const { phone, password } = parsed.data;

      if (!req.session.dbUserId) {
        res.status(404).json({ message: "Profile not found" });
        return;
      }

      const verified = await hasRecentVerification(
        phone,
        "auth",
        OTP_VERIFICATION_WINDOW_MINUTES
      );
      if (!verified) {
        res.status(400).json({ message: "Please verify your new number first" });
        return;
      }

      // Where a password exists, it is the stronger of the two credentials on
      // the account, so moving the weaker one has to be signed off by it.
      // Accounts created here have no password to ask for — the OTP on the new
      // number, plus the live session, is everything there is.
      const needsPassword = await itdUserHasStoredPassword(req.session.dbUserId);
      if (needsPassword) {
        if (!password) {
          res.status(400).json({
            message: "Enter your password to change your number.",
            code: "PASSWORD_REQUIRED",
          });
          return;
        }
        const profile = await getItdUserProfileById(req.session.dbUserId);
        if (!profile?.email) {
          res.status(502).json({ message: "Could not verify your password. Please try again." });
          return;
        }
        try {
          await withTimeout(
            itdClient.loginUser(profile.email, password),
            ITD_LINK_TIMEOUT_MS,
            "ITD loginUser (phone change)"
          );
        } catch {
          res.status(401).json({ message: "That password is incorrect." });
          return;
        }
      }

      const result = await updateItdUserPhoneById(req.session.dbUserId, phone);
      if (result === "taken") {
        res.status(409).json({
          message: "That mobile number is already linked to another account.",
        });
        return;
      }
      if (result === "error") {
        res.status(502).json({ message: "Could not update your number. Please try again." });
        return;
      }

      void insertNotification({
        user_id: req.session.dbUserId,
        type: "account",
        title: "Mobile number changed",
        body: `Your Bombino account now signs in with ${phone}.`,
        data: { phone },
      });

      res.json({ phone });
    }
  );

  // ── Shipments history & notifications (DB) ──────────────────────────────

  app.get(
    "/api/shipments/history",
    requireUser,
    ensureDbUser,
    async (req: Request, res: Response) => {
      if (!req.session.dbUserId) {
        return res.json([]);
      }
      const rows = await listShipmentsByUserId(req.session.dbUserId);
      return res.json(rows ?? []);
    }
  );

  // Shipment printables (AWB label, box/postal label, invoice) come from the
  // create_docket response stored on the shipment row — tracking never returns them.
  const documentRoutes: {
    path: string;
    kind: ShipmentDocumentKind;
    key: string;
    missing: string;
  }[] = [
    { path: "label", kind: "label", key: "label", missing: "Label not available" },
    {
      path: "box-label",
      kind: "boxLabel",
      key: "boxLabel",
      missing: "Box label not available",
    },
    {
      path: "postal-label",
      kind: "postalLabel",
      key: "postalLabel",
      missing: "Postal service label not available",
    },
    { path: "invoice", kind: "invoice", key: "invoice", missing: "Invoice not available" },
  ];

  app.get(
    "/api/shipments/:awb/documents",
    requireUser,
    ensureDbUser,
    async (req: Request, res: Response) => {
      const dbUserId = req.session.dbUserId;
      if (!dbUserId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const documents = await listShipmentDocumentKinds(req.params.awb, dbUserId);
      return res.json({ documents });
    }
  );

  for (const { path, kind, key, missing } of documentRoutes) {
    app.get(
      `/api/shipments/:awb/${path}`,
      requireUser,
      ensureDbUser,
      async (req: Request, res: Response) => {
        const { awb } = req.params;
        const dbUserId = req.session.dbUserId;

        if (!dbUserId) {
          return res.status(401).json({ message: "Unauthorized" });
        }

        const document = await getShipmentDocument(awb, dbUserId, kind);
        if (!document) {
          return res.status(404).json({ message: missing });
        }

        return res.json({ [key]: document });
      }
    );
  }

  app.get(
    "/api/shipments/download-csv",
    requireUser,
    ensureDbUser,
    async (req: Request, res: Response) => {
      if (!req.session.dbUserId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const rows = await listShipmentsByUserId(req.session.dbUserId);
      if (!rows) {
        return res.status(500).json({ error: "Failed to fetch shipments" });
      }

      const headers = [
        "AWB Number",
        "Booking Date",
        "Service Type",
        "Origin City",
        "Destination City",
        "Destination Country",
        "Consignee Name",
        "Consignee Phone",
        "Shipment Content",
        "Weight",
        "Declared Value",
        "Currency",
        "Current Status",
        "Last Updated",
      ];

      const escape = (val: unknown) => {
        if (val === null || val === undefined) return "";
        const str = String(val);
        if (str.includes(",") || str.includes('"') || str.includes("\n")) {
          return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
      };

      const csvRows = [
        headers.join(","),
        ...rows.map((r) =>
          [
            escape(r.awb_number),
            escape(
              r.booking_date
                ? new Date(r.booking_date).toLocaleDateString("en-IN")
                : r.created_at
                  ? new Date(r.created_at).toLocaleDateString("en-IN")
                  : ""
            ),
            escape(r.service_name),
            escape(r.sender_city),
            escape(r.consignee_city),
            escape(r.consignee_country),
            escape(r.consignee_name),
            escape(r.consignee_phone),
            escape(r.contents_description),
            escape(r.weight_kg),
            escape(r.declared_value),
            escape(r.currency),
            escape(r.current_status),
            escape(
              r.created_at ? new Date(r.created_at).toLocaleDateString("en-IN") : ""
            ),
          ].join(",")
        ),
      ];

      const csv = csvRows.join("\n");
      const filename =
        "bombino-shipments-" + new Date().toISOString().split("T")[0] + ".csv";

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", 'attachment; filename="' + filename + '"');
      return res.send(csv);
    }
  );

  app.get(
    "/api/addresses",
    requireUser,
    ensureDbUser,
    async (req: Request, res: Response) => {
      const parseType = z.enum(["sender", "recipient"]).safeParse(req.query.type);
      if (!parseType.success) {
        return res.status(400).json({ message: "type must be sender or recipient" });
      }

      if (!req.session.dbUserId) {
        return res.json([]);
      }

      const rows = await listAddressesByUserIdAndType(req.session.dbUserId, parseType.data);
      return res.json(rows ?? []);
    }
  );

  app.get(
    "/api/notifications/unread-count",
    requireUser,
    ensureDbUser,
    async (req: Request, res: Response) => {
      if (!req.session.dbUserId) {
        return res.json({ count: 0 });
      }
      const count = await countUnreadNotifications(req.session.dbUserId);
      return res.json({ count: count ?? 0 });
    }
  );

  app.get(
    "/api/notifications",
    requireUser,
    ensureDbUser,
    async (req: Request, res: Response) => {
      if (!req.session.dbUserId) {
        return res.json([]);
      }
      const rows = await listNotificationsByUserId(req.session.dbUserId);
      return res.json(rows ?? []);
    }
  );

  app.patch(
    "/api/notifications/:id/read",
    requireUser,
    ensureDbUser,
    async (req: Request, res: Response) => {
      if (!req.session.dbUserId) {
        return res.status(404).json({ message: "Not found" });
      }
      const rows = await markNotificationRead(req.params.id, req.session.dbUserId);
      if (rows === null) {
        return res.status(500).json({ message: "Database error" });
      }
      if (rows.length === 0) {
        return res.status(404).json({ message: "Not found" });
      }
      return res.json({ ok: true });
    }
  );

  // ── ITD: Tracking ────────────────────────────────────────────────────────

  // GET /api/track/:trackingNo — no login required; guest uses company token + superadmin
  app.get(
    "/api/track/:trackingNo",
    ensureDbUser,
    refreshItdTokenIfNeeded,
    async (req: Request, res: Response) => {
      const { trackingNo } = req.params;

      try {
        const user = req.session.user;
        const data = await itdClient.trackShipment(
          trackingNo,
          user ? req.session.itdToken : undefined,
          user ? user.code : "superadmin"
        );
        const first = data[0];
        const events = first?.docket_events ?? [];
        const latestStatus =
          events.length > 0
            ? String((events[events.length - 1] as { event_state?: string }).event_state ?? "")
                .trim() || "INTRANSIT"
            : "INTRANSIT";
        const trackedAt = new Date().toISOString();
        void upsertTrackingEvents(trackingNo, events);
        void updateShipmentTrackingStatus(trackingNo, latestStatus, trackedAt);
        res.json({
          results: data,
          fromCache: false as const,
          lastTrackedAt: trackedAt,
        });
      } catch (_err) {
        const lastKnown = await getLastKnownTracking(trackingNo);
        if (lastKnown) {
          res.status(200).json({
            fromCache: true as const,
            lastTrackedAt: lastKnown.lastTrackedAt,
            currentStatus: lastKnown.currentStatus,
            message:
              "Tracking service temporarily unavailable. Showing last known status.",
          });
          return;
        }
        res.status(502).json({
          message: "Tracking unavailable. Please try again later.",
        });
      }
    }
  );

  // ── Postal lookup (pincode → city/state) ─────────────────────────────────

  app.get(
    "/api/postal-lookup",
    ensureDbUser,
    async (req: Request, res: Response) => {
      const parseQuery = z
        .object({
          country: z.string().min(1),
          code: z.string().min(1),
        })
        .safeParse(req.query);

      if (!parseQuery.success) {
        return res.status(400).json({ message: "country and code are required" });
      }

      try {
        const result = await lookupPostal(parseQuery.data.country, parseQuery.data.code);
        return res.json(result);
      } catch {
        return res.json({ found: false, city: "", state: "" });
      }
    }
  );

  // ── ITD: Rate Calculation ─────────────────────────────────────────────────

  app.post(
    "/api/rates",
    ensureDbUser,
    refreshItdTokenIfNeeded,
    async (req: Request, res: Response) => {
      const {
        product_code,
        destination_code,
        booking_date,
        origin_code,
        pcs,
        actual_weight,
        ori_city,
        ori_pincode,
        dest_city,
        dest_pincode,
      } = req.body as RateParams;

      if (!product_code || !destination_code || !actual_weight) {
        res.status(400).json({ message: "product_code, destination_code, and actual_weight are required" });
        return;
      }

      const rateParams: RateParams = {
        product_code,
        destination_code,
        booking_date: booking_date ?? new Date().toISOString().split("T")[0],
        origin_code: origin_code ?? "IN",
        pcs: pcs ?? "1",
        actual_weight,
        ori_city,
        ori_pincode,
        dest_city,
        dest_pincode,
      };

      try {
        let data: unknown;
        const sessionUser = req.session.user;
        if (sessionUser && req.session.dbUserId) {
          try {
            const secrets = await getItdUserTokenAndSecretsById(req.session.dbUserId);
            if (
              secrets?.itd_password_encrypted &&
              secrets?.encryption_iv
            ) {
              const plain = decryptPassword(
                secrets.itd_password_encrypted,
                secrets.encryption_iv
              );
              data = await itdClient.getRates(
                rateParams,
                sessionUser.email,
                sessionUser.code,
                plain
              );
            } else {
              data = await itdClient.getRates(rateParams);
            }
          } catch {
            data = await itdClient.getRates(rateParams);
          }
        } else {
          data = await itdClient.getRates(rateParams);
        }
        res.json(data);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Rate calculation failed";
        res.status(502).json({ message });
      }
    }
  );

  // ── Support: AI chat ──────────────────────────────────────────────────────

  // POST /api/support/chat — guest and logged-in; validates body and returns { message }
  app.post(
    "/api/support/chat",
    ensureDbUser,
    refreshItdTokenIfNeeded,
    supportChatRateLimit,
    async (req: Request, res: Response) => {
    const body = req.body as { messages?: unknown; sessionId?: unknown };
    const messages = body?.messages;
    const bodySessionId =
      typeof body?.sessionId === "string" && body.sessionId.trim() !== ""
        ? body.sessionId.trim()
        : null;

    if (!Array.isArray(messages)) {
      res.status(400).json({ message: "messages must be an array" });
      return;
    }
    if (messages.length < 1 || messages.length > SUPPORT_CHAT_MAX_MESSAGES) {
      res.status(400).json({
        message: `messages must have 1–${SUPPORT_CHAT_MAX_MESSAGES} items`,
      });
      return;
    }

    for (let i = 0; i < messages.length; i++) {
      const m = messages[i] as Record<string, unknown>;
      if (m?.role !== "user" && m?.role !== "assistant") {
        res.status(400).json({
          message: `messages[${i}]: role must be "user" or "assistant"`,
        });
        return;
      }
      if (typeof m?.content !== "string") {
        res.status(400).json({
          message: `messages[${i}]: content must be a string`,
        });
        return;
      }
      if (m.content.length > SUPPORT_CHAT_MAX_CONTENT_LENGTH) {
        res.status(400).json({
          message: `messages[${i}]: content must be at most ${SUPPORT_CHAT_MAX_CONTENT_LENGTH} characters`,
        });
        return;
      }
    }

    const chatMessages: ChatMessage[] = messages.map((m: Record<string, unknown>) => ({
      role: m.role as "user" | "assistant",
      content: String(m.content),
    }));

    const dbUserId = req.session.dbUserId ?? null;
    const isLoggedIn = !!req.session.user && !!dbUserId;

    let activeSessionId: string | null = null;
    if (isLoggedIn && dbUserId) {
      if (bodySessionId) {
        activeSessionId = bodySessionId;
      } else {
        const row = await getOrCreateSupportSession(dbUserId);
        activeSessionId = row?.id ?? null;
      }
    }

    const context = {
      user: req.session.user ?? null,
      itdToken: req.session.itdToken ?? null,
      dbUserId,
      sessionId: activeSessionId,
    };

    try {
      const message = await handleChat(chatMessages, context);
      const stored: ChatMessage[] = [
        ...chatMessages,
        { role: "assistant" as const, content: message },
      ];

      if (isLoggedIn && activeSessionId) {
        const firstUser = chatMessages.find((m) => m.role === "user");
        const titleCandidate =
          firstUser !== undefined
            ? generateSessionTitle(firstUser.content)
            : undefined;
        void updateSupportSessionMessages(
          activeSessionId,
          stored,
          titleCandidate
        );

        const lastUserMsg =
          chatMessages
            .filter((m) => m.role === "user")
            .at(-1)
            ?.content?.toLowerCase() ?? "";
        const isThankyou = [
          "thank you",
          "thanks",
          "bye",
          "goodbye",
          "perfect",
          "great",
        ].some((phrase) => lastUserMsg.includes(phrase));
        const hasContactCta = message
          .toLowerCase()
          .includes("tap_contact_us");
        if (isThankyou && !hasContactCta && activeSessionId) {
          void resolveSupportSession(activeSessionId);
        }
      }

      res.json({
        message,
        sessionId: isLoggedIn ? activeSessionId : null,
      });
    } catch {
      res.status(500).json({
        message:
          "Something went wrong. Please try again or contact support from the app menu.",
      });
    }
  });

  // GET /api/support/session — logged-in: active session + messages
  app.get(
    "/api/support/session",
    requireUser,
    ensureDbUser,
    async (req: Request, res: Response) => {
      const dbUserId = req.session.dbUserId ?? null;
      if (!dbUserId) {
        res.json({
          sessionId: null,
          messages: [] as ChatMessage[],
          title: null as string | null,
        });
        return;
      }

      const row = await getOrCreateSupportSession(dbUserId);
      if (!row) {
        res.json({
          sessionId: null,
          messages: [] as ChatMessage[],
          title: null as string | null,
        });
        return;
      }

      res.json({
        sessionId: row.id,
        messages: row.messages,
        title: row.title,
      });
    }
  );

  // POST /api/support/new-session — start fresh conversation
  app.post(
    "/api/support/new-session",
    requireUser,
    ensureDbUser,
    async (req: Request, res: Response) => {
      const dbUserId = req.session.dbUserId ?? null;
      if (!dbUserId) {
        res.status(400).json({ message: "Profile not synced yet" });
        return;
      }

      const created = await createNewSupportSession(dbUserId);
      if (!created) {
        res.status(503).json({ message: "Could not create a new session" });
        return;
      }

      res.json({ sessionId: created.id });
    }
  );

  // ── ITD: Create Shipment ──────────────────────────────────────────────────

  // POST /api/shipments — requires login (session token)
  app.post(
    "/api/shipments",
    // Docket creation is irreversible — ITD permits no amendment once an AWB
    // exists. Under the deferred-docket model this is fired by ops at the end
    // of the lifecycle (M5), never by a customer at booking. Admin only.
    requireUser,
    requireRole("admin"),
    ensureDbUser,
    refreshItdTokenIfNeeded,
    async (req: Request, res: Response) => {
    if (!req.session.itdToken) {
      res.status(401).json({ message: "Login required to create a shipment" });
      return;
    }

    if (!req.session.dbUserId) {
      res.status(401).json({ message: "User profile not found. Please log in again." });
      return;
    }

    const payload = req.body as CreateShipmentPayload;

    if (!payload.product_code || !payload.destination_code || !payload.actual_weight) {
      res.status(400).json({ message: "product_code, destination_code, and actual_weight are required" });
      return;
    }

    const kyc = await getKycByUserId(req.session.dbUserId);
    if (!kyc) {
      res.status(422).json({
        message: "KYC required. Upload your identity document before creating a shipment.",
      });
      return;
    }

    const publicUrl =
      process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 5000}`;
    const kycPayload = buildItdKycPayload(
      {
        document_type: kyc.document_type,
        document_no: kyc.document_no,
        capability_id: kyc.capability_id,
      },
      publicUrl
    );
    payload.kyc_details = kycPayload.kyc_details;
    payload.shipper_gstin_type = kycPayload.shipper_gstin_type;
    payload.shipper_gstin_no = kycPayload.shipper_gstin_no;

    try {
      const token = req.session.itdToken;
      if (!token) {
        return res
          .status(401)
          .json({ message: "Session token missing. Please log in again." });
      }
      const data = await itdClient.createShipment(payload, token);
      res.json(data);
      if (data.success && req.session.dbUserId) {
        void persistShipmentAfterCreate(
          req.session.dbUserId,
          payload,
          data,
          req.ip
        );
      }
    } catch (err) {
      console.error("[POST /api/shipments] createShipment failed:", err);
      const message = err instanceof Error ? err.message : "Shipment creation failed";
      const tokenError =
        message.includes("Session expired") || message.includes("AUTH TOKEN");
      res.status(tokenError ? 401 : 502).json({ message });
    }
  });

  // ── Orders (A3: Booking) ────────────────────────────────────────────────
  // Booking creates a Bombino order, not an ITD docket. Zero ITD calls here —
  // the docket is generated later by ops (M5), reusing itdClient.createShipment
  // above with the data stashed in `items`/`consignee` on this order.

  const PAYMENT_METHODS = ["pay_now", "pay_at_pickup", "pay_at_dropoff", "cod"] as const;

  // GET /api/pickup/slots and /api/pickup/coverage are gone, with the pickup
  // window itself. A customer names a date; there is no roster to check it
  // against and no window that can lapse while the form is open.
  //
  // GET /api/payment/upi is gone too, along with the doorstep QR it fed. The
  // agent no longer shows the customer a payee address of any kind; the UPI
  // transfer is arranged between them and only its reference is recorded.
  // BOMBINO_UPI_VPA / BOMBINO_UPI_NAME are consequently unread.

  const orderCreateSchema = z
    .object({
      pickup_request: z.union([z.literal(1), z.literal(2)]),
      pickup_date: z.string().trim().min(1).optional().nullable(),
      payment_method: z.enum(PAYMENT_METHODS),
      booked_weight: z.number().optional().nullable(),
      quoted_amount: z.number().optional().nullable(),
      // Absent on clients booking against the older shape — read as "no
      // packaging", which is what every order before this option was.
      packaging_required: z.boolean().optional(),
      origin_address: z.object({
        full_name: z.string().trim().min(1),
        company: z.string().optional().nullable(),
        email: z.string().optional().nullable(),
        phone: z.string().trim().min(1),
        address_line_1: z.string().trim().min(1),
        city: z.string().trim().min(1),
        state: z.string().optional().nullable(),
        pincode: z.string().optional().nullable(),
        country_code: z.string().trim().min(2),
        country_name: z.string().optional().nullable(),
      }),
      consignee: z.record(z.unknown()),
      items: z.record(z.unknown()),
    })
    .refine((body) => body.pickup_request !== 1 || !!body.pickup_date, {
      message: "pickup_date is required when pickup_request is 1 (pickup)",
    })
    // Two payment methods are tied to how the parcel reaches us, because each
    // names the person who physically takes the money. Pay-at-pickup is
    // collected by the agent at the customer's door and has no collector on a
    // drop-off; pay-at-drop-off is collected by ops at the hub counter and has
    // no collector on a pickup. Allowing the mismatch would create an order
    // whose money nobody is positioned to take, and which no lifecycle action
    // can settle: `collect_payment` is guarded on the method in
    // server/orderLifecycle.ts, so the order would stall before `settled`.
    .refine(
      (body) => !(body.pickup_request === 1 && body.payment_method === "pay_at_dropoff"),
      { message: "Pay at drop-off is only available when you drop the parcel off yourself" }
    )
    .refine(
      (body) => !(body.pickup_request === 2 && body.payment_method === "pay_at_pickup"),
      { message: "Pay at pickup is only available when an agent collects the parcel" }
    );

  // POST /api/orders — requires login (session)
  /**
   * Book a shipment — as an account, or as a guest.
   *
   * One route rather than two on purpose. Everything below the ownership
   * question is identical for both: pincode serviceability, the pickup cutoff,
   * the address write, the KYC stamp, the agent shout, the confirmation
   * message. A parallel /api/guest/orders would have to repeat all of it and
   * would drift the first time one of them changed.
   *
   * The guest path is NOT a way around KYC. A guest reaches this endpoint only
   * after verifying their phone and producing the same complete, OCR-checked
   * document set signup demands — the checks below are the very same
   * assertIdentityVerified and assertDocumentsStaged the signup route runs.
   * The only thing they skip is the account.
   */
  app.post("/api/orders", ensureDbUser, async (req: Request, res: Response) => {
    const parsed = orderCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid order payload" });
      return;
    }
    const body = parsed.data;

    // Who is booking. An account wins when both could apply: a signed-in
    // customer with a stale guest ref in their session is booking as themselves.
    //
    // A guest is authorised the way every pre-account endpoint is — by a
    // recent OTP on the number they are booking under, checked here rather
    // than taken on trust from the payload. This is the same test
    // POST /api/auth/signup/personal applies before it opens an account.
    //
    // Deliberately NOT keyed on session.signupRef: that is minted by the first
    // document upload, so keying on it would answer "verify your phone" to a
    // guest whose phone is verified and whose real problem is that they have
    // uploaded nothing yet. The KYC gates below say that properly.
    const bookingAsGuest = !req.session.dbUserId;
    const guestPhone = bookingAsGuest ? body.origin_address.phone.trim() : null;

    if (bookingAsGuest) {
      // Two ways to prove the number, and the second one matters as much as
      // the first.
      //
      // A fresh OTP is the direct proof, but it lasts ten minutes and a guest
      // verifies at the START of the booking — the number is asked for before
      // the parcel is described, so it can be carried onto the form and so
      // nobody fills in four steps only to be sent back. Filling those four
      // steps in under ten minutes is not something to demand of somebody
      // measuring a box, and failing at Confirm Booking is the worst possible
      // moment to say so.
      //
      // So a session holding staged rows for this exact number is accepted
      // too. That is not a weaker proof: those rows CANNOT exist without a
      // valid OTP on that number — every /api/signup/identity and
      // /api/signup/documents endpoint checks hasRecentVerification before it
      // writes, and signupRefForPhone discards everything the moment the phone
      // changes. The staged set is the OTP's own receipt, and
      // assertDocumentsStaged below still demands it be complete.
      const stagedForThisPhone =
        !!guestPhone && req.session.signupPhone === guestPhone && !!req.session.signupRef;

      const verified =
        !!guestPhone &&
        (stagedForThisPhone ||
          (await hasRecentVerification(guestPhone, "auth", OTP_VERIFICATION_WINDOW_MINUTES)));

      if (!verified) {
        res.status(401).json({
          message: "Verify your phone number to book as a guest, or sign in.",
          code: PHONE_UNVERIFIED,
        });
        return;
      }

      // The same refusal /api/guest/phone/verify gives, enforced again at the
      // write. The check there is what the customer sees; this is what makes it
      // true — a client that skipped the dialog, or an account created in the
      // minutes since, must not end with one customer split across an account
      // and a guest record that nothing later reconciles.
      const owner = await findItdUserIdByPhone(guestPhone!);
      if (owner) {
        res.status(409).json({
          message: "This number already has a Bombino account. Please sign in to book.",
          code: "ACCOUNT_EXISTS",
        });
        return;
      }
    }

    // Authoritative pickup checks — coverage first, then the date, because a
    // pincode we do not serve has no cutoff worth quoting. The form applies
    // both, but that is a convenience: its copy of the hub table can be stale,
    // the cutoff can pass while a customer is still filling the form in, and
    // nothing stops a hand-crafted request. Both run before the address write,
    // so a rejected booking leaves nothing behind.
    if (body.pickup_request === 1) {
      const coverage = getPickupServiceability(body.origin_address.pincode);
      if (!coverage.serviceable) {
        res.status(409).json({
          message:
            `We can't pick up from ${body.origin_address.pincode || "that pincode"} just yet. ` +
            `Doorstep pickup is available in ${formatPickupCities()} — ` +
            `choose drop-off and you can hand your parcel in at our hub.`,
          code: "PICKUP_PINCODE_NOT_SERVICEABLE",
        });
        return;
      }

      // Each hub keeps its own hours, so the boundary is the one that applies
      // where the parcel actually is, not a company-wide constant.
      if (body.pickup_date) {
        const cutoff = pickupCutoffHour(body.origin_address.pincode);
        const earliest = earliestPickupDate(cutoff);
        if (body.pickup_date < earliest) {
          res.status(409).json({
            message:
              `Pickups in ${coverage.city} booked after ${formatCutoffHour(cutoff)} ` +
              `are collected from the next day. Choose ${earliest} or later.`,
            code: "PICKUP_DATE_TOO_EARLY",
            earliest_pickup_date: earliest,
          });
          return;
        }
      }
    }

    const guestRef = bookingAsGuest ? req.session.signupRef ?? null : null;

    // A guest owes exactly what a personal account owes on this screen: one
    // identity document, through the same /api/kyc/upload the KycUpload card
    // posts to. Not the signup matrix — that is what opening an ACCOUNT costs,
    // and a guest is not opening one. Booking as a guest removes the account,
    // not the KYC.
    //
    // Presence is the whole test, for the same reason it is on the account
    // side: an upload whose OCR contradicted the typed number, read the wrong
    // kind of document, or tripped a tamper check never reached storage —
    // /api/kyc/upload refuses those outright. A row here has already passed.
    if (bookingAsGuest) {
      const guestKyc = guestRef ? await getKycByGuestRef(guestRef) : null;
      if (!guestKyc) {
        res.status(422).json({
          message: "Please add your identity document before booking.",
          code: "KYC_REQUIRED",
        });
        return;
      }
    }

    const originAddr = await findOrCreateAddress({
      user_id: req.session.dbUserId ?? null,
      guest_ref: guestRef,
      type: "sender",
      full_name: body.origin_address.full_name,
      company: body.origin_address.company || null,
      email: body.origin_address.email || null,
      phone: body.origin_address.phone,
      address_line_1: body.origin_address.address_line_1,
      city: body.origin_address.city,
      state: body.origin_address.state || null,
      pincode: body.origin_address.pincode || null,
      country_code: body.origin_address.country_code,
      country_name: body.origin_address.country_name || null,
    });

    if (!originAddr?.id) {
      res.status(502).json({ message: "Could not save pickup address" });
      return;
    }

    const isPickup = body.pickup_request === 1;
    const status = isPickup ? "pickup_requested" : "awaiting_dropoff";

    // Stamp the account's verification state onto the order.
    //
    // Booking is deliberately not blocked by it — an unverified customer can
    // book, and be collected from, and pay. The flag is read much later, by the
    // `generate_docket` guard, at the last moment anything is still reversible.
    // Denormalised because that guard is pure and synchronous (no DB reads),
    // and refreshed by refreshKycVerifiedOnOpenOrders when a document lands.
    //
    // A failure to read it stamps `true`: the alternative is holding an order
    // because Supabase blipped during booking, and signup already refused to
    // open this account without its documents.
    // A guest's documents were just checked above, so the stamp is true by
    // construction — there is no account row to read a state off, and asking
    // getVerificationState for one would return "everything missing" and hold
    // an order whose KYC is complete.
    const bookingKyc = bookingAsGuest
      ? { verified: true }
      : await (async () => {
          const shape = await accountShapeFor(req.session.dbUserId!);
          return getVerificationState(req.session.dbUserId!, shape.accountType, shape.category);
        })();

    const order = await insertOrderAndReturnRow({
      user_id: req.session.dbUserId ?? null,
      guest_ref: guestRef,
      guest_name: bookingAsGuest ? body.origin_address.full_name : null,
      guest_email: bookingAsGuest ? body.origin_address.email || null : null,
      guest_phone: bookingAsGuest ? guestPhone! : null,
      status,
      pickup_request: body.pickup_request,
      pickup_date: isPickup ? body.pickup_date ?? null : null,
      origin_address_id: originAddr.id,
      consignee: body.consignee,
      items: body.items,
      booked_weight: body.booked_weight ?? null,
      quoted_amount: body.quoted_amount ?? null,
      packaging_required: body.packaging_required ?? false,
      payment_method: body.payment_method,
      is_cod: body.payment_method === "cod",
      metadata: { kyc_verified: bookingKyc.verified },
    });

    if (!order) {
      res.status(502).json({ message: "Order creation failed" });
      return;
    }

    if (bookingAsGuest && guestRef) {
      // No mirror to do: a guest's document was written straight into
      // kyc_documents by /api/kyc/upload, which is the table buildItdKycPayload
      // reads when ops dockets the order. Account signup mirrors because its
      // documents land in account_documents first; a guest has no such matrix.

      // Promote the staging ref to the session's guest identity.
      //
      // signupRef is re-minted whenever the phone on this browser changes, and
      // the customer still has to be able to pay for the order they have just
      // placed. guestRef is the stable copy that ownership is checked against
      // in server/routes/payments.ts.
      req.session.guestRef = guestRef;
      req.session.guestPhone = guestPhone!;
    }

    void insertOrderEvent({
      order_id: order.id,
      status,
      note: bookingAsGuest ? "Order created (guest)" : "Order created",
      // No account, so no actor id. The note and the order's guest_ref are
      // what say who did this.
      actor_user_id: req.session.dbUserId ?? null,
    });

    // A drop-off has no agent and no claim, so there is no later moment to
    // issue its code from: the customer walks into the hub whenever they like,
    // and the code has to be on their screen before they set off. A pickup's
    // code waits for the claim — nobody needs a code for a job no agent holds.
    if (!isPickup) {
      await issueCode(order.id, "dropoff");
    }

    // The booking confirmation, and — for a pickup — the shout to the agents
    // rostered for that window. Neither goes through `notifyOrderTransition`:
    // the customer is the actor here, and that function silences self-actions.
    //
    // Fire-and-forget. A slow provider must not delay the Order ID the customer
    // is waiting on, and a failed message must not fail a paid-for booking.
    const bookedOrder = toOrder(order);
    void notifyOrderBooked({
      order: bookedOrder,
      customerName: body.origin_address.full_name,
    });
    void notifyAgentsOfNewJob({
      order: bookedOrder,
      address: { city: body.origin_address.city, pincode: body.origin_address.pincode },
    });

    res.json({ order });
  });

  // The customer-facing copy that used to sit here moved to
  // `server/notificationCopy.ts`, so the WhatsApp templates and the in-app rows
  // read from one table instead of two.

  // ── The uniform lifecycle endpoint (M0 item 7) ──────────────────────────
  //
  // Every transition, for every role, in every surface, goes through here.
  // The response carries the recomputed `availableActions` so a caller never
  // has to know the state machine — it renders one button per entry.
  //
  // SCAFFOLD: authorisation is complete and enforced; the write is not built.
  // A legal request gets 501 today. When the handlers land, replace the 501
  // with the transition's effect — and put the race-prone preconditions in the
  // UPDATE's WHERE clause, not just in the guard (see orderLifecycle.ts).

  /**
   * Which handover each OTP-gated action checks.
   *
   * Kept as data next to the switch rather than inferred inside it, so adding a
   * fourth handover is one line here and one transition row — the same
   * discipline `orderLifecycle.ts` follows.
   */
  const HANDOVER_KIND_FOR_ACTION = {
    mark_picked_up: "pickup",
    mark_received_at_hub: "hub",
    mark_received_dropoff: "dropoff",
  } as const satisfies Record<string, HandoverKind>;

  /**
   * Whose code each handover checks, for the audit note.
   *
   * Not cosmetic: reading "with the hub's code" in an order's history is what
   * tells whoever is investigating a disputed parcel which party was tested.
   */
  const HANDOVER_CODE_OWNER = {
    pickup: "the customer's code",
    hub: "the hub's code",
    dropoff: "the customer's code",
  } as const satisfies Record<HandoverKind, string>;

  /** Which handover an ops override is waving through, by the status it acts on. */
  const HANDOVER_KIND_FOR_STATUS: Partial<Record<OrderStatus, HandoverKind>> = {
    out_for_pickup: "pickup",
    picked_up: "hub",
    awaiting_dropoff: "dropoff",
  };

  /**
   * Session role → contract role. `req.session.user.role` is a free-form
   * string (ITD's value on password logins, a Bombino literal on OTP signups),
   * so anything unrecognised resolves to null and is refused rather than
   * defaulted to something permissive.
   */
  function resolveRole(raw: string | undefined): Role | null {
    return isRole(raw) ? raw : null;
  }

  app.post(
    "/api/orders/:id/actions",
    requireUser,
    ensureDbUser,
    async (req: Request, res: Response) => {
      const callerId = req.session.dbUserId;
      if (!callerId) {
        res.status(401).json({ message: "Login required" });
        return;
      }

      const role = resolveRole(req.session.user?.role);
      if (!role) {
        res.status(403).json({
          message: "You do not have permission to perform this action.",
          code: "FORBIDDEN",
        });
        return;
      }

      const parsed = z
        .object({
          action: z.string().trim().min(1, "action is required"),
          payload: z.record(z.unknown()).optional(),
        })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          message: parsed.error.issues[0]?.message ?? "Invalid action request",
          code: "INVALID_REQUEST",
        });
        return;
      }

      // Unknown verb is a malformed request (400). A known verb the caller may
      // not perform right now is a refusal (403). Keeping those apart is what
      // lets the client tell "I sent nonsense" from "someone beat me to it".
      if (!isKnownAction(parsed.data.action)) {
        res.status(400).json({
          message: `Unknown action "${parsed.data.action}".`,
          code: "UNKNOWN_ACTION",
        });
        return;
      }
      const action = parsed.data.action;

      const order = await getOrderById(req.params.id);
      if (!order) {
        res.status(404).json({ message: "Order not found", code: "ORDER_NOT_FOUND" });
        return;
      }

      // Ownership, before anything else. A customer may only ever touch their
      // own order. Agents and ops are scoped by the transition table instead —
      // an agent's per-job ownership is enforced by the `isOwningAgent` guard.
      // Note RLS is bypassed everywhere (service-role key), so this check is
      // the only thing standing between a customer and someone else's order.
      if (role === "customer" && order.user_id !== callerId) {
        res.status(404).json({ message: "Order not found", code: "ORDER_NOT_FOUND" });
        return;
      }

      const transition = findTransition(order, action, role, { userId: callerId });
      if (!transition) {
        // Deliberately does not say which precondition failed — that would
        // leak other users' state (e.g. that another agent holds this job).
        res.status(403).json({
          message: "That action is not available on this order right now.",
          code: "ACTION_NOT_AVAILABLE",
          availableActions: availableActions(order, role, { userId: callerId }),
        });
        return;
      }

      // ── Execute ─────────────────────────────────────────────────────────
      // Past this point the caller is authorised and the transition is legal
      // against the row we read. That row is now stale by definition, so each
      // branch re-asserts its preconditions in the UPDATE's WHERE clause and
      // treats a zero-row result as "someone else got there first" (409).

      let updated: Order | null = null;
      let eventNote = "";
      let extra: Record<string, unknown> = {};
      let collectionReceipt: { txnId: string | null; amount: number } | null = null;

      switch (action) {
        case "claim": {
          updated = await claimPickup(order.id, callerId);
          if (!updated) {
            res.status(409).json({
              message: "Another agent just took this pickup.",
              code: "PICKUP_ALREADY_CLAIMED",
            });
            return;
          }
          eventNote = "Pickup claimed by agent";
          // The customer can now be told a code, and will want it visible well
          // before the doorbell goes. Best-effort: the claim is already
          // committed, and refusing it because a code failed to write would
          // hand the job back to the pool for no good reason. The customer's
          // screen offers a regenerate when there is nothing to show.
          await issueCode(order.id, "pickup");
          break;
        }

        case "start_pickup": {
          if (!transition.to) {
            res.status(500).json({ message: "Malformed transition", code: "BAD_TRANSITION" });
            return;
          }
          updated = await advanceOrderStatus({
            orderId: order.id,
            agentId: callerId,
            expectedFrom: transition.from,
            to: transition.to,
          });
          if (!updated) {
            // Either the order moved under us, or it is not ours. Both are the
            // same answer to the caller, and saying which would disclose
            // whether another agent holds it.
            res.status(409).json({
              message: "This pickup has already moved on. Refresh your list.",
              code: "ORDER_STATE_CHANGED",
            });
            return;
          }
          eventNote = `Agent moved order to ${transition.to}`;
          break;
        }

        // ── OTP-gated handovers ───────────────────────────────────────────
        // Three steps, one shape: check the code the other party read out,
        // then move the order. The code is verified BEFORE the status write,
        // so a wrong guess costs an attempt and changes nothing else.
        case "mark_picked_up":
        case "mark_received_at_hub":
        case "mark_received_dropoff": {
          if (!transition.to) {
            res.status(500).json({ message: "Malformed transition", code: "BAD_TRANSITION" });
            return;
          }

          const kind = HANDOVER_KIND_FOR_ACTION[action];

          const otpBody = z
            .object({
              // `required_error` as well as the regex message: a missing key
              // otherwise surfaces zod's bare "Required", which is what an
              // agent would have been shown at a doorstep.
              otp: z
                .string({ required_error: "Enter the code" })
                .trim()
                // 4-6: new codes are four digits, but one issued before that
                // change is still on somebody's screen. See handoverCodes.ts.
                .regex(HANDOVER_CODE_PATTERN, "Enter the 4-digit code"),
            })
            .safeParse(parsed.data.payload ?? {});
          if (!otpBody.success) {
            res.status(400).json({
              message: otpBody.error.issues[0]?.message ?? "The handover code is required",
              code: "OTP_REQUIRED",
            });
            return;
          }

          const check = await verifyCode({
            orderId: order.id,
            kind,
            submitted: otpBody.data.otp,
            verifiedBy: callerId,
          });

          if (!check.ok) {
            const messages: Record<typeof check.reason, string> = {
              no_code: "There is no handover code on this order to check.",
              locked:
                "Too many wrong codes. Ask for a fresh code to be generated, then try again.",
              mismatch:
                check.attemptsLeft > 0
                  ? `That code is not right. ${check.attemptsLeft} ${
                      check.attemptsLeft === 1 ? "try" : "tries"
                    } left.`
                  : "That code is not right, and this code is now locked. Ask for a fresh one.",
              error: "Could not check the code. Try again.",
            };
            res.status(check.reason === "error" ? 502 : 409).json({
              message: messages[check.reason],
              code: `OTP_${check.reason.toUpperCase()}`,
              attemptsLeft: check.attemptsLeft,
            });
            return;
          }

          // Ownership differs by who is acting: the agent may only advance a
          // job they hold, ops may act on anyone's.
          updated =
            role === "agent"
              ? await advanceOrderStatus({
                  orderId: order.id,
                  agentId: callerId,
                  expectedFrom: transition.from,
                  to: transition.to,
                })
              : await transitionOrderStatus({
                  orderId: order.id,
                  expectedFrom: transition.from,
                  to: transition.to,
                });

          if (!updated) {
            // The code is already spent at this point. Saying so matters: the
            // caller must ask for a fresh one rather than retyping the same
            // number and being told it is wrong.
            res.status(409).json({
              message:
                "This order moved on before the code was accepted. Refresh, then ask for a fresh code.",
              code: "ORDER_STATE_CHANGED",
            });
            return;
          }

          eventNote = `${
            role === "agent" ? "Agent" : "Ops"
          } completed the ${kind} handover with ${HANDOVER_CODE_OWNER[kind]}`;
          extra = { handover: kind, verified: true };

          // The parcel is now in the agent's bag and the next handover is at the
          // hub counter, where ops reads this number off their console. Issued
          // here rather than at the counter so it is already on the ops screen
          // when the agent walks up.
          if (action === "mark_picked_up") {
            await issueCode(order.id, "hub");
          }
          break;
        }

        case "override_handover": {
          if (!transition.to) {
            res.status(500).json({ message: "Malformed transition", code: "BAD_TRANSITION" });
            return;
          }

          const overrideBody = z
            .object({
              // Required, unlike every other note in this endpoint. An
              // override is the one action here with no check on it at all,
              // so the reason is the only thing anyone can audit it by.
              reason: z
                .string({ required_error: "Say why the code could not be used" })
                .trim()
                .min(3, "Say why the code could not be used")
                .max(300, "Keep the reason under 300 characters"),
            })
            .safeParse(parsed.data.payload ?? {});
          if (!overrideBody.success) {
            res.status(400).json({
              message: overrideBody.error.issues[0]?.message ?? "A reason is required",
              code: "REASON_REQUIRED",
            });
            return;
          }

          const kind = HANDOVER_KIND_FOR_STATUS[transition.from];

          updated = await transitionOrderStatus({
            orderId: order.id,
            expectedFrom: transition.from,
            to: transition.to,
          });
          if (!updated) {
            res.status(409).json({
              message: "This order has already moved on.",
              code: "ORDER_STATE_CHANGED",
            });
            return;
          }

          // Spend the code so it cannot be used afterwards to imply the
          // handover was verified when it was waved through.
          if (kind) {
            await burnCodeForOverride({
              orderId: order.id,
              kind,
              overriddenBy: callerId,
            });
          }

          eventNote = `Ops completed the ${kind ?? "handover"} without a code: ${overrideBody.data.reason}`;
          extra = { handover: kind, override: true, reason: overrideBody.data.reason };
          break;
        }

        case "collect_payment": {
          if (role === "agent") {
            // Ops collection at the hub is M3's; this branch is the doorstep.
            if (order.payment_method !== "pay_at_pickup") {
              res.status(400).json({
                message: "This order is not marked pay-at-pickup.",
                code: "PAYMENT_METHOD_MISMATCH",
              });
              return;
            }

            const paymentBody = z
              .object({
                amount: z.number().positive("amount must be greater than zero"),
                // How the money actually moved. Required: an agent handing over
                // a parcel must have said whether they hold cash or watched a
                // UPI transfer land, because only one of those ends up in their
                // pouch at the end of the shift.
                collection_mode: z.enum(["upi", "cash"], {
                  errorMap: () => ({ message: "Choose UPI or cash" }),
                }),
                // UPI reference from the customer's app, if they read it out.
                reference: z.string().trim().max(120).optional().nullable(),
              })
              .safeParse(parsed.data.payload ?? {});
            if (!paymentBody.success) {
              res.status(400).json({
                message: paymentBody.error.issues[0]?.message ?? "Invalid payment payload",
                code: "INVALID_PAYLOAD",
              });
              return;
            }

            const result = await recordCollectedPayment({
              order_id: order.id,
              user_id: order.user_id,
              guest_ref: order.guest_ref ?? null,
              amount: paymentBody.data.amount,
              method: "pay_at_pickup",
              status: "collected",
              collection_mode: paymentBody.data.collection_mode,
              collected_by: callerId,
              reference: paymentBody.data.reference ?? null,
            });
            if (!result) {
              res.status(502).json({
                message: "Could not record the payment. Do not hand over the parcel.",
                code: "PAYMENT_WRITE_FAILED",
              });
              return;
            }

            // Deliberately no status change — the parcel is still out_for_pickup.
            updated = result.order ?? order;
            eventNote = `Collected ₹${paymentBody.data.amount} at pickup (${paymentBody.data.collection_mode})`;
            extra = {
              payment_id: result.paymentId,
              txn_id: result.txnId,
              amount: paymentBody.data.amount,
              collection_mode: paymentBody.data.collection_mode,
            };
            // Surfaced at the top level so the sheet can show the receipt without
            // digging through the event metadata.
            collectionReceipt = { txnId: result.txnId, amount: paymentBody.data.amount };
            break;
          }

          if (role === "admin" || role === "super_admin") {
            if (order.payment_method !== "pay_at_dropoff") {
              res.status(400).json({
                message: "This order is not marked pay-at-drop-off.",
                code: "PAYMENT_METHOD_MISMATCH",
              });
              return;
            }

            const paymentBody = z
              .object({
                amount: z.number().positive("amount must be greater than zero"),
                collection_mode: z.enum(["upi", "cash"], {
                  errorMap: () => ({ message: "Choose UPI or cash" }),
                }),
                reference: z.string().trim().max(120).optional().nullable(),
              })
              .safeParse(parsed.data.payload ?? {});
            if (!paymentBody.success) {
              res.status(400).json({
                message: paymentBody.error.issues[0]?.message ?? "Invalid payment payload",
                code: "INVALID_PAYLOAD",
              });
              return;
            }

            const result = await recordCollectedPayment({
              order_id: order.id,
              user_id: order.user_id,
              guest_ref: order.guest_ref ?? null,
              amount: paymentBody.data.amount,
              method: "pay_at_dropoff",
              status: "collected",
              collection_mode: paymentBody.data.collection_mode,
              collected_by: callerId,
              reference: paymentBody.data.reference ?? null,
            });
            if (!result) {
              res.status(502).json({
                message: "Could not record the payment. Do not settle yet.",
                code: "PAYMENT_WRITE_FAILED",
              });
              return;
            }

            updated = result.order ?? order;
            eventNote = `Collected ₹${paymentBody.data.amount} at drop-off (${paymentBody.data.collection_mode})`;
            extra = {
              payment_id: result.paymentId,
              txn_id: result.txnId,
              amount: paymentBody.data.amount,
              collection_mode: paymentBody.data.collection_mode,
            };
            collectionReceipt = { txnId: result.txnId, amount: paymentBody.data.amount };
            break;
          }

          res.status(403).json({
            message: "You do not have permission to collect payment on this order.",
            code: "FORBIDDEN",
          });
          return;
        }

        case "request_cancellation": {
          const requestBody = z
            .object({
              // Optional, and capped: this is a note for whoever picks the
              // request up, not a support ticket.
              reason: z.string().trim().max(300, "Keep the reason under 300 characters")
                .optional()
                .nullable(),
            })
            .safeParse(parsed.data.payload ?? {});
          if (!requestBody.success) {
            res.status(400).json({
              message: requestBody.error.issues[0]?.message ?? "Invalid request payload",
              code: "INVALID_PAYLOAD",
            });
            return;
          }

          const reason = requestBody.data.reason?.trim() || null;

          updated = await recordCancellationRequest({
            orderId: order.id,
            userId: callerId,
            // The states a request is legal from, mirrored from the transition
            // table so the WHERE clause re-asserts what the guard checked.
            expectedStatuses: ["pickup_requested", "awaiting_dropoff", "agent_accepted"],
            reason,
          });
          if (!updated) {
            res.status(409).json({
              message:
                "This order has already moved on. Call support if you still need it cancelled.",
              code: "ORDER_STATE_CHANGED",
            });
            return;
          }

          // Deliberately no status change: the order is still live and the
          // agent is still expected to collect it until ops decides.
          eventNote = reason
            ? `Customer requested cancellation: ${reason}`
            : "Customer requested cancellation";
          extra = { reason };

          // Warn the agent holding it. The order has not moved, so the message
          // says wait rather than stop — but an agent who sets off now may find
          // a customer who has already decided they are not sending anything.
          void notifyAgentOfCancellationRequest(updated);
          break;
        }

        case "cancel": {
          if (!transition.to) {
            res.status(500).json({ message: "Malformed transition", code: "BAD_TRANSITION" });
            return;
          }
          // Ops only — `orderLifecycle.ts` gives the customer no `cancel` row,
          // so a customer reaching here has already been refused by
          // `findTransition` above.
          updated = await transitionOrderStatus({
            orderId: order.id,
            expectedFrom: transition.from,
            to: transition.to,
          });
          if (!updated) {
            res.status(409).json({
              message: "This order has already moved on and can no longer be cancelled.",
              code: "ORDER_STATE_CHANGED",
            });
            return;
          }
          // Whether ops was acting on a request or a phone call is the first
          // thing anyone asks afterwards, so the event says which.
          const request = readCancellationRequest(order);
          if (request) {
            // Best-effort: the cancellation itself is already committed above,
            // and failing the response because an audit field did not write
            // would tell ops the cancellation failed when it did not.
            await markCancellationRequestDecided({
              orderId: order.id,
              decision: "approved",
              decidedBy: callerId,
              note: null,
            });
          }
          eventNote = request
            ? "Order cancelled by ops on the customer's request"
            : "Order cancelled by ops";
          extra = request
            ? { requested_at: request.requested_at, requested_reason: request.reason }
            : {};
          break;
        }

        case "reject_cancellation": {
          const rejectBody = z
            .object({
              // The customer reads this. Optional, because a decline over the
              // phone may already have been explained.
              note: z.string().trim().max(300, "Keep the note under 300 characters")
                .optional()
                .nullable(),
            })
            .safeParse(parsed.data.payload ?? {});
          if (!rejectBody.success) {
            res.status(400).json({
              message: rejectBody.error.issues[0]?.message ?? "Invalid decision payload",
              code: "INVALID_PAYLOAD",
            });
            return;
          }

          const note = rejectBody.data.note?.trim() || null;

          const written = await markCancellationRequestDecided({
            orderId: order.id,
            decision: "rejected",
            decidedBy: callerId,
            note,
          });
          if (!written) {
            res.status(409).json({
              message: "There is no open cancellation request on this order.",
              code: "NO_OPEN_REQUEST",
            });
            return;
          }

          // Nothing moved — that is the decision. Re-read so the response and
          // the recomputed actions reflect the decision just written.
          updated = (await getOrderById(order.id)) ?? order;
          eventNote = note
            ? `Cancellation declined by ops: ${note}`
            : "Cancellation declined by ops";
          extra = { note };

          // The one case the customer must be told about explicitly. An
          // approval announces itself as the order turning `cancelled`, which
          // the fan-out below already notifies; a decline changes nothing on
          // screen, so without this the customer waits forever.
          void notifyCancellationDeclined({ order: updated, note });
          break;
        }

        default: {
          // Ops actions — weigh, settle, generate_docket. mark_received_dropoff
          // is OTP-gated above; do not delegate a payload-less handler here.
          const mapOpsResult = (
            r: Awaited<ReturnType<typeof handleWeigh>>
          ): boolean => {
            if ("error" in r) {
              res.status(r.error.status).json({
                message: r.error.message,
                code: r.error.code,
                ...(r.error.extra ?? {}),
                availableActions: availableActions(order, role, { userId: callerId }),
              });
              return false;
            }
            updated = r.order;
            eventNote = r.eventNote;
            extra = r.eventMeta;
            return true;
          };

          if (action === "weigh") {
            if (!transition.to) {
              res.status(500).json({ message: "Malformed transition", code: "BAD_TRANSITION" });
              return;
            }
            const ok = mapOpsResult(
              await handleWeigh({
                order,
                callerId,
                expectedFrom: transition.from,
                to: transition.to,
                payload: parsed.data.payload,
              })
            );
            if (!ok) return;
            break;
          }

          if (action === "settle") {
            if (!transition.to) {
              res.status(500).json({ message: "Malformed transition", code: "BAD_TRANSITION" });
              return;
            }
            const ok = mapOpsResult(
              await handleSettle({
                order,
                callerId,
                expectedFrom: transition.from,
                to: transition.to,
              })
            );
            if (!ok) return;
            break;
          }

          if (action === "generate_docket") {
            if (!transition.to) {
              res.status(500).json({ message: "Malformed transition", code: "BAD_TRANSITION" });
              return;
            }
            const ok = mapOpsResult(await handleGenerateDocket({ order, callerId }));
            if (!ok) return;
            break;
          }

          res.status(501).json({
            message: `"${action}" is legal for this order but not implemented yet.`,
            code: "NOT_IMPLEMENTED",
            action,
            from: transition.from,
            to: transition.to,
            requiresPayload: transition.requiresPayload ?? false,
            availableActions: availableActions(order, role, { userId: callerId }),
          });
          return;
        }
      }

      if (!updated) {
        res.status(500).json({
          message: "Action completed without an order row.",
          code: "NO_ORDER",
        });
        return;
      }

      // The write landed. Log it before responding — awaited, not fire-and-
      // forget, so a failure is visible rather than a silently missing row.
      // The status change is already committed and cannot be rolled back from
      // here (supabase-js has no multi-statement transaction), so a failed log
      // is reported alongside a successful action rather than masking it.
      // The durable fix is an AFTER UPDATE trigger on `orders`, which would
      // cover every writer instead of just this endpoint.
      const eventLogged = await insertOrderEvent({
        order_id: updated.id,
        status: updated.status,
        note: eventNote,
        actor_user_id: callerId,
        metadata: { action, role, ...extra },
      });

      if (!eventLogged) {
        console.error("[POST /api/orders/:id/actions] order_events insert failed", {
          order_id: updated.id,
          action,
          status: updated.status,
          actor_user_id: callerId,
        });
      }

      // Tell everyone who needs telling — in-app and on WhatsApp.
      //
      // The rules that used to live here (silence on the three internal
      // statuses, silence when the actor is the customer) now live in
      // `server/notify.ts` alongside the WhatsApp half, so the two channels
      // cannot drift apart. Fire-and-forget: a provider round trip must not sit
      // in front of this response.
      void notifyOrderTransition({
        order: updated,
        moved: transition.to !== null,
        actorUserId: callerId,
      });

      res.json({
        order: updated,
        availableActions: availableActions(updated, role, { userId: callerId }),
        ...(collectionReceipt ? { receipt: collectionReceipt } : {}),
        ...(eventLogged ? {} : { warning: "Action applied but history entry failed to write." }),
      });
    }
  );

  // GET /api/orders — requires login (session)
  app.get("/api/orders", ensureDbUser, async (req: Request, res: Response) => {
    if (!req.session.dbUserId) {
      res.status(401).json({ message: "Login required" });
      return;
    }

    const orders = await listOrdersByUserId(req.session.dbUserId);
    if (orders === null) {
      res.status(502).json({ message: "Could not load orders" });
      return;
    }

    res.json({ orders });
  });

  // ── POST /api/orders/:id/handover-code — issue a fresh code ─────────────
  //
  // The escape hatch for the two ways a code stops working: five wrong guesses
  // locked it, or nobody can find it because the write failed when the order
  // moved. Only the party who *shows* the code may regenerate it — a verifier
  // who could mint a new one would be testing themselves.
  //
  // The kind is derived from role and status rather than taken from the body,
  // so a customer cannot ask for the agent's hub code by naming it.
  app.post(
    "/api/orders/:id/handover-code",
    requireUser,
    ensureDbUser,
    async (req: Request, res: Response) => {
      const callerId = req.session.dbUserId;
      if (!callerId) {
        res.status(401).json({ message: "Login required" });
        return;
      }

      const role = resolveRole(req.session.user?.role);
      if (!role) {
        res.status(403).json({ message: "Not allowed", code: "FORBIDDEN" });
        return;
      }

      const order = await getOrderById(req.params.id);
      if (!order) {
        res.status(404).json({ message: "Order not found", code: "ORDER_NOT_FOUND" });
        return;
      }

      let kind: HandoverKind | null = null;

      if (role === "customer") {
        // Ownership first: a customer regenerating someone else's code would
        // be a denial of service on a stranger's pickup.
        if (order.user_id !== callerId) {
          res.status(404).json({ message: "Order not found", code: "ORDER_NOT_FOUND" });
          return;
        }
        if (order.pickup_request === 2 && order.status === "awaiting_dropoff") {
          kind = "dropoff";
        } else if (
          order.pickup_request === 1 &&
          (order.status === "agent_accepted" || order.status === "out_for_pickup")
        ) {
          kind = "pickup";
        }
      } else if (role === "admin" || role === "super_admin") {
        // The hub code, and only the hub code. Ops shows that one to the agent
        // at the counter, so ops is the party entitled to refresh it.
        //
        // Not `dropoff`, even though it is also read at their counter: that code
        // is the customer's and ops is the one who types it in. Not `pickup`
        // either, for the same reason at the other end. A verifier who could
        // mint a fresh code would be testing themselves, which is the one rule
        // `handoverCodes.ts` exists to hold.
        //
        // The agent has no branch here at all any more — they type the hub code
        // now, so the entitlement moved with the handover.
        if (order.status === "picked_up") {
          kind = "hub";
        }
      }

      if (!kind) {
        res.status(409).json({
          message: "This order has no handover code to refresh right now.",
          code: "NO_HANDOVER_DUE",
        });
        return;
      }

      const code = await issueCode(order.id, kind);
      if (!code) {
        res.status(502).json({
          message: "Could not generate a new code. Try again.",
          code: "CODE_ISSUE_FAILED",
        });
        return;
      }

      // Logged so a string of regenerations before a disputed handover is
      // visible afterwards, rather than being invisible in the order's history.
      void insertOrderEvent({
        order_id: order.id,
        status: order.status,
        note: `New ${kind} handover code issued`,
        actor_user_id: callerId,
        metadata: { action: "regenerate_handover_code", handover: kind, role },
      });

      // Push the new pickup code to the customer's WhatsApp, but only once the
      // agent is actually on the way — before that the customer is reading it
      // off their own screen and has nothing to be told. `notifyHandoverCodeReissued`
      // keys its dedupe on the new code, so this is a different message from
      // the one carrying the code it replaced rather than a suppressed duplicate.
      if (kind === "pickup") {
        void notifyHandoverCodeReissued({ order, code });
      }

      res.json({ handover: { kind, code, locked: false } });
    }
  );

  // ── GET /api/orders/cancellations — the customer's cancellation screen ───
  //
  // MUST stay above `/api/orders/:orderNo`: Express matches in registration
  // order, and the param route would otherwise swallow this and look up an
  // order numbered "cancellations".
  //
  // One row per order cancellation has touched, in the three states the screen
  // groups by. The state is derived server-side by `cancellationState` so the
  // page never re-implements the rule that a cancelled order outranks whatever
  // its metadata says.
  app.get("/api/orders/cancellations", ensureDbUser, async (req: Request, res: Response) => {
    const userId = req.session.dbUserId;
    if (!userId) {
      res.status(401).json({ message: "Login required" });
      return;
    }

    const rows = await listCancellationOrdersByUserId(userId);
    if (rows === null) {
      res.status(502).json({ message: "Could not load your cancellations" });
      return;
    }

    const orders = rows.map((row) => {
      const order = toOrder(row);
      const request = readCancellationRequest(order);
      return {
        id: order.id,
        order_no: order.order_no,
        status: order.status,
        customerStatus: deriveCustomerStatus(order),
        pickup_request: order.pickup_request,
        pickup_date: order.pickup_date,
        quoted_amount: order.quoted_amount,
        final_amount: order.final_amount,
        payment_method: order.payment_method,
        payment_status: order.payment_status,
        created_at: order.created_at,
        updated_at: order.updated_at,
        cancellation: {
          state: cancellationState(order),
          requestedAt: request?.requested_at ?? null,
          reason: request?.reason ?? null,
          decidedAt: request?.decided_at ?? null,
          // Ops' words to the customer when they declined. Null on an approval,
          // which needs no explaining.
          decisionNote: request?.decision_note ?? null,
        },
      };
    });

    res.json({ orders });
  });

  // ── GET /api/orders/:orderNo — one order, in full, for its owner ─────────
  //
  // The customer's counterpart to the agent's pickup detail screen. Everything
  // captured at booking, plus the lifecycle log so a pickup customer can see
  // what the agent did and when.
  //
  // Ownership is enforced in the SQL WHERE (`getOrderByNumberForUser`), not
  // here — the service-role key bypasses RLS, so a JS-side comparison would not
  // be a boundary (§4.2 of open-items).

  /**
   * Statuses during which the assigned agent's phone number is useful to the
   * customer. Before a claim there is no agent; after the hub handoff the
   * parcel is ops' problem and the agent should not keep taking calls about it.
   */
  const AGENT_PHONE_VISIBLE_STATUSES: readonly OrderStatus[] = [
    "agent_accepted",
    "out_for_pickup",
    "picked_up",
  ];

  /** Who moved the order, in terms the customer cares about. */
  function eventActorKind(role: unknown, isOwner: boolean): "agent" | "ops" | "you" | "system" {
    if (isOwner) return "you";
    if (role === "agent") return "agent";
    if (role === "admin" || role === "super_admin") return "ops";
    return "system";
  }

  app.get("/api/orders/:orderNo", ensureDbUser, async (req: Request, res: Response) => {
    const userId = req.session.dbUserId;
    if (!userId) {
      res.status(401).json({ message: "Login required" });
      return;
    }

    const order = await getOrderByNumberForUser(req.params.orderNo, userId);
    if (!order) {
      // An order that belongs to someone else is reported the same way as one
      // that does not exist — the distinction is not the caller's business.
      res.status(404).json({ message: "Order not found", code: "ORDER_NOT_FOUND" });
      return;
    }

    /**
     * The customer's handover code, and only the customer's.
     *
     * A pickup order's code is theirs to read to the agent; a drop-off order's
     * is theirs to read at the hub counter. The `hub` code belongs to ops and
     * must never appear here — this endpoint is the customer's.
     *
     * Only fetched in the statuses where the handover is actually next. Showing
     * a code for a parcel already at the hub invites someone to read out a
     * number that opens nothing.
     */
    const handoverKind: HandoverKind | null =
      order.pickup_request === 2
        ? order.status === "awaiting_dropoff"
          ? "dropoff"
          : null
        : order.status === "agent_accepted" || order.status === "out_for_pickup"
          ? "pickup"
          : null;

    const [rawEvents, payments, handover] = await Promise.all([
      listOrderEvents(order.id),
      listPaymentsByOrderId(order.id),
      handoverKind ? getCodeForOwner(order.id, handoverKind) : Promise.resolve(null),
    ]);

    // The three internal statuses produce no customer-visible change (§2 of
    // roles-and-flows) and are dropped rather than rendered as a stalled
    // repeat of "Arrived at Bombino hub".
    const visibleEvents = (rawEvents ?? []).filter(
      (ev) => !isInternalOnlyStatus(ev.status as OrderStatus)
    );

    const contacts = await getUserContactsByIds([
      ...visibleEvents.map((ev) => ev.actor_user_id).filter((id): id is string => !!id),
      ...(payments ?? []).map((p) => p.collected_by).filter((id): id is string => !!id),
      ...(order.agent_id ? [order.agent_id] : []),
    ]);

    const events = visibleEvents.map((ev) => {
      const meta = (ev.metadata ?? {}) as Record<string, unknown>;
      const actor = ev.actor_user_id ? contacts.get(ev.actor_user_id) : undefined;
      // `collect_payment` is the one action that does real work without moving
      // the order, so deriving its label from the status would repeat the
      // previous entry verbatim ("Agent on the way" twice in a row). Name what
      // actually happened instead.
      const isCollection = meta.action === "collect_payment";
      // Same reasoning for the two cancellation verbs, which by design leave
      // the status alone: without this the customer's own request, and ops
      // declining it, both render as whatever the order already said.
      const isCancellationRequest = meta.action === "request_cancellation";
      const isCancellationDeclined = meta.action === "reject_cancellation";
      return {
        id: ev.id,
        at: ev.created_at,
        status: ev.status,
        // Same phrase the list and the badge use, so one order never reads as
        // two different things on two screens.
        label: isCollection
          ? "Payment collected"
          : isCancellationRequest
            ? "Cancellation requested"
            : isCancellationDeclined
              ? "Cancellation declined"
              : deriveCustomerStatus({ ...order, status: ev.status as OrderStatus }),
        note: ev.note,
        action: typeof meta.action === "string" ? meta.action : null,
        actorName: actor?.full_name ?? null,
        actorKind: eventActorKind(meta.role, ev.actor_user_id === userId),
        amount: typeof meta.amount === "number" ? meta.amount : null,
      };
    });

    const agentContact = order.agent_id ? contacts.get(order.agent_id) : undefined;
    const agent = agentContact
      ? {
          name: agentContact.full_name,
          phone: AGENT_PHONE_VISIBLE_STATUSES.includes(order.status)
            ? agentContact.phone
            : null,
        }
      : null;

    res.json({
      order,
      customerStatus: deriveCustomerStatus(order),
      agent,
      events,
      payments: (payments ?? []).map((p) => ({
        id: p.id,
        amount: p.amount,
        currency: p.currency,
        method: p.method,
        status: p.status,
        reference: p.reference,
        collectedAt: p.collected_at ?? p.created_at,
        collectedByName: p.collected_by ? contacts.get(p.collected_by)?.full_name ?? null : null,
      })),
      // Lets the page render its actions without knowing the state machine.
      availableActions: availableActions(order, "customer", { userId }),
      /**
       * `kind` is sent even when there is no code, so the page can offer a
       * regenerate instead of silently showing nothing at the one moment the
       * customer is standing at the door being asked for a number.
       */
      handover: handoverKind
        ? {
            kind: handoverKind,
            code: handover?.code ?? null,
            locked: handover?.locked ?? false,
          }
        : null,
      // Surfaced as its own field rather than leaving the page to dig through
      // `order.metadata` — the customer app has no business parsing an escape
      // hatch that also carries gateway ids and failure blobs.
      cancellationRequest: (() => {
        const request = readCancellationRequest(order);
        if (!request) return null;
        const state = cancellationState(order);
        return {
          state,
          requestedAt: request.requested_at,
          reason: request.reason,
          decidedAt: request.decided_at ?? null,
          decisionNote: request.decision_note ?? null,
          // Kept as its own field rather than left to the page to derive from
          // `state`: "are we still waiting?" is the question the banner asks,
          // and one boolean is harder to get wrong than a string comparison.
          pending: state === "pending",
        };
      })(),
      // A failed events read is not fatal — the booking detail is still worth
      // showing — but the page must be able to say so rather than imply the
      // order has no history.
      ...(rawEvents === null ? { warning: "History could not be loaded." } : {}),
    });
  });

  // ── KYC: Upload document ──────────────────────────────────────────────────

  // GET /api/kyc/me — masked summary of stored KYC for the logged-in user
  app.get(
    "/api/kyc/me",
    // No requireUser: a guest mid-booking reads back the document they just
    // uploaded here, the same way an account holder does. resolveKycOwner is
    // what decides whose it is, and a guest is only ever handed their own ref.
    ensureDbUser,
    async (req: Request, res: Response) => {
      const owner = await resolveKycOwner(req);
      if (!owner) {
        res.status(401).json({ message: "Not authenticated" });
        return;
      }

      // Never cache: a fresh upload must be visible on the next read.
      res.set("Cache-Control", "no-store");

      const kyc = owner.userId
        ? await getKycByUserId(owner.userId)
        : await getKycByGuestRef(owner.guestRef!);
      if (!kyc) {
        res.status(404).json({ message: "KYC not on file" });
        return;
      }

      res.json(toKycSummary(kyc));
    }
  );

  // GET /api/kyc/me/file — serve the logged-in user's own KYC document for preview
  app.get(
    "/api/kyc/me/file",
    ensureDbUser,
    async (req: Request, res: Response) => {
      const owner = await resolveKycOwner(req);
      if (!owner) {
        res.status(401).json({ message: "Not authenticated" });
        return;
      }

      try {
        const doc = owner.userId
          ? await getKycFileByUserId(owner.userId)
          : await getKycFileByGuestRef(owner.guestRef!);
        if (!doc) {
          res.status(404).json({ message: "KYC not on file" });
          return;
        }

        const buffer = Buffer.from(doc.file_data, "base64");
        res.set({
          "Content-Type": doc.mime_type,
          "Content-Length": String(buffer.length),
          "Cache-Control": "no-store",
          "Content-Disposition": `inline; filename="${doc.original_filename.replace(/"/g, "")}"`,
        });
        res.send(buffer);
      } catch (err) {
        console.error("[GET /api/kyc/me/file] failed:", err);
        res.status(500).json({ message: "Failed to retrieve document." });
      }
    }
  );

  // POST /api/kyc/upload — upload KYC document; upserts one row per user
  app.post(
    "/api/kyc/upload",
    // No requireUser: a guest booking uses this same endpoint, authorised by a
    // recently verified phone rather than by a session, exactly as the signup
    // document endpoints are. ensureDbUser still resolves the account when
    // there IS one; it is a no-op for a guest.
    ensureDbUser,
    kycUpload.single("file"),
    async (req: Request, res: Response) => {
      // Who owns the document this writes. An account if there is one;
      // otherwise the guest ref this browser staged under, which can only
      // exist if an OTP on that number was verified.
      const kycOwner = await resolveKycOwner(req);
      if (!kycOwner) {
        res.status(401).json({ message: "Not authenticated", code: PHONE_UNVERIFIED });
        return;
      }

      if (!req.file) {
        res.status(400).json({ message: "No file uploaded." });
        return;
      }

      const validDocTypes = [
        "Aadhaar Number",
        "PAN Number",
        "Passport Number",
        "Driving Licence",
        "GSTIN (Normal)",
      ] as const;

      const docNoValidation: Record<string, RegExp> = {
        "Aadhaar Number": /^\d{12}$/,
        "PAN Number": /^[A-Z]{5}[0-9]{4}[A-Z]$/i,
        "Passport Number": /^[A-Z0-9]{7,8}$/i,
        "Driving Licence": /^[A-Z0-9-]{5,20}$/i,
        "GSTIN (Normal)": /^.{15}$/,
      };

      const documentType =
        typeof req.body.document_type === "string"
          ? req.body.document_type.trim()
          : "";
      const documentNo =
        typeof req.body.document_no === "string"
          ? req.body.document_no.trim()
          : "";

      if (!documentType) {
        res.status(400).json({ message: "document_type is required" });
        return;
      }
      if (!documentNo) {
        res.status(400).json({ message: "document_no is required" });
        return;
      }
      if (!validDocTypes.includes(documentType as (typeof validDocTypes)[number])) {
        res.status(400).json({ message: "Invalid document type" });
        return;
      }
      if (!docNoValidation[documentType].test(documentNo)) {
        res.status(400).json({
          message: `Invalid document number for ${documentType}`,
        });
        return;
      }

      const normalizedDocumentNo =
        documentType === "Aadhaar Number"
          ? documentNo
          : documentNo.toUpperCase();

      const ocr = await verifyDocumentOrRefuse(res, {
        cashfreeType: ocrTypeForKycDocumentType(documentType),
        typedNumber: normalizedDocumentNo,
        file: req.file,
        tag: "kyc",
      });
      if (!ocr) return;

      try {
        const existing = kycOwner.userId
          ? await getKycByUserId(kycOwner.userId)
          : await getKycByGuestRef(kycOwner.guestRef!);
        const capabilityId = existing?.capability_id ?? crypto.randomUUID();
        const fileDataBase64 = req.file.buffer.toString("base64");

        const saved = await upsertKycDocument({
          user_id: kycOwner.userId,
          guest_ref: kycOwner.guestRef,
          capability_id: capabilityId,
          document_type: documentType,
          document_no: normalizedDocumentNo,
          original_filename: req.file.originalname,
          mime_type: req.file.mimetype,
          file_size_bytes: req.file.size,
          file_data: fileDataBase64,
          ocr: toOcrColumns(ocr),
        });

        if (!saved) {
          res.status(500).json({ message: "Failed to save KYC document." });
          return;
        }

        // Mirror back into account_documents when this document is also one of
        // the slots the account owes.
        //
        // This endpoint predates the document matrix and writes only
        // kyc_documents. Left alone it would produce a half-verified account:
        // customs has what it needs, but `verificationState` — which reads
        // account_documents — still says outstanding, so the banner stays up
        // and the docket stays held. Two surfaces still post here (the inline
        // upload at booking, and the profile card), and a customer who
        // completes their Aadhaar through either should be finished.
        //
        // Only a `match` is mirrored. An unreadable scan is worth keeping on
        // the KYC row for ops, but writing it into the slot would present it as
        // progress the customer has not actually made.
        // Guests have no account_documents matrix to keep in step — nothing
        // reads verificationState for them, and the booking gate reads the
        // kyc_documents row this just wrote. So the mirror is account-only.
        const mirrorSlot = kycOwner.userId ? ACCOUNT_SLOT_FOR_KYC_TYPE[documentType] : undefined;
        if (mirrorSlot && ocr.status === "match" && kycOwner.userId) {
          const { accountType, category } = await accountShapeFor(kycOwner.userId);
          if (requiredDocuments(accountType, category).includes(mirrorSlot)) {
            await upsertAccountDocument({
              user_id: kycOwner.userId,
              doc_slot: mirrorSlot,
              document_no: normalizedDocumentNo,
              original_filename: req.file.originalname,
              mime_type: req.file.mimetype,
              file_size_bytes: req.file.size,
              file_data: fileDataBase64,
              ocr: toOcrColumns(ocr),
            });
            const state = await getVerificationState(kycOwner.userId, accountType, category);
            void refreshKycVerifiedOnOpenOrders(kycOwner.userId, state.verified);
          }
        }

        res.json({
          capability_id: saved.capability_id,
          ...toKycSummary(saved),
          ocr: { status: ocr.status, message: ocr.message },
        });
      } catch (err) {
        console.error("KYC upload full error:", JSON.stringify(err, Object.getOwnPropertyNames(err as object)));
        res.status(500).json({ message: "Failed to save KYC document." });
      }
    }
  );

  // GET /api/kyc/documents/:id/file — serve KYC document (no auth; ITD must be able to fetch)
  app.get("/api/kyc/documents/:id/file", async (req: Request, res: Response) => {
    try {
      const doc = await getKycByCapabilityId(req.params.id);
      if (!doc) {
        // Logged too: a run of these from one address is somebody guessing.
        logDocumentAccess(req, {
          source: "kyc",
          capabilityId: req.params.id,
          outcome: "not_found",
        });
        res.status(404).json({ message: "Document not found." });
        return;
      }

      logDocumentAccess(req, {
        source: "kyc",
        capabilityId: req.params.id,
        outcome: "served",
        documentId: doc.id,
        userId: doc.user_id,
      });

      const buffer = Buffer.from(doc.file_data, "base64");
      res.set({
        "Content-Type": doc.mime_type,
        "Content-Length": String(buffer.length),
        // Re-uploads reuse the capability_id, so a cached copy would go stale.
        "Cache-Control": "no-store",
        // A leaked URL must not end up in a search index, and a browser must
        // not be talked into treating an identity document as something it can
        // execute. See migrations/add_document_access_log.sql.
        "X-Robots-Tag": "noindex, nofollow, noarchive",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Content-Disposition": `inline; filename="${doc.original_filename}"`,
      });
      res.send(buffer);
    } catch (err) {
      console.error("[GET /api/kyc/documents/:id/file] failed:", err);
      res.status(500).json({ message: "Failed to retrieve document." });
    }
  });

  return httpServer;
}
