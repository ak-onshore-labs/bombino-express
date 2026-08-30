import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  CloudUpload,
  CheckCircle2,
  XCircle,
  Loader2,
  FileText,
  Trash2,
  AlertTriangle,
} from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  DOC_SLOT_SPECS,
  isVerifiedDocSlot,
  requiredDocuments,
  type AccountKind,
  type CompanyCategory,
  type DocSlot,
} from '@shared/accountSpec';
import { validateAadhaar } from '@shared/aadhaar';
import { cn } from '@/lib/utils';

const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

type SlotStatus = 'idle' | 'pending' | 'uploading' | 'success' | 'unverified' | 'error';

interface SlotState {
  status: SlotStatus;
  documentNo: string;
  /**
   * True once the server holds this slot's number in identity_verifications.
   *
   * The upload endpoint takes the number it compares against from that row,
   * not from the request, and 422s when there is none — so for a slot that
   * carries a number, recording it is a precondition of uploading anything.
   * The field locks at the same moment, because the row is what the document
   * will be judged against and letting the two drift is the whole problem.
   */
  numberRecorded: boolean;
  /** In flight to the identity endpoint; the upload waits on it. */
  recording: boolean;
  fileName: string;
  error: string;
  /**
   * Why the document is not verified, when it is not. A contradicting number,
   * the wrong document or a tamper signal never gets this far — the server
   * refuses those uploads outright. What lands here is an unreadable scan or
   * an unreachable verifier, and account creation refuses both, so the slot
   * stays outstanding rather than showing as done.
   */
  ocrNote: string;
}

const EMPTY_SLOT: SlotState = {
  status: 'idle',
  documentNo: '',
  numberRecorded: false,
  recording: false,
  fileName: '',
  error: '',
  ocrNote: '',
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
 */
function isSlotVerified(slot: string, ocrStatus: string | null | undefined): boolean {
  if (!isVerifiedDocSlot(slot)) return true;
  return OCR_ACCEPTED.has(ocrStatus ?? '');
}

interface AccountDocumentsProps {
  accountType: AccountKind;
  category: CompanyCategory | null;
  /** The verified number — the server's authorisation for a pre-account upload. */
  phone: string;
  /**
   * The name this account is for: the individual's, or the company's. Only the
   * GST check reads it — the portal answers with the registered business and
   * the two have to agree.
   */
  accountName: string;
  /**
   * The GST number typed at the details step. Not re-typed here — it is a
   * first-class field on the form, and asking twice would invite the two to
   * disagree. Empty on a personal account, which has no GST slot.
   */
  gstin?: string;
  /** Fires with the slots still outstanding, so the parent can gate its button. */
  onMissingChange: (missing: DocSlot[]) => void;
  /** Slots the parent wants marked, after a blocked submit. */
  highlight?: readonly DocSlot[];
  /**
   * The OTP that authorised this signup has expired.
   *
   * Every endpoint on this screen is authorised by a recent verification of
   * the phone, not by a session — there is no account yet — and that expires
   * after ten minutes. Filling in a document screen takes longer than that
   * often enough that it is ordinary, not an edge case, and once it happens
   * every button here fails identically. The parent sends the customer back
   * to request a new code rather than leaving them to guess.
   */
  onPhoneUnverified: () => void;
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
  accountName,
  gstin = '',
  onMissingChange,
  highlight,
  onPhoneUnverified,
}: AccountDocumentsProps): React.JSX.Element {
  const slots = requiredDocuments(accountType, category);
  const [state, setState] = useState<Record<string, SlotState>>({});
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});
  /** A file chosen before its number was valid; uploaded as soon as it is. */
  const pendingFiles = useRef<Record<string, File | null>>({});

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
      onPhoneUnverified();
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
      if (cancelled) return;

      try {
        const res = await fetch(
          `/api/signup/documents?phone=${encodeURIComponent(phone)}`,
          { credentials: 'include' },
        );
        if (!res.ok) return;
        const body = (await res.json()) as {
          documents: Array<{
            doc_slot: string;
            document_no: string | null;
            original_filename: string;
            ocr_status: string | null;
          }>;
        };
        if (cancelled) return;
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
            if (isVerifiedDocSlot(doc.doc_slot)) continue;
            const verified = isSlotVerified(doc.doc_slot, doc.ocr_status);
            next[doc.doc_slot] = {
              ...(next[doc.doc_slot] ?? EMPTY_SLOT),
              status: verified ? 'success' : 'unverified',
              documentNo: doc.document_no ?? '',
              fileName: doc.original_filename,
              error: '',
              ocrNote: verified
                ? ''
                : 'This document could not be verified. Please upload it again.',
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
  }, [phone]);

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
      const verdict = validateAadhaar(value);
      return { ok: verdict.valid, message: verdict.message };
    }
    return field.pattern.test(value) ? { ok: true } : { ok: false, message: field.error };
  };

  async function performUpload(slot: DocSlot, file: File, documentNo: string): Promise<void> {
    patchSlot(slot, { status: 'uploading', fileName: file.name, error: '', ocrNote: '' });

    const formData = new FormData();
    formData.append('file', file);
    formData.append('doc_slot', slot);
    formData.append('phone', phone);
    if (documentNo) formData.append('document_no', documentNo);

    try {
      const res = await fetch('/api/signup/documents', {
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
        throw new Error(body.message);
      }
      const body = (await res.json().catch(() => ({}))) as {
        ocr?: { status?: string; message?: string };
      };
      const verified = isSlotVerified(slot, body.ocr?.status);
      patchSlot(slot, {
        status: verified ? 'success' : 'unverified',
        fileName: file.name,
        error: '',
        ocrNote: verified ? '' : (body.ocr?.message ?? 'This document could not be verified.'),
      });
      pendingFiles.current[slot] = null;
    } catch (err) {
      patchSlot(slot, {
        status: 'error',
        error: err instanceof Error ? err.message : 'Upload failed. Please try again.',
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
    if (!accountName.trim()) {
      patchSlot('gst_certificate', {
        status: 'error',
        error: 'Go back and enter the company name.',
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
      await fetch(`/api/signup/documents/${slot}`, {
        method: 'DELETE',
        credentials: 'include',
      });
    } catch {
      // The slot is already cleared locally. The number row stays until the
      // next one replaces it, and no document points at it any more.
    }
  }

  async function handleFile(slot: DocSlot, file: File): Promise<void> {
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      patchSlot(slot, { status: 'error', error: 'Only PDF, JPEG, or PNG files are accepted.' });
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      patchSlot(slot, { status: 'error', error: 'File must be under 5MB.' });
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
      await fetch(`/api/signup/documents/${slot}`, {
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
        {slots.length} document{slots.length === 1 ? '' : 's'} required. PDF, JPEG, or PNG · max 5MB
        each.
      </p>

      {slots.map((slot) => {
        const spec = DOC_SLOT_SPECS[slot];
        const s = getSlot(slot);
        // A recorded number is the value the uploaded document is judged
        // against, so it stops being editable the moment it is banked.
        const locked = s.numberRecorded;
        const flagged = highlight?.includes(slot) && s.status !== 'success';
        // The GST number is not typed here; it comes from the details step.
        const isGst = slot === 'gst_certificate';

        return (
          <div
            key={slot}
            className={cn(
              'bg-card rounded-xl border p-4 shadow-sm space-y-3',
              flagged ? 'border-primary border-2 field-shake' : 'border-border',
            )}
            data-testid={`doc-slot-${slot}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <Label className="text-sm font-semibold">
                  {spec.label} <span className="text-red-400">*</span>
                </Label>
                <p className="text-[11px] text-muted-foreground mt-0.5">{spec.hint}</p>
              </div>
              <StatusPill status={s.status} />
            </div>

            {spec.numberField && (
              <div>
                <Label className="text-xs text-muted-foreground">
                  {spec.numberField.label} <span className="text-red-400">*</span>
                </Label>
                <Input
                  value={s.documentNo}
                  onChange={(e) => handleNumberChange(slot, e.target.value)}
                  placeholder={spec.numberField.placeholder}
                  maxLength={spec.numberField.maxLength}
                  inputMode={spec.numberField.uppercase ? 'text' : 'numeric'}
                  readOnly={locked || s.recording}
                  aria-readonly={locked || s.recording}
                  className={cn(
                    'h-11 mt-1 text-sm bg-muted/30 border-border rounded-xl',
                    !spec.numberField.uppercase && 'font-mono tracking-widest',
                    locked && 'text-muted-foreground cursor-not-allowed',
                  )}
                  data-testid={`doc-number-${slot}`}
                />
                {s.recording ? (
                  <p className="text-[10px] text-muted-foreground mt-1 inline-flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" /> Saving…
                  </p>
                ) : locked ? (
                  <p className="text-[10px] text-muted-foreground mt-1 inline-flex items-center gap-1.5">
                    <CheckCircle2 className="w-3 h-3 text-green-600" />
                    Saved — now upload the matching document.
                    <button
                      type="button"
                      onClick={() => void handleClearNumber(slot)}
                      className="underline"
                      data-testid={`doc-number-change-${slot}`}
                    >
                      Change
                    </button>
                  </p>
                ) : (
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Type it exactly as printed on the document.
                  </p>
                )}
              </div>
            )}

            {isGst && (
              <div>
                <Label className="text-xs text-muted-foreground">GST Number</Label>
                {/* Read-only: the GST number belongs to the details step. */}
                <Input
                  value={gstin}
                  readOnly
                  aria-readonly
                  placeholder="22AAAAA0000A1Z5"
                  className="h-11 mt-1 text-sm bg-muted/30 border-border rounded-xl font-mono tracking-wider text-muted-foreground"
                  data-testid="doc-number-gst_certificate"
                />
                {locked ? (
                  <p className="text-[10px] text-muted-foreground mt-1 inline-flex items-center gap-1.5">
                    <CheckCircle2 className="w-3 h-3 text-green-600" />
                    Verified on the GST portal — now upload the certificate.
                    <button
                      type="button"
                      onClick={() => void handleClearNumber(slot)}
                      className="underline"
                      data-testid="doc-number-change-gst_certificate"
                    >
                      Check again
                    </button>
                  </p>
                ) : (
                  <div className="mt-2 space-y-1">
                    <p className="text-[10px] text-muted-foreground">
                      Checked against <span className="font-medium">{accountName || '—'}</span>. To
                      change the number, go back a step.
                    </p>
                    <Button
                      type="button"
                      onClick={() => void handleVerifyGstin()}
                      disabled={gstin.trim().length !== 15 || s.recording}
                      className="h-9 rounded-xl"
                      data-testid="doc-gstin-verify"
                    >
                      {s.recording ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        'Verify GST number'
                      )}
                    </Button>
                  </div>
                )}
              </div>
            )}

            <input
              ref={(el) => {
                fileInputs.current[slot] = el;
              }}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(slot, file);
                e.target.value = '';
              }}
              data-testid={`doc-file-${slot}`}
            />

            <div
              role="button"
              tabIndex={0}
              onClick={() => fileInputs.current[slot]?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') fileInputs.current[slot]?.click();
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const file = e.dataTransfer.files[0];
                if (file) void handleFile(slot, file);
              }}
              className={cn(
                'border-2 border-dashed rounded-xl p-4 flex flex-col items-center justify-center gap-1.5 cursor-pointer transition-colors min-h-[84px] select-none',
                s.status === 'idle' && 'border-border hover:border-primary/50 hover:bg-primary/5',
                s.status === 'pending' && 'border-sky-300 bg-sky-50/50',
                s.status === 'unverified' && 'border-amber-400 bg-amber-50',
                s.status === 'uploading' && 'border-amber-300 bg-amber-50 pointer-events-none',
                s.status === 'success' && 'border-green-300 bg-green-50',
                s.status === 'error' && 'border-red-300 bg-red-50',
              )}
            >
              {s.status === 'idle' && (
                <>
                  <CloudUpload className="w-6 h-6 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">Tap to upload or drag &amp; drop</p>
                </>
              )}

              {s.status === 'pending' && (
                <>
                  <FileText className="w-6 h-6 text-sky-600" />
                  <p className="text-xs text-sky-900 font-medium truncate max-w-[200px]">
                    {s.fileName}
                  </p>
                  <p className="text-[10px] text-muted-foreground text-center px-1">
                    Enter a valid {spec.numberField?.label} to upload
                  </p>
                </>
              )}

              {s.status === 'uploading' && (
                <>
                  <Loader2 className="w-5 h-5 text-amber-600 animate-spin" />
                  <p className="text-xs text-amber-700 font-medium truncate max-w-[200px]">
                    {s.fileName}
                  </p>
                </>
              )}

              {s.status === 'success' && (
                <>
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                  <p className="text-xs text-green-700 font-medium truncate max-w-[200px]">
                    {s.fileName}
                  </p>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        fileInputs.current[slot]?.click();
                      }}
                      className="text-[11px] text-primary underline"
                    >
                      Change file
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleRemove(slot);
                      }}
                      className="text-[11px] text-muted-foreground underline inline-flex items-center gap-1"
                    >
                      <Trash2 className="w-3 h-3" /> Remove
                    </button>
                  </div>
                </>
              )}

              {s.status === 'unverified' && (
                <>
                  <AlertTriangle className="w-5 h-5 text-amber-600" />
                  <p className="text-xs text-amber-800 font-medium truncate max-w-[200px]">
                    {s.fileName}
                  </p>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputs.current[slot]?.click();
                    }}
                    className="text-[11px] text-primary underline"
                  >
                    Upload a clearer photo
                  </button>
                </>
              )}

              {s.status === 'error' && (
                <>
                  <XCircle className="w-5 h-5 text-red-500" />
                  <p className="text-xs text-red-600 text-center px-2">{s.error}</p>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputs.current[slot]?.click();
                    }}
                    className="text-[11px] text-primary underline"
                  >
                    Try again
                  </button>
                </>
              )}
            </div>

            {s.status === 'unverified' && s.ocrNote && (
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                {s.ocrNote}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function StatusPill({ status }: { status: SlotStatus }): React.JSX.Element {
  const config: Record<SlotStatus, { label: string; className: string }> = {
    idle: { label: 'Required', className: 'bg-muted text-muted-foreground' },
    pending: { label: 'Selected', className: 'bg-sky-100 text-sky-800' },
    uploading: { label: 'Checking…', className: 'bg-amber-100 text-amber-700' },
    // "Verified", not "Uploaded" — the document was read and it agreed.
    success: { label: 'Verified', className: 'bg-green-100 text-green-700' },
    unverified: { label: 'Not verified', className: 'bg-amber-100 text-amber-800' },
    error: { label: 'Failed', className: 'bg-red-100 text-red-600' },
  };
  const { label, className } = config[status];
  return (
    <span
      className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0', className)}
    >
      {label}
    </span>
  );
}
