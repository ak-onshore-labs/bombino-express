/**
 * The handover from an in-flight signup to the account that comes out of it.
 *
 * Everything a signup staged is owned by a `signupRef` — documents, identity
 * verifications, and any bookings the same number made as a guest. At account
 * creation those rows are re-parented to the new user, and with account review
 * on the same details are filed as an application instead.
 *
 * Claiming is best effort and deliberately non-fatal: an account that exists
 * with an unclaimed document is recoverable by ops, while refusing to create
 * the account leaves the customer with neither.
 *
 * Lifted verbatim out of the closure inside `registerRoutes`. Behaviour is
 * unchanged.
 */

import type { Request, Response } from "express";

import type { CompanyCategory } from "../shared/accountSpec.js";
import { CONTRACT_VERSION } from "../shared/contract.js";
import { fileApplication } from "./accountApplications.js";
import { PHONE_UNVERIFIED } from "./signupRef.js";
import { toCustomerView, type ApplicationRow } from "./accountApplicationsDb.js";
import { claimSignupDocuments } from "./accountDocsDb.js";
import { claimSignupIdentityVerifications } from "./identityDb.js";
import { claimGuestOrdersForUser } from "./ordersDb.js";
import { deleteGuestProfilesFor } from "./guestProfileDb.js";

/** The columns an acceptance writes, with the evidence to go alongside it. */
export function contractColumns(
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

/**
 * The end of signup under account review: file the application and answer
 * with it. The customer stays a guest on this number until the Bombino team
 * approves it (server/accountApproval.ts).
 *
 * `signupRef` is always present here: assertDocumentsStaged has just found
 * the documents under it.
 */
export async function respondWithApplication(
  req: Request,
  res: Response,
  input: {
    phone: string;
    accountType: "personal" | "company";
    category: CompanyCategory | null;
    details: Parameters<typeof fileApplication>[1]["details"];
    contract_signed_name: string;
    /**
     * A fix of an application the team sent back (server/applicationFix.ts):
     * the contract it was filed with stands, with its original time and IP,
     * because nothing was signed again.
     */
    keepContractOf?: ApplicationRow | null;
  }
): Promise<void> {
  const signupRef = req.session.signupRef;
  if (!signupRef) {
    res.status(400).json({ message: "Your signup has expired. Please start again.", code: PHONE_UNVERIFIED });
    return;
  }
  const filed = await fileApplication(req, {
    phone: input.phone,
    signupRef,
    accountType: input.accountType,
    category: input.category,
    details: input.details,
    contract: input.keepContractOf
      ? {
          contract_signed_name: input.keepContractOf.contract_signed_name,
          contract_version: input.keepContractOf.contract_version,
          contract_accepted_at: input.keepContractOf.contract_accepted_at,
          contract_accepted_ip: input.keepContractOf.contract_accepted_ip,
        }
      : contractColumns(req, input.contract_signed_name),
  });
  if (!filed.ok) {
    res.status(filed.status).json({ message: filed.message, code: filed.code });
    return;
  }
  req.session.save((err) => {
    if (err) console.error("[signup/application] session save error:", err);
    res.status(202).json({
      status: "application_submitted" as const,
      application: toCustomerView(filed.value.row),
    });
  });
}

/** Move the staged documents onto the new account; never fatal to signup. */
export async function claimDocumentsForUser(req: Request, userId: string): Promise<void> {
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
export async function claimGuestBookingsForUser(req: Request, phone: string, userId: string): Promise<void> {
  try {
    const claimed = await claimGuestOrdersForUser(phone, userId);
    if (claimed.orders > 0) {
      console.log(`[signup] claimed ${claimed.orders} guest order(s) for ${userId}`);
    }

    // The guest profile has no reader once an account exists: signup wrote
    // the name, email and company details to itd_users, and the claim above
    // moved everything that hung off the ref. Leaving it would keep a second
    // copy of a customer's personal data that nothing ever reads again.
    const dropped = await deleteGuestProfilesFor(phone, claimed.refs);
    if (dropped > 0) {
      console.log(`[signup] removed ${dropped} guest profile row(s) for ${phone}`);
    }
  } catch (err) {
    console.error("[signup] claiming guest bookings failed:", err);
  }
  delete req.session.guestRef;
  delete req.session.guestPhone;
}
