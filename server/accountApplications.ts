/**
 * Account review (ACCOUNT_REVIEW=1): signup files an application instead of
 * opening an account. Everything here runs after signup's own gates — identity
 * numbers, the OCR-checked document set, the GSTIN, the signature — have
 * already passed in routes.ts, so an application is always as complete as an
 * account used to be.
 *
 * Off by default. Until the ops console can approve applications, turning it
 * on would leave every new customer waiting on a queue nobody can empty.
 */

import type { Request } from "express";
import { insertNotification } from "./appDb.js";
import {
  getOpenApplicationByPhone,
  insertApplication,
  insertApplicationEvent,
  updateApplicationFrom,
  type ApplicationDetails,
  type ApplicationRow,
} from "./accountApplicationsDb.js";
import { getSignupDocumentWithFile } from "./accountDocsDb.js";
import { upsertGuestProfile } from "./guestProfileDb.js";
import { getKycByGuestRef } from "./kycDb.js";
import { mirrorAadhaarToKyc } from "./kycMirror.js";
import { sendMail } from "./mailer.js";
import { applicationAlertEmail, applicationReceivedEmail, changesRequestedEmail, rejectedEmail } from "./accountEmails.js";
import { getApplicationAlertRecipients } from "./opsSettings.js";
import { COMPANY_CATEGORY_SPECS, DOC_SLOT_SPECS, isCompanyCategory, isDocSlot } from "../shared/accountSpec.js";
import {
  APPLICATION_FIELD_LABELS,
  OPEN_APPLICATION_STATUSES,
  isApplicationField,
  type RequestedChanges,
} from "../shared/applicationStatus.js";

export function isAccountReviewEnabled(): boolean {
  return process.env.ACCOUNT_REVIEW === "1";
}

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; status: number; code: string; message: string };

// ── Filing ───────────────────────────────────────────────────────────────────

export interface FileApplicationInput {
  phone: string;
  signupRef: string;
  accountType: "personal" | "company";
  category: string | null;
  details: ApplicationDetails;
  contract: {
    contract_signed_name: string;
    contract_version: string;
    contract_accepted_at: string;
    contract_accepted_ip: string | null;
  };
}

/**
 * File the application, or update the open one on this number.
 *
 * A second signup while one is open is the customer correcting it: allowed
 * while nobody has picked it up (`submitted`) or when the team asked for a
 * change (`changes_requested`), refused while a reviewer is reading it. The
 * original submission time is kept either way, so fixing a typo does not send
 * them to the back of the queue.
 */
export async function fileApplication(
  req: Request,
  input: FileApplicationInput
): Promise<ServiceResult<{ row: ApplicationRow; event: "submitted" | "edited" | "resubmitted" }>> {
  const inReview = {
    ok: false as const,
    status: 409,
    code: "APPLICATION_IN_REVIEW",
    message: "The Bombino team is reviewing your application right now, so it can't be changed. Try again later.",
  };
  const unavailable = {
    ok: false as const,
    status: 503,
    code: "APPLICATION_UNAVAILABLE",
    message: "We couldn't send your application just now. Please try again.",
  };

  const existing = await getOpenApplicationByPhone(input.phone);
  let row: ApplicationRow | null;
  let event: "submitted" | "edited" | "resubmitted";

  if (existing) {
    if (existing.status === "in_review") return inReview;
    event = existing.status === "changes_requested" ? "resubmitted" : "edited";
    row = await updateApplicationFrom(existing.id, ["submitted", "changes_requested"], {
      status: "submitted",
      // This browser's ref, which is where the documents just checked live.
      signup_ref: input.signupRef,
      account_type: input.accountType,
      company_category: input.category,
      details: input.details,
      ...input.contract,
      requested_changes: null,
      resubmission_count: existing.resubmission_count + (event === "resubmitted" ? 1 : 0),
      // The reviewer who asked for the change keeps it.
      reviewer_id: event === "resubmitted" ? existing.reviewer_id : null,
    });
    // It moved under us: a reviewer claimed it between the read and the write.
    if (!row) return inReview;
  } else {
    const inserted = await insertApplication({
      phone: input.phone,
      signup_ref: input.signupRef,
      account_type: input.accountType,
      company_category: input.category,
      details: input.details,
      ...input.contract,
    });
    if (!inserted.ok) {
      // Another tab filed first. Answer as the edit path would, with a retry.
      return inserted.reason === "open_exists"
        ? { ok: false, status: 409, code: "APPLICATION_OPEN", message: "An application for this number is already open. Refresh to see it." }
        : unavailable;
    }
    row = inserted.row;
    event = "submitted";
  }

  await insertApplicationEvent({ application_id: row.id, event });
  // Tell the team something new is waiting, and the customer that it arrived.
  // Not for an edit before anyone has looked: it is the same application,
  // already in the queue, and they were told the first time.
  if (event !== "edited") {
    void notifyTeamOfApplication(row, event === "resubmitted");
    void notifyCustomerReceived(row, event === "resubmitted");
  }

  // The guest profile holds the same details, so every guest screen shows the
  // customer what they sent. Best-effort: the application stands either way.
  const d = input.details;
  await upsertGuestProfile({
    guest_ref: input.signupRef,
    phone: input.phone,
    full_name: input.accountType === "personal" ? d.full_name ?? null : d.contact_person ?? null,
    email: d.email,
    account_type: input.accountType,
    ...(input.accountType === "company"
      ? {
          company_category: input.category,
          company_name: d.company_name ?? null,
          gstin: d.gstin ?? null,
          contact_person: d.contact_person ?? null,
          address_line_1: d.address ?? null,
          pincode: d.pincode ?? null,
          city: d.city ?? null,
          state: d.state ?? null,
          hub_id: d.hub_id !== undefined ? String(d.hub_id) : null,
          extras: Object.fromEntries(
            (["lut_no", "iec_branch_code", "bank_account_no", "bank_ad_code"] as const)
              .filter((k) => d[k])
              .map((k) => [k, d[k] as string])
          ),
        }
      : {}),
  });

  // The customer carries on as a guest on this ref: the same fields
  // /api/guest/phone/verify sets, so booking, payment and the profile all
  // resolve them. The OTP behind this signup is what proved the number.
  req.session.signupRef = input.signupRef;
  req.session.signupPhone = input.phone;
  req.session.guestRef = input.signupRef;
  req.session.guestPhone = input.phone;

  // So they can book without uploading their ID again. Only when the guest
  // side has nothing: a document they chose to book with stays theirs.
  if (!(await getKycByGuestRef(input.signupRef))) {
    const aadhaar = await getSignupDocumentWithFile(input.signupRef, "aadhaar_card");
    if (aadhaar) await mirrorAadhaarToKyc({ userId: null, guestRef: input.signupRef }, aadhaar, "application");
  }

  if (event !== "edited") {
    await insertNotification({
      guest_ref: input.signupRef,
      type: "account",
      title: event === "resubmitted" ? "Changes sent to the Bombino team" : "Application received",
      body: "The Bombino team is setting up your account. You can book as a guest in the meantime.",
      data: { application_id: row.id },
    });
  }

  return { ok: true, value: { row, event } };
}

// ── The customer ─────────────────────────────────────────────────────────────

export async function withdrawApplication(phone: string): Promise<ServiceResult<ApplicationRow>> {
  const open = await getOpenApplicationByPhone(phone);
  if (!open) return { ok: false, status: 404, code: "NO_OPEN_APPLICATION", message: "There's no open application to withdraw." };
  const row = await updateApplicationFrom(open.id, OPEN_APPLICATION_STATUSES, {
    status: "withdrawn",
    decided_at: new Date().toISOString(),
  });
  if (!row) return { ok: false, status: 409, code: "APPLICATION_STATE_CHANGED", message: "Your application just changed. Refresh and look again." };
  await insertApplicationEvent({ application_id: row.id, event: "withdrawn" });
  return { ok: true, value: row };
}

// ── Ops decisions that reach the customer ───────────────────────────────────

function customerName(app: ApplicationRow): string {
  return (app.account_type === "company" ? app.details.contact_person : app.details.full_name) || "there";
}

// ── Telling the team ─────────────────────────────────────────────────────────

function consoleLink(applicationId: string): string {
  const base = (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT ?? 5000}`).replace(/\/+$/, "");
  return `${base}/ops/applications/${applicationId}`;
}

function accountTypeLabel(app: ApplicationRow): string {
  return isCompanyCategory(app.company_category) ? COMPANY_CATEGORY_SPECS[app.company_category].label : "Personal";
}

/**
 * Email the addresses set on the Applications page (or APPLICATION_ALERT_EMAILS
 * until the settings table exists). Best-effort: the application stands either
 * way, the queue and the nav pill show it, and a failure is a log line.
 */
export async function notifyTeamOfApplication(app: ApplicationRow, resent: boolean): Promise<void> {
  try {
    const { emails } = await getApplicationAlertRecipients();
    if (emails.length === 0) return;
    const name = (app.account_type === "company" ? app.details.company_name : app.details.full_name) || `+91 ${app.phone}`;
    const mail = applicationAlertEmail({
      name,
      accountTypeLabel: accountTypeLabel(app),
      phone: app.phone,
      email: app.details.email,
      submittedAt: resent ? new Date().toISOString() : app.submitted_at,
      resent,
      link: consoleLink(app.id),
    });
    const sent = await sendMail({ to: emails.join(", "), ...mail });
    if (!sent.ok) console.error(`[accountApplications] team alert for ${app.id} not sent: ${sent.error}`);
  } catch (err) {
    console.error(`[accountApplications] team alert for ${app.id} failed:`, err);
  }
}

/**
 * The customer's acknowledgement: "we've received your application" (or your
 * changes). Best-effort like every email here, and recorded in the history as
 * sent or failed, so the reviewer can see whether the customer heard.
 */
export async function notifyCustomerReceived(app: ApplicationRow, resent: boolean): Promise<void> {
  try {
    const mail = applicationReceivedEmail({
      name: customerName(app),
      phone: app.phone,
      accountTypeLabel: accountTypeLabel(app),
      resent,
    });
    const sent = await sendMail({ to: app.details.email, ...mail });
    await insertApplicationEvent({
      application_id: app.id,
      event: sent.ok ? "email_sent" : "email_failed",
      note: sent.ok ? null : sent.error,
      metadata: { kind: "received", to: app.details.email },
    });
  } catch (err) {
    console.error(`[accountApplications] received email for ${app.id} failed:`, err);
  }
}

/** The "Send a test" button: a sample alert, so the team can see it lands. */
export async function sendTestApplicationAlert(emails: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
  const mail = applicationAlertEmail({
    name: "Test Applicant (sample)",
    accountTypeLabel: "Personal",
    phone: "9000000000",
    email: "applicant@example.com",
    submittedAt: new Date().toISOString(),
    resent: false,
    link: `${(process.env.PUBLIC_URL || `http://localhost:${process.env.PORT ?? 5000}`).replace(/\/+$/, "")}/ops/applications`,
  });
  const sent = await sendMail({ to: emails.join(", "), ...mail, subject: `[Test] ${mail.subject}` });
  return sent.ok ? { ok: true } : { ok: false, error: sent.error };
}

/** Validate a reviewer's change request against the fields and slots that exist. */
export function parseRequestedChanges(body: unknown): ServiceResult<RequestedChanges> {
  const b = (body ?? {}) as { fields?: unknown; slots?: unknown; note?: unknown };
  // The note is optional: ticking the fields and documents already tells the
  // customer what to change. Something has to be asked for, though.
  const note = typeof b.note === "string" ? b.note.trim() : "";
  if (note.length > 1000) {
    return { ok: false, status: 400, code: "NOTE_TOO_LONG", message: "Keep the note to 1000 characters." };
  }
  const fields = Array.isArray(b.fields) ? b.fields : [];
  const slots = Array.isArray(b.slots) ? b.slots : [];
  if (fields.length === 0 && slots.length === 0 && note === "") {
    return {
      ok: false,
      status: 400,
      code: "NOTHING_REQUESTED",
      message: "Tick what the customer should change, or write them a note.",
    };
  }
  const badField = fields.find((f) => !isApplicationField(f));
  if (badField !== undefined) return { ok: false, status: 400, code: "UNKNOWN_FIELD", message: `Unknown field: ${String(badField)}` };
  const badSlot = slots.find((s) => !isDocSlot(s));
  if (badSlot !== undefined) return { ok: false, status: 400, code: "UNKNOWN_DOCUMENT", message: `Unknown document: ${String(badSlot)}` };
  return { ok: true, value: { fields: fields as string[], slots: slots as string[], note } };
}

export async function notifyChangesRequested(app: ApplicationRow): Promise<void> {
  const changes = app.requested_changes;
  if (!changes) return;
  const fieldLabels = changes.fields.map((f) => (isApplicationField(f) ? APPLICATION_FIELD_LABELS[f] : f));
  const documentLabels = changes.slots.map((s) => (isDocSlot(s) ? DOC_SLOT_SPECS[s].label : s));
  // No note: the notification lists what was ticked instead.
  const listed = [...fieldLabels, ...documentLabels.map((d) => `${d} (upload again)`)].join(", ");
  await insertNotification({
    guest_ref: app.signup_ref,
    type: "account",
    title: "Your application needs a change",
    body: changes.note || `Please update: ${listed}.`,
    data: { application_id: app.id },
  });
  const email = changesRequestedEmail({ name: customerName(app), note: changes.note, fieldLabels, documentLabels });
  const sent = await sendMail({ to: app.details.email, ...email });
  await insertApplicationEvent({
    application_id: app.id,
    event: sent.ok ? "email_sent" : "email_failed",
    note: sent.ok ? null : sent.error,
    metadata: { kind: "changes_requested", to: app.details.email },
  });
}

export async function notifyRejected(app: ApplicationRow): Promise<void> {
  const reason = app.decision_note ?? "";
  await insertNotification({
    guest_ref: app.signup_ref,
    type: "account",
    title: "Account not opened",
    body: reason,
    data: { application_id: app.id },
  });
  const sent = await sendMail({ to: app.details.email, ...rejectedEmail({ name: customerName(app), reason }) });
  await insertApplicationEvent({
    application_id: app.id,
    event: sent.ok ? "email_sent" : "email_failed",
    note: sent.ok ? null : sent.error,
    metadata: { kind: "rejected", to: app.details.email },
  });
}
