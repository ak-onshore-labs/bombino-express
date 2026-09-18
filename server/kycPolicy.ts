/**
 * Who a document belongs to, and whether an account has produced the set it
 * owes — the rules the booking guard, the signup gate and the docket path all
 * have to agree on.
 *
 * `resolveKycOwner` is the write path's answer to "whose upload is this": it
 * verifies an OTP, refuses a number that already has an account, and mints a
 * signup ref as a side effect. That is why it is not part of
 * `server/sessionOwner.ts`, which only reads what a session already proved.
 *
 * Lifted verbatim out of the closure inside `registerRoutes`. Behaviour is
 * unchanged.
 */

import type { Request, Response } from "express";

import type { Order } from "../shared/orderContract.js";
import {
  DOC_SLOT_SPECS,
  isVerifiedDocSlot,
  verificationState,
  type CompanyCategory,
  type DocSlot,
} from "../shared/accountSpec.js";
import { findItdUserIdByPhone } from "./appDb.js";
import { getKycByGuestRef, getKycByUserId } from "./kycDb.js";
import { listDocumentsBySignupRef } from "./accountDocsDb.js";
import { seedSignupDocumentFromGuestKyc } from "./guestKycMirror.js";
import { isAccountReviewEnabled } from "./accountApplications.js";
import { IDENTITY_KIND_BY_SLOT, recordedIdentityNumbers } from "./identityChecks.js";
import { isPhoneVerifiedHere, signupRefForPhone } from "./signupRef.js";

/**
 * The KYC document behind an order, whoever booked it.
 *
 * An account order's document is owned by its user; a guest order's by the
 * ref it was staged under. Both produce the same row, because a guest is
 * compelled to produce the same documents — the difference is only where the
 * row hangs.
 *
 * This is what a docket path must use, and `docketAtBooking` below does.
 * POST /api/shipments still does not: that path reads the *caller's* KYC,
 * which is a documented bug predating guest booking (see
 * docs/final-phase/markdowns/open-items.md §4.0) and is still waiting on M5.
 * Reaching for `order.user_id` directly would refuse every guest docket.
 */
export async function kycForOrder(order: Pick<Order, "user_id"> & { guest_ref?: string | null }) {
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
export async function resolveKycOwner(
  req: Request,
  options?: { allowSessionGuest?: boolean }
): Promise<{ userId: string; guestRef: null } | { userId: null; guestRef: string } | null> {
  if (req.session.dbUserId) return { userId: req.session.dbUserId, guestRef: null };

  /**
   * Reading your own document, on a session that already proved the number.
   *
   * Opt-in, and only the GETs opt in. The ten-minute OTP window below is the
   * right rule for a WRITE — it is what stops a stale session uploading
   * against a number proved yesterday — but applied to a read it means a
   * returning guest cannot see the document they already gave us, and the
   * booking screen offers them an upload form for a document that is on
   * file.
   *
   * `session.guestRef` is not weaker proof for a read: it is minted only by
   * signupRefForPhone, which only ever runs after an OTP on that number, and
   * it is the same ref /api/guest/profile is already trusted to answer from.
   * The row it reaches is the caller's own by construction.
   */
  if (options?.allowSessionGuest && req.session.guestRef) {
    return { userId: null, guestRef: req.session.guestRef };
  }

  // A guest names the number they proved, and it is checked here rather than
  // trusted — the same shape /api/signup/documents uses. Falls back to the
  // session's own phone so a repeat upload need not resend it.
  const claimed =
    typeof req.body?.phone === "string" ? req.body.phone.trim() : req.session.signupPhone;
  if (!claimed) return null;

  const verified = await isPhoneVerifiedHere(req, claimed);
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
export function sameIdentityNumber(documentNo: string | null, recorded: string): boolean {
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

export async function assertDocumentsStaged(
  req: Request,
  res: Response,
  accountType: "personal" | "company",
  category: CompanyCategory | null,
  phone: string
): Promise<Map<DocSlot, { document_no: string | null; capability_id: string }> | null> {
  const signupRef = req.session.signupRef;
  // Seeded here as well as on the documents read, so a client that skipped
  // that screen — or reached this with a document uploaded since — is held
  // to what the customer has actually given us rather than to what one GET
  // happened to have copied.
  if (signupRef) await seedSignupDocumentFromGuestKyc(signupRef);
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
      code: "DOCUMENTS_MISSING",
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
  //
  // Except with account review on. Cashfree is then only the first layer:
  // the Bombino team opens and verifies every document by hand before the
  // account opens (no approval without it, server/accountApproval.ts), so a
  // scan Cashfree couldn't read goes through to them instead of stopping the
  // customer here. Mismatched, wrong or tampered documents never get this far:
  // those uploads are refused outright.
  if (unverified.length > 0 && !isAccountReviewEnabled()) {
    res.status(422).json({
      message:
        `We could not verify your ${unverified
          .map((slot) => DOC_SLOT_SPECS[slot].label)
          .join(" and ")}. Please upload a clear photo of the original and check the number you entered.`,
      unverified_documents: unverified,
      code: "DOCUMENTS_UNVERIFIED",
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
      code: "DOCUMENTS_OUTDATED",
    });
    return null;
  }

  return stagedBySlot;
}
