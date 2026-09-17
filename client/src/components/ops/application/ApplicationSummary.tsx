/**
 * The record's facts and the pre-flight checks, beside the decision panel.
 *
 * Moved verbatim out of `pages/ops/OpsApplicationDetail.tsx`.
 */

import { useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { formatIst } from '@/lib/orderDetail';
import { SLOW_AFTER_MS, waitedFor } from '@/lib/opsApplications';
import { isAcceptedOcrStatus } from '@shared/accountSpec';
import { isOpenApplicationStatus } from '@shared/applicationStatus';
import type { OpsApplicationDetail as Detail } from '@/hooks/useOpsApplications';
import { docStatus } from './ApplicationDocuments';
import {
  Eyebrow,
} from './blocks';

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
export function Properties({ data }: { data: Detail }) {
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
export function Checks({ data }: { data: Detail }) {
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
