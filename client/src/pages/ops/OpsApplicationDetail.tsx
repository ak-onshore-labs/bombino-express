import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'wouter';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Bot,
  Check,
  CheckCircle2,
  Circle,
  Copy,
  Eye,
  EyeOff,
  FileText,
  Loader2,
  Mail,
  UserCog,
  UserRound,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { OpsDocumentPreviewOverlay, useOpsDocumentPreview } from '@/components/ops/OpsDocumentPreview';
import { OpsShell } from '@/components/ops/OpsShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  fetchOpsApplicationDocumentFile,
  useOpsApplicationAction,
  useOpsApplicationDetail,
  useVerifyOpsApplicationDocument,
  type OpsApplicationActionInput,
  type OpsApplicationDetail as Detail,
  type OpsApplicationDocument,
  type OpsApplicationEvent,
} from '@/hooks/useOpsApplications';
import { CUSTOMER_EVENTS, OPS_EVENT_LABEL, SLOW_AFTER_MS, timeAgo, waitedFor } from '@/lib/opsApplications';
import { parseApiErrorMessage } from '@/lib/apiError';
import { formatIst } from '@/lib/orderDetail';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { StatusPill } from '@/pages/ops/OpsApplications';
import { DOC_SLOT_SPECS, isAcceptedOcrStatus, isDocSlot } from '@shared/accountSpec';
import { INDIA_HUBS } from '@shared/hubs';
import {
  APPLICATION_FIELD_LABELS,
  isApplicationField,
  isOpenApplicationStatus,
  type ApplicationField,
} from '@shared/applicationStatus';

/**
 * One account application, for the person deciding it.
 *
 * Layout: what it is (status, timing, who has it) across the top; what was sent
 * (details, documents) in the main column; the decision in a sticky panel on the
 * right, so the buttons stay in reach while the reviewer reads; the history
 * under the main column. Below xl the panel drops between documents and history.
 */

/** The form fields, grouped the way a reviewer checks them against ITD. */
const DETAIL_GROUPS: ReadonlyArray<{ title: string; keys: readonly ApplicationField[] }> = [
  { title: 'Applicant', keys: ['full_name', 'company_name', 'contact_person', 'email'] },
  { title: 'Address', keys: ['address', 'city', 'state', 'pincode', 'hub_id'] },
  { title: 'Export and bank', keys: ['gstin', 'lut_no', 'iec_branch_code', 'bank_account_no', 'bank_ad_code'] },
];

const DETAIL_ORDER: readonly ApplicationField[] = DETAIL_GROUPS.flatMap((g) => g.keys);

function detailValue(key: string, value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  if (key === 'hub_id') return INDIA_HUBS.find((h) => h.id === Number(value))?.name ?? String(value);
  return String(value);
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function fieldLabel(key: string): string {
  return isApplicationField(key) ? APPLICATION_FIELD_LABELS[key] : key;
}

function slotLabel(slot: string): string {
  return isDocSlot(slot) ? DOC_SLOT_SPECS[slot].label : slot;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function OpsApplicationDetail() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, isError, error } = useOpsApplicationDetail(id);
  const { preview, closePreview, openBlob, fileBusy, fileErrors } = useOpsDocumentPreview();
  const notFound = isError && error instanceof Error && error.message.startsWith('404:');

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
      {isError && (
        <p className="text-sm text-muted-foreground py-8" data-testid="ops-application-error">
          {notFound ? 'That application could not be found.' : 'Could not load this application. Try refreshing.'}
        </p>
      )}

      {data && (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_21rem] xl:items-start">
          {/* First in the source so a phone shows the decision before the paperwork. */}
          <aside className="min-w-0 xl:col-start-2 xl:row-start-1 xl:sticky xl:top-6 xl:max-h-[calc(100dvh-3rem)] xl:overflow-y-auto">
            <ActionPanel data={data} />
            <Properties data={data} />
          </aside>

          <div className="min-w-0 space-y-8 xl:col-start-1 xl:row-start-1">
            <section
              className="rounded-2xl border border-border bg-white overflow-hidden"
              data-testid="ops-application-sheet"
            >
              <DetailsSection data={data} />
              <DocumentsSection
                data={data}
                fileBusy={fileBusy}
                fileErrors={fileErrors}
                onView={(doc) =>
                  void openBlob(doc.slot, doc.label, () => fetchOpsApplicationDocumentFile(data.application.id, doc.slot))
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

// ── Building blocks ──────────────────────────────────────────────────────────

/** A section's title row inside the application sheet. */
function SheetHeading({ title, meta, divided = false }: { title: string; meta?: string; divided?: boolean }) {
  return (
    <header className={cn('flex items-baseline justify-between gap-3 px-5 pt-5 pb-3', divided && 'border-t border-border')}>
      <h2 className="text-base font-extrabold text-foreground">{title}</h2>
      {meta && <p className="text-xs font-medium text-muted-foreground">{meta}</p>}
    </header>
  );
}

/** Small uppercase label that opens a block. */
function Eyebrow({ children, className }: { children: string; className?: string }) {
  return (
    <p className={cn('text-[11px] font-bold uppercase tracking-wider text-muted-foreground', className)}>{children}</p>
  );
}

/** Reviewers retype most of this into ITD; one click saves the typos. */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => setCopied(true), () => undefined);
      }}
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      title={copied ? 'Copied' : 'Copy'}
      className={cn(
        'grid place-items-center w-7 h-7 -my-1 rounded-md shrink-0 transition-opacity duration-150',
        'text-muted-foreground hover:bg-[#F3F4F6] hover:text-foreground focus-visible:opacity-100',
        'opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100',
        copied && 'opacity-100 text-emerald-700',
      )}
    >
      {copied ? <Check className="w-3.5 h-3.5" aria-hidden /> : <Copy className="w-3.5 h-3.5" aria-hidden />}
    </button>
  );
}

function FixTag() {
  return (
    <span className="ml-2 inline-block align-middle rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-800">
      Asked to fix
    </span>
  );
}

function Quote({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-white px-3 py-2">
      {label && <p className="text-[11px] font-semibold text-muted-foreground mb-0.5">{label}</p>}
      <p className="text-sm text-foreground whitespace-pre-wrap break-words">{children}</p>
    </div>
  );
}

// ── Summary ──────────────────────────────────────────────────────────────────

function Prop({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-xs text-muted-foreground pt-px">{label}</dt>
      <dd className="min-w-0 break-words text-sm font-semibold text-foreground tabular-nums">{children}</dd>
    </>
  );
}

/** The record's facts, under the decision: plain rows on the page, not another card. */
function Properties({ data }: { data: Detail }) {
  const a = data.application;
  const open = isOpenApplicationStatus(a.status);
  const now = Date.now();
  const slow = open && now - new Date(a.submitted_at).getTime() > SLOW_AFTER_MS;
  return (
    <section className="mt-6 px-1" aria-label="About this application" data-testid="ops-application-header">
      <Eyebrow className="mb-3">About</Eyebrow>
      <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-2.5">
        <Prop label="Account">{a.category_label}</Prop>
        <Prop label="Phone">+91 {a.phone}</Prop>
        <Prop label="Sent">{formatIst(a.submitted_at)}</Prop>
        {open && (
          <Prop label="Waiting">
            <span className={slow ? 'text-red-700' : undefined}>
              {waitedFor(a.submitted_at, now)}
              {slow ? ', over 2 days' : ''}
            </span>
          </Prop>
        )}
        {!open && a.decided_at && <Prop label="Decided">{formatIst(a.decided_at)}</Prop>}
        <Prop label="Reviewer">{a.reviewer_name ?? 'Nobody yet'}</Prop>
        {a.resubmission_count > 0 && (
          <Prop label="Resent">{a.resubmission_count === 1 ? 'Once' : `${a.resubmission_count} times`}</Prop>
        )}
      </dl>
    </section>
  );
}

function countWords(accounts: number, applications: number): string {
  const parts = [
    accounts > 0 ? `${accounts} ${accounts === 1 ? 'account' : 'accounts'}` : null,
    applications > 0 ? `${applications} ${applications === 1 ? 'application' : 'applications'}` : null,
  ].filter(Boolean);
  return parts.join(' and ');
}


function CheckItem({ ok, testId, children }: { ok: boolean; testId?: string; children: ReactNode }) {
  const Icon = ok ? CheckCircle2 : AlertTriangle;
  return (
    <li className="flex gap-2.5" data-testid={testId}>
      <Icon className={cn('w-4 h-4 mt-0.5 shrink-0', ok ? 'text-emerald-600' : 'text-amber-600')} aria-hidden />
      <div className="min-w-0 flex-1 text-sm text-foreground">{children}</div>
    </li>
  );
}

/**
 * What to look at before approving, worked out from what is already on the
 * page: every document verified by a reviewer (required; approval waits on
 * it), anything Cashfree flagged as worth a closer look, and the same GSTIN or
 * email elsewhere. The duplicate list can be long (one person testing with many
 * numbers, a company with many branches), so it opens on request.
 */
function Checks({ data }: { data: Detail }) {
  const [showDuplicates, setShowDuplicates] = useState(false);
  const docs = data.documents;
  const missing = docs.filter((d) => !d.provided);
  const toVerify = docs.filter((d) => d.provided && !d.verified_at);
  const flagged = docs.filter((d) => d.provided && !d.verified_at && !isAcceptedOcrStatus(d.ocr_status));
  const dups = data.duplicates;
  const dupLines = (['gstin', 'email'] as const)
    .map((field) => {
      const hits = dups.filter((d) => d.field === field);
      const text = countWords(hits.filter((d) => d.kind === 'account').length, hits.filter((d) => d.kind === 'application').length);
      return text ? `${field === 'gstin' ? 'GSTIN' : 'Email'} matches ${text}` : null;
    })
    .filter((line): line is string => line !== null);

  return (
    <div className="border-t border-border px-5 py-4" data-testid="ops-application-checks">
      <Eyebrow>Before you approve</Eyebrow>
      <ul className="mt-3 space-y-3">
        <CheckItem ok={missing.length === 0 && toVerify.length === 0} testId="ops-application-check-documents">
          {missing.length === 0 && toVerify.length === 0 ? (
            <p className="font-medium">All {docs.length} documents verified</p>
          ) : (
            <>
              <p className="font-medium">
                {docs.length - missing.length - toVerify.length} of {docs.length} documents verified
              </p>
              {toVerify.length > 0 && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Open and verify: {toVerify.map((d) => d.label).join(', ')}
                </p>
              )}
              {missing.length > 0 && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Not uploaded: {missing.map((d) => d.label).join(', ')}. Request changes to ask for it.
                </p>
              )}
            </>
          )}
        </CheckItem>

        {flagged.length > 0 && (
          <CheckItem ok={false}>
            <p className="font-medium">Cashfree flagged {flagged.length === 1 ? 'one' : flagged.length}</p>
            <ul className="text-xs text-muted-foreground mt-0.5">
              {flagged.map((d) => (
                <li key={d.slot}>
                  {d.label}: {docStatus(d).text.toLowerCase()}. Look closely.
                </li>
              ))}
            </ul>
          </CheckItem>
        )}

        <CheckItem ok={dups.length === 0} testId="ops-application-duplicates">
          {dups.length === 0 ? (
            <p className="font-medium">GSTIN and email not used elsewhere</p>
          ) : (
            <>
              {dupLines.map((line) => (
                <p key={line} className="font-medium">
                  {line}
                </p>
              ))}
              <p className="text-xs text-muted-foreground mt-0.5">
                Often the same {data.application.account_type === 'company' ? 'company' : 'person'} on another number.
                Check before creating a second ITD customer.
              </p>
              <button
                type="button"
                onClick={() => setShowDuplicates((v) => !v)}
                aria-expanded={showDuplicates}
                className="mt-1 text-xs font-semibold text-[#2F4468] underline underline-offset-2 hover:text-foreground"
                data-testid="button-application-duplicates-toggle"
              >
                {showDuplicates ? 'Hide' : dups.length === 1 ? 'Show it' : `Show all ${dups.length}`}
              </button>
              {showDuplicates && (
                <ul className="mt-2 max-h-44 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                  {dups.map((dup) => (
                    <li key={`${dup.kind}-${dup.id}-${dup.field}`} className="px-2.5 py-1.5">
                      <Link
                        href={dup.kind === 'account' ? `/ops/customers/${dup.id}` : `/ops/applications/${dup.id}`}
                        className="block break-words text-xs font-semibold text-[#2F4468] hover:underline"
                      >
                        {dup.label}
                      </Link>
                      <span className="text-[11px] text-muted-foreground">
                        {dup.field === 'gstin' ? 'GSTIN' : 'Email'} ·{' '}
                        {dup.kind === 'account' ? 'account' : `application, ${dup.status ?? 'open'}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </CheckItem>
      </ul>
    </div>
  );
}

// ── Details ──────────────────────────────────────────────────────────────────

/**
 * Identifiers read and typed character by character: tabular figures and a
 * little extra tracking so they scan in groups. (No mono face is loaded, and
 * the system fallback clashes with Poppins.)
 */
const ID_FIELDS: ReadonlySet<string> = new Set(['gstin', 'lut_no', 'iec_branch_code', 'bank_account_no', 'bank_ad_code', 'pincode', 'phone']);

type TableRow = { key: string; label: string; value: string; copy?: string; flagged?: boolean };

function Row({ row }: { row: TableRow }) {
  return (
    <div className="group grid grid-cols-[minmax(7rem,10rem)_minmax(0,1fr)] gap-x-4 px-5 py-2.5 border-t border-border first:border-t-0 hover:bg-[#F8F9FA]/70">
      <dt className="pt-0.5 text-xs font-medium text-muted-foreground">{row.label}</dt>
      <dd className="flex items-start gap-2 min-w-0">
        <span
          className={cn(
            'flex-1 min-w-0 break-words text-sm font-semibold text-foreground',
            ID_FIELDS.has(row.key) && 'tabular-nums tracking-wide',
          )}
        >
          {row.value}
          {row.flagged && <FixTag />}
        </span>
        {row.copy !== undefined && <CopyButton value={row.copy} label={row.label} />}
      </dd>
    </div>
  );
}

function Group({ title, rows }: { title: string; rows: TableRow[] }) {
  return (
    <div className="min-w-0">
      <h3 className="border-y border-border bg-[#F8F9FA] px-5 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <dl>
        {rows.map((row) => (
          <Row key={row.key} row={row} />
        ))}
      </dl>
    </div>
  );
}

function DetailsSection({ data }: { data: Detail }) {
  const a = data.application;
  const asked = new Set(a.status === 'changes_requested' ? a.requested_changes?.fields ?? [] : []);

  const groups = DETAIL_GROUPS.map((group) => {
    const rows: TableRow[] = group.keys.flatMap((key) => {
      const value = detailValue(key, a.details[key]);
      return value === null
        ? []
        : [{ key, label: APPLICATION_FIELD_LABELS[key], value, copy: value, flagged: asked.has(key) }];
    });
    if (group.title === 'Applicant') rows.push({ key: 'phone', label: 'Phone', value: `+91 ${a.phone}`, copy: a.phone });
    return { title: group.title, rows };
  }).filter((g) => g.rows.length > 0);

  groups.push({
    title: 'Contract',
    rows: [
      { key: 'signed_name', label: 'Signed by', value: a.contract.signed_name },
      { key: 'accepted_at', label: 'Signed on', value: formatIst(a.contract.accepted_at) },
      { key: 'version', label: 'Version', value: a.contract.version },
    ],
  });

  return (
    <div data-testid="ops-application-details">
      <SheetHeading title="Details" meta="Hover a value to copy it" />
      {/* Two columns only when the sheet itself is wide (the stacked layout);
          beside the decision panel it is too narrow and values would wrap. */}
      <div className="@container">
        <div className="grid @4xl:grid-cols-2 @4xl:[&>*:nth-child(even)]:border-l @4xl:[&>*]:border-border">
          {groups.map((g) => (
            <Group key={g.title} title={g.title} rows={g.rows} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Documents ────────────────────────────────────────────────────────────────

/**
 * Cashfree's word, for staff: the first layer, advice to the reviewer and
 * never an approval. `bypassed` reads as matched here as everywhere else: the
 * check is switched off on test credentials and nothing on screen says so.
 */
function docStatus(doc: Pick<OpsApplicationDocument, 'provided' | 'ocr_status'>): { text: string; tone: string; Icon: LucideIcon } {
  if (!doc.provided) return { text: 'Not uploaded', tone: 'text-red-700', Icon: XCircle };
  const s = doc.ocr_status;
  if (s === 'match' || s === 'bypassed') return { text: 'Matched', tone: 'text-emerald-700', Icon: CheckCircle2 };
  if (s === 'mismatch') return { text: 'Number does not match', tone: 'text-red-700', Icon: AlertTriangle };
  if (s === 'wrong_document') return { text: 'Wrong document', tone: 'text-red-700', Icon: AlertTriangle };
  if (s === 'tampered') return { text: 'Looks edited', tone: 'text-red-700', Icon: AlertTriangle };
  if (s === 'unreadable' || s === 'unavailable') return { text: "Couldn't be checked", tone: 'text-amber-700', Icon: AlertCircle };
  return { text: 'Not checked', tone: 'text-muted-foreground', Icon: Circle };
}

function DocumentsSection({
  data,
  fileBusy,
  fileErrors,
  onView,
}: {
  data: Detail;
  fileBusy: string | null;
  fileErrors: Record<string, string>;
  onView: (doc: OpsApplicationDocument) => void;
}) {
  const role = useAppStore((s) => s.user?.role);
  const canViewDocs = role === 'admin' || role === 'super_admin';
  const a = data.application;
  const asked = new Set(a.status === 'changes_requested' ? a.requested_changes?.slots ?? [] : []);
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
                      className="h-9 rounded-lg text-xs font-semibold gap-1.5"
                      disabled={fileBusy === doc.slot}
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
                      View
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
        {canViewDocs ? 'Each view is recorded.' : 'Document viewing needs an ops account.'}
      </p>
    </div>
  );
}

// ── History ──────────────────────────────────────────────────────────────────

const FAILED_EVENTS: ReadonlySet<string> = new Set(['approve_failed', 'finalize_failed', 'email_failed']);
const DONE_EVENTS: ReadonlySet<string> = new Set(['approved', 'finalized', 'document_verified']);

function eventActor(ev: OpsApplicationEvent): string {
  if (CUSTOMER_EVENTS.has(ev.event)) return 'Customer';
  if (ev.actor_name) return ev.actor_name;
  if (ev.actor_id) return 'Bombino staff';
  return 'Automatic';
}

function eventMarker(ev: OpsApplicationEvent): { Icon: LucideIcon; tone: string } {
  const Icon: LucideIcon = ev.event.startsWith('email_')
    ? Mail
    : CUSTOMER_EVENTS.has(ev.event)
      ? UserRound
      : ev.actor_id
        ? UserCog
        : Bot;
  if (FAILED_EVENTS.has(ev.event)) return { Icon, tone: 'bg-red-50 text-red-700 border-red-200' };
  if (DONE_EVENTS.has(ev.event)) return { Icon, tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  if (ev.event === 'changes_requested') return { Icon, tone: 'bg-violet-50 text-violet-700 border-violet-200' };
  return { Icon, tone: 'bg-white text-muted-foreground border-border' };
}

function emailKind(kind: unknown): string {
  if (kind === 'received') return 'Application-received email';
  if (kind === 'changes_requested') return 'Changes-needed email';
  if (kind === 'rejected') return 'Not-opened email';
  return 'Account-ready email with the ITD login';
}

/** What happened, beyond the label: what was asked, said, or sent, and to whom. */
function EventDetail({ ev }: { ev: OpsApplicationEvent }) {
  const m = ev.metadata ?? {};
  switch (ev.event) {
    case 'changes_requested': {
      const fields = strings(m.fields).map(fieldLabel);
      const slots = strings(m.slots).map(slotLabel);
      return (
        <>
          {fields.length > 0 && (
            <p className="text-xs text-foreground">
              <span className="text-muted-foreground">Fix: </span>
              {fields.join(', ')}
            </p>
          )}
          {slots.length > 0 && (
            <p className="text-xs text-foreground">
              <span className="text-muted-foreground">Upload again: </span>
              {slots.join(', ')}
            </p>
          )}
          {ev.note && <Quote label="Note sent to the customer">{ev.note}</Quote>}
        </>
      );
    }
    case 'rejected':
      return ev.note ? <Quote label="Reason sent to the customer">{ev.note}</Quote> : null;
    case 'approved': {
      const login = typeof m.itd_email === 'string' ? m.itd_email : null;
      return login ? (
        <p className="text-xs text-foreground">
          <span className="text-muted-foreground">ITD login: </span>
          {login}
        </p>
      ) : null;
    }
    case 'email_sent':
    case 'email_failed': {
      const to = typeof m.to === 'string' ? m.to : null;
      return (
        <>
          <p className="text-xs text-foreground">
            {emailKind(m.kind)}
            {to && <span className="text-muted-foreground"> to {to}</span>}
          </p>
          {ev.event === 'email_failed' && ev.note && <p className="text-xs text-red-700 break-words">{ev.note}</p>}
        </>
      );
    }
    case 'approve_failed':
    case 'finalize_failed':
      return ev.note ? <p className="text-xs text-red-700 break-words">{ev.note}</p> : null;
    case 'document_verified': {
      const slot = typeof m.slot === 'string' ? m.slot : null;
      const previous = typeof m.previous === 'string' ? m.previous : null;
      const cashfree = docStatus({ provided: true, ocr_status: previous }).text;
      return (
        <p className="text-xs text-foreground">
          {slot ? slotLabel(slot) : 'A document'}
          <span className="text-muted-foreground"> · Cashfree: {cashfree.toLowerCase()}</span>
        </p>
      );
    }
    case 'edited':
      return <p className="text-xs text-muted-foreground">Changed their details or documents before anyone picked it up.</p>;
    case 'resubmitted':
      return <p className="text-xs text-muted-foreground">Back in the queue as new.</p>;
    default:
      return ev.note ? <p className="text-xs text-muted-foreground whitespace-pre-wrap">{ev.note}</p> : null;
  }
}

/** An activity feed on the page itself, under the sheet, like any tracker's. */
function HistorySection({ events }: { events: OpsApplicationEvent[] }) {
  const newestFirst = [...events].reverse();
  const now = Date.now();
  return (
    <section data-testid="ops-application-history">
      <div className="flex items-baseline justify-between gap-3 px-1 mb-4">
        <h2 className="text-base font-extrabold text-foreground">History</h2>
        {events.length > 0 && <p className="text-xs font-medium text-muted-foreground">Newest first</p>}
      </div>
      {newestFirst.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">Nothing recorded yet.</p>
      ) : (
        <ol className="px-1">
          {newestFirst.map((ev, i) => {
            const marker = eventMarker(ev);
            const last = i === newestFirst.length - 1;
            return (
              <li key={ev.id} className={cn('relative flex gap-3', !last && 'pb-5')}>
                {!last && <span aria-hidden className="absolute left-[15px] top-8 bottom-0 w-px bg-border" />}
                <span
                  className={cn('relative grid place-items-center w-8 h-8 rounded-full border shrink-0', marker.tone)}
                  aria-hidden
                >
                  <marker.Icon className="w-4 h-4" />
                </span>
                <div className="min-w-0 flex-1 pt-1 space-y-1.5">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{OPS_EVENT_LABEL[ev.event] ?? ev.event}</p>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground/80">{eventActor(ev)}</span>
                      {' · '}
                      <time dateTime={ev.created_at}>{formatIst(ev.created_at)}</time>
                      {timeAgo(ev.created_at, now) && ` · ${timeAgo(ev.created_at, now)}`}
                    </p>
                  </div>
                  <EventDetail ev={ev} />
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

// ── Decision panel ───────────────────────────────────────────────────────────

type Mode = 'approve' | 'changes' | 'reject' | null;
type RunFn = (input: OpsApplicationActionInput, done?: string) => Promise<boolean>;

/** Where the application stands, in a sentence the reviewer can act on. */
function standing(data: Detail): { title: string; body: string } {
  const a = data.application;
  switch (a.status) {
    case 'submitted':
      return { title: 'New, not picked up', body: 'Pick it up so nobody else reviews it at the same time.' };
    case 'in_review':
      return {
        title: `In review with ${a.reviewer_name ?? 'a reviewer'}`,
        body: 'Check the details and documents against ITD, then decide.',
      };
    case 'changes_requested':
      return {
        title: 'Waiting on the customer',
        body: 'They have been told what to change. When they send it back, it returns here as new.',
      };
    case 'approved':
      return {
        title: 'Account opened',
        body: a.decided_at ? `Approved ${formatIst(a.decided_at)}.` : 'Approved.',
      };
    case 'rejected':
      return { title: 'Rejected', body: 'They stay a guest, keep their bookings, and can apply again.' };
    case 'withdrawn':
      return { title: 'Withdrawn', body: 'The customer withdrew this application.' };
  }
}

function ActionPanel({ data }: { data: Detail }) {
  const a = data.application;
  const allowed = new Set(data.allowed_actions);
  const action = useOpsApplicationAction(a.id);
  const [mode, setMode] = useState<Mode>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // A different application, or the same one moved on: start the panel clean.
  useEffect(() => {
    setMode(null);
    setError('');
  }, [a.id, a.status]);

  const run: RunFn = async (input, done) => {
    setError('');
    setNotice('');
    try {
      const result = await action.mutateAsync(input);
      if (input.action === 'approve' || input.action === 'retry_finalize' || input.action === 'resend_email') {
        const parts = [
          result.finalized === false ? 'Account opened, but moving documents or orders did not finish. Use Retry.' : null,
          result.email_sent === false ? 'The email was not sent; see below.' : null,
        ].filter(Boolean);
        setNotice(parts.length > 0 ? parts.join(' ') : done ?? 'Done.');
      } else if (done) {
        setNotice(done);
      }
      setMode(null);
      return true;
    } catch (err) {
      setError(parseApiErrorMessage(err, 'That did not go through. Refresh and try again.'));
      return false;
    }
  };

  const busy = action.isPending;
  const { title, body } = standing(data);
  const asked = a.status === 'changes_requested' ? a.requested_changes : null;
  const hasPrimary = allowed.has('claim') || allowed.has('approve') || allowed.has('request_changes');
  const hasFooter = allowed.has('release') || allowed.has('reject');
  // Approval waits on a reviewer's own check of every document (the server enforces it too).
  const docsLeft = data.documents.filter((d) => !d.verified_at).length;
  const rejectedNote = a.status === 'rejected' ? a.decision_note : null;
  const hasBody =
    Boolean(notice || error || asked || rejectedNote) || a.status === 'approved' || mode !== null || hasPrimary;

  return (
    <section className="rounded-2xl border border-border bg-white overflow-hidden" data-testid="ops-application-actions">
      <header className="px-5 pt-4 pb-4">
        <div className="flex items-center justify-between gap-2">
          <Eyebrow>Decision</Eyebrow>
          <StatusPill status={a.status} />
        </div>
        <h2 className="mt-2 text-base font-extrabold leading-snug text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground mt-1">{body}</p>
      </header>

      {allowed.has('approve') && <Checks data={data} />}

      {hasBody && (
      <div className="border-t border-border px-5 py-4 space-y-3">
        {notice && (
          <p
            className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
            role="status"
            data-testid="ops-application-notice"
          >
            {notice}
          </p>
        )}
        {error && (
          <p
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            role="alert"
            data-testid="ops-application-action-error"
          >
            {error}
          </p>
        )}

        {asked && (
          <div className="space-y-1.5">
            {asked.fields.length > 0 && (
              <p className="text-xs">
                <span className="text-muted-foreground">Fix: </span>
                {asked.fields.map(fieldLabel).join(', ')}
              </p>
            )}
            {asked.slots.length > 0 && (
              <p className="text-xs">
                <span className="text-muted-foreground">Upload again: </span>
                {asked.slots.map(slotLabel).join(', ')}
              </p>
            )}
            {asked.note && <Quote label="Note sent to the customer">{asked.note}</Quote>}
          </div>
        )}
        {a.status === 'rejected' && a.decision_note && (
          <Quote label="Reason sent to the customer">{a.decision_note}</Quote>
        )}

        {a.status === 'approved' && <ApprovedBody data={data} busy={busy} run={run} />}

        {mode === 'approve' && <ApproveForm data={data} busy={busy} run={run} onCancel={() => setMode(null)} />}
        {mode === 'changes' && <ChangesForm data={data} busy={busy} run={run} onCancel={() => setMode(null)} />}
        {mode === 'reject' && <RejectForm busy={busy} run={run} onCancel={() => setMode(null)} />}

        {mode === null && hasPrimary && (
          <div className="space-y-2">
            {allowed.has('claim') && (
              <Button
                className="w-full h-11 rounded-xl font-semibold"
                disabled={busy}
                onClick={() => void run({ action: 'claim' }, 'Picked up. It is yours to review.')}
                data-testid="button-application-claim"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : 'Pick up for review'}
              </Button>
            )}
            {allowed.has('approve') && (
              <div>
                <Button
                  variant={allowed.has('claim') || docsLeft > 0 ? 'outline' : 'default'}
                  className="w-full h-11 rounded-xl font-semibold"
                  disabled={busy || docsLeft > 0}
                  onClick={() => setMode('approve')}
                  data-testid="ops-application-approve-open"
                >
                  Approve…
                </Button>
                {docsLeft > 0 && (
                  <p className="mt-1.5 text-center text-xs text-muted-foreground" data-testid="ops-application-approve-blocked">
                    Verify every document first ({docsLeft} left).
                  </p>
                )}
              </div>
            )}
            {allowed.has('request_changes') && (
              <Button
                variant="outline"
                className="w-full h-11 rounded-xl font-semibold"
                disabled={busy}
                onClick={() => setMode('changes')}
                data-testid="ops-application-changes-open"
              >
                Request changes…
              </Button>
            )}
          </div>
        )}
      </div>
      )}

      {/* Kept apart from the main buttons: releasing and rejecting are rare, and rejecting is not undone. */}
      {mode === null && hasFooter && (
        <footer className="flex items-center gap-2 px-3 py-2 border-t border-border bg-[#F8F9FA]">
          {allowed.has('release') && (
            <Button
              variant="ghost"
              className="h-9 rounded-lg text-xs font-semibold text-muted-foreground hover:text-foreground"
              disabled={busy}
              onClick={() => void run({ action: 'release' }, 'Put back in the queue.')}
              data-testid="button-application-release"
            >
              Put back in the queue
            </Button>
          )}
          {allowed.has('reject') && (
            <Button
              variant="ghost"
              className="ml-auto h-9 rounded-lg text-xs font-semibold text-red-700 hover:bg-red-50 hover:text-red-800"
              disabled={busy}
              onClick={() => setMode('reject')}
              data-testid="ops-application-reject-open"
            >
              Reject…
            </Button>
          )}
        </footer>
      )}
    </section>
  );
}

function FormHeading({ children }: { children: string }) {
  return <p className="text-sm font-extrabold text-foreground">{children}</p>;
}

function FormButtons({
  label,
  disabled,
  busy,
  destructive = false,
  onSubmit,
  onCancel,
  testId,
}: {
  label: string;
  disabled: boolean;
  busy: boolean;
  destructive?: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  testId: string;
}) {
  return (
    <div className="flex gap-2 pt-1">
      <Button
        variant={destructive ? 'destructive' : 'default'}
        className="flex-1 h-10 rounded-lg font-semibold"
        disabled={busy || disabled}
        onClick={onSubmit}
        data-testid={testId}
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : label}
      </Button>
      <Button variant="outline" className="h-10 rounded-lg" onClick={onCancel} disabled={busy}>
        Cancel
      </Button>
    </div>
  );
}

function ApproveForm({ data, busy, run, onCancel }: { data: Detail; busy: boolean; run: RunFn; onCancel: () => void }) {
  const [email, setEmail] = useState(String(data.application.details.email ?? ''));
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [created, setCreated] = useState(false);

  const submit = async (): Promise<void> => {
    const ok = await run(
      { action: 'approve', itd_email: email.trim(), itd_password: password },
      'Approved. The account is open and the customer has been emailed.',
    );
    // Gone from the page either way: a password left in a field is a password on a shared screen.
    setPassword('');
    if (ok) setCreated(false);
  };

  return (
    <div className="space-y-3" data-testid="ops-application-approve">
      <FormHeading>Approve and open the account</FormHeading>
      <ol className="list-decimal pl-4 text-xs text-muted-foreground space-y-1">
        <li>Create this customer and a login for them in ITD.</li>
        {data.itd_setup && (
          <li>
            Use contract head <span className="font-mono font-semibold text-foreground">{data.itd_setup.contract_head}</span>
            {data.itd_setup.group_code ? (
              <>
                {' '}and group code <span className="font-mono font-semibold text-foreground">{data.itd_setup.group_code}</span>
              </>
            ) : null}
            .
          </li>
        )}
        <li>Enter that login here. ITD checks it before anything is saved, then it is emailed to the customer.</li>
      </ol>
      <div>
        <label className="block text-xs font-semibold mb-1" htmlFor="itd-email">ITD login email</label>
        <Input
          id="itd-email"
          type="email"
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-10 rounded-lg"
          data-testid="input-itd-email"
        />
      </div>
      <div>
        <label className="block text-xs font-semibold mb-1" htmlFor="itd-password">ITD password</label>
        <div className="relative">
          <Input
            id="itd-password"
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-10 rounded-lg pr-10"
            data-testid="input-itd-password"
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? 'Hide password' : 'Show password'}
            className="absolute right-1 top-1/2 -translate-y-1/2 p-2 text-muted-foreground hover:text-foreground"
          >
            {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </div>
      <label className="flex items-start gap-2 text-xs cursor-pointer">
        <Checkbox checked={created} onCheckedChange={(v) => setCreated(v === true)} data-testid="checkbox-itd-created" />
        <span>I have created this customer and login in ITD.</span>
      </label>
      <FormButtons
        label="Approve & open account"
        disabled={!created || !email.trim() || !password}
        busy={busy}
        onSubmit={() => void submit()}
        onCancel={onCancel}
        testId="button-application-approve"
      />
    </div>
  );
}

function ChangesForm({ data, busy, run, onCancel }: { data: Detail; busy: boolean; run: RunFn; onCancel: () => void }) {
  const [fields, setFields] = useState<string[]>([]);
  const [slots, setSlots] = useState<string[]>([]);
  const [note, setNote] = useState('');

  const fieldOptions = DETAIL_ORDER.filter((k) => detailValue(k, data.application.details[k]) !== null);
  // The note is optional; asking for nothing at all is not.
  const nothingAsked = fields.length === 0 && slots.length === 0 && note.trim() === '';
  const toggle = (list: string[], set: (v: string[]) => void, key: string): void =>
    set(list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);

  const submit = async (): Promise<void> => {
    const ok = await run(
      { action: 'request_changes', fields, slots, note: note.trim() },
      'Sent. The customer has been told what to change.',
    );
    if (ok) {
      setFields([]);
      setSlots([]);
      setNote('');
    }
  };

  return (
    <div className="space-y-3" data-testid="ops-application-changes">
      <FormHeading>Ask the customer for a change</FormHeading>
      <fieldset>
        <legend className="text-xs font-semibold mb-1.5">Details to fix</legend>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          {fieldOptions.map((key) => (
            <label key={key} className="flex items-center gap-2 text-xs cursor-pointer">
              <Checkbox checked={fields.includes(key)} onCheckedChange={() => toggle(fields, setFields, key)} />
              {APPLICATION_FIELD_LABELS[key]}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="text-xs font-semibold mb-1.5">Documents to upload again</legend>
        <div className="grid gap-1.5">
          {data.documents.map((doc) => (
            <label key={doc.slot} className="flex items-center gap-2 text-xs cursor-pointer">
              <Checkbox checked={slots.includes(doc.slot)} onCheckedChange={() => toggle(slots, setSlots, doc.slot)} />
              {slotLabel(doc.slot)}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label className="block text-xs font-semibold mb-1" htmlFor="changes-note">
          Note to the customer <span className="font-normal text-muted-foreground">(optional, shown word for word)</span>
        </label>
        <Textarea
          id="changes-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={4}
          maxLength={1000}
          placeholder="e.g. Your PAN card photo is blurred. Please upload a clear photo of the original."
          className="rounded-lg"
          data-testid="input-changes-note"
        />
      </div>
      {nothingAsked && (
        <p className="text-xs text-muted-foreground">Tick what they should change, or write them a note.</p>
      )}
      <FormButtons
        label="Send to customer"
        disabled={nothingAsked}
        busy={busy}
        onSubmit={() => void submit()}
        onCancel={onCancel}
        testId="button-application-request-changes"
      />
    </div>
  );
}

function RejectForm({ busy, run, onCancel }: { busy: boolean; run: RunFn; onCancel: () => void }) {
  const [reason, setReason] = useState('');
  return (
    <div className="space-y-3" data-testid="ops-application-reject">
      <FormHeading>Reject this application</FormHeading>
      <div>
        <label className="block text-xs font-semibold mb-1" htmlFor="reject-reason">
          Reason (shown to the customer word for word)
        </label>
        <Textarea
          id="reject-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={1000}
          className="rounded-lg"
          data-testid="input-reject-reason"
        />
      </div>
      <p className="text-xs text-muted-foreground">They stay a guest, keep their bookings, and can apply again.</p>
      <FormButtons
        label="Reject"
        destructive
        disabled={reason.trim().length < 5}
        busy={busy}
        onSubmit={() => void run({ action: 'reject', reason: reason.trim() }, 'Rejected. The customer has been told.')}
        onCancel={onCancel}
        testId="button-application-reject"
      />
    </div>
  );
}

function ApprovedBody({ data, busy, run }: { data: Detail; busy: boolean; run: RunFn }) {
  const a = data.application;
  return (
    <div className="space-y-3" data-testid="ops-application-approved">
      {a.user_id && (
        <Link href={`/ops/customers/${a.user_id}`} className="block text-sm font-semibold text-[#2F4468] hover:underline">
          Open the customer →
        </Link>
      )}

      {a.finalize_error ? (
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
          <p className="flex items-center gap-1.5 text-xs font-bold text-amber-900">
            <AlertTriangle className="w-3.5 h-3.5" aria-hidden />
            Moving to the account didn't finish
          </p>
          <p className="text-xs text-amber-900 mt-1 break-words">{a.finalize_error}</p>
          <Button
            variant="outline"
            className="mt-2 h-9 rounded-lg text-xs font-semibold"
            disabled={busy}
            onClick={() => void run({ action: 'retry_finalize' }, 'Done. Everything is on the account now.')}
            data-testid="button-application-retry"
          >
            Retry
          </Button>
        </div>
      ) : (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0 mt-px" aria-hidden />
          Documents, identity numbers and guest orders are on the account.
        </p>
      )}

      <div className="pt-3 border-t border-border">
        {a.email_sent_at ? (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Mail className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden />
            Email with the login sent {formatIst(a.email_sent_at)}.
          </p>
        ) : (
          <p className="text-xs text-red-700 break-words">Email not sent{a.email_error ? `: ${a.email_error}` : '.'}</p>
        )}
        <Button
          variant="outline"
          className="mt-2 h-9 rounded-lg text-xs font-semibold"
          disabled={busy}
          onClick={() => void run({ action: 'resend_email' }, 'Email sent again.')}
          data-testid="button-application-resend"
        >
          {a.email_sent_at ? 'Send the email again' : 'Send the email'}
        </Button>
      </div>
    </div>
  );
}
