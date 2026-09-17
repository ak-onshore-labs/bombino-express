import { useEffect, useRef, useState } from 'react';
import { OpsAccessRequired } from '@/components/ops/OpsAccessRequired';
import { Link, useParams } from 'wouter';
import {
  ArrowLeft,
} from 'lucide-react';
import { OpsDocumentPreviewOverlay, useOpsDocumentPreview } from '@/components/ops/OpsDocumentPreview';
import { ActionPanel } from '@/components/ops/application/ApplicationActions';
import { DetailsSection } from '@/components/ops/application/ApplicationDetails';
import { DocumentsSection } from '@/components/ops/application/ApplicationDocuments';
import { HistorySection } from '@/components/ops/application/ApplicationHistory';
import { Properties } from '@/components/ops/application/ApplicationSummary';
import { OpsShell } from '@/components/ops/OpsShell';
import { fetchOpsApplicationDocumentFile, useOpsApplicationDetail } from '@/hooks/useOpsApplications';
import { isForbiddenError, isNotFoundError } from '@/lib/apiError';

/**
 * One account application, for the person deciding it.
 *
 * Layout: what it is (status, timing, who has it) across the top; what was sent
 * (details, documents) in the main column; the decision in a sticky panel on the
 * right, so the buttons stay in reach while the reviewer reads; the history
 * under the main column. Below xl the panel drops between documents and history.
 */

// ── Page ─────────────────────────────────────────────────────────────────────

export default function OpsApplicationDetail() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, isError, error } = useOpsApplicationDetail(id);
  const { preview, closePreview, openBlob, downloadBlob, fileBusy, fileErrors } = useOpsDocumentPreview();
  const notFound = isNotFoundError(error);
  const forbidden = isForbiddenError(error);

  /**
   * What the reviewer has picked out to send back, ticked either in the panel's
   * form or on the value itself in Details. One list, so a row and the form
   * always say the same thing. The nonce opens the form on each pick, including
   * a pick of something already ticked (which unticks it).
   */
  const [changeFields, setChangeFields] = useState<string[]>([]);
  const [changeSlots, setChangeSlots] = useState<string[]>([]);
  const [openChanges, setOpenChanges] = useState(0);
  const panelRef = useRef<HTMLElement>(null);

  // A different application is a different set of picks.
  useEffect(() => {
    setChangeFields([]);
    setChangeSlots([]);
    setOpenChanges(0);
  }, [id]);

  // On a phone the panel is above the sheet, and off screen by the time the
  // reviewer is reading the record.
  const openChangesForm = (): void => {
    setOpenChanges((n) => n + 1);
    panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const toggle = (list: string[], key: string): string[] =>
    list.includes(key) ? list.filter((k) => k !== key) : [...list, key];

  const askFieldChange = (key: string): void => {
    setChangeFields((prev) => toggle(prev, key));
    openChangesForm();
  };

  const askSlotChange = (slot: string): void => {
    setChangeSlots((prev) => toggle(prev, slot));
    openChangesForm();
  };

  return (
    <OpsShell
      title={data ? (data.application.name ?? `+91 ${data.application.phone}`) : 'Application'}
      subtitle={data ? `Account application · ${data.application.category_label}` : 'Account application'}
      eyebrow={
        <Link
          href="/ops/applications"
          className="inline-flex items-center gap-1 text-xs font-semibold text-[#2F4468] hover:underline"
          data-testid="link-ops-back-applications"
        >
          <ArrowLeft className="w-3.5 h-3.5" aria-hidden />
          Applications
        </Link>
      }
      wide
    >
      {isLoading && <DetailSkeleton />}
      {isError && forbidden && <OpsAccessRequired what="an application" />}
      {isError && !forbidden && (
        <p className="text-sm text-muted-foreground py-8" data-testid="ops-application-error">
          {notFound ? 'That application could not be found.' : 'Could not load this application. Try refreshing.'}
        </p>
      )}

      {data && (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_21rem] xl:items-start">
          {/* First in the source so a phone shows the decision before the paperwork. */}
          <aside
            ref={panelRef}
            className="min-w-0 xl:col-start-2 xl:row-start-1 xl:sticky xl:top-6 xl:max-h-[calc(100dvh-3rem)] xl:overflow-y-auto"
          >
            <ActionPanel
              data={data}
              changeFields={changeFields}
              onChangeFields={setChangeFields}
              changeSlots={changeSlots}
              onChangeSlots={setChangeSlots}
              openChanges={openChanges}
            />
            <Properties data={data} />
          </aside>

          <div className="min-w-0 space-y-8 xl:col-start-1 xl:row-start-1">
            <section
              className="rounded-2xl border border-border bg-white overflow-hidden"
              data-testid="ops-application-sheet"
            >
              <DetailsSection
                data={data}
                canAskChanges={data.allowed_actions.includes('request_changes')}
                picked={changeFields}
                onAsk={askFieldChange}
              />
              <DocumentsSection
                data={data}
                fileBusy={fileBusy}
                fileErrors={fileErrors}
                canAskChanges={data.allowed_actions.includes('request_changes')}
                picked={changeSlots}
                onAsk={askSlotChange}
                onView={(doc) =>
                  void openBlob(doc.slot, doc.label, () => fetchOpsApplicationDocumentFile(data.application.id, doc.slot))
                }
                onDownload={(doc) =>
                  void downloadBlob(doc.slot, doc.label, () =>
                    fetchOpsApplicationDocumentFile(data.application.id, doc.slot, true),
                  )
                }
              />
            </section>
            <HistorySection events={data.events} />
          </div>
        </div>
      )}

      {preview && <OpsDocumentPreviewOverlay preview={preview} onClose={closePreview} />}
    </OpsShell>
  );
}

function DetailSkeleton() {
  return (
    <div className="animate-pulse motion-reduce:animate-none" aria-busy="true" data-testid="ops-application-loading">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="h-[32rem] rounded-2xl bg-[#E9ECF0]" />
        <div className="h-72 rounded-2xl bg-[#E9ECF0]" />
      </div>
    </div>
  );
}
