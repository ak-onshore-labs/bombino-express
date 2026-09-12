import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CloudUpload, FileText, Loader2 } from 'lucide-react';
import { DOC_SLOT_SPECS } from '@shared/accountSpec';
import { validateAadhaar } from '@shared/aadhaar';
import type { DocUploadCard, KycDocumentType } from '@shared/biaCards';
import { explainError } from '@shared/errorCatalog';
import { explainDocumentIssue, type DocumentIssue } from '@shared/ocrExplain';
import { KYC_QUERY_KEY } from '@/hooks/useKycOnFile';
import { VERIFICATION_QUERY_KEY } from '@/hooks/useVerificationState';
import { AADHAAR_DISPLAY_MAX_LENGTH, readAadhaarInput } from '@/lib/aadhaarInput';
import { DOCUMENTS_CHANGED_EVENT } from '@/lib/biaEvents';
import { apiRequest } from '@/lib/queryClient';
import { cn } from '@/lib/utils';
import { CARD } from './cardStyles';

/**
 * A document upload inside the chat (shared/biaCards.ts §DocUploadCard): BIA's
 * first action, and the customer's own tap. It posts to the same endpoint the
 * screen uses, which checks who is calling — the card adds no way in.
 *
 * No full ID number passes through BIA. When the account endpoint needs the
 * number on file, it's read from the account's own document list at upload
 * time; when there is none, or it's a guest's identity document, the customer
 * types it here, and it goes straight to the upload.
 *
 * Afterwards the screens that show documents are told, so Profile and the
 * booking form show the new file without a reload.
 */

const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const MAX_FILE_SIZE = 4 * 1024 * 1024; // 4MB, as the upload endpoints enforce

/** POST /api/kyc/upload's own patterns, for a guest's typed number. */
const KYC_NUMBER: Record<KycDocumentType, { label: string; pattern: RegExp; maxLength: number; uppercase: boolean }> = {
  'Aadhaar Number': { label: 'Aadhaar number', pattern: /^\d{12}$/, maxLength: 12, uppercase: false },
  'PAN Number': { label: 'PAN', pattern: /^[A-Z]{5}[0-9]{4}[A-Z]$/, maxLength: 10, uppercase: true },
  'Passport Number': { label: 'Passport number', pattern: /^[A-Z0-9]{7,8}$/, maxLength: 8, uppercase: true },
  'Driving Licence': { label: 'Licence number', pattern: /^[A-Z0-9-]{5,20}$/, maxLength: 20, uppercase: true },
  'GSTIN (Normal)': { label: 'GST number', pattern: /^[A-Z0-9]{15}$/, maxLength: 15, uppercase: true },
};

type Phase =
  | { kind: 'idle' }
  | { kind: 'uploading' }
  | { kind: 'uploaded' }
  /** Kept, but its check didn't pass. */
  | { kind: 'unchecked'; issue: DocumentIssue }
  /** Turned away by the endpoint. */
  | { kind: 'refused'; issue: DocumentIssue | null; message: string }
  /** Signed out, or a guest's phone check no longer on this device. */
  | { kind: 'signin' }
  | { kind: 'failed'; message: string };

export function DocUploadCardView({
  card,
  turnId,
  onNavigate,
}: {
  card: DocUploadCard;
  turnId?: string;
  onNavigate: (to: string) => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState('');
  const [digits, setDigits] = useState('');
  const [display, setDisplay] = useState('');
  const [numberError, setNumberError] = useState('');
  /** Set when the number on file turns out not to be readable after all. */
  const [askNumber, setAskNumber] = useState(card.needsNumber);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  const isAadhaar = card.target === 'kyc' ? card.documentType === 'Aadhaar Number' : card.slot === 'aadhaar_card';
  const numberSpec =
    card.target === 'kyc' && card.documentType
      ? KYC_NUMBER[card.documentType]
      : card.slot
        ? (() => {
            const f = DOC_SLOT_SPECS[card.slot].numberField;
            return f ? { label: f.label, pattern: f.pattern, maxLength: f.maxLength, uppercase: f.uppercase } : null;
          })()
        : null;
  const done = phase.kind === 'uploaded';

  const pick = (chosen: File | undefined): void => {
    if (!chosen) return;
    if (!ALLOWED_MIME_TYPES.has(chosen.type)) {
      setFile(null);
      setFileError('Only PDF, JPEG or PNG files are accepted.');
      return;
    }
    if (chosen.size > MAX_FILE_SIZE) {
      setFile(null);
      setFileError('The file must be under 4MB.');
      return;
    }
    setFileError('');
    setFile(chosen);
    if (phase.kind !== 'uploading') setPhase({ kind: 'idle' });
  };

  const checkNumber = (): string | null => {
    if (!askNumber || !numberSpec) return null;
    if (isAadhaar) {
      const verdict = validateAadhaar(digits);
      return verdict.valid ? null : (verdict.message ?? 'Enter the 12-digit Aadhaar number.');
    }
    return numberSpec.pattern.test(digits) ? null : `Enter the ${numberSpec.label} as printed on the document.`;
  };

  /** The whole number on file, read from the account's own list; null if it can't be. */
  const numberOnFile = async (): Promise<string | null> => {
    try {
      const res = await fetch('/api/account/documents', { credentials: 'include', cache: 'no-store' });
      if (!res.ok) return null;
      const body = (await res.json()) as { documents?: { doc_slot: string; document_no: string | null }[] };
      return body.documents?.find((d) => d.doc_slot === card.slot)?.document_no ?? null;
    } catch {
      return null;
    }
  };

  const report = (outcome: 'uploaded' | 'unchecked' | 'refused' | 'failed'): void => {
    if (!turnId) return;
    void apiRequest('POST', '/api/support/upload-outcome', { turnId, outcome }).catch(() => undefined);
  };

  const upload = async (): Promise<void> => {
    if (!file) return;
    const problem = checkNumber();
    if (problem) {
      setNumberError(problem);
      return;
    }
    setNumberError('');
    setPhase({ kind: 'uploading' });

    let documentNo = askNumber ? digits : '';
    if (!askNumber && card.target === 'account' && numberSpec) {
      const onFile = await numberOnFile();
      if (!onFile) {
        // The number on file couldn't be read back; ask for it instead.
        setAskNumber(true);
        setPhase({ kind: 'idle' });
        return;
      }
      documentNo = onFile;
    }

    const form = new FormData();
    form.append('file', file);
    if (card.target === 'account' && card.slot) {
      form.append('doc_slot', card.slot);
      if (documentNo) form.append('document_no', documentNo);
    } else if (card.documentType) {
      form.append('document_type', card.documentType);
      form.append('document_no', documentNo);
    }

    try {
      const res = await fetch(card.target === 'account' ? '/api/account/documents' : '/api/kyc/upload', {
        method: 'POST',
        body: form,
        credentials: 'include',
      });
      const body = (await res.json().catch(() => ({}))) as {
        message?: string;
        code?: string;
        ocr?: { status?: string };
      };
      if (res.status === 401) {
        setPhase({ kind: 'signin' });
        report('refused');
        return;
      }
      if (!res.ok) {
        const message = body.message ?? 'The upload didn’t go through. Please try again.';
        setPhase({ kind: 'refused', issue: explainDocumentIssue({ code: body.code }), message });
        // A refused file isn't worth sending again; the retry picks a new one.
        setFile(null);
        report('refused');
        return;
      }

      const issue = explainDocumentIssue({ verdict: body.ocr?.status });
      setPhase(issue ? { kind: 'unchecked', issue } : { kind: 'uploaded' });
      report(issue ? 'unchecked' : 'uploaded');
      setFile(null);
      // The screens that show this document read it again.
      void queryClient.invalidateQueries({ queryKey: VERIFICATION_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: KYC_QUERY_KEY });
      window.dispatchEvent(new CustomEvent(DOCUMENTS_CHANGED_EVENT, { detail: { target: card.target, slot: card.slot } }));
    } catch {
      setPhase({ kind: 'failed', message: 'The upload didn’t go through. Check your connection and try again.' });
      report('failed');
    }
  };

  const signinCopy = explainError('phone_unverified');

  return (
    <div className={cn(CARD, 'flex flex-col gap-2')} data-testid={`bia-card-docupload-${card.slot ?? 'kyc'}`}>
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 shrink-0 text-[#FBAD1F]" aria-hidden />
        <span className="flex-1 text-sm font-semibold text-white">Upload your {card.label}</span>
      </div>

      {done ? (
        <p className="flex items-center gap-1.5 text-xs text-emerald-200" role="status" data-testid="bia-docupload-done">
          <CheckCircle2 className="h-4 w-4" aria-hidden /> Uploaded. Your {card.label} is on file.
        </p>
      ) : (
        <>
          {!askNumber && card.numberEnding && (
            <p className="text-[11px] text-white/60">Checked against the number on file ending {card.numberEnding}.</p>
          )}
          {askNumber && numberSpec && (
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-white/70">
                {numberSpec.label}
                {card.numberEnding ? ` (on file: ending ${card.numberEnding})` : ''}
              </span>
              <input
                type="text"
                inputMode={isAadhaar ? 'numeric' : 'text'}
                autoComplete="off"
                spellCheck={false}
                maxLength={isAadhaar ? AADHAAR_DISPLAY_MAX_LENGTH : numberSpec.maxLength}
                value={isAadhaar ? display : digits}
                onChange={(e) => {
                  if (isAadhaar) {
                    const next = readAadhaarInput(e.target);
                    setDigits(next.digits);
                    setDisplay(next.display);
                  } else {
                    const v = e.target.value.replace(/\s+/g, '');
                    setDigits(numberSpec.uppercase ? v.toUpperCase() : v);
                  }
                  setNumberError('');
                }}
                className="rounded-lg border border-white/15 bg-white/[0.06] px-2.5 py-1.5 font-mono text-sm tracking-wide text-white placeholder:text-white/30 focus:border-[#FBAD1F]/60 focus:outline-none"
                placeholder={
                  isAadhaar ? 'XXXX XXXX XXXX' : ((card.slot && DOC_SLOT_SPECS[card.slot].numberField?.placeholder) ?? '')
                }
                data-testid="input-bia-docupload-number"
              />
              {numberError && <span className="text-[11px] text-red-300" role="alert">{numberError}</span>}
            </label>
          )}

          <input
            ref={fileInput}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            className="hidden"
            onChange={(e) => {
              pick(e.target.files?.[0]);
              e.target.value = '';
            }}
            data-testid="input-bia-docupload-file"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={phase.kind === 'uploading'}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.06] px-2.5 py-1.5 text-xs text-white/85 hover:bg-white/[0.1] disabled:opacity-50"
              data-testid="button-bia-docupload-choose"
            >
              <CloudUpload className="h-3.5 w-3.5" aria-hidden />
              {file ? 'Choose another file' : phase.kind === 'unchecked' || phase.kind === 'refused' ? phase.issue?.retryLabel ?? 'Choose a file' : 'Choose a file'}
            </button>
            {file && (
              <button
                type="button"
                onClick={() => void upload()}
                disabled={phase.kind === 'uploading'}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#FBAD1F] px-3 py-1.5 text-xs font-semibold text-[#1a1208] hover:bg-[#fcb93c] disabled:opacity-60"
                data-testid="button-bia-docupload-upload"
              >
                {phase.kind === 'uploading' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
                {phase.kind === 'uploading' ? 'Uploading…' : 'Upload'}
              </button>
            )}
          </div>
          {file && <p className="truncate text-[11px] text-white/60">{file.name}</p>}
          {fileError && <p className="text-[11px] text-red-300" role="alert">{fileError}</p>}
          <p className="text-[10.5px] text-white/40">PDF, JPEG or PNG · max 4MB</p>
        </>
      )}

      {(phase.kind === 'unchecked' || (phase.kind === 'refused' && phase.issue)) && (
        <div
          className={cn(
            'rounded-lg px-2.5 py-1.5 text-[11px] leading-snug',
            phase.kind === 'refused' ? 'bg-red-400/15 text-red-100' : 'bg-amber-400/15 text-amber-100'
          )}
          role={phase.kind === 'refused' ? 'alert' : 'status'}
          data-testid="bia-docupload-issue"
        >
          <p className="font-semibold">{phase.issue!.headline}</p>
          <p>
            {phase.issue!.why} {phase.issue!.fix}
          </p>
        </div>
      )}
      {phase.kind === 'refused' && !phase.issue && (
        <p className="text-[11px] text-red-300" role="alert" data-testid="bia-docupload-issue">{phase.message}</p>
      )}
      {phase.kind === 'failed' && <p className="text-[11px] text-red-300" role="alert">{phase.message}</p>}
      {phase.kind === 'signin' && (
        <div className="flex flex-col items-start gap-1.5 rounded-lg bg-red-400/15 px-2.5 py-1.5 text-[11px] leading-snug text-red-100" role="alert" data-testid="bia-docupload-signin">
          <p className="font-semibold">{card.target === 'kyc' ? signinCopy?.title : 'You’re signed out'}</p>
          <p>
            {card.target === 'kyc'
              ? 'This upload goes against the number you verified, and that check is no longer on this device. Verify your phone on the Ship screen, then try again here.'
              : 'Sign in again, then try the upload once more.'}
          </p>
          <button
            type="button"
            onClick={() => onNavigate(card.target === 'kyc' ? '/create' : '/login')}
            className="font-semibold text-white underline underline-offset-2"
          >
            {card.target === 'kyc' ? 'Go to Ship' : 'Sign in'}
          </button>
        </div>
      )}
    </div>
  );
}
