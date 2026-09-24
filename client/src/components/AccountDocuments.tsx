import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_UPLOAD_BYTES, isAllowedUploadType } from '@shared/upload';
import { useLocation } from 'wouter';
import type { BiaScreen } from '@shared/biaScreen';
import { DocumentSlotCard } from '@/components/documents/DocumentSlotCard';
import type { SlotState } from '@/components/documents/accountDocumentSlot';
import { ocrErrorCode } from '@shared/errorCatalog';
import {
} from 'lucide-react';
import {
  DOC_SLOT_SPECS,
  isVerifiedDocSlot,
  requiredDocuments,
  type AccountKind,
  type CompanyCategory,
  type DocSlot,
} from '@shared/accountSpec';
import { validateAadhaar } from '@shared/aadhaar';



const EMPTY_SLOT: SlotState = {
  status: 'idle',
  documentNo: '',
  numberRecorded: false,
  recording: false,
  fileName: '',
  error: '',
  ocrNote: '',
  errorCode: null,
};

/**
 * The OCR outcomes the server will open an account on.
 *
 * `bypassed` is OCR_BYPASS=1 on the server: the document was stored without
 * being checked at all, on purpose, because there is no Cashfree production
 * account yet. Leaving it out here would gate Continue on a verdict that is
 * never coming.
 *
 * Note this is the one gate standing behind an Aadhaar number now — nothing
 * verifies the number itself since DigiLocker was removed — so OCR_BYPASS=1
 * leaves an Aadhaar slot backed by nothing whatsoever.
 */
const OCR_ACCEPTED = new Set(['match', 'bypassed']);

/**
 * Whether a slot counts as done.
 *
 * Deliberately the same rule the server applies in assertDocumentsStaged: a
 * slot nothing checks is always fine, and one that is checked must have come
 * back `match` — or `bypassed`, which is the server saying it was told not to
 * look. Anything else — unreadable, unavailable, or a row from before any of
 * this existed with no status at all — leaves the slot outstanding, because
 * the server will refuse to open an account on it.
 *
 * Keyed on isVerifiedDocSlot rather than isOcrCheckedSlot so the GST
 * certificate counts: Cashfree has no OCR type for one, but it is read all the
 * same (server/gstCertificate.ts) and the server gates on it.
 *
 * `staffReview` (signup with account review on): the Bombino team verifies
 * every document by hand before the account opens, so any stored document is
 * enough here, Cashfree's first-layer verdict notwithstanding. A document that
 * contradicted its number was refused at upload and is never stored.
 */
function isSlotVerified(slot: string, ocrStatus: string | null | undefined, staffReview = false): boolean {
  if (!isVerifiedDocSlot(slot)) return true;
  if (staffReview) return true;
  return OCR_ACCEPTED.has(ocrStatus ?? '');
}

interface AccountDocumentsProps {
  accountType: AccountKind;
  category: CompanyCategory | null;
  /**
   * The verified number — the server's authorisation for a pre-account upload.
   * Omitted on the `account` endpoint, where the session is the authorisation.
   */
  phone?: string;
  /**
   * The name this account is for: the individual's, or the company's. Only the
   * GST portal lookup reads it — it answers with the registered business and
   * the two have to agree — so it is only needed on the `signup` endpoint.
   */
  accountName?: string;
  /**
   * The GST number typed at the details step. Not re-typed here — it is a
   * first-class field on the form, and asking twice would invite the two to
   * disagree. Empty on a personal account, which has no GST slot.
   */
  gstin?: string;
  /**
   * Which pair of endpoints to talk to.
   *
   *   signup   /api/signup/documents  — staged against the session's signupRef,
   *                                     authorised by a recently verified phone
   *   account  /api/account/documents — owned by the signed-in user
   *
   * The two are deliberately the same component. A customer replacing a
   * document after the account is open meets the identical form they met at
   * signup, and the slot list, the number validation and the OCR feedback
   * cannot drift apart between the two places they appear.
   *
   * The difference is where the typed number is proved. On `signup` it is
   * recorded first, through /api/signup/identity/*, and the upload is judged
   * against the stored value. On `account` there is no staging step and no OTP
   * to authorise one — the session is the authorisation — so the number rides
   * with the upload as `document_no` and is judged there.
   */
  endpoint?: 'signup' | 'account';
  /** Fires with the slots still outstanding, so the parent can gate its button. */
  onMissingChange: (missing: DocSlot[]) => void;
  /** Slots the parent wants marked, after a blocked submit. */
  highlight?: readonly DocSlot[];
  /**
   * The OTP that authorised this signup has expired.
   *
   * On the `signup` endpoint every request here is authorised by a recent
   * verification of the phone, not by a session — there is no account yet —
   * and that expires after ten minutes. Filling in a document screen takes
   * longer than that often enough that it is ordinary, not an edge case, and
   * once it happens every button here fails identically. The parent sends the
   * customer back to request a new code rather than leaving them to guess.
   *
   * Unused on the `account` endpoint, which has a session and cannot hit this.
   */
  onPhoneUnverified?: () => void;
  /** Fires after any successful upload, with whatever the endpoint returned. */
  onUploaded?: (body: unknown) => void;
}

/**
 * The compelled document set for one account shape, and the numbers that go
 * with it.
 *
 * The numbers used to live on a step of their own, ahead of this one. They do
 * not any more: a number and the document that has to carry it are one thing,
 * and splitting them across two screens meant a customer typed an Aadhaar,
 * moved on, and only found out a screen later that the card they had did not
 * match it. Each slot now asks for both, in that order.
 *
 * The order is not cosmetic. The upload endpoint takes the number it compares
 * against from identity_verifications rather than from the request, so the
 * number has to be recorded before a file can be sent — which is also what
 * stops a client typing one number and uploading a card for another.
 *
 * Uploads land before the account exists — they are staged server-side
 * against the session and claimed at creation — so nothing here needs a login.
 * The slot list comes from `shared/accountSpec.ts`, the same file the server
 * validates against, so the form cannot ask for less than the server demands.
 */
export function AccountDocuments({
  accountType,
  category,
  phone,
  accountName = '',
  gstin = '',
  endpoint = 'signup',
  onMissingChange,
  highlight,
  onPhoneUnverified,
  onUploaded,
}: AccountDocumentsProps): React.JSX.Element {
  const slots = requiredDocuments(accountType, category);
  const basePath = endpoint === 'account' ? '/api/account/documents' : '/api/signup/documents';
  const [state, setState] = useState<Record<string, SlotState>>({});
  // Where "Ask BIA" says the customer is: their account's documents, a guest
  // opening an account, or the documents step of signup.
  const [location] = useLocation();
  const biaScreen: Omit<BiaScreen, 'errorCode'> =
    endpoint === 'account'
      ? { surface: 'documents' }
      : location.startsWith('/guest-profile')
        ? { surface: 'guest_profile' }
        : {
            surface: 'signup',
            step: 'documents',
            ...(accountType === 'personal' ? { account: 'personal' } : category ? { account: category } : {}),
          };
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});
  /** A file chosen before its number was valid; uploaded as soon as it is. */
  const pendingFiles = useRef<Record<string, File | null>>({});
  /** Signup with account review on: the team checks each document by hand (see isSlotVerified). */
  const staffReview = useRef(false);
  /** TEMPORARY: false while the server has document checks off (shared/aadhaar.ts). */
  const aadhaarCheckDigits = useRef(true);
  /**
   * TEMPORARY: false while the server skips the GST portal (IDENTITY_BYPASS).
   * The GST number is then saved as part of the upload, with no Verify step.
   */
  const [gstinLookup, setGstinLookup] = useState(true);

  const getSlot = useCallback(
    (slot: DocSlot): SlotState => state[slot] ?? EMPTY_SLOT,
    [state],
  );

  const patchSlot = useCallback((slot: DocSlot, patch: Partial<SlotState>): void => {
    setState((prev) => ({ ...prev, [slot]: { ...(prev[slot] ?? EMPTY_SLOT), ...patch } }));
  }, []);

  /**
   * Whether a refusal is the phone verification having run out.
   *
   * Keyed on the code rather than the message, so rewording the copy on the
   * server cannot quietly break the recovery path. Calling this hands the
   * decision to the parent, which owns the step machine.
   */
  const isPhoneUnverified = useCallback(
    (body: { code?: string } | null): boolean => {
      if (body?.code !== 'phone_unverified') return false;
      onPhoneUnverified?.();
      return true;
    },
    [onPhoneUnverified],
  );

  /**
   * Arriving at this step starts the number-bearing slots clean, every time.
   *
   * The server is told to discard what it holds before anything is read back
   * — see POST /api/signup/identity/reset. A number typed on an earlier run
   * reappearing on a later one is not a convenience; on a shared device it is
   * somebody else's Aadhaar on a stranger's screen. Clearing the number means
   * clearing the card that was checked against it, or the screen would show a
   * verified upload above an empty field.
   *
   * What survives is the slots that carry no number — an electricity bill, an
   * authorization letter — because nothing about those goes stale, and making
   * somebody find the file again buys nothing. Those are read back below.
   */
  useEffect(() => {
    let cancelled = false;
    // A change of phone is a different signup; drop what the last one staged.
    setState({});
    void (async () => {
      // Signup only. On the account endpoint there is nothing staged to
      // discard, the documents on screen are the customer's own, and
      // /api/signup/identity/* would refuse a request with no verified phone
      // behind it.
      if (endpoint === 'signup') {
        try {
          const reset = await fetch('/api/signup/identity/reset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone }),
            credentials: 'include',
          });
          // An HTML 200 is not a successful reset. The dev server answers an
          // unmatched /api path with index.html and a 200, so a route that is
          // not there — a server running older code, most likely — otherwise
          // reads as "cleared" and the stale numbers below quietly survive.
          const body = (await reset.json().catch(() => null)) as
            | { cleared?: boolean; code?: string }
            | null;
          // The commonest reason to be refused here, and the only recoverable
          // one: ten minutes have passed since the OTP.
          if (isPhoneUnverified(body)) return;
          if (!reset.ok || body === null) {
            console.error(
              '[signup/documents] identity reset did not run. If this is local, restart the server —',
              'the route is missing from the process handling requests.',
            );
          }
        } catch {
          // Offline, or the session is gone. Nothing is shown either way, and
          // every number is about to be retyped — each write replaces whatever
          // survived on the server.
        }
      }

      if (cancelled) return;

      try {
        // The signup endpoint is authorised by the verified phone, so it goes
        // in the query; the account endpoint reads the session.
        const res = await fetch(
          endpoint === 'signup' && phone
            ? `${basePath}?phone=${encodeURIComponent(phone)}`
            : basePath,
          { credentials: 'include' },
        );
        if (!res.ok) return;
        const body = (await res.json()) as {
          staff_review?: boolean;
          aadhaar_check_digits?: boolean;
          gstin_lookup?: boolean;
          documents: Array<{
            doc_slot: string;
            document_no: string | null;
            original_filename: string;
            ocr_status: string | null;
          }>;
        };
        if (cancelled) return;
        staffReview.current = endpoint === 'signup' && body.staff_review === true;
        aadhaarCheckDigits.current = body.aadhaar_check_digits !== false;
        setGstinLookup(body.gstin_lookup !== false);
        setState((prev) => {
          const next = { ...prev };
          for (const doc of body.documents) {
            // A slot already being worked on locally wins — the in-flight
            // upload is newer than whatever this response describes.
            if (next[doc.doc_slot]?.status === 'uploading') continue;
            // The reset above deleted every slot that carries a number, so
            // anything still here is one that does not. Guarded anyway: a
            // failed reset must not resurrect a number-bearing slot whose
            // identity row is now gone, which would show as done and then be
            // refused at account creation.
            // Signup only, and only because the reset above deleted the
            // identity rows these slots were checked against. On the account
            // endpoint nothing was reset and these are the customer's own
            // verified documents — hiding them would show an empty form to
            // someone who has already finished, and report them as missing.
            if (endpoint === 'signup' && isVerifiedDocSlot(doc.doc_slot)) continue;
            const verified = isSlotVerified(doc.doc_slot, doc.ocr_status, staffReview.current);
            next[doc.doc_slot] = {
              ...(next[doc.doc_slot] ?? EMPTY_SLOT),
              status: verified ? 'success' : 'unverified',
              documentNo: doc.document_no ?? '',
              fileName: doc.original_filename,
              error: '',
              ocrNote: verified
                ? ''
                : 'This document could not be verified. Please upload it again.',
              // A row with no verdict at all predates the checks: explained as
              // unverified rather than left without a reason.
              errorCode: verified ? null : (ocrErrorCode(doc.ocr_status) ?? 'DOCUMENTS_UNVERIFIED'),
            };
          }
          return next;
        });
      } catch {
        // Offline or a dead session: the slots stay empty and re-uploading
        // replaces the rows anyway.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone, basePath, endpoint]);


  // Report upward on every change. The parent gates "create account" on this,
  // and the server refuses the same set independently.
  useEffect(() => {
    // 'unverified' deliberately does not count as complete: the server refuses
    // to open an account on a document OCR never read, so letting Continue
    // through here would only fail two screens later.
    onMissingChange(slots.filter((slot) => (state[slot]?.status ?? 'idle') !== 'success'));
    // `slots` is derived from the two props above, so it changes with them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, accountType, category]);

  /**
   * Whether this slot is ready to accept a file.
   *
   * For a slot the server checks, that means its number is already recorded —
   * the pattern passing is not enough, because the upload endpoint reads the
   * number from identity_verifications and refuses when there is no row. A
   * slot nothing checks has nothing to wait for.
   */
  const isReadyToUpload = (slot: DocSlot): boolean => {
    if (isVerifiedDocSlot(slot)) return getSlot(slot).numberRecorded;
    const field = DOC_SLOT_SPECS[slot].numberField;
    if (!field) return true;
    return field.pattern.test(getSlot(slot).documentNo);
  };

  /**
   * Local validation for a typed number, ahead of sending it.
   *
   * Aadhaar goes through shared/aadhaar.ts rather than the bare twelve-digit
   * pattern in DOC_SLOT_SPECS, so the Verhoeff check digit is caught here —
   * one keystroke after the typo, instead of by the server a request later.
   */
  const checkNumber = (slot: DocSlot, value: string): { ok: boolean; message?: string } => {
    const field = DOC_SLOT_SPECS[slot].numberField;
    if (!field) return { ok: true };
    if (slot === 'aadhaar_card') {
      const verdict = validateAadhaar(value, { checkDigits: aadhaarCheckDigits.current });
      return { ok: verdict.valid, message: verdict.message };
    }
    return field.pattern.test(value) ? { ok: true } : { ok: false, message: field.error };
  };

  async function performUpload(slot: DocSlot, file: File, documentNo: string): Promise<void> {
    patchSlot(slot, { status: 'uploading', fileName: file.name, error: '', ocrNote: '', errorCode: null });

    const formData = new FormData();
    formData.append('file', file);
    formData.append('doc_slot', slot);
    // Only the signup endpoint takes it; the account one reads the session.
    if (phone) formData.append('phone', phone);
    if (documentNo) formData.append('document_no', documentNo);

    try {
      const res = await fetch(basePath, {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({ message: 'Upload failed.' }))) as {
          message: string;
          code?: string;
        };
        if (isPhoneUnverified(body)) {
          // Put the file back in hand, so returning with a fresh code does not
          // also cost the customer finding it again.
          pendingFiles.current[slot] = file;
          patchSlot(slot, { status: 'pending', fileName: file.name, error: '' });
          return;
        }
        patchSlot(slot, { status: 'error', error: body.message, errorCode: body.code ?? null });
        return;
      }
      const body = (await res.json().catch(() => ({}))) as {
        ocr?: { status?: string; message?: string };
        staff_review?: boolean;
      };
      if (endpoint === 'signup' && typeof body.staff_review === 'boolean') staffReview.current = body.staff_review;
      const verified = isSlotVerified(slot, body.ocr?.status, staffReview.current);
      patchSlot(slot, {
        status: verified ? 'success' : 'unverified',
        fileName: file.name,
        error: '',
        ocrNote: verified ? '' : (body.ocr?.message ?? 'This document could not be verified.'),
        errorCode: verified ? null : (ocrErrorCode(body.ocr?.status) ?? 'DOCUMENTS_UNVERIFIED'),
      });
      pendingFiles.current[slot] = null;
      // The account endpoint returns the recomputed verification state with the
      // upload, so the warning banner can clear on this round trip rather than
      // after a refetch the customer waits for.
      onUploaded?.(body);
    } catch (err) {
      patchSlot(slot, {
        status: 'error',
        error: err instanceof Error ? err.message : 'Upload failed. Please try again.',
        errorCode: null,
      });
    }
  }

  /** Which identity endpoint records this slot's number. */
  const IDENTITY_PATH: Partial<Record<DocSlot, string>> = {
    aadhaar_card: '/api/signup/identity/aadhaar',
    pan_card: '/api/signup/identity/pan',
    gst_certificate: '/api/signup/identity/gstin',
  };

  /**
   * Send a slot's number to the server, so a file can then be judged against
   * it. Returns the value actually recorded, or null if it was refused.
   *
   * The GST call is the only one that reaches an authority, and the only one
   * that can be refused for a reason other than shape: a cancelled
   * registration, a business name that does not match the account. The other
   * two record what they are given.
   */
  async function recordNumber(slot: DocSlot, value: string): Promise<string | null> {
    // The account endpoint has no separate recording step: /api/signup/identity/*
    // is authorised by a recently verified phone, which a signed-in customer
    // coming back to finish does not have. Their number travels with the upload
    // as `document_no` and POST /api/account/documents judges the file against
    // it there. Same check, one request instead of two.
    if (endpoint !== 'signup') return value;
    const path = IDENTITY_PATH[slot];
    if (!path) return value;

    patchSlot(slot, { recording: true, error: '' });
    const body: Record<string, unknown> =
      slot === 'gst_certificate'
        ? { phone, gstin: value, name: accountName.trim() }
        : slot === 'aadhaar_card'
          ? { phone, aadhaar_number: value }
          : { phone, pan: value };

    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include',
      });
      const parsed = (await res.json().catch(() => ({}))) as {
        message?: string;
        document_no?: string;
        code?: string;
      };
      if (!res.ok) {
        if (isPhoneUnverified(parsed)) {
          patchSlot(slot, { recording: false, numberRecorded: false });
          return null;
        }
        patchSlot(slot, {
          recording: false,
          numberRecorded: false,
          status: 'error',
          error: parsed.message ?? 'Could not save this number. Please try again.',
          errorCode: parsed.code ?? null,
        });
        return null;
      }
      const recorded = parsed.document_no ?? value;
      patchSlot(slot, {
        recording: false,
        numberRecorded: true,
        documentNo: recorded,
        error: '',
        // A slot holding a file it could not send yet moves to `pending`; one
        // with nothing waiting goes back to idle with the number locked in.
        status: pendingFiles.current[slot] ? 'pending' : 'idle',
      });
      return recorded;
    } catch {
      patchSlot(slot, {
        recording: false,
        numberRecorded: false,
        status: 'error',
        error: 'Could not save this number. Please try again.',
        errorCode: null,
      });
      return null;
    }
  }

  /**
   * A typed number, keystroke by keystroke.
   *
   * Nothing is sent while it is being typed. The number is recorded when it
   * first becomes valid, because that is the point at which the upload below
   * it can be enabled — and a file already chosen and waiting goes up in the
   * same breath.
   */
  function handleNumberChange(slot: DocSlot, raw: string): void {
    const field = DOC_SLOT_SPECS[slot].numberField;
    if (!field) return;
    const current = getSlot(slot);
    // A recorded number is the value the server will judge the document
    // against. Changing it means the document no longer belongs to it, so the
    // field locks and the slot has to be cleared to start over.
    if (current.numberRecorded || current.recording) return;

    const stripped = raw.replace(field.uppercase ? /[^A-Za-z0-9]/g : /\D/g, '');
    const value = (field.uppercase ? stripped.toUpperCase() : stripped).slice(0, field.maxLength);

    const verdict = checkNumber(slot, value);
    if (!verdict.ok) {
      patchSlot(slot, {
        documentNo: value,
        numberRecorded: false,
        // Say nothing until the field is full — an error on every keystroke of
        // a twelve-digit number is noise, not help.
        error: value.length >= field.maxLength ? (verdict.message ?? field.error) : '',
        status: pendingFiles.current[slot] ? 'pending' : 'idle',
        fileName: pendingFiles.current[slot] ? current.fileName : '',
      });
      return;
    }

    patchSlot(slot, { documentNo: value, error: '' });
    void (async () => {
      const recorded = await recordNumber(slot, value);
      if (!recorded) return;
      const waiting = pendingFiles.current[slot];
      if (waiting) {
        pendingFiles.current[slot] = null;
        await performUpload(slot, waiting, recorded);
      }
    })();
  }

  /**
   * The GST number, which is not typed here — it comes from the details step,
   * so this is a button rather than a field. Billed, hence deliberate.
   */
  async function handleVerifyGstin(): Promise<void> {
    if (endpoint === 'signup' && !accountName.trim()) {
      patchSlot('gst_certificate', {
        status: 'error',
        error: 'Go back and enter the company name.',
        errorCode: null,
      });
      return;
    }
    const recorded = await recordNumber('gst_certificate', gstin.trim().toUpperCase());
    if (!recorded) return;
    const waiting = pendingFiles.current.gst_certificate;
    if (waiting) {
      pendingFiles.current.gst_certificate = null;
      await performUpload('gst_certificate', waiting, recorded);
    }
  }

  /** Unlock a recorded number so it can be retyped, dropping its document. */
  async function handleClearNumber(slot: DocSlot): Promise<void> {
    pendingFiles.current[slot] = null;
    patchSlot(slot, { ...EMPTY_SLOT });
    try {
      await fetch(`${basePath}/${slot}`, {
        method: 'DELETE',
        credentials: 'include',
      });
    } catch {
      // The slot is already cleared locally. The number row stays until the
      // next one replaces it, and no document points at it any more.
    }
  }

  async function handleFile(slot: DocSlot, file: File): Promise<void> {
    if (!isAllowedUploadType(file.type)) {
      // errorCode cleared too: a code left from an earlier upload would
      // explain the wrong problem in place of this message.
      patchSlot(slot, { status: 'error', error: 'Only PDF, JPEG, or PNG files are accepted.', errorCode: null });
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      patchSlot(slot, { status: 'error', error: 'File must be under 4MB.', errorCode: null });
      return;
    }

    // TEMPORARY: with the GST portal lookup off there is nothing to wait for.
    // Save the GST number from the details step and send the file in one go.
    if (
      slot === 'gst_certificate' &&
      !gstinLookup &&
      endpoint === 'signup' &&
      !getSlot(slot).numberRecorded &&
      gstin.trim().length === 15
    ) {
      patchSlot(slot, { status: 'uploading', fileName: file.name, error: '', errorCode: null });
      const recorded = await recordNumber(slot, gstin.trim().toUpperCase());
      if (recorded) await performUpload(slot, file, recorded);
      return;
    }

    if (!isReadyToUpload(slot)) {
      // Held until the number lands. The server would refuse this file now —
      // it judges a document against the recorded number, and there is none.
      pendingFiles.current[slot] = file;
      patchSlot(slot, { status: 'pending', fileName: file.name, error: '' });
      return;
    }
    await performUpload(slot, file, getSlot(slot).documentNo);
  }

  async function handleRemove(slot: DocSlot): Promise<void> {
    pendingFiles.current[slot] = null;
    patchSlot(slot, { status: 'idle', fileName: '', error: '' });
    try {
      await fetch(`${basePath}/${slot}`, {
        method: 'DELETE',
        credentials: 'include',
      });
    } catch {
      // The slot is already cleared locally, and re-uploading replaces the row
      // server-side, so a failed delete costs nothing the customer can see.
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {slots.length} document{slots.length === 1 ? '' : 's'} required. PDF, JPEG, or PNG · max 4MB
        each.
      </p>

      {slots.map((slot) => (
        <DocumentSlotCard
          key={slot}
          slot={slot}
          state={getSlot(slot)}
          endpoint={endpoint}
          accountName={accountName}
          biaScreen={biaScreen}
          gstinLookup={gstinLookup}
          gstin={gstin}
          // The server named this slot as one to fix; stop flagging it once it lands.
          flagged={Boolean(highlight?.includes(slot)) && getSlot(slot).status !== 'success'}
          registerInput={(s, el) => {
            fileInputs.current[s] = el;
          }}
          openPicker={(s) => fileInputs.current[s]?.click()}
          onFile={handleFile}
          onNumberChange={handleNumberChange}
          onClearNumber={handleClearNumber}
          onRemove={handleRemove}
          onVerifyGstin={handleVerifyGstin}
        />
      ))}
    </div>
  );
}

