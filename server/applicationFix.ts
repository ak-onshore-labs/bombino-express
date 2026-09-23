/**
 * Fixing an application the Bombino team sent back (account review).
 *
 * The team ticks what is wrong — some fields, some documents — and the customer
 * changes exactly those. They are a guest on the number the application was
 * filed under, and that guest session is the proof they own it: `guestRef` can
 * only have been minted by an OTP on `guestPhone`, and it is the ref the
 * application's documents live under. So no fresh code is asked for, and
 * nothing outside what the team ticked is theirs to change on the way back.
 *
 * Everything else signup checks still runs on the resend (the identity
 * numbers, the full document set, the GSTIN); this only decides who may make
 * the change and what the resend is allowed to carry.
 */

import type { Request, Response } from "express";

import { isAccountReviewEnabled } from "./accountApplications.js";
import { getOpenApplicationByPhone, listApplicationEvents, type ApplicationRow } from "./accountApplicationsDb.js";
import { listDocumentsBySignupRef } from "./accountDocsDb.js";
import {
  DOC_SLOT_SPECS,
  isCompanyCategory,
  isDocSlot,
  requiredDocuments,
  requiredIdentityChecks,
  type DocSlot,
  type VerifiedDocSlot,
} from "../shared/accountSpec.js";
import { listIdentityVerificationsBySignupRef } from "./identityDb.js";
import { IDENTITY_KIND_BY_SLOT } from "./identityChecks.js";

/**
 * The application this session may fix for `phone`, or null.
 *
 * Also points the session's staging handle at the application's own ref, so
 * the document and identity endpoints read and replace the files the team
 * reviewed. Left alone, `signupRefForPhone` would mint a fresh ref for a
 * session that never ran signup — and an empty ref is a whole signup again.
 */
export async function applicationToFix(req: Request, phone: unknown): Promise<ApplicationRow | null> {
  if (!isAccountReviewEnabled()) return null;
  if (typeof phone !== "string" || !phone) return null;
  const guestRef = req.session.guestRef;
  if (!guestRef || req.session.guestPhone !== phone) return null;

  const app = await getOpenApplicationByPhone(phone);
  if (!app || app.status !== "changes_requested" || app.signup_ref !== guestRef) return null;

  req.session.signupRef = app.signup_ref;
  req.session.signupPhone = phone;
  return app;
}

/**
 * The signup request a fix resends: what was filed, with only the fields the
 * team asked about taken from the customer.
 *
 * A field the team did not tick keeps its filed value whatever the request
 * says, so a fix cannot become a quiet rewrite of the rest. The contract is the
 * one already signed, by the same name, and is not signed again here.
 */
export function mergeFixBody(app: ApplicationRow, body: Record<string, unknown>): Record<string, unknown> {
  const asked = new Set(app.requested_changes?.fields ?? []);
  // Nulls are dropped: the export fields a category never asked for are
  // filed as null, and the signup schema reads a missing one as "not given".
  const merged: Record<string, unknown> = Object.fromEntries(
    Object.entries(app.details).filter(([, value]) => value !== null && value !== undefined),
  );
  for (const field of asked) {
    if (field in body) merged[field] = body[field];
  }
  merged.phone = app.phone;
  merged.contract_accepted = true;
  merged.contract_signed_name = app.contract_signed_name;
  if (app.account_type === "company" && app.company_category) {
    merged.company_category = app.company_category;
  }
  return merged;
}

/**
 * The documents the team asked for that have not been uploaded since they
 * asked. A file counts as new if it was saved after the team sent the
 * application back.
 */
export async function slotsNotReplaced(app: ApplicationRow): Promise<DocSlot[]> {
  const asked = (app.requested_changes?.slots ?? []).filter(isDocSlot);
  if (asked.length === 0) return [];
  // When the team asked: the latest changes_requested event. The row's own
  // updated_at is a fallback only, since an email status write can move it.
  const events = await listApplicationEvents(app.id);
  const askedAt = events
    .filter((e) => e.event === "changes_requested")
    .map((e) => new Date(e.created_at).getTime())
    .reduce((a, b) => Math.max(a, b), 0);
  const since = askedAt || new Date(app.updated_at).getTime();
  const docs = await listDocumentsBySignupRef(app.signup_ref);
  const fresh = new Set(
    docs.filter((d) => new Date(d.updated_at).getTime() > since).map((d) => d.doc_slot),
  );
  return asked.filter((slot) => !fresh.has(slot));
}

export const FIX_NOT_OPEN_MESSAGE =
  "This application isn't waiting on changes from you any more. Refresh your profile to see where it stands.";

/** Refuse the resend while a document the team asked for is still the old file. */
export async function assertFixedSlotsReplaced(app: ApplicationRow, res: Response): Promise<boolean> {
  const missing = await slotsNotReplaced(app);
  if (missing.length === 0) return true;
  res.status(422).json({
    message: `Please upload again: ${missing.map((slot) => DOC_SLOT_SPECS[slot].label).join(", ")}.`,
    code: "DOCUMENTS_NOT_REPLACED",
  });
  return false;
}

export interface FixNeeds {
  /** Documents the team asked to see again and that haven't been uploaded since. */
  asked: DocSlot[];
  /** Asked for, and already uploaded again since the team asked. */
  replaced: DocSlot[];
  /**
   * Documents the application must have and doesn't: never uploaded, lost,
   * or on file without the number it was checked against. The resend fails on
   * these whether the team ticked them or not, so the customer is shown them.
   */
  missing: DocSlot[];
}

/** What the fix screen has to ask for, from what is actually on file. */
export async function fixNeeds(app: ApplicationRow): Promise<FixNeeds> {
  const category = isCompanyCategory(app.company_category) ? app.company_category : null;
  const required = requiredDocuments(app.account_type, category);
  const [docs, identities, pending] = await Promise.all([
    listDocumentsBySignupRef(app.signup_ref),
    listIdentityVerificationsBySignupRef(app.signup_ref),
    slotsNotReplaced(app),
  ]);
  const onFile = new Set(docs.map((d) => d.doc_slot));
  const numbers = new Set(identities.map((i) => i.kind));
  // The numbers the resend insists on: the same list signup's
  // assertIdentityVerified checks, so this screen and that refusal agree.
  const numberRequired = new Set<DocSlot>(requiredIdentityChecks(app.account_type, category));
  const missing = required.filter(
    (slot) =>
      !onFile.has(slot) ||
      (numberRequired.has(slot) && !numbers.has(IDENTITY_KIND_BY_SLOT[slot as VerifiedDocSlot])),
  );
  const asked = (app.requested_changes?.slots ?? []).filter(isDocSlot);
  return {
    asked: pending,
    replaced: asked.filter((slot) => !pending.includes(slot) && !missing.includes(slot)),
    missing: [...missing],
  };
}
