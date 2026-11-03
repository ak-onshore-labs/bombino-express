import { useState } from 'react';
import { CheckCircle2, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { KycOnFileCard } from '@/components/KycOnFileCard';
import { KycUpload, type KycUploadResult } from '@/components/KycUpload';
import type { KycOnFile } from '@/hooks/useKycOnFile';
import { ProfileSection } from '@/components/profile/ProfileBlocks';

/**
 * Profile's identity document: what is on file, and a deliberate way to
 * replace it.
 *
 * The replacement form used to sit open under the document card, unlabelled
 * as a replacement ("KYC Details", "Required"), so a customer whose document
 * was fine read it as something still to do, and one whose details had
 * changed could not tell that filling it in would swap the old one out. Now
 * the form stays closed until asked for, says plainly what it does, and
 * confirms when it is done.
 *
 * The upload itself saves the moment a file is chosen (KycUpload), and the
 * card above refreshes from the shared cache, so "done" is the first
 * successful upload: the panel closes and says so.
 */
export function IdentityDocumentSection({ kyc }: { kyc: KycOnFile }) {
  const [replacing, setReplacing] = useState(false);
  const [replaced, setReplaced] = useState<KycUploadResult | null>(null);

  const startReplacing = () => {
    setReplaced(null);
    setReplacing(true);
  };

  return (
    <ProfileSection
      id="kyc"
      icon={ShieldCheck}
      title="Identity document"
      description="Kept on file and sent with every shipment for Indian customs. Nothing to do unless it has changed."
      bodyClassName="space-y-3 px-4 pb-4"
      testId="profile-kyc-section"
    >

      <KycOnFileCard kyc={kyc} />

      {replaced && !replacing && (
        <div
          className="flex items-start gap-2.5 rounded-xl border border-green-200 bg-green-50 px-3.5 py-3"
          role="status"
          data-testid="kyc-replaced-note"
        >
          <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-green-700" aria-hidden />
          <p className="text-xs leading-relaxed text-green-900">
            <span className="font-semibold">New document saved.</span> Your {replaced.document_type} ending{' '}
            {replaced.last_four} has replaced the old one and is used from your next shipment. Our team will check it.
          </p>
        </div>
      )}

      {!replacing ? (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-[#F8F9FA] px-3.5 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Details changed?</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Upload a new document and it replaces the one above.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={startReplacing}
            className="h-10 shrink-0 rounded-xl text-sm font-semibold"
            aria-expanded={false}
            aria-controls="kyc-replace-panel"
            data-testid="button-kyc-replace"
          >
            <RefreshCw className="w-4 h-4 mr-1.5" aria-hidden />
            Replace
          </Button>
        </div>
      ) : (
        <div
          id="kyc-replace-panel"
          className="rounded-xl border border-primary/20 bg-primary/[0.03] p-4 space-y-4"
          data-testid="kyc-replace-panel"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">Replace identity document</p>
              <ol className="mt-1.5 space-y-1 text-xs text-muted-foreground list-decimal pl-4">
                <li>Choose the document type and enter its number.</li>
                <li>Upload a clear photo or PDF of it.</li>
              </ol>
              <p className="mt-1.5 text-xs text-muted-foreground">
                The new one replaces your current document as soon as it uploads.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setReplacing(false)}
              className="-mr-1.5 -mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Cancel replacing the document"
              data-testid="button-kyc-replace-cancel"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <KycUpload
            embedded
            onValidChange={(result) => {
              if (!result) return;
              setReplaced(result);
              setReplacing(false);
            }}
          />

          <Button
            type="button"
            variant="ghost"
            onClick={() => setReplacing(false)}
            className="w-full h-10 rounded-xl text-sm text-muted-foreground"
          >
            Cancel, keep my current document
          </Button>
        </div>
      )}
    </ProfileSection>
  );
}
