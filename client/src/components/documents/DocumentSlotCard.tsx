import React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CloudUpload,
  FileText,
  Loader2,
  Trash2,
  XCircle,
} from 'lucide-react';
import { type BiaScreen } from '@shared/biaScreen';
import { DocumentIssueNote } from '@/components/DocumentIssueNote';
import { Label } from '@/components/ui/label';
import { AskBiaLink } from '@/components/bia/AskBiaLink';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatAadhaar } from '@shared/aadhaar';
import { AADHAAR_DISPLAY_MAX_LENGTH, readAadhaarInput } from '@/lib/aadhaarInput';
import { explainDocumentIssue } from '@shared/ocrExplain';
import { DOC_SLOT_SPECS, type DocSlot } from '@shared/accountSpec';
import { cn } from '@/lib/utils';
import type { SlotState, SlotStatus } from './accountDocumentSlot';

/**
 * One document slot, as the customer sees it: what is asked for, the number
 * that goes with it where there is one, the file, and whatever the reader made
 * of it.
 *
 * Lifted out of `AccountDocuments.tsx`, where this 300-line card sat inline
 * inside a `.map` in a 1,050-line component. It renders and reports; every
 * decision still belongs to its parent.
 */
export function DocumentSlotCard({
  slot,
  state,
  endpoint,
  accountName,
  biaScreen,
  gstinLookup,
  gstin,
  flagged,
  registerInput,
  openPicker,
  onFile,
  onNumberChange,
  onClearNumber,
  onRemove,
  onVerifyGstin,
}: {
  slot: DocSlot;
  state: SlotState;
  endpoint: 'signup' | 'account';
  accountName: string;
  biaScreen: Omit<BiaScreen, 'errorCode'>;
  gstinLookup: boolean;
  /** The GST number typed in the details step; this card only shows it. */
  gstin: string;
  /** The parent highlights a slot the server asked the customer to fix. */
  flagged: boolean;
  registerInput: (slot: string, el: HTMLInputElement | null) => void;
  openPicker: (slot: string) => void;
  onFile: (slot: DocSlot, file: File) => void;
  onNumberChange: (slot: DocSlot, value: string) => void;
  onClearNumber: (slot: DocSlot) => void;
  onRemove: (slot: DocSlot) => void;
  onVerifyGstin: (slot: DocSlot) => void;
}) {
  const spec = DOC_SLOT_SPECS[slot];
  const s = state;
  // A recorded number is the value the uploaded document is judged
  // against, so it stops being editable the moment it is banked.
  const locked = s.numberRecorded;
  // The GST number is not typed here; it comes from the details step.
  const isGst = slot === 'gst_certificate';
  // A refused file or a failed check, explained the way BIA explains it.
  // Null for any other error, which keeps the server's own message.
  const issue =
    s.status === 'error' || s.status === 'unverified' ? explainDocumentIssue({ code: s.errorCode }) : null;

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
            {/* Aadhaar is shown in the card's own groups of four; the
                slot still holds the bare twelve digits, which is what is
                validated and sent. */}
            <Input
              value={slot === 'aadhaar_card' ? formatAadhaar(s.documentNo) : s.documentNo}
              onChange={(e) =>
                onNumberChange(
                  slot,
                  slot === 'aadhaar_card' ? readAadhaarInput(e.target).digits : e.target.value,
                )
              }
              placeholder={spec.numberField.placeholder}
              maxLength={
                slot === 'aadhaar_card' ? AADHAAR_DISPLAY_MAX_LENGTH : spec.numberField.maxLength
              }
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
                  onClick={() => void onClearNumber(slot)}
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
            {!gstinLookup && endpoint === 'signup' ? (
              // TEMPORARY: no portal lookup, so no Verify step either.
              <p className="text-[10px] text-muted-foreground mt-1">
                {locked ? 'Saved.' : 'Saved with the certificate when you upload it.'} To change the number,
                go back a step.
              </p>
            ) : locked ? (
              <p className="text-[10px] text-muted-foreground mt-1 inline-flex items-center gap-1.5">
                <CheckCircle2 className="w-3 h-3 text-green-600" />
                Verified on the GST portal — now upload the certificate.
                <button
                  type="button"
                  onClick={() => void onClearNumber(slot)}
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
                  onClick={() => void onVerifyGstin(slot)}
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
            registerInput(slot, el);
          }}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onFile(slot, file);
            e.target.value = '';
          }}
          data-testid={`doc-file-${slot}`}
        />

        <div
          role="button"
          tabIndex={0}
          onClick={() => openPicker(slot)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') openPicker(slot);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const file = e.dataTransfer.files[0];
            if (file) void onFile(slot, file);
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
                {isGst
                  ? 'Uploads once the GST number is verified above'
                  : `Uploads by itself once the ${spec.numberField?.label ?? 'number'} above is filled in`}
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
                    openPicker(slot);
                  }}
                  className="text-[11px] text-primary underline"
                >
                  Change file
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void onRemove(slot);
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
                  openPicker(slot);
                }}
                className="text-[11px] text-primary underline"
              >
                {issue?.retryLabel ?? 'Upload a clearer photo'}
              </button>
            </>
          )}

          {s.status === 'error' && (
            <>
              <XCircle className="w-5 h-5 text-red-500" />
              {issue ? (
                // Explained below the box; here, just which file it was.
                s.fileName && (
                  <p className="text-xs text-red-600 font-medium truncate max-w-[200px]">{s.fileName}</p>
                )
              ) : (
                <>
                  <p className="text-xs text-red-600 text-center px-2">{s.error}</p>
                  <AskBiaLink screen={biaScreen} code={s.errorCode} message={s.error} />
                </>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  openPicker(slot);
                }}
                className="text-[11px] text-primary underline"
              >
                {issue?.retryLabel ?? 'Try again'}
              </button>
            </>
          )}
        </div>

        {issue ? (
          <DocumentIssueNote
            issue={issue}
            refused={s.status === 'error'}
            screen={biaScreen}
            message={s.status === 'error' ? s.error : s.ocrNote}
          />
        ) : (
          s.status === 'unverified' &&
          s.ocrNote && (
            <div className="flex flex-col items-start gap-1 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
              <p>{s.ocrNote}</p>
              <AskBiaLink screen={biaScreen} code={s.errorCode} message={s.ocrNote} />
            </div>
          )
        )}
      </div>
  );
}

export function StatusPill({ status }: { status: SlotStatus }): React.JSX.Element {
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
