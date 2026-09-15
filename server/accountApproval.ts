/**
 * Approving an account application: the moment an account actually opens.
 *
 * ITD has no API that issues a login, so the Bombino team creates the customer
 * and its login in ITD by hand and types that login into the ops console. This
 * module then:
 *
 *   1. proves the login against ITD (a mistyped password fails here, not the
 *      first time the customer signs in),
 *   2. refuses a login or number already linked elsewhere,
 *   3. marks the application approved — a conditional UPDATE, so of two
 *      reviewers pressing Approve exactly one wins,
 *   4. writes the itd_users row with the password encrypted, exactly as
 *      POST /api/auth/link/itd stores one,
 *   5. finalizes: moves the staged documents, identity numbers and guest
 *      orders onto the account, mirrors the Aadhaar for customs, drops the
 *      guest profile,
 *   6. tells the customer: in-app notification and the account-ready email.
 *
 * Steps 1–4 either all happen or the application is left as it was. Step 5 and
 * 6 are idempotent and keyed on the application: if one fails the application
 * stays `approved` with `finalize_error` set, and "Retry" re-runs them. The
 * credential check never runs twice — the password is on itd_users by then.
 *
 * The password exists in plain text only in this request's memory and in the
 * email body. It is never logged and never written anywhere but encrypted.
 */

import {
  findItdUserIdByCustomerId,
  findItdUserIdByPhone,
  getItdUserProfileById,
  getItdUserTokenAndSecretsById,
  insertNotification,
  upsertItdUserAndReturnId,
} from "./appDb.js";
import {
  getApplicationById,
  insertApplicationEvent,
  patchApprovedApplication,
  updateApplicationFrom,
  type ApplicationRow,
} from "./accountApplicationsDb.js";
import { claimSignupDocuments, getUserDocumentWithFile, listDocumentsBySignupRef, listDocumentsByUserId } from "./accountDocsDb.js";
import { claimSignupIdentityVerifications } from "./identityDb.js";
import { claimGuestOrdersForUser } from "./ordersDb.js";
import { deleteGuestProfilesFor } from "./guestProfileDb.js";
import { mirrorAadhaarToKyc } from "./kycMirror.js";
import { decryptPassword, encryptPassword, isEncryptionConfigured } from "./crypto.js";
import { itdClient, type ITDUserInfo } from "./itd.js";
import { itdTokenExpiryIso, withTimeout } from "./itdTokenRefresh.js";
import { sendMail } from "./mailer.js";
import { accountReadyEmail, type DocumentOnFile } from "./accountEmails.js";
import { signContractPdf } from "./contractPdf.js";
import {
  COMPANY_CATEGORY_SPECS,
  DOC_SLOT_SPECS,
  isCompanyCategory,
  isDocumentVerified,
  isStaffVerified,
  requiredDocuments,
  type CompanyCategory,
} from "../shared/accountSpec.js";
import { ACTION_FROM } from "../shared/applicationStatus.js";

const ITD_LOGIN_TIMEOUT_MS = 10_000;

export type ApprovalError = { status: number; code: string; message: string };
export type ApprovalResult<T> = { ok: true; value: T } | { ok: false; error: ApprovalError };

const fail = <T>(status: number, code: string, message: string): ApprovalResult<T> => ({
  ok: false,
  error: { status, code, message },
});

// ── The login ────────────────────────────────────────────────────────────────

/** Ask ITD whether this email and password are a login. Nothing is written. */
export async function verifyItdLogin(
  email: string,
  password: string
): Promise<ApprovalResult<{ user: ITDUserInfo; token: string }>> {
  // Hard refusal, as on /api/auth/link/itd: the encrypted password IS the link.
  // Without the key it would store nothing and the customer could never reach
  // ITD, discovered days later.
  if (!isEncryptionConfigured()) {
    console.error("[accountApproval] ENCRYPTION_KEY missing — refusing to store an ITD login");
    return fail(503, "ENCRYPTION_UNAVAILABLE", "Logins cannot be stored right now (ENCRYPTION_KEY is not set).");
  }
  try {
    const result = await withTimeout(itdClient.loginUser(email, password), ITD_LOGIN_TIMEOUT_MS, "ITD loginUser (approve)");
    return { ok: true, value: result };
  } catch (err) {
    // ITD's message, not the password: loginUser's errors carry no credentials.
    const detail = err instanceof Error ? err.message : "no response";
    console.warn(`[accountApproval] ITD refused the login for ${email}: ${detail}`);
    return fail(
      422,
      "ITD_LOGIN_FAILED",
      "ITD did not accept that email and password. Check them against what you set up in ITD."
    );
  }
}

/**
 * Refuse a login or a number that already belongs to someone else.
 *
 * `exceptUserId` lets the credentials-update path replace the login on the
 * account that already holds it.
 */
async function assertLinkable(
  itdUser: ITDUserInfo,
  phone: string,
  exceptUserId: string | null = null
): Promise<ApprovalError | null> {
  const phoneOwner = await findItdUserIdByPhone(phone);
  if (phoneOwner && phoneOwner.id !== exceptUserId) {
    const profile = await getItdUserProfileById(phoneOwner.id);
    if (!profile || profile.itd_customer_id !== itdUser.id) {
      return {
        status: 409,
        code: "PHONE_LINKED_ELSEWHERE",
        message: `+91 ${phone} already belongs to another account (${profile?.full_name ?? "unknown"}).`,
      };
    }
  }
  const loginOwner = await findItdUserIdByCustomerId(itdUser.id);
  if (loginOwner && loginOwner.id !== exceptUserId) {
    const profile = await getItdUserProfileById(loginOwner.id);
    if (profile?.phone && profile.phone !== phone) {
      return {
        status: 409,
        code: "ITD_LOGIN_LINKED_ELSEWHERE",
        message: `That ITD login is already linked to +91 ${profile.phone}. Create a separate login in ITD for this customer.`,
      };
    }
  }
  return null;
}

// ── Approve ──────────────────────────────────────────────────────────────────

export interface ApproveInput {
  applicationId: string;
  reviewerId: string;
  itdEmail: string;
  itdPassword: string;
}

export interface ApproveOutcome {
  application: ApplicationRow;
  /** Whether everything after the account itself went through. */
  finalized: boolean;
  emailSent: boolean;
}

function accountName(app: ApplicationRow): string {
  return (app.account_type === "company" ? app.details.company_name : app.details.full_name)?.trim() || app.phone;
}

/**
 * Labels of the required documents a reviewer hasn't verified by hand yet,
 * including any not uploaded at all. Empty means approval may go ahead.
 */
export async function documentsAwaitingStaffCheck(app: ApplicationRow): Promise<string[]> {
  const category: CompanyCategory | null = isCompanyCategory(app.company_category) ? app.company_category : null;
  const docs = app.user_id ? await listDocumentsByUserId(app.user_id) : await listDocumentsBySignupRef(app.signup_ref);
  return requiredDocuments(app.account_type, category)
    .filter((slot) => {
      const doc = docs.find((d) => d.doc_slot === slot);
      return !doc || !isStaffVerified(doc);
    })
    .map((slot) => DOC_SLOT_SPECS[slot].label);
}

export async function approveApplication(input: ApproveInput): Promise<ApprovalResult<ApproveOutcome>> {
  const app = await getApplicationById(input.applicationId);
  if (!app) return fail(404, "NOT_FOUND", "Application not found.");
  if (!ACTION_FROM.approve.includes(app.status)) {
    return fail(409, "APPLICATION_STATE_CHANGED", "This application has already moved on. Refresh and look again.");
  }

  // No account opens on a document nobody at Bombino has looked at. Cashfree
  // is the first layer; the reviewer's own check is the one that counts.
  const unchecked = await documentsAwaitingStaffCheck(app);
  if (unchecked.length > 0) {
    return fail(
      409,
      "DOCUMENTS_NOT_VERIFIED",
      `Verify every document before approving. Still to check: ${unchecked.join(", ")}.`
    );
  }

  const login = await verifyItdLogin(input.itdEmail, input.itdPassword);
  if (!login.ok) return login;
  const { user: itdUser, token } = login.value;

  const conflict = await assertLinkable(itdUser, app.phone);
  if (conflict) return { ok: false, error: conflict };

  // The winner. From here the application is ours to finish.
  const now = new Date().toISOString();
  const approved = await updateApplicationFrom(app.id, ACTION_FROM.approve, {
    status: "approved",
    reviewer_id: input.reviewerId,
    decided_at: now,
    itd_customer_id: itdUser.id,
    finalize_error: "account not written yet",
  });
  if (!approved) {
    return fail(409, "APPLICATION_STATE_CHANGED", "Someone else acted on this application first. Refresh and look again.");
  }

  const enc = encryptPassword(input.itdPassword);
  const category: CompanyCategory | null = isCompanyCategory(app.company_category) ? app.company_category : null;
  const spec = category ? COMPANY_CATEGORY_SPECS[category] : null;
  const d = app.details;
  const row = await upsertItdUserAndReturnId({
    itd_customer_id: itdUser.id,
    itd_customer_code: itdUser.customerId,
    email: itdUser.email || d.email,
    full_name: accountName(app),
    username: itdUser.username || app.phone,
    role: "customer",
    phone: app.phone,
    itd_token: token,
    itd_token_expires_at: itdTokenExpiryIso(),
    itd_password_encrypted: enc.encrypted,
    encryption_iv: enc.iv,
    account_type: app.account_type,
    ...(app.account_type === "company"
      ? {
          company_name: d.company_name ?? null,
          gstin: d.gstin ?? null,
          company_category: category,
          contract_head: spec?.contractHead ?? null,
          group_code: spec?.groupCode ?? null,
          contact_person: d.contact_person ?? null,
          lut_no: d.lut_no ?? null,
          iec_branch_code: d.iec_branch_code ?? null,
          bank_account_no: d.bank_account_no ?? null,
          bank_ad_code: d.bank_ad_code ?? null,
        }
      : {}),
    contract_signed_name: app.contract_signed_name,
    contract_version: app.contract_version,
    contract_accepted_at: app.contract_accepted_at,
    contract_accepted_ip: app.contract_accepted_ip,
  });

  if (!row?.id) {
    // Put it back: nothing exists yet, so the reviewer can simply try again.
    await updateApplicationFrom(app.id, ["approved"], {
      status: app.status === "submitted" ? "submitted" : "in_review",
      decided_at: null,
      itd_customer_id: null,
      finalize_error: null,
    });
    await insertApplicationEvent({
      application_id: app.id,
      event: "approve_failed",
      actor_id: input.reviewerId,
      note: "The account could not be written. Nothing was changed.",
    });
    return fail(502, "ACCOUNT_WRITE_FAILED", "The account could not be saved. Nothing was changed; please try again.");
  }

  await updateApplicationFrom(app.id, ["approved"], { user_id: row.id });
  await insertApplicationEvent({
    application_id: app.id,
    event: "approved",
    actor_id: input.reviewerId,
    metadata: { itd_customer_id: itdUser.id, itd_email: itdUser.email || d.email, user_id: row.id },
  });

  const result = await finalizeApplication(app.id, { password: input.itdPassword, actorId: input.reviewerId });
  const latest = (await getApplicationById(app.id)) ?? approved;
  return { ok: true, value: { application: latest, finalized: result.finalized, emailSent: result.emailSent } };
}

// ── Finalize (idempotent) ────────────────────────────────────────────────────

/**
 * Everything after the account exists. Safe to run any number of times.
 *
 * `password` is passed on the approve request, which already has it; a retry
 * or resend decrypts it from itd_users instead.
 */
export async function finalizeApplication(
  applicationId: string,
  opts: { password?: string; actorId: string | null; forceEmail?: boolean }
): Promise<{ finalized: boolean; emailSent: boolean; error: string | null }> {
  const app = await getApplicationById(applicationId);
  if (!app || app.status !== "approved" || !app.user_id) {
    return { finalized: false, emailSent: false, error: "application is not approved with an account" };
  }
  const userId = app.user_id;
  const problems: string[] = [];

  // Documents and identity numbers. Re-running claims nothing new.
  await claimSignupDocuments(app.signup_ref, userId);
  await claimSignupIdentityVerifications(app.signup_ref, userId);
  const leftBehind = await listDocumentsBySignupRef(app.signup_ref);
  if (leftBehind.length > 0) problems.push(`${leftBehind.length} document(s) not moved`);

  // The Aadhaar customs reads. Personal accounts carry one; company accounts
  // may not, and that is not a failure.
  const aadhaar = await getUserDocumentWithFile(userId, "aadhaar_card");
  if (aadhaar && !(await mirrorAadhaarToKyc({ userId }, aadhaar, "account-approval"))) {
    problems.push("Aadhaar not copied to KYC");
  }

  // Guest bookings on this number, and the guest profile that no longer has a reader.
  try {
    const claimed = await claimGuestOrdersForUser(app.phone, userId);
    await deleteGuestProfilesFor(app.phone, [app.signup_ref, ...claimed.refs]);
  } catch (err) {
    problems.push(`guest orders: ${err instanceof Error ? err.message : String(err)}`);
  }

  const finalizeError = problems.length > 0 ? problems.join("; ") : null;
  await patchApprovedApplication(app.id, {
    finalize_error: finalizeError,
    ...(finalizeError ? {} : { finalized_at: app.finalized_at ?? new Date().toISOString() }),
  });

  // Tell them once. A retry after a failed claim does not repeat it.
  if (!app.finalized_at && !app.email_sent_at) {
    await insertNotification({
      user_id: userId,
      type: "account",
      title: "Your account is ready",
      body: "The Bombino team has opened your account. Your guest bookings are in Orders.",
      data: { application_id: app.id },
    });
  }

  let emailSent = Boolean(app.email_sent_at) && !opts.forceEmail;
  if (!emailSent) {
    const sent = await sendAccountReadyEmail(app, userId, opts.password ?? null);
    emailSent = sent;
  }
  if (finalizeError) {
    await insertApplicationEvent({ application_id: app.id, event: "finalize_failed", actor_id: opts.actorId, note: finalizeError });
  } else if (!app.finalized_at) {
    await insertApplicationEvent({ application_id: app.id, event: "finalized", actor_id: opts.actorId });
  }
  return { finalized: finalizeError === null, emailSent, error: finalizeError };
}

async function sendAccountReadyEmail(app: ApplicationRow, userId: string, knownPassword: string | null): Promise<boolean> {
  const profile = await getItdUserProfileById(userId);
  const to = (profile?.email as string | undefined) || app.details.email;

  let password = knownPassword;
  if (!password) {
    const secrets = await getItdUserTokenAndSecretsById(userId);
    try {
      password =
        secrets?.itd_password_encrypted && secrets.encryption_iv
          ? decryptPassword(secrets.itd_password_encrypted, secrets.encryption_iv)
          : null;
    } catch {
      password = null;
    }
  }
  if (!password) {
    await patchApprovedApplication(app.id, { email_error: "no stored login to send" });
    return false;
  }

  const docs = await listDocumentsByUserId(userId);
  const documents: DocumentOnFile[] = docs.map((doc) => ({
    label: DOC_SLOT_SPECS[doc.doc_slot]?.label ?? doc.doc_slot,
    number: doc.document_no,
    status: isDocumentVerified(doc) ? "Verified" : "On file",
  }));

  const typeLabel =
    app.account_type === "company" && isCompanyCategory(app.company_category)
      ? COMPANY_CATEGORY_SPECS[app.company_category].label
      : "Personal";

  const email = accountReadyEmail({
    name: app.account_type === "company" ? app.details.contact_person || accountName(app) : accountName(app),
    phone: app.phone,
    accountTypeLabel: typeLabel,
    customerCode: (profile?.itd_customer_code as string | undefined) ?? null,
    itdEmail: to,
    itdPassword: password,
    documents,
  });

  let contract: Buffer | null = null;
  try {
    contract = await signContractPdf({
      signedName: app.contract_signed_name,
      accountName: accountName(app),
      signedAt: new Date(app.contract_accepted_at),
    });
  } catch (err) {
    console.error("[accountApproval] contract PDF for the email failed:", err);
  }

  const result = await sendMail({
    to,
    ...email,
    attachments: contract
      ? [{ filename: "bombino-contract.pdf", content: contract, contentType: "application/pdf" }]
      : undefined,
    secrets: [password],
  });

  if (result.ok) {
    await patchApprovedApplication(app.id, { email_sent_at: new Date().toISOString(), email_error: null });
    await insertApplicationEvent({ application_id: app.id, event: "email_sent", metadata: { to } });
    return true;
  }
  await patchApprovedApplication(app.id, { email_error: result.error });
  await insertApplicationEvent({ application_id: app.id, event: "email_failed", note: result.error, metadata: { to } });
  return false;
}

// ── Credentials, later ───────────────────────────────────────────────────────

/**
 * Replace the ITD login on an existing account: Bombino changed the password
 * in ITD, or an account opened before review never had one.
 *
 * Proved against ITD first, like approval. Refused if the login belongs to a
 * different account.
 */
export async function replaceItdCredentials(input: {
  userId: string;
  itdEmail: string;
  itdPassword: string;
}): Promise<ApprovalResult<{ userId: string }>> {
  const profile = await getItdUserProfileById(input.userId);
  if (!profile) return fail(404, "NOT_FOUND", "Customer not found.");
  if (!profile.phone) return fail(409, "NO_PHONE", "This account has no mobile number to sign in with.");

  const login = await verifyItdLogin(input.itdEmail, input.itdPassword);
  if (!login.ok) return login;
  const { user: itdUser, token } = login.value;

  const conflict = await assertLinkable(itdUser, profile.phone, input.userId);
  if (conflict) return { ok: false, error: conflict };

  // A new password for the same ITD customer, or a first login for an account
  // opened before review (a synthetic 'local-…' id, which stays: the upsert is
  // keyed on it, and everything hangs off itd_users.id anyway). A login for a
  // DIFFERENT ITD customer on a real ITD account would quietly move this
  // customer's bookings under someone else's ITD scope.
  const isLocal = String(profile.itd_customer_id).startsWith("local-");
  if (!isLocal && profile.itd_customer_id !== itdUser.id) {
    return fail(
      409,
      "ITD_LOGIN_MISMATCH",
      "That login belongs to a different ITD customer than this account. Check you are on the right customer."
    );
  }

  const enc = encryptPassword(input.itdPassword);
  const row = await upsertItdUserAndReturnId({
    itd_customer_id: profile.itd_customer_id,
    itd_customer_code: itdUser.customerId,
    email: itdUser.email || profile.email,
    full_name: profile.full_name,
    username: profile.username,
    role: profile.role,
    itd_token: token,
    itd_token_expires_at: itdTokenExpiryIso(),
    itd_password_encrypted: enc.encrypted,
    encryption_iv: enc.iv,
  });
  if (!row?.id) return fail(502, "ACCOUNT_WRITE_FAILED", "The login could not be saved. Please try again.");
  return { ok: true, value: { userId: row.id } };
}
