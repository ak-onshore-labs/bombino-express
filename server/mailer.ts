/**
 * Email, over Bombino's own SMTP server.
 *
 *   SMTP_HOST, SMTP_PORT (default 587), SMTP_USER, SMTP_PASS, MAIL_FROM
 *
 * For now a Google account sends everything, with an app password:
 *
 *   MAIL_FROM=<the Gmail / Workspace address>   GOOGLE_APP_PASS=<app password>
 *
 * With GOOGLE_APP_PASS set (also read as `google_app_pass`), SMTP_HOST defaults
 * to smtp.gmail.com on 465, SMTP_PASS to the app password, and the login
 * (SMTP_USER) to the MAIL_FROM address, or the other way round: either one
 * names both, since Gmail sends only as the account it logs in as. A bare
 * address is shown as "Bombino Express <address>". Moving to Bombino's own
 * server later is setting SMTP_* explicitly.
 *
 * Port 465 is implicit TLS; anything else starts plain and upgrades with
 * STARTTLS, which nodemailer requires the server to offer (`requireTLS`), so a
 * misconfigured server fails to send rather than sending a login in the clear.
 *
 * Not configured is a normal state until Bombino hands over the details: every
 * send then returns `{ ok: false, error: "not configured" }`, the caller records
 * that, and ops can resend once it is set. Nothing throws.
 *
 * ── Secrets ────────────────────────────────────────────────────────────────
 *
 * The account-ready email carries the customer's ITD password (their choice of
 * design, not ours — see docs/account-review.md). So every error that leaves
 * this module is scrubbed of the strings the caller marks as secret before it
 * can reach a log line or the `email_error` column. An SMTP server that echoes
 * part of a rejected message back in its error must not put a password in our
 * database.
 */

import nodemailer, { type Transporter } from "nodemailer";

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: MailAttachment[];
  /** Removed from any error text before it is returned or logged. */
  secrets?: string[];
}

export type MailResult = { ok: true; messageId: string } | { ok: false; error: string };

interface MailConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

/** The address in "Name <a@b.c>" or a bare "a@b.c"; empty when there is none. */
function addressIn(value: string): string {
  const m = value.match(/<([^>]+)>/) ?? value.match(/([^\s<>"]+@[^\s<>"]+)/);
  return m ? m[1].trim() : "";
}

/** Explicit SMTP_* wins; a Google app password fills in the rest. */
function mailConfig(): MailConfig | null {
  const googlePass = (process.env.GOOGLE_APP_PASS || process.env.google_app_pass || "").replace(/\s+/g, "");
  const rawFrom = (process.env.MAIL_FROM ?? "").trim();
  // With a Google account the login is the From address, so either one names both.
  const user = (process.env.SMTP_USER ?? "").trim() || (googlePass ? addressIn(rawFrom) : "");
  const host = (process.env.SMTP_HOST ?? "").trim() || (googlePass ? "smtp.gmail.com" : "");
  const port = Number(process.env.SMTP_PORT || (googlePass && !process.env.SMTP_HOST ? "465" : "587"));
  const pass = process.env.SMTP_PASS || googlePass;
  // A bare address gets the brand as its display name, so inboxes show "Bombino Express".
  const from = rawFrom
    ? rawFrom.includes("<")
      ? rawFrom
      : `Bombino Express <${rawFrom}>`
    : user
      ? `Bombino Express <${user}>`
      : "";
  if (!host || !from) return null;
  // Gmail refuses every send without a login, so a half-set Google config is not configured.
  if (host === "smtp.gmail.com" && (!user || !pass)) return null;
  return { host, port, user, pass, from };
}

export function isMailerConfigured(): boolean {
  return mailConfig() !== null;
}

/** For the console: who mail goes out as, or null when nothing can be sent. */
export function mailSender(): string | null {
  return mailConfig()?.from ?? null;
}

let transport: Transporter | null = null;

function getTransport(config: MailConfig): Transporter {
  if (transport) return transport;
  const { port } = config;
  transport = nodemailer.createTransport({
    host: config.host,
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    auth: config.user ? { user: config.user, pass: config.pass } : undefined,
    // A hung SMTP server must not hold an ops request open for minutes.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return transport;
}

/** Replace every secret in `text` with a marker. Longest first, so no secret leaves a fragment of another. */
export function scrubSecrets(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const secret of [...secrets].filter((s) => s.length > 0).sort((a, b) => b.length - a.length)) {
    out = out.split(secret).join("[redacted]");
  }
  return out;
}

export async function sendMail(message: MailMessage): Promise<MailResult> {
  const config = mailConfig();
  if (!config) return { ok: false, error: "not configured" };
  // The mail password is a secret too: an auth error must never echo it.
  const secrets = [...(message.secrets ?? []), config.pass];
  try {
    const info = await getTransport(config).sendMail({
      from: config.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      attachments: message.attachments,
    });
    return { ok: true, messageId: String(info.messageId ?? "") };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const error = scrubSecrets(raw, secrets).slice(0, 500);
    // The recipient only, never the body: the body is where the password is.
    console.error(`[mailer] send to ${message.to} failed: ${error}`);
    return { ok: false, error };
  }
}

/** Called once at boot. Loud only when account review is on and nothing can be sent. */
export function warnIfMailerMissing(accountReviewEnabled: boolean): void {
  if (!accountReviewEnabled || isMailerConfigured()) return;
  console.warn(
    [
      "",
      "  ############################################################",
      "  ##  ACCOUNT_REVIEW is on but SMTP is not configured.",
      "  ##  Approved customers will get no account email; ops can",
      "  ##  resend it once SMTP_USER + GOOGLE_APP_PASS (or SMTP_HOST",
      "  ##  and MAIL_FROM) are set.",
      "  ############################################################",
      "",
    ].join("\n")
  );
}
