import type { Express, NextFunction, Request, Response } from "express";
import {
  countUnreadNotifications,
  findItdUserIdByPhone,
  findOrCreateAddress,
  getAccountShapeById,
  getItdUserProfileById,
  getItdUserTokenAndSecretsById,
  insertLoginAuditLog,
  listAddressesByUserIdAndType,
  listAddressesByGuestRefAndType,
  getShipmentDocument,
  listShipmentDocumentKinds,
  listNotificationsByUserId,
  listNotificationsForOwner,
  listShipmentsByUserId,
  insertNotification,
  markNotificationRead,
  mergeItdUserMetadataById,
  clearItdUserPhoneById,
  itdUserHasStoredPassword,
  updateItdUserPhoneById,
  updateItdUserEmailById,
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
  toOrder,
} from "./ordersDb.js";
import {
  availableActions,
  findTransition,
  isKnownAction,
} from "./orderLifecycle.js";
import {
  notifyAgentsOfNewJob,
  notifyHandoverCodeReissued,
  notifyOrderBooked,
  notifyOrderTransition,
} from "./notify.js";
import {
} from "./agentDb.js";
import {
  getCodeForOwner,
  issueCode,
  type HandoverKind,
} from "./handoverCodes.js";
import { ensureDbUser, requireRole, requireUser } from "./routeGuards.js";
import { registerAgentRoutes } from "./routes/agent.js";
import { registerPaymentRoutes } from "./routes/payments.js";
import { registerGuestProfileRoutes } from "./routes/guestProfile.js";
import { registerSupportRoutes } from "./routes/support.js";
import { seedSignupDocumentFromGuestKyc } from "./guestKycMirror.js";
import { mirrorAadhaarToKyc } from "./kycMirror.js";
import { getLatestGuestRefForPhone, upsertGuestProfile } from "./guestProfileDb.js";
import { itdLinkFailure } from "./itdLinkError.js";
import { applicationToFix, assertFixedSlotsReplaced, FIX_NOT_OPEN_MESSAGE, mergeFixBody } from "./applicationFix.js";
import { registerWhatsappRoutes } from "./routes/whatsapp.js";
import { registerWhatsappScheduleRoutes } from "./routes/whatsappSchedule.js";
import { registerOpsRoutes } from "./routes/ops.js";
import { registerBiaRoutes } from "./routes/bia.js";
import { registerAccountApplicationRoutes } from "./routes/accountApplications.js";
import { isAccountReviewEnabled } from "./accountApplications.js";
import { getLatestApplicationByPhone, toCustomerView } from "./accountApplicationsDb.js";
import {
  handleGenerateDocket,
  handleMarkDispatched,
  handleSettle,
  handleWeigh,
  itdRateAtWeight,
  itdRatesLoginFor,
} from "./opsActions.js";
import { isIndiaHubId } from "../shared/hubs.js";
import {
  cancellationState,
  deriveCustomerStatus,
  isInternalOnlyStatus,
  isRole,
  readCancellationRequest,
} from "../shared/orderContract.js";
import type { Order, OrderStatus, Role } from "../shared/orderContract.js";
import { earliestPickupDate, todayInIst } from "../shared/istTime.js";
import { sendDocumentFile } from "./documentResponse.js";
import { OWNER_PROFILES, ownerFrom } from "./sessionOwner.js";
import { requireCronSecret } from "./cronAuth.js";
import {
  handleCancel,
  handleClaim,
  handleCollectPayment,
  handleHandover,
  handleOverrideHandover,
  handleRejectCancellation,
  handleRequestCancellation,
  handleStartPickup,
  type AgentActionResult,
} from "./orderActions.js";
import {
  claimDocumentsForUser,
  claimGuestBookingsForUser,
  contractColumns,
  respondWithApplication,
} from "./signupClaim.js";
import {
  assertDocumentsStaged,
  resolveKycOwner,
} from "./kycPolicy.js";
import {
  IDENTITY_KIND_BY_SLOT,
  IDENTITY_KIND_FOR_KYC_TYPE,
  normalizeDocumentNo,
  recordIdentity,
  recordedIdentityNumbers,
  sendIdentityFailure,
  verifyDocumentOrRefuse,
} from "./identityChecks.js";
import {
  PHONE_UNVERIFIED,
  assertPhoneVerified,
  isPhoneVerifiedHere,
  markPhoneVerified,
  signupRefForPhone,
  signupRefForReading,
} from "./signupRef.js";
import { INDIAN_MOBILE_MESSAGE, INDIAN_MOBILE_PATTERN } from "../shared/contact.js";
import { MAX_UPLOAD_BYTES, UPLOAD_TYPE_MESSAGE, isAllowedUploadType } from "../shared/upload.js";
import {
  formatCutoffHour,
  formatPickupCities,
  getPickupServiceability,
  pickupCities,
  pickupCutoffHour,
  type PickupArea,
} from "../shared/pickupPincodes.js";
import { getCoverage } from "./pickupCoverageDb.js";
import {
  generateOtp,
  hashOtp,
  deliverOtp,
  OTP_TTL_MINUTES,
  OTP_MAX_REQUESTS_PER_HOUR,
} from "./otp.js";
import type { OtpPurpose } from "./otpDb.js";
import {
  countRecentRequests,
  insertOtpCode,
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
import crypto from "crypto";
import multer from "multer";
import { z } from "zod";
import { itdClient } from "./itd.js";
import type { CreateShipmentPayload, RateParams } from "./itd.js";
import { persistShipmentAfterCreate } from "./persistShipment.js";
import { docketAtBooking } from "./docketAtBooking.js";
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
  isOcrBypassed,
  ocrTypeForDocSlot,
  ACCOUNT_SLOT_FOR_KYC_TYPE,
  ocrTypeForKycDocumentType,
  type OcrResult,
} from "./cashfreeOcr.js";
import {
  isIdentityBypassed,
  isValidAadhaarNumber,
  isValidPanNumber,
  verifyGstin,
} from "./cashfreeIdentity.js";
import { checkGstCertificate } from "./gstCertificate.js";
import { signContractPdf } from "./contractPdf.js";
import { sweepAbandonedSignups, ABANDONED_SIGNUP_RETENTION_DAYS } from "./retention.js";
import { logDocumentAccess } from "./documentAccessLog.js";
import {
  deleteIdentityVerificationsBySignupRef,
  listIdentityVerificationsBySignupRef,
  upsertIdentityVerification,
} from "./identityDb.js";
import {
  toOcrColumns,
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
  EXTRA_FIELD_SPECS,
  IDENTITY_CHECK_LABELS,
  isDocSlot,
  isVerifiedDocSlot,
  VERIFIED_DOC_SLOTS,
  requiredDocuments,
  requiredExtraFields,
  requiredIdentityChecks,
  type CompanyCategory,
  type ExtraField,
} from "../shared/accountSpec.js";
import { validateGstin } from "../shared/gstin.js";
import { isErrorCode, ocrErrorCode } from "../shared/errorCatalog.js";

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
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    if (isAllowedUploadType(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(UPLOAD_TYPE_MESSAGE));
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
  registerGuestProfileRoutes(app);

  // WhatsApp delivery receipts, and the STOP word. Unauthenticated by design
  // too — the secret in the path is what the provider was given.
  registerWhatsappRoutes(app);

  // The agent digest and slot reminders, driven by an external scheduler.
  registerWhatsappScheduleRoutes(app);

  // Ops console: board + detail reads, the transactions ledger, and staff
  // users. Admin/super_admin gated inside the module; writes go through the
  // uniform action endpoint below.
  registerOpsRoutes(app);
  // BIA's nudges: the daily sweep and each customer's switches (BIA 3.0, 5.1).
  registerBiaRoutes(app);
  // Account review: the customer's application status and the ops queue.
  registerAccountApplicationRoutes(app);

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
  const phoneSchema = z.string().trim().regex(INDIAN_MOBILE_PATTERN, INDIAN_MOBILE_MESSAGE);

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
      res.status(429).json({ message: "Too many OTP requests. Please try again later.", code: "OTP_RATE_LIMITED" });
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
      res.status(502).json({ message: "Could not send OTP. Please try again.", code: "OTP_SEND_FAILED" });
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
      res.status(result.status).json({ message: result.message, code: result.code });
      return;
    }
    if (purpose === "auth") markPhoneVerified(req, phone);
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

  // The staging ref, the phone that proved it, and the OTP freshness rule
  // now live in server/signupRef.ts.
  // Document-number validation, the OCR verdict policy and identity
  // recording now live in server/identityChecks.ts.
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
    // `req` so a guest can read the contract they are being asked to sign.
    // Theirs sits at the end of the sender step, which a customer measuring a
    // parcel can easily reach more than ten minutes after the OTP — and being
    // refused sight of a contract you are about to sign is the wrong failure.
    // The session ref proves the same number; nothing here is written.
    const phone = await assertPhoneVerified(req.body?.phone, res, req, { allowSessionGuest: true });
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
    const phone = await assertPhoneVerified(req.body?.phone, res, req);
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
    const phone = await assertPhoneVerified(req.body?.phone, res, req);
    if (!phone) return;

    const aadhaar =
      typeof req.body?.aadhaar_number === "string"
        ? req.body.aadhaar_number.replace(/\s/g, "")
        : "";
    // TEMPORARY: with OCR_BYPASS=1 (no document checks until Cashfree production
    // credentials are in) only the 12 digits are required; the 0/1 prefix and
    // Verhoeff rules come back when the flag goes. See shared/aadhaar.ts.
    if (!isValidAadhaarNumber(aadhaar, { checkDigits: !isOcrBypassed() })) {
      res.status(400).json({ message: "Enter a valid 12-digit Aadhaar number", code: "AADHAAR_INVALID" });
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
    const phone = await assertPhoneVerified(req.body?.phone, res, req);
    if (!phone) return;

    const pan = typeof req.body?.pan === "string" ? req.body.pan.trim().toUpperCase() : "";
    if (!isValidPanNumber(pan)) {
      res.status(400).json({ message: "Enter a valid 10-character PAN", code: "PAN_INVALID" });
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
    // `req` is passed so a guest completing their profile can verify a GSTIN
    // without a fresh SMS. Everything below is unchanged: shape and checksum
    // first, then the registry, then the name match.
    const phone = await assertPhoneVerified(req.body?.phone, res, req, { allowSessionGuest: true });
    if (!phone) return;

    const gstin = typeof req.body?.gstin === "string" ? req.body.gstin.trim().toUpperCase() : "";
    // Shape and mod-36 checksum first, so a typo never costs a billed lookup.
    const shapeCheck = validateGstin(gstin);
    if (!shapeCheck.valid) {
      res.status(400).json({
        message: shapeCheck.message ?? "Enter a valid 15-character GST number",
        code: "GSTIN_INVALID",
      });
      return;
    }

    // The company's own name. Stored as name_submitted and re-checked when the
    // account is written, so verifying under one name and registering under
    // another does not get through.
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!name) {
      res.status(400).json({ message: "Enter the company name this account is for", code: "COMPANY_NAME_REQUIRED" });
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

    // A guest verified this from their own profile, so the number belongs on
    // it. Signup keeps reading identity_verifications as it always has; this
    // is the copy the profile screen renders, and it is only ever written
    // after the registry agreed.
    if (req.session.guestRef && req.session.guestPhone === phone) {
      void upsertGuestProfile({
        guest_ref: req.session.guestRef,
        phone,
        gstin: result.gstin,
        gstin_verified_name: result.legalName ?? null,
      }).catch((err) => console.error("[signup/identity] guest profile gstin write failed:", err));
    }

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
        code: "IDENTITY_MISSING",
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
          code: "IDENTITY_NAME_MISMATCH",
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
      res.status(422).json({
        message: check.message,
        code: ocrErrorCode(check.status) ?? undefined,
        ocr: { status: check.status },
      });
      return null;
    }
    return check;
  }

  // POST /api/signup/documents — stage one document of an in-flight signup
  app.post(
    "/api/signup/documents",
    kycUpload.single("file"),
    async (req: Request, res: Response) => {
      const phone = await assertPhoneVerified(req.body?.phone, res, req);
      if (!phone) return;

      if (!req.file) {
        res.status(400).json({ message: "No file uploaded.", code: "FILE_MISSING" });
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
            code: "IDENTITY_NUMBER_FIRST",
            unverified_identity: [IDENTITY_KIND_BY_SLOT[slot]],
          });
          return;
        }
        documentNo = proved;
      } else {
        const parsed = normalizeDocumentNo(slot, req.body?.document_no);
        if (!parsed.ok) {
          res.status(400).json({ message: parsed.message, code: "DOCUMENT_NUMBER_INVALID" });
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
            // With account review on, the Bombino team checks every document by
            // hand, so one Cashfree couldn't read still lets signup go on.
            staff_review: isAccountReviewEnabled(),
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
  app.post("/api/admin/retention/sweep", requireCronSecret, async (req: Request, res: Response) => {

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
    // A guest fixing a sent-back application reads that application's files
    // (applicationToFix points the session at its ref).
    const signupRef =
      signupRefForReading(req, phone) ??
      ((await applicationToFix(req, phone)) ? req.session.signupRef ?? null : null);
    if (!signupRef) {
      res.set("Cache-Control", "no-store");
      res.json({ documents: [] });
      return;
    }
    // A guest arriving at signup has already given us an identity document to
    // book with. Filling the slot it answers here means the documents step
    // opens with it in place rather than asking for the same file twice; a
    // slot they have staged themselves is left alone.
    await seedSignupDocumentFromGuestKyc(signupRef);

    const rows = await listDocumentsBySignupRef(signupRef);
    res.set("Cache-Control", "no-store");
    res.json({
      // See POST: with account review on, a document Cashfree couldn't read is
      // left to the Bombino team rather than holding signup up.
      staff_review: isAccountReviewEnabled(),
      // TEMPORARY: false while OCR_BYPASS=1, so the form asks only for 12 digits
      // (shared/aadhaar.ts §validateAadhaar), matching the server.
      aadhaar_check_digits: !isOcrBypassed(),
      // TEMPORARY: false while IDENTITY_BYPASS=gstin. With no portal lookup to
      // run, the form saves the GST number by itself instead of asking for a
      // "Verify" click, and the certificate uploads straight away.
      gstin_lookup: !isIdentityBypassed("gstin"),
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
        // because account creation will refuse it (unless staff_review).
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
  // Document ownership and the "has this account produced what it owes"
  // gate now live in server/kycPolicy.ts.

  // The booking-time docket now lives in server/docketAtBooking.ts,
  // beside the flag that turns it on.


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

  // Filing an application, and re-parenting what a signup staged, now live
  // in server/signupClaim.ts.

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
      sendDocumentFile(res, doc);
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
        // TEMPORARY: see GET /api/signup/documents.
        aadhaar_check_digits: !isOcrBypassed(),
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
        res.status(400).json({ message: "No file uploaded.", code: "FILE_MISSING" });
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
        res.status(400).json({ message: docNo.message, code: "DOCUMENT_NUMBER_INVALID" });
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
            code: "GSTIN_NOT_ON_FILE",
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
    // `fix: true` resends an application the team sent back, changing only
    // what they asked about (server/applicationFix.ts).
    const fixing = req.body?.fix === true ? await applicationToFix(req, req.body?.phone) : null;
    if (req.body?.fix === true && (!fixing || fixing.account_type !== "personal")) {
      res.status(409).json({ message: FIX_NOT_OPEN_MESSAGE, code: "APPLICATION_NOT_AWAITING_CHANGES" });
      return;
    }
    const parsed = signupPersonalSchema.safeParse(fixing ? mergeFixBody(fixing, req.body) : req.body);
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
      res.status(409).json({
        message: "This phone number is already registered. Please sign in instead.",
        code: "ACCOUNT_EXISTS",
      });
      return;
    }

    // "auth" — the unified entry point issues one code before it knows whether
    // the number ends in a sign-in, a link, or this. See otpPurposeSchema.
    // A fix is proved by the guest session instead (applicationToFix above).
    const verified = fixing !== null || (await isPhoneVerifiedHere(req, phone));
    if (!verified) {
      res.status(400).json({
        message: "Your phone verification has expired. Please request a new code.",
        code: PHONE_UNVERIFIED,
      });
      return;
    }
    if (fixing && !(await assertFixedSlotsReplaced(fixing, res))) return;

    // Aadhaar and PAN both, before the account exists — the numbers are a
    // precondition of opening it, and so is the document set. In that order,
    // though neither number is checked with an authority any more: recording
    // them first is what makes the OCR match that follows mean anything, by
    // fixing the value the card has to carry before the card arrives.
    if (!(await assertIdentityVerified(req, res, "personal", null, full_name))) return;

    const staged = await assertDocumentsStaged(req, res, "personal", null, phone);
    if (!staged) return;

    // Account review: everything above has passed, so file it for the Bombino
    // team instead of opening the account here. See server/accountApplications.ts.
    if (isAccountReviewEnabled()) {
      await respondWithApplication(req, res, {
        phone,
        accountType: "personal",
        category: null,
        details: { full_name, email },
        contract_signed_name,
        keepContractOf: fixing,
      });
      return;
    }

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
    // ITD registration needs the registered address and the servicing hub;
    // add_customer rejects a company without them.
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
    // `fix: true`: see /api/auth/signup/personal.
    const fixing = req.body?.fix === true ? await applicationToFix(req, req.body?.phone) : null;
    if (req.body?.fix === true && (!fixing || fixing.account_type !== "company")) {
      res.status(409).json({ message: FIX_NOT_OPEN_MESSAGE, code: "APPLICATION_NOT_AWAITING_CHANGES" });
      return;
    }
    const parsed = signupCompanySchema.safeParse(fixing ? mergeFixBody(fixing, req.body) : req.body);
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
      address,
      pincode,
      city,
      state,
      hub_id,
      contract_signed_name,
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
      res.status(400).json({ message: extras.message, code: "EXTRA_FIELD_INVALID" });
      return;
    }

    const existing = await findItdUserIdByPhone(phone);
    if (existing) {
      res.status(409).json({
        message: "This phone number is already registered. Please sign in instead.",
        code: "ACCOUNT_EXISTS",
      });
      return;
    }

    const verified = fixing !== null || (await isPhoneVerifiedHere(req, phone));
    if (!verified) {
      res.status(400).json({
        message: "Your phone verification has expired. Please request a new code.",
        code: PHONE_UNVERIFIED,
      });
      return;
    }
    if (fixing && !(await assertFixedSlotsReplaced(fixing, res))) return;

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
        code: "GSTIN_CHANGED",
        unverified_identity: ["gstin"],
      });
      return;
    }

    const staged = await assertDocumentsStaged(req, res, "company", company_category, phone);
    if (!staged) return;

    // Account review: file it instead. No ITD add_customer either — the team
    // creates the customer in ITD by hand, and calling it here as well would
    // register the company twice.
    if (isAccountReviewEnabled()) {
      await respondWithApplication(req, res, {
        phone,
        accountType: "company",
        category: company_category,
        details: {
          email,
          company_name,
          gstin,
          contact_person,
          address,
          pincode,
          city,
          state,
          hub_id,
          ...extras.values,
        },
        contract_signed_name,
        keepContractOf: fixing,
      });
      return;
    }

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
      res.status(otp.status).json({ message: otp.message, code: otp.code });
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

    // Spend it now, and stamp THIS session with the proof. That is what
    // authorises the document upload and the booking that follow, for the
    // next few minutes and from this browser only.
    const spent = await consumeOtp(phone, "auth", code);
    if (!spent.ok) {
      res.status(spent.status).json({ message: spent.message, code: spent.code });
      return;
    }
    markPhoneVerified(req, phone);

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

    // Give a returning guest their own records back — as their identity AND as
    // the ref this booking stages under.
    //
    // signupRefForPhone has just minted a fresh ref for this browser. That is
    // right for a guest we have never met and wrong for one we have: their
    // profile, their identity document and their orders all sit in Postgres
    // under the ref an earlier session happened to hold, and a fresh one
    // reaches none of it.
    //
    // Both fields are set, and that is the point. `guestRef` alone made
    // /api/guest/profile recognise them while POST /api/orders — which files
    // under `signupRef` and checks KYC under it — still saw a stranger, so a
    // returning guest was refused with "add your identity document" for a
    // document already on file. One ref, or the two halves disagree.
    //
    // Overwriting the ref just minted orphans nothing: minting writes no rows,
    // it only puts a uuid in the session. Discarding what an EARLIER phone
    // staged has already happened inside signupRefForPhone above, which is why
    // that call stays.
    //
    // Authorised by the OTP just proved on this exact number — the only thing
    // that identifies a guest at all.
    const existingRef = await getLatestGuestRefForPhone(phone);
    if (existingRef) {
      req.session.signupRef = existingRef;
      req.session.signupPhone = phone;
      req.session.guestRef = existingRef;
      req.session.guestPhone = phone;
    } else {
      // Nothing to adopt: a number we have never seen. The freshly minted
      // signupRef stands, and anything the last guest on this browser left is
      // cleared so a shared device does not answer this number with someone
      // else's orders.
      delete req.session.guestRef;
      delete req.session.guestPhone;
    }

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
      res.status(otp.status).json({ message: otp.message, code: otp.code });
      return;
    }
    markPhoneVerified(req, phone);

    const existing = await findItdUserIdByPhone(phone);
    if (!existing) {
      // No account — but not necessarily a stranger.
      //
      // A number that has booked as a guest already has a profile, an identity
      // document and orders filed against one `guest_ref`. Answering it with
      // "do you have an account?" asks somebody we recognise to introduce
      // themselves, so their number signs them straight back into being that
      // guest instead.
      //
      // Adopting the ref here is the same move /api/guest/phone/verify makes,
      // and for the same reason: `signupRef` is what booking and the document
      // endpoints resolve, `guestRef` is what the profile reads, and they have
      // to be the one uuid or the two halves disagree.
      const guestRef = await getLatestGuestRefForPhone(phone);
      if (guestRef) {
        req.session.signupRef = guestRef;
        req.session.signupPhone = phone;
        req.session.guestRef = guestRef;
        req.session.guestPhone = phone;

        // An applicant waiting on the Bombino team signs in as exactly this: a
        // guest. Their application rides along so the app can say where it is.
        const application = isAccountReviewEnabled() ? await getLatestApplicationByPhone(phone) : null;
        req.session.save((err) => {
          if (err) console.error("[phone/continue] guest session save error:", err);
          res.json({
            status: "guest" as const,
            application: application ? toCustomerView(application) : null,
          });
        });
        return;
      }

      // Genuinely new. The choice screen stays for these: it is the only route
      // to "I already have a Bombino account" (/api/auth/link/itd), which a
      // customer whose ITD account predates phone sign-in still needs.
      //
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

    // A guest booking that landed while the Bombino team was approving this
    // account was filed under the guest ref after approval had already moved
    // the rest. Claiming again is idempotent and finds nothing in the ordinary
    // case: a number with an account cannot book as a guest.
    void claimGuestOrdersForUser(phone, existing.id).catch((err) =>
      console.error("[phone/continue] late guest-order claim failed:", err)
    );

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

    const verified = await isPhoneVerifiedHere(req, phone);
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
      // ITD's wording goes to the log; the customer gets one of two plain
      // answers (server/itdLinkError.ts).
      const raw = err instanceof Error ? err.message : String(err);
      const failure = itdLinkFailure(raw);
      console.warn(`[link/itd] ITD login failed (${failure.code}): ${raw}`);
      res.status(failure.status).json({ message: failure.message, code: failure.code });
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
          code: "PHONE_LINKED_ELSEWHERE",
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
      /**
       * Both fields optional, at least one required.
       *
       * `email` is genuinely optional data, not merely an optional field: staff
       * accounts are created without one, and an agent adding theirs so the
       * office can reach them must equally be able to take it off again. An
       * empty string is therefore a valid value meaning "clear it", which is why
       * this is not `.email()` alone.
       */
      const parsed = z
        .object({
          username: usernameSchema.optional(),
          email: z.union([z.literal(""), z.string().trim().email("Enter a valid email")]).optional(),
        })
        .refine((body) => body.username !== undefined || body.email !== undefined, {
          message: "Nothing to change",
        })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid request" });
        return;
      }
      const { username, email } = parsed.data;

      if (!req.session.dbUserId) {
        res.status(404).json({ message: "Profile not found" });
        return;
      }

      if (username !== undefined) {
        const ok = await updateItdUserUsernameById(req.session.dbUserId, username);
        if (!ok) {
          res.status(502).json({ message: "Could not save your username. Please try again." });
          return;
        }
      }

      if (email !== undefined) {
        const ok = await updateItdUserEmailById(req.session.dbUserId, email);
        if (!ok) {
          res.status(502).json({ message: "Could not save your email. Please try again." });
          return;
        }
      }

      // Keep the session copy in step, or /api/auth/me and anything reading
      // req.session.user would serve the old value until the next sign-in.
      if (req.session.user) {
        req.session.user = {
          ...req.session.user,
          ...(username !== undefined ? { username } : {}),
          ...(email !== undefined ? { email } : {}),
        };
      }
      req.session.save((err) => {
        if (err) {
          console.error("[PATCH /api/user/profile] session save error:", err);
        }
        res.json({ username, email });
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

      const verified = await isPhoneVerifiedHere(req, phone);
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

      // The server runs UTC and every customer is in India: a booking made
      // after 18:30 IST would otherwise export under the previous day.
      const istDate = (value: string | null | undefined): string =>
        value ? new Date(value).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }) : "";

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
            escape(istDate(r.booking_date) || istDate(r.created_at)),
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
            escape(istDate(r.created_at)),
          ].join(",")
        ),
      ];

      const csv = csvRows.join("\n");
      const filename = `bombino-shipments-${todayInIst()}.csv`;

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", 'attachment; filename="' + filename + '"');
      return res.send(csv);
    }
  );

  app.get(
    "/api/addresses",
    // Guests too. Their pickup addresses are real rows keyed on `guest_ref`
    // (migrations/add_guest_orders.sql) written by findOrCreateAddress at
    // booking — until now nothing read them back, so a returning guest retyped
    // an address we already had. Ownership is the session's ref, never a value
    // from the request.
    //
    // NO auth guard, deliberately. This is a list, and a caller we cannot
    // identify has an honest answer: nothing saved. A 401 here was worse than
    // useless — the client's session interceptor reads one as an expired
    // session, so a guest verifying a number that had never booked (signupRef
    // set, guestRef not yet) was signed out and dropped on /login the moment
    // the booking form asked for their saved addresses.
    ensureDbUser,
    async (req: Request, res: Response) => {
      const parseType = z.enum(["sender", "recipient"]).safeParse(req.query.type);
      if (!parseType.success) {
        return res.status(400).json({ message: "type must be sender or recipient" });
      }

      if (req.session.dbUserId) {
        const rows = await listAddressesByUserIdAndType(req.session.dbUserId, parseType.data);
        return res.json(rows ?? []);
      }

      // `signupRef` as well as `guestRef`: the two are the same uuid, and a
      // guest carries only the first until their first booking promotes it.
      const guestRef =
        req.session.guestRef ??
        (req.session.signupRef && req.session.signupPhone ? req.session.signupRef : null);

      if (guestRef) {
        const rows = await listAddressesByGuestRefAndType(guestRef, parseType.data);
        return res.json(rows ?? []);
      }

      // Nobody identified, or identified with nothing saved. Same answer.
      return res.json([]);
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

  /**
   * A guest's own bell, answered ahead of `requireUser`.
   *
   * Only for a session with no account on it; an account session falls through
   * to the account handlers exactly as before, so its 401 still means expiry.
   * The ref is the session's own — minted only after an OTP on the number, the
   * same trust /api/guest/profile answers from — never one named in the request.
   */
  function sessionGuestRef(req: Request): string | null {
    return ownerFrom(req, OWNER_PROFILES.guestNotifications)?.guestRef ?? null;
  }

  app.get(
    "/api/notifications",
    async (req: Request, res: Response, next: NextFunction) => {
      const guestRef = sessionGuestRef(req);
      if (!guestRef) return next();
      const rows = await listNotificationsForOwner({ guestRef });
      return res.json(rows ?? []);
    },
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
    async (req: Request, res: Response, next: NextFunction) => {
      const guestRef = sessionGuestRef(req);
      if (!guestRef) return next();
      const rows = await markNotificationRead(req.params.id, { guestRef });
      if (rows === null) return res.status(500).json({ message: "Database error" });
      if (rows.length === 0) return res.status(404).json({ message: "Not found" });
      return res.json({ ok: true });
    },
    requireUser,
    ensureDbUser,
    async (req: Request, res: Response) => {
      if (!req.session.dbUserId) {
        return res.status(404).json({ message: "Not found" });
      }
      const rows = await markNotificationRead(req.params.id, { userId: req.session.dbUserId });
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

  // ── Pickup coverage (which pincodes we collect from, and by when) ────────

  /**
   * The whole coverage map, in one response.
   *
   * Deliberately not a per-pincode query. The booking form asks this question
   * on every keystroke of the sender's pincode, and a round trip per keystroke
   * would be both slow and wrong — the answer has to be there before the
   * customer finishes typing, not a moment after. ~700 entries is small enough
   * to hand over whole and cache.
   *
   * No auth: guests book, and this is public information — where the company
   * collects from and by what time. Nothing here names a rider.
   *
   * `source` says whether these are the beats ops last edited or the table
   * compiled into the build. It is the one thing that makes a stale-coverage
   * incident diagnosable from a browser, so it ships in the payload rather than
   * only in a log line.
   */
  app.get("/api/pickup/coverage", async (_req: Request, res: Response) => {
    const { areas, source } = await getCoverage();

    const payload: Record<string, PickupArea> = {};
    areas.forEach((area, pincode) => {
      payload[pincode] = area;
    });

    // Five minutes, matching the server's own cache. An ops edit is visible to
    // a customer who reloads within that; one already mid-booking keeps the map
    // they started with, which is the same guarantee POST /api/orders re-checks.
    res.set("Cache-Control", "public, max-age=300");
    res.json({ areas: payload, cities: pickupCities(areas), source });
  });

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
  // Lives in routes/support.ts. Registered here, where the block used to be,
  // so the order routes are matched in is unchanged.
  registerSupportRoutes(app);

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
        code: "KYC_REQUIRED",
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
      // Positive, and a sane parcel. The amount is only the browser's claim —
      // the server asks ITD for the real price below and books at that.
      booked_weight: z
        .number()
        .positive("Weight must be greater than zero")
        .max(1000, "Weight looks wrong — check the unit")
        .optional()
        .nullable(),
      quoted_amount: z.number().positive("Amount must be greater than zero").optional().nullable(),
      /**
       * The shipping contract, signed on the sender step of a guest booking.
       *
       * Optional in the schema and required below for guests only: an account
       * signed it once at signup and its acceptance lives on itd_users, so
       * asking again per shipment would be asking twice for the same thing.
       */
      contract_accepted: z.boolean().optional(),
      contract_signed_name: z.string().trim().max(120).optional(),
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
      params: { code: "PICKUP_DATE_REQUIRED" },
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
      {
        message: "Pay at drop-off is only available when you drop the parcel off yourself",
        params: { code: "PAY_AT_DROPOFF_NEEDS_DROPOFF" },
      }
    )
    .refine(
      (body) => !(body.pickup_request === 2 && body.payment_method === "pay_at_pickup"),
      {
        message: "Pay at pickup is only available when an agent collects the parcel",
        params: { code: "PAY_AT_PICKUP_NEEDS_PICKUP" },
      }
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
      // A refinement names its catalogued code in `params`; the message is
      // still the one the form has always shown.
      const issue = parsed.error.issues[0];
      const code = issue?.code === "custom" ? issue.params?.code : undefined;
      res.status(400).json({
        message: issue?.message ?? "Invalid order payload",
        code: isErrorCode(code) ? code : undefined,
      });
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

    // A guest has never signed the contract — there was no account creation to
    // sign it at — so the shipment cannot move without it. Checked here as
    // well as on the form: the form is a convenience, this is the record.
    if (bookingAsGuest) {
      const signedName = (body.contract_signed_name ?? "").trim();
      if (body.contract_accepted !== true || signedName.length < 2) {
        res.status(422).json({
          message: "Please accept the shipping terms and sign with your full name.",
          code: "CONTRACT_REQUIRED",
        });
        return;
      }
    }

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
          (await isPhoneVerifiedHere(req, guestPhone)));

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
      // Beats as ops last edited them, or the compiled-in table if the database
      // cannot be reached — never a refusal on the strength of a failed query.
      const { areas } = await getCoverage();

      const coverage = getPickupServiceability(body.origin_address.pincode, areas);
      if (!coverage.serviceable) {
        res.status(409).json({
          message:
            `We can't pick up from ${body.origin_address.pincode || "that pincode"} just yet. ` +
            `Doorstep pickup is available in ${formatPickupCities(areas)} — ` +
            `choose drop-off and you can hand your parcel in at our hub.`,
          code: "PICKUP_PINCODE_NOT_SERVICEABLE",
        });
        return;
      }

      // Each beat keeps its own hours, so the boundary is the one that applies
      // where the parcel actually is, not a company-wide constant.
      if (body.pickup_date) {
        const cutoff = pickupCutoffHour(body.origin_address.pincode, areas);
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
      res.status(502).json({ message: "Could not save pickup address", code: "ORDER_CREATE_FAILED" });
      return;
    }

    const isPickup = body.pickup_request === 1;
    const status = isPickup ? "pickup_requested" : "awaiting_dropoff";

    // The price is ours to set, not the browser's. Ask ITD for the selected
    // service at the booked weight — the same lookup the hub reprices with —
    // and book at that. When ITD can't answer, the browser's amount is kept
    // but marked unverified: it can't be charged online, and the hub won't
    // scale it into a final price (server/opsActions.ts).
    const itdQuote = body.booked_weight
      ? await itdRateAtWeight(
          {
            items: body.items,
            consignee: body.consignee,
            origin: { city: body.origin_address.city, pincode: body.origin_address.pincode ?? null },
            login: await itdRatesLoginFor(req.session.dbUserId ?? null),
          },
          body.booked_weight
        )
      : null;
    const quotedAmount = itdQuote ? itdQuote.total : (body.quoted_amount ?? null);
    if (itdQuote && body.quoted_amount != null && Math.abs(itdQuote.total - body.quoted_amount) > 1) {
      console.warn("[orders] booking quote differs from ITD — booking at ITD's price", {
        client: body.quoted_amount,
        itd: itdQuote.total,
      });
    }

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
      quoted_amount: quotedAmount,
      packaging_required: body.packaging_required ?? false,
      payment_method: body.payment_method,
      is_cod: body.payment_method === "cod",
      metadata: {
        kyc_verified: bookingKyc.verified,
        quote_verified: !!itdQuote,
        ...(itdQuote && body.quoted_amount != null && itdQuote.total !== body.quoted_amount
          ? { client_quoted_amount: body.quoted_amount }
          : {}),
        // The guest's acceptance, kept with the shipment it authorised. An
        // account's lives on itd_users; a guest has no row of their own to
        // carry it, and the order is the thing the terms are about.
        ...(bookingAsGuest
          ? {
              contract: {
                signed_name: (body.contract_signed_name ?? "").trim(),
                version: CONTRACT_VERSION,
                accepted_at: new Date().toISOString(),
                // Evidence alongside the timestamp, not proof on its own —
                // behind a proxy it is only as good as `trust proxy`.
                accepted_ip: req.ip ?? null,
              },
            }
          : {}),
      },
    });

    if (!order) {
      res.status(502).json({ message: "Order creation failed", code: "ORDER_CREATE_FAILED" });
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

      // Open the guest's profile row from what the booking already declared,
      // rather than waiting for them to volunteer it later. This is what the
      // profile screen reads, and a guest who never touches it should still
      // find their own name and orders there on their next visit.
      //
      // Best-effort: the order is placed and paid for either way, and a failed
      // bookkeeping write must not turn a successful booking into a 500.
      //
      // A blank field is left out rather than written as null: upsert skips
      // undefined columns, so a booking without a sender email cannot wipe the
      // one the profile or an account application already saved.
      void upsertGuestProfile({
        guest_ref: guestRef,
        phone: guestPhone!,
        full_name: body.origin_address.full_name || undefined,
        email: body.origin_address.email || undefined,
      }).catch((err) => console.error("[orders] guest profile upsert failed:", err));
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

    // The airway bill, for the accounts that can have one now.
    //
    // Awaited, unlike the two messages above: the AWB is part of what the
    // customer is being told about this booking, and a success screen that
    // showed the order number and then quietly grew an AWB a second later
    // would be worse than waiting. Bounded by its own 15s timeout, and it
    // cannot fail the booking — the order row is already committed, and a
    // refusal comes back as `docket.status === "failed"` alongside it.
    const docket = await docketAtBooking(req, bookedOrder);

    res.json({
      order: docket.status === "issued" ? { ...order, awb_no: docket.awb_no } : order,
      docket,
    });
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

  // The three handovers and whose code each checks now live beside the
  // handler that uses them, in server/orderActions.ts.

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

      /**
       * What the arm did. One object rather than four `let`s, because every arm
       * now writes it from inside `applyResult` — and TypeScript cannot follow
       * an assignment made in a closure, so plain locals would narrow to
       * `never` by the time they are read below.
       */
      const outcome: {
        order: Order | null;
        note: string;
        meta: Record<string, unknown>;
        receipt: { txnId: string | null; amount: number } | null;
      } = { order: null, note: "", meta: {}, receipt: null };

      /**
       * A handler's answer, onto the response. Every arm returns
       * `{ order, eventNote, eventMeta }` or `{ error }` and never touches
       * `res` itself; this is the one place that knows how either becomes HTTP.
       * Returns false when it has already answered.
       */
      const applyResult = (r: AgentActionResult): boolean => {
        if ("error" in r) {
          res.status(r.error.status).json({
            message: r.error.message,
            code: r.error.code,
            ...(r.error.extra ?? {}),
            availableActions: availableActions(order, role, { userId: callerId }),
          });
          return false;
        }
        outcome.order = r.order;
        outcome.note = r.eventNote;
        outcome.meta = r.eventMeta;
        if ("receipt" in r) outcome.receipt = r.receipt;
        return true;
      };

      switch (action) {
        case "claim": {
          if (!applyResult(await handleClaim({ order, callerId }))) return;
          break;
        }

        case "start_pickup": {
          if (!transition.to) {
            res.status(500).json({ message: "Malformed transition", code: "BAD_TRANSITION" });
            return;
          }
          const result = await handleStartPickup({
            order,
            callerId,
            expectedFrom: transition.from,
            to: transition.to,
          });
          if (!applyResult(result)) return;
          break;
        }

        // ── OTP-gated handovers ───────────────────────────────────────────
        // Three steps, one shape, and they live in server/orderActions.ts.
        case "mark_picked_up":
        case "mark_received_at_hub":
        case "mark_received_dropoff": {
          if (!transition.to) {
            res.status(500).json({ message: "Malformed transition", code: "BAD_TRANSITION" });
            return;
          }
          const result = await handleHandover({
            order,
            callerId,
            role,
            action,
            expectedFrom: transition.from,
            to: transition.to,
            payload: parsed.data.payload,
          });
          if (!applyResult(result)) return;
          break;
        }


        case "override_handover": {
          if (!transition.to) {
            res.status(500).json({ message: "Malformed transition", code: "BAD_TRANSITION" });
            return;
          }
          const result = await handleOverrideHandover({
            order,
            callerId,
            expectedFrom: transition.from,
            to: transition.to,
            payload: parsed.data.payload,
          });
          if (!applyResult(result)) return;
          break;
        }


        case "collect_payment": {
          const result = await handleCollectPayment({
            order,
            callerId,
            role,
            payload: parsed.data.payload,
          });
          if (!applyResult(result)) return;
          break;
        }


        case "request_cancellation": {
          const result = await handleRequestCancellation({
            order,
            callerId,
            payload: parsed.data.payload,
          });
          if (!applyResult(result)) return;
          break;
        }

        case "cancel": {
          if (!transition.to) {
            res.status(500).json({ message: "Malformed transition", code: "BAD_TRANSITION" });
            return;
          }
          const result = await handleCancel({
            order,
            callerId,
            expectedFrom: transition.from,
            to: transition.to,
          });
          if (!applyResult(result)) return;
          break;
        }

        case "reject_cancellation": {
          const result = await handleRejectCancellation({
            order,
            callerId,
            payload: parsed.data.payload,
          });
          if (!applyResult(result)) return;
          break;
        }


        default: {
          // Ops actions — weigh, settle, generate_docket. mark_received_dropoff
          // is OTP-gated above; do not delegate a payload-less handler here.
          if (action === "weigh") {
            if (!transition.to) {
              res.status(500).json({ message: "Malformed transition", code: "BAD_TRANSITION" });
              return;
            }
            const ok = applyResult(
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
            const ok = applyResult(
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
            const ok = applyResult(await handleGenerateDocket({ order, callerId }));
            if (!ok) return;
            break;
          }

          if (action === "mark_dispatched") {
            if (!transition.to) {
              res.status(500).json({ message: "Malformed transition", code: "BAD_TRANSITION" });
              return;
            }
            const ok = applyResult(await handleMarkDispatched({ order, callerId }));
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

      const settled = outcome.order;
      if (!settled) {
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
        order_id: settled.id,
        status: settled.status,
        note: outcome.note,
        actor_user_id: callerId,
        metadata: { action, role, ...outcome.meta },
      });

      if (!eventLogged) {
        console.error("[POST /api/orders/:id/actions] order_events insert failed", {
          order_id: settled.id,
          action,
          status: settled.status,
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
        order: settled,
        moved: transition.to !== null,
        actorUserId: callerId,
      });

      res.json({
        order: settled,
        availableActions: availableActions(settled, role, { userId: callerId }),
        ...(outcome.receipt ? { receipt: outcome.receipt } : {}),
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
      const owner = await resolveKycOwner(req, { allowSessionGuest: true });
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
      const owner = await resolveKycOwner(req, { allowSessionGuest: true });
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

        sendDocumentFile(res, doc);
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
      //
      // `allowSessionGuest` is what lets a guest replace their document from
      // their own profile rather than only mid-booking, where a fresh OTP had
      // just been typed. The ref is no weaker a proof of the number — it can
      // only have been minted by an OTP on it — and this same session can
      // already read that document and book against it. The ten-minute window
      // was the wrong rule for a customer tidying up their own record.
      const kycOwner = await resolveKycOwner(req, { allowSessionGuest: true });
      if (!kycOwner) {
        res.status(401).json({ message: "Not authenticated", code: PHONE_UNVERIFIED });
        return;
      }

      if (!req.file) {
        res.status(400).json({ message: "No file uploaded.", code: "FILE_MISSING" });
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
          code: "DOCUMENT_NUMBER_INVALID",
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

        // Bank the identity row a guest would otherwise have to produce again
        // at signup.
        //
        // Signup asks for the number first (/api/signup/identity/aadhaar and
        // /pan write it `self_declared`) and proves it with the OCR on the
        // card uploaded afterwards. A guest does both at once, here: the
        // number is typed on this form and this upload is the OCR that backs
        // it. The row was simply never written, so `assertIdentityVerified`
        // asked a guest-turned-customer for a check they had already passed.
        //
        // Guests only. An account holder has no signup_ref to write against
        // and is past the gate that reads these.
        //
        // Best-effort: the document is saved and the booking gate is satisfied
        // either way, and signup can still ask for the number if this fails.
        const identityKind = IDENTITY_KIND_FOR_KYC_TYPE[documentType];
        if (identityKind && kycOwner.guestRef) {
          void upsertIdentityVerification({
            signup_ref: kycOwner.guestRef,
            kind: identityKind,
            document_no: normalizedDocumentNo,
            // Same word signup uses for these two: the number is asserted by
            // the customer, and what stands behind it is the OCR match above,
            // never a registry.
            status: "self_declared",
            reference_id: null,
            verified_name: null,
            details: null,
          }).catch((err) =>
            console.error("[kyc/upload] identity row write failed:", err)
          );
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

      sendDocumentFile(res, doc);
    } catch (err) {
      console.error("[GET /api/kyc/documents/:id/file] failed:", err);
      res.status(500).json({ message: "Failed to retrieve document." });
    }
  });

  return httpServer;
}
