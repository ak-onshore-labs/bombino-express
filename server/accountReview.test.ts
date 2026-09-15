import { test } from "node:test";
import assert from "node:assert/strict";

// No shared database from unit tests: the credentials may be in the shell's
// environment, so they go before anything creates a client.
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.DATABASE_URL;
delete process.env.SMTP_HOST;
delete process.env.MAIL_FROM;
// Nor a real mailbox: the Google app password fills in SMTP on its own.
delete process.env.GOOGLE_APP_PASS;
delete process.env.google_app_pass;
delete process.env.SMTP_USER;
delete process.env.SMTP_PASS;

const { scrubSecrets, sendMail, isMailerConfigured, mailSender } = await import("./mailer.js");
const {
  accountReadyEmail,
  applicationAlertEmail,
  applicationReceivedEmail,
  changesRequestedEmail,
  maskNumber,
  rejectedEmail,
} = await import("./accountEmails.js");
const { alertEmailsSchema } = await import("./opsSettings.js");
const { parseRequestedChanges, isAccountReviewEnabled } = await import("./accountApplications.js");
const { toCustomerView } = await import("./accountApplicationsDb.js");
const { describeApplication } = await import("./supportDocuments.js");
const {
  ACTION_FROM,
  APPLICATION_STATUSES,
  actionAllowed,
  customerCanEdit,
  isOpenApplicationStatus,
} = await import("../shared/applicationStatus.js");
type ApplicationRow = import("./accountApplicationsDb.js").ApplicationRow;

function row(fields: Partial<ApplicationRow> = {}): ApplicationRow {
  return {
    id: "app-1",
    phone: "9000000002",
    signup_ref: "11111111-1111-1111-1111-111111111111",
    account_type: "personal",
    company_category: null,
    details: { full_name: "Asha Rao", email: "asha@example.com" },
    contract_signed_name: "Asha Rao",
    contract_version: "2026-1",
    contract_accepted_at: "2026-09-15T05:00:00Z",
    contract_accepted_ip: null,
    status: "submitted",
    reviewer_id: "reviewer-uuid",
    claimed_at: null,
    requested_changes: null,
    decision_note: null,
    resubmission_count: 0,
    user_id: null,
    itd_customer_id: null,
    finalize_error: "internal detail",
    finalized_at: null,
    email_sent_at: null,
    email_error: "smtp detail",
    whatsapp_sent_at: null,
    submitted_at: "2026-09-15T05:00:00Z",
    decided_at: null,
    created_at: "2026-09-15T05:00:00Z",
    updated_at: "2026-09-15T05:00:00Z",
    ...fields,
  };
}

// ── Status rules ─────────────────────────────────────────────────────────────

test("review is off unless ACCOUNT_REVIEW is exactly 1", () => {
  const before = process.env.ACCOUNT_REVIEW;
  delete process.env.ACCOUNT_REVIEW;
  assert.equal(isAccountReviewEnabled(), false);
  process.env.ACCOUNT_REVIEW = "true";
  assert.equal(isAccountReviewEnabled(), false);
  process.env.ACCOUNT_REVIEW = "1";
  assert.equal(isAccountReviewEnabled(), true);
  if (before === undefined) delete process.env.ACCOUNT_REVIEW;
  else process.env.ACCOUNT_REVIEW = before;
});

test("every action starts only from statuses that exist, and decided ones stay decided", () => {
  for (const froms of Object.values(ACTION_FROM)) {
    for (const s of froms) assert.ok(APPLICATION_STATUSES.includes(s));
  }
  // Nothing moves a rejected or withdrawn application.
  for (const action of Object.keys(ACTION_FROM) as Array<keyof typeof ACTION_FROM>) {
    assert.equal(actionAllowed(action, "rejected"), false, `${action} from rejected`);
    assert.equal(actionAllowed(action, "withdrawn"), false, `${action} from withdrawn`);
  }
  // Approving twice is not a thing; retrying the tail of an approval is.
  assert.equal(actionAllowed("approve", "approved"), false);
  assert.equal(actionAllowed("retry_finalize", "approved"), true);
  assert.equal(actionAllowed("approve", "changes_requested"), false, "wait for the customer's change");
});

test("the customer can edit until a reviewer picks it up, and again when asked", () => {
  assert.equal(customerCanEdit("submitted"), true);
  assert.equal(customerCanEdit("in_review"), false);
  assert.equal(customerCanEdit("changes_requested"), true);
  assert.equal(customerCanEdit("approved"), false);
  assert.deepEqual(
    APPLICATION_STATUSES.filter(isOpenApplicationStatus),
    ["submitted", "in_review", "changes_requested"]
  );
});

test("the customer's view hides the reviewer and the internals", () => {
  const view = toCustomerView(row({ status: "rejected", decision_note: "GSTIN belongs to another company" }));
  assert.equal(view.decision_note, "GSTIN belongs to another company");
  const json = JSON.stringify(view);
  for (const secret of ["reviewer-uuid", "internal detail", "smtp detail", "11111111-1111"]) {
    assert.ok(!json.includes(secret), `leaked ${secret}`);
  }
  // A note from an earlier rejection doesn't follow a new submission around.
  assert.equal(toCustomerView(row({ status: "submitted", decision_note: "old" })).decision_note, null);
});

// ── Change requests ──────────────────────────────────────────────────────────

test("a change request names real fields and documents; the note is optional", () => {
  const ok = parseRequestedChanges({ fields: ["email"], slots: ["pan_card"], note: "Please upload a clearer PAN card." });
  assert.ok(ok.ok);
  const noNote = parseRequestedChanges({ fields: ["gstin"], slots: [], note: "   " });
  assert.ok(noNote.ok && noNote.value.note === "", "ticked fields are enough on their own");
  assert.ok(parseRequestedChanges({ fields: [], slots: [], note: "hi" }).ok, "a note is enough on its own");
  const nothing = parseRequestedChanges({ fields: [], slots: [] });
  assert.ok(!nothing.ok && nothing.code === "NOTHING_REQUESTED", "asking for nothing is refused");
  const long = parseRequestedChanges({ fields: ["email"], slots: [], note: "x".repeat(1001) });
  assert.ok(!long.ok && long.code === "NOTE_TOO_LONG");
  const badField = parseRequestedChanges({ fields: ["password"], slots: [], note: "Change your password" });
  assert.ok(!badField.ok && badField.code === "UNKNOWN_FIELD");
  const badSlot = parseRequestedChanges({ fields: [], slots: ["selfie"], note: "Upload a selfie please" });
  assert.ok(!badSlot.ok && badSlot.code === "UNKNOWN_DOCUMENT");
});

// ── Mail ─────────────────────────────────────────────────────────────────────

test("secrets are scrubbed from error text, the longest first", () => {
  assert.equal(scrubSecrets("550 rejected: body had Pa55word!", ["Pa55word!"]), "550 rejected: body had [redacted]");
  assert.equal(scrubSecrets("abc abcd", ["abc", "abcd"]), "[redacted] [redacted]");
  assert.equal(scrubSecrets("nothing here", []), "nothing here");
  assert.equal(scrubSecrets("x", [""]), "x", "an empty secret doesn't blank the text");
});

test("with no SMTP configured, sending says so and throws nothing", async () => {
  assert.equal(isMailerConfigured(), false);
  const result = await sendMail({ to: "a@example.com", subject: "s", text: "t", html: "h", secrets: ["pw"] });
  assert.deepEqual(result, { ok: false, error: "not configured" });
});

test("a Google app password sets up Gmail SMTP, but only with the account it belongs to", () => {
  try {
    process.env.google_app_pass = "abcd efgh ijkl mnop";
    assert.equal(isMailerConfigured(), false, "no SMTP_USER: Gmail would refuse every send");
    assert.equal(mailSender(), null);
    process.env.SMTP_USER = "alerts@example.com";
    assert.equal(isMailerConfigured(), true);
    assert.equal(mailSender(), "Bombino Express <alerts@example.com>");
    process.env.MAIL_FROM = "Bombino Team <alerts@example.com>";
    assert.equal(mailSender(), "Bombino Team <alerts@example.com>", "an explicit From wins");
    delete process.env.SMTP_USER;
    process.env.MAIL_FROM = "team@example.com";
    assert.equal(isMailerConfigured(), true, "MAIL_FROM alone names the Google login");
    assert.equal(mailSender(), "Bombino Express <team@example.com>", "a bare address gets the brand name");
  } finally {
    delete process.env.google_app_pass;
    delete process.env.SMTP_USER;
    delete process.env.MAIL_FROM;
  }
  assert.equal(isMailerConfigured(), false);
});

test("the team's new-application email: contact details and a link, nothing injected", () => {
  const mail = applicationAlertEmail({
    name: "Sharma <b>Exports</b>",
    accountTypeLabel: "Corporate",
    phone: "9876543210",
    email: "accounts@sharma.in",
    submittedAt: "2026-09-15T05:00:00Z",
    resent: false,
    link: "https://app.example.com/ops/applications/abc",
  });
  assert.match(mail.subject, /^New account application: Sharma <b>Exports<\/b> \(Corporate\)$/);
  assert.match(mail.text, /\+91 9876543210/);
  assert.match(mail.text, /https:\/\/app\.example\.com\/ops\/applications\/abc/);
  assert.doesNotMatch(mail.html, /<b>Exports/, "the name is escaped in the html");
  assert.doesNotMatch(mail.html, /Call us on/, "no customer support footer on a team email");
  const resent = applicationAlertEmail({
    name: "A",
    accountTypeLabel: "Personal",
    phone: "9",
    email: "a@b.co",
    submittedAt: "2026-09-15T05:00:00Z",
    resent: true,
    link: "x",
  });
  assert.match(resent.subject, /^Changes sent back: /);
});

test("a reviewer's check is its own mark: Cashfree's verdict is advice, and stays as it was", async () => {
  const { isAcceptedOcrStatus, isDocumentVerified, isStaffVerified, verificationState } = await import(
    "../shared/accountSpec.js"
  );
  assert.ok(isAcceptedOcrStatus("match") && isAcceptedOcrStatus("bypassed"));
  for (const not of ["unreadable", "unavailable", "manual", null, undefined, ""]) {
    assert.equal(isAcceptedOcrStatus(not), false, `${String(not)} is not a Cashfree pass`);
  }
  // A Cashfree match is not a staff check.
  assert.equal(isStaffVerified({ ocr_verified_at: null }), false);
  assert.ok(isStaffVerified({ ocr_verified_at: "2026-09-15T10:00:00Z" }));
  // Verified overall: checked by a reviewer, or (older accounts) passed by Cashfree.
  assert.ok(isDocumentVerified({ doc_slot: "pan_card", ocr_status: "unreadable", ocr_verified_at: "2026-09-15T10:00:00Z" }));
  assert.ok(isDocumentVerified({ doc_slot: "pan_card", ocr_status: "match" }));
  const before = verificationState("personal", null, [
    { doc_slot: "aadhaar_card", ocr_status: "unreadable" },
    { doc_slot: "pan_card", ocr_status: "match" },
  ]);
  assert.deepEqual(before.unverified, ["aadhaar_card"]);
  const after = verificationState("personal", null, [
    { doc_slot: "aadhaar_card", ocr_status: "unreadable", ocr_verified_at: "2026-09-15T10:00:00Z" },
    { doc_slot: "pan_card", ocr_status: "match" },
  ]);
  assert.equal(after.verified, true);
});

test("the customer's received email: what happens next, guest booking meanwhile, nothing injected", () => {
  const first = applicationReceivedEmail({ name: "Asha <i>x</i>", phone: "9000000002", accountTypeLabel: "Personal", resent: false });
  assert.equal(first.subject, "We've received your Bombino account application");
  assert.match(first.text, /personal account/);
  assert.match(first.text, /email you again when your account is open/);
  assert.match(first.text, /\+91 9000000002/);
  assert.doesNotMatch(first.html, /<i>x<\/i>/, "the name is escaped");
  assert.match(first.html, /Call us on/, "customer emails keep the support footer");
  const again = applicationReceivedEmail({ name: "Asha", phone: "9000000002", accountTypeLabel: "Personal", resent: true });
  assert.equal(again.subject, "We've received your changes");
});

test("alert recipients: valid, de-duplicated, lower-cased, at most five", () => {
  const ok = alertEmailsSchema.safeParse([" Ops@Bombino.com ", "ops@bombino.com", "b@x.io"]);
  assert.ok(ok.success);
  assert.deepEqual(ok.data, ["ops@bombino.com", "b@x.io"]);
  assert.equal(alertEmailsSchema.safeParse(["not-an-email"]).success, false);
  assert.equal(alertEmailsSchema.safeParse(["a@x.io", "b@x.io", "c@x.io", "d@x.io", "e@x.io", "f@x.io"]).success, false);
  assert.ok(alertEmailsSchema.safeParse([]).success, "an empty list turns the emails off");
});

test("the account-ready email: the login as agreed, numbers to their last four, nothing injected", () => {
  const email = accountReadyEmail({
    name: "Asha <script>alert(1)</script>",
    phone: "9000000002",
    accountTypeLabel: "Personal",
    customerCode: "BOM123",
    itdEmail: "asha@example.com",
    itdPassword: "Pa55word!",
    documents: [
      { label: "Aadhaar card", number: "234567890123", status: "Verified" },
      { label: "PAN card", number: "ABCDE1234F", status: "On file" },
    ],
  });
  assert.match(email.text, /Pa55word!/);
  assert.match(email.html, /Pa55word!/);
  assert.match(email.text, /••0123/);
  assert.match(email.text, /••234F/);
  assert.ok(!email.text.includes("234567890123"), "full Aadhaar in the text");
  assert.ok(!email.html.includes("234567890123"), "full Aadhaar in the html");
  assert.ok(!email.html.includes("<script>"), "html not escaped");
  assert.match(email.text, /sign in with your mobile number/i);
});

test("change and rejection emails quote the team and carry no login", () => {
  const changes = changesRequestedEmail({
    name: "Asha",
    note: "Your PAN photo is blurred.",
    fieldLabels: ["Email"],
    documentLabels: ["PAN card"],
  });
  assert.match(changes.text, /Your PAN photo is blurred\./);
  assert.match(changes.text, /PAN card \(upload again\)/);
  const noNote = changesRequestedEmail({ name: "Asha", note: "", fieldLabels: ["GST number"], documentLabels: [] });
  assert.match(noNote.text, /- GST number/);
  assert.doesNotMatch(noNote.html, /<blockquote/, "no empty quote when there is no note");
  const rejected = rejectedEmail({ name: "Asha", reason: "Duplicate of an existing account" });
  assert.match(rejected.text, /Duplicate of an existing account/);
  assert.match(rejected.text, /book shipments as a guest/);
});

test("maskNumber keeps four characters at most", () => {
  assert.equal(maskNumber("234567890123"), "••0123");
  assert.equal(maskNumber("12 34"), "••1234");
  assert.equal(maskNumber(null), "");
});

// ── BIA ──────────────────────────────────────────────────────────────────────

test("BIA's word on an application: the team's note verbatim, no promised date, the profile button", () => {
  const waiting = describeApplication(toCustomerView(row({ status: "in_review" })));
  assert.match(waiting, /no set time/i);
  assert.match(waiting, /TAP_GUEST_PROFILE/);

  const changes = describeApplication(
    toCustomerView(
      row({
        status: "changes_requested",
        requested_changes: { fields: ["gstin"], slots: ["gst_certificate"], note: "The certificate is for another GSTIN." },
      })
    )
  );
  assert.match(changes, /"The certificate is for another GSTIN\."/);
  assert.match(changes, /GST number/);
  assert.match(changes, /Make the change/);

  const approved = describeApplication(toCustomerView(row({ status: "approved" })));
  assert.match(approved, /sign in again/i);
  assert.doesNotMatch(approved, /TAP_GUEST_PROFILE/, "an account holder isn't sent to the guest profile");
});
