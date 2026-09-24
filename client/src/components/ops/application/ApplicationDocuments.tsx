/**
 * The uploaded set: Cashfree's first-layer verdict, the reviewer's own check
 * that approval waits on, and viewing or downloading each file.
 *
 * Moved verbatim out of `pages/ops/OpsApplicationDetail.tsx`.
 */

import { useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Circle,
  Download,
  Eye,
  FileText,
  Loader2,
  XCircle,
  type LucideIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { parseApiErrorMessage } from '@/lib/apiError';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { isRole, roleSatisfies } from '@shared/orderContract';
import {
  useVerifyOpsApplicationDocument,
  type OpsApplicationDetail as Detail,
  type OpsApplicationDocument,
} from '@/hooks/useOpsApplications';
import {
  AskButton,
  AskHelp,
  FixTag,
  SheetHeading,
} from './blocks';

// ── Documents ────────────────────────────────────────────────────────────────

/**
 * Cashfree's word, for staff: the first layer, advice to the reviewer and
 * never an approval. `bypassed` reads as matched here as everywhere else: the
 * check is switched off on test credentials and nothing on screen says so.
 */
export function docStatus(doc: Pick<OpsApplicationDocument, 'provided' | 'ocr_status'>): { text: string; tone: string; Icon: LucideIcon } {
  if (!doc.provided) return { text: 'Not uploaded', tone: 'text-red-700', Icon: XCircle };
  const s = doc.ocr_status;
  if (s === 'match' || s === 'bypassed') return { text: 'Matched', tone: 'text-emerald-700', Icon: CheckCircle2 };
  if (s === 'mismatch') return { text: 'Number does not match', tone: 'text-red-700', Icon: AlertTriangle };
  if (s === 'wrong_document') return { text: 'Wrong document', tone: 'text-red-700', Icon: AlertTriangle };
  if (s === 'tampered') return { text: 'Looks edited', tone: 'text-red-700', Icon: AlertTriangle };
  if (s === 'unreadable' || s === 'unavailable') return { text: "Couldn't be checked", tone: 'text-amber-700', Icon: AlertCircle };
  return { text: 'Not checked', tone: 'text-muted-foreground', Icon: Circle };
}

export function DocumentsSection({
  data,
  fileBusy,
  fileErrors,
  canAskChanges,
  picked,
  onAsk,
  onView,
  onDownload,
}: {
  data: Detail;
  fileBusy: string | null;
  fileErrors: Record<string, string>;
  canAskChanges: boolean;
  picked: readonly string[];
  onAsk: (slot: string) => void;
  onView: (doc: OpsApplicationDocument) => void;
  onDownload: (doc: OpsApplicationDocument) => void;
}) {
  const role = useAppStore((s) => s.user?.role);
  const canViewDocs = isRole(role) && roleSatisfies(role, 'admin');
  const a = data.application;
  const asked = new Set(a.status === 'changes_requested' ? a.requested_changes?.slots ?? [] : []);
  const pickedSet = new Set(picked);
  const provided = data.documents.filter((d) => d.provided).length;
  const verify = useVerifyOpsApplicationDocument(a.id);
  // Which slot is being saved, for its button's spinner.
  const [saving, setSaving] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState<{ slot: string; message: string } | null>(null);
  // Verifying means having looked: the button waits until the file was opened here.
  const [viewed, setViewed] = useState<ReadonlySet<string>>(new Set());
  const verifiedCount = data.documents.filter((d) => d.verified_at).length;
  // Closed applications are history; nothing on them changes.
  const canVerify = canViewDocs && a.status !== 'rejected' && a.status !== 'withdrawn';

  /** Who vouched for a hand-verified document: the latest such entry in the history. */
  const verifiedBy = (slot: string): string | null => {
    const ev = [...data.events].reverse().find((e) => e.event === 'document_verified' && e.metadata?.slot === slot);
    return ev ? ev.actor_name ?? 'Bombino staff' : null;
  };

  const markVerified = async (slot: string): Promise<void> => {
    setVerifyError(null);
    setSaving(slot);
    try {
      await verify.mutateAsync(slot);
    } catch (err) {
      setVerifyError({ slot, message: parseApiErrorMessage(err, "Couldn't mark it verified. Try again.") });
    } finally {
      setSaving(null);
    }
  };

  return (
    <div data-testid="ops-application-documents">
      <SheetHeading
        title="Documents"
        meta={`${verifiedCount} of ${data.documents.length} verified${provided < data.documents.length ? ` · ${data.documents.length - provided} not uploaded` : ''}`}
        divided
      />
      {canAskChanges && <AskHelp what="documents" count={picked.length} />}
      <ul className="border-t border-border divide-y divide-border">
        {data.documents.map((doc) => {
          const cashfree = docStatus(doc);
          const verifiable = canVerify && doc.provided && !doc.verified_at;
          const hasViewed = viewed.has(doc.slot);
          const isSaving = saving === doc.slot;
          return (
            <li key={doc.slot} className="px-5 py-3">
              <div className="flex items-center gap-3">
                <FileText className="w-5 h-5 text-muted-foreground shrink-0" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">
                    {doc.label}
                    {doc.number && <span className="ml-2 font-mono text-xs text-muted-foreground">{doc.number}</span>}
                    {asked.has(doc.slot) && <FixTag />}
                  </p>
                  {/* The reviewer's check: the one approval waits on. */}
                  {!doc.provided ? (
                    <p className="mt-0.5 inline-flex items-center gap-1 text-xs font-semibold text-red-700">
                      <XCircle className="w-3.5 h-3.5" aria-hidden />
                      Not uploaded
                    </p>
                  ) : doc.verified_at ? (
                    <p className="mt-0.5 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                      <CheckCircle2 className="w-3.5 h-3.5" aria-hidden />
                      Verified by {verifiedBy(doc.slot) ?? 'Bombino staff'}
                    </p>
                  ) : (
                    <p className="mt-0.5 inline-flex items-center gap-1 text-xs font-semibold text-amber-700">
                      <AlertCircle className="w-3.5 h-3.5" aria-hidden />
                      Not verified yet
                    </p>
                  )}
                  {/* Cashfree's, as a first layer of advice. */}
                  {doc.provided && (
                    <p className="text-[11px] text-muted-foreground">
                      Cashfree: <span className={cn('font-medium', cashfree.tone)}>{cashfree.text.toLowerCase()}</span>
                    </p>
                  )}
                  {fileErrors[doc.slot] && <p className="text-xs text-red-600 mt-1">{fileErrors[doc.slot]}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {canAskChanges && (
                    <AskButton
                      fieldKey={doc.slot}
                      label={doc.label}
                      picked={pickedSet.has(doc.slot)}
                      onAsk={() => onAsk(doc.slot)}
                      isDocument
                    />
                  )}
                  {verifiable && (
                    <Button
                      type="button"
                      variant={hasViewed ? 'default' : 'outline'}
                      className="h-9 rounded-lg text-xs font-semibold gap-1.5"
                      disabled={!hasViewed || saving !== null}
                      title={hasViewed ? undefined : 'Open the document first'}
                      onClick={() => void markVerified(doc.slot)}
                      data-testid={`ops-application-verify-${doc.slot}`}
                    >
                      {isSaving ? (
                        <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                      ) : (
                        <CheckCircle2 className="w-4 h-4" aria-hidden />
                      )}
                      Mark verified
                    </Button>
                  )}
                  {canViewDocs && doc.provided && (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-9 w-9 rounded-lg"
                      disabled={fileBusy === doc.slot}
                      aria-label={`View ${doc.label}`}
                      title={`View ${doc.label}`}
                      onClick={() => {
                        setViewed((prev) => new Set(prev).add(doc.slot));
                        onView(doc);
                      }}
                      data-testid={`ops-application-view-${doc.slot}`}
                    >
                      {fileBusy === doc.slot ? (
                        <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                      ) : (
                        <Eye className="w-4 h-4" aria-hidden />
                      )}
                    </Button>
                  )}
                  {canViewDocs && doc.provided && (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-9 w-9 rounded-lg"
                      disabled={fileBusy === doc.slot}
                      aria-label={`Download ${doc.label}`}
                      title={`Download ${doc.label}`}
                      onClick={() => {
                        // A copy in hand counts as having looked, same as opening it.
                        setViewed((prev) => new Set(prev).add(doc.slot));
                        onDownload(doc);
                      }}
                      data-testid={`ops-application-download-${doc.slot}`}
                    >
                      <Download className="w-4 h-4" aria-hidden />
                    </Button>
                  )}
                </div>
              </div>

              {verifyError?.slot === doc.slot && (
                <p className="mt-2 ml-8 text-xs text-red-700" role="alert">
                  {verifyError.message}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <p className="border-t border-border bg-[#F8F9FA] px-5 py-2.5 text-xs text-muted-foreground">
        {canViewDocs
          ? 'Every view and download is recorded.'
          : 'Document viewing needs an ops account.'}
      </p>
    </div>
  );
}
