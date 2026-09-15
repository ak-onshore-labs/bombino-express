/**
 * The emails an account application sends. Pure: text in, subject/text/html out.
 *
 * Identity numbers appear as their last four digits and nothing more, and no
 * identity document is ever attached. An Aadhaar image in an inbox is a copy of
 * it we no longer control.
 */

const SUPPORT_PHONE = "+91 22 6640 0000";

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The last four characters, the rest dotted out. */
export function maskNumber(value: string | null | undefined): string {
  const v = (value ?? "").replace(/\s+/g, "");
  if (v.length <= 4) return v ? `••${v}` : "";
  return `••${v.slice(-4)}`;
}

function layout(title: string, bodyHtml: string, audience: "customer" | "team" = "customer"): string {
  return [
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1f2937;font-size:14px;line-height:1.55">',
    '<div style="background:#C62828;color:#fff;padding:16px 20px;font-size:18px;font-weight:bold">Bombino Express</div>',
    `<div style="padding:20px"><h1 style="font-size:18px;margin:0 0 12px">${escapeHtml(title)}</h1>${bodyHtml}`,
    audience === "customer"
      ? `<p style="color:#6b7280;font-size:12px;margin-top:24px">Questions? Call us on ${SUPPORT_PHONE}, or use WhatsApp Support in the app.</p>`
      : '<p style="color:#6b7280;font-size:12px;margin-top:24px">Sent to the Bombino team by the ops console. Change who gets these on the Applications page.</p>',
    "</div></div>",
  ].join("");
}

// ── To the Bombino team ─────────────────────────────────────────────────────

export interface ApplicationAlertInput {
  name: string;
  accountTypeLabel: string;
  phone: string;
  email: string;
  submittedAt: string;
  /** The customer sent back the changes they were asked for. */
  resent: boolean;
  /** The application in the ops console. */
  link: string;
}

function istTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })} IST`;
}

/**
 * "A new application is waiting." Contact details only: no identity numbers,
 * no documents. Whoever picks it up reads those in the console, where each
 * view is logged.
 */
export function applicationAlertEmail(input: ApplicationAlertInput): RenderedEmail {
  const what = input.resent ? "Changes sent back" : "New account application";
  const subject = `${what}: ${input.name} (${input.accountTypeLabel})`;
  const lead = input.resent
    ? "A customer has sent back the changes they were asked for. It is back in the queue as new."
    : "A new account application is waiting for the Bombino team.";
  const text = [
    lead,
    "",
    `Name: ${input.name}`,
    `Account: ${input.accountTypeLabel}`,
    `Phone: +91 ${input.phone}`,
    `Email: ${input.email}`,
    `Sent: ${istTime(input.submittedAt)}`,
    "",
    `Review it: ${input.link}`,
  ].join("\n");
  const html = layout(
    what,
    [
      `<p>${escapeHtml(lead)}</p>`,
      '<table style="border-collapse:collapse;margin:8px 0 16px">',
      row("Name", input.name),
      row("Account", input.accountTypeLabel),
      row("Phone", `+91 ${input.phone}`),
      row("Email", input.email),
      row("Sent", istTime(input.submittedAt)),
      "</table>",
      `<p><a href="${escapeHtml(input.link)}" style="display:inline-block;background:#C62828;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:bold">Review the application</a></p>`,
    ].join(""),
    "team"
  );
  return { subject, text, html };
}

function row(label: string, value: string): string {
  return `<tr><td style="padding:4px 12px 4px 0;color:#6b7280">${escapeHtml(label)}</td><td style="padding:4px 0;font-weight:bold">${escapeHtml(value)}</td></tr>`;
}

export interface DocumentOnFile {
  label: string;
  number: string | null;
  /** "Verified" or "On file". */
  status: string;
}

export interface AccountReadyInput {
  name: string;
  phone: string;
  accountTypeLabel: string;
  customerCode: string | null;
  itdEmail: string;
  itdPassword: string;
  documents: DocumentOnFile[];
}

export function accountReadyEmail(input: AccountReadyInput): RenderedEmail {
  const subject = "Your Bombino account is ready";
  const docsText = input.documents
    .map((d) => `  - ${d.label}${d.number ? ` ${maskNumber(d.number)}` : ""}: ${d.status}`)
    .join("\n");

  const text = [
    `Hello ${input.name},`,
    "",
    "Your Bombino Express account is open.",
    "",
    `In the app: sign in with your mobile number (+91 ${input.phone}). We send you a code on WhatsApp; you don't need a password in the app.`,
    "",
    "Your ITD login, for the Bombino/ITD customer portal:",
    `  Email:    ${input.itdEmail}`,
    `  Password: ${input.itdPassword}`,
    "Keep this safe, and change the password after your first sign-in to the portal.",
    "",
    `Account type: ${input.accountTypeLabel}`,
    ...(input.customerCode ? [`Customer code: ${input.customerCode}`] : []),
    "",
    "Documents on file:",
    docsText || "  (none)",
    "",
    "Your signed contract is attached.",
    "",
    `Questions? Call us on ${SUPPORT_PHONE}, or use WhatsApp Support in the app.`,
  ].join("\n");

  const html = layout(
    "Your account is ready",
    [
      `<p>Hello ${escapeHtml(input.name)},</p>`,
      "<p>Your Bombino Express account is open.</p>",
      `<p><strong>In the app:</strong> sign in with your mobile number (+91 ${escapeHtml(input.phone)}). We send you a code on WhatsApp; you don't need a password in the app.</p>`,
      '<p style="margin-bottom:4px"><strong>Your ITD login</strong>, for the Bombino/ITD customer portal:</p>',
      `<table style="border-collapse:collapse">${row("Email", input.itdEmail)}${row("Password", input.itdPassword)}</table>`,
      '<p style="color:#b91c1c">Keep this safe, and change the password after your first sign-in to the portal.</p>',
      `<table style="border-collapse:collapse">${row("Account type", input.accountTypeLabel)}${
        input.customerCode ? row("Customer code", input.customerCode) : ""
      }</table>`,
      '<p style="margin-bottom:4px"><strong>Documents on file</strong></p>',
      input.documents.length > 0
        ? `<ul style="margin-top:0">${input.documents
            .map(
              (d) =>
                `<li>${escapeHtml(d.label)}${d.number ? ` ${escapeHtml(maskNumber(d.number))}` : ""}: ${escapeHtml(d.status)}</li>`
            )
            .join("")}</ul>`
        : "<p>(none)</p>",
      "<p>Your signed contract is attached.</p>",
    ].join("")
  );

  return { subject, text, html };
}

export interface ChangesRequestedInput {
  name: string;
  /** Optional; empty when the reviewer only ticked fields and documents. */
  note: string;
  fieldLabels: string[];
  documentLabels: string[];
}

export function changesRequestedEmail(input: ChangesRequestedInput): RenderedEmail {
  const subject = "Your Bombino application needs a change";
  const items = [...input.fieldLabels, ...input.documentLabels.map((d) => `${d} (upload again)`)];
  const text = [
    `Hello ${input.name},`,
    "",
    "The Bombino team needs a change before they can open your account:",
    ...(input.note ? ["", input.note] : []),
    ...(items.length > 0 ? ["", ...items.map((i) => `  - ${i}`)] : []),
    "",
    "Open the Bombino app, sign in with your mobile number and go to My Profile to make the change. You can keep booking as a guest in the meantime.",
  ].join("\n");
  const html = layout(
    "Your application needs a change",
    [
      `<p>Hello ${escapeHtml(input.name)},</p>`,
      "<p>The Bombino team needs a change before they can open your account:</p>",
      input.note
        ? `<blockquote style="border-left:3px solid #C62828;margin:0;padding:4px 12px">${escapeHtml(input.note)}</blockquote>`
        : "",
      items.length > 0 ? `<ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>` : "",
      "<p>Open the Bombino app, sign in with your mobile number and go to <strong>My Profile</strong> to make the change. You can keep booking as a guest in the meantime.</p>",
    ].join("")
  );
  return { subject, text, html };
}

export interface ApplicationReceivedInput {
  name: string;
  phone: string;
  accountTypeLabel: string;
  /** They sent back the changes they were asked for, rather than a first application. */
  resent: boolean;
}

/**
 * "We have your application." Sent the moment signup files it, so the customer
 * has something in their inbox that says what happens next. No details beyond
 * the account type: nothing here needs an identity number.
 */
export function applicationReceivedEmail(input: ApplicationReceivedInput): RenderedEmail {
  const subject = input.resent
    ? "We've received your changes"
    : "We've received your Bombino account application";
  const lead = input.resent
    ? "Thank you. We've received the changes you sent, and the Bombino team will look at your application again."
    : `Thank you for applying for a Bombino ${input.accountTypeLabel.toLowerCase()} account. We've received your application, and the Bombino team is now setting up your account.`;
  const next =
    "We'll email you again when your account is open, with your login details. If anything needs changing, we'll tell you what, and you can make the change in the app under My Profile.";
  const meanwhile = `In the meantime you can book shipments as a guest with +91 ${input.phone}. They move into your account when it opens.`;
  const text = [`Hello ${input.name},`, "", lead, "", next, "", meanwhile].join("\n");
  const html = layout(
    input.resent ? "We've received your changes" : "We've received your application",
    [
      `<p>Hello ${escapeHtml(input.name)},</p>`,
      `<p>${escapeHtml(lead)}</p>`,
      `<p>${escapeHtml(next)}</p>`,
      `<p>${escapeHtml(meanwhile)}</p>`,
    ].join("")
  );
  return { subject, text, html };
}

export interface RejectedInput {
  name: string;
  reason: string;
}

export function rejectedEmail(input: RejectedInput): RenderedEmail {
  const subject = "About your Bombino account application";
  const text = [
    `Hello ${input.name},`,
    "",
    "The Bombino team could not open this account:",
    "",
    input.reason,
    "",
    "You can still book shipments as a guest with your mobile number, and apply again at any time.",
  ].join("\n");
  const html = layout(
    "We couldn't open this account",
    [
      `<p>Hello ${escapeHtml(input.name)},</p>`,
      "<p>The Bombino team could not open this account:</p>",
      `<blockquote style="border-left:3px solid #C62828;margin:0;padding:4px 12px">${escapeHtml(input.reason)}</blockquote>`,
      "<p>You can still book shipments as a guest with your mobile number, and apply again at any time.</p>",
    ].join("")
  );
  return { subject, text, html };
}
