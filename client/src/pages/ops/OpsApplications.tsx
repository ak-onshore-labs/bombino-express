import { useState } from 'react';
import { Link } from 'wouter';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { OpsShell } from '@/components/ops/OpsShell';
import { OpsApplicationSettings } from '@/components/ops/OpsApplicationAlerts';
import { useOpsApplications, type OpsApplicationFilter, type OpsApplicationRow } from '@/hooks/useOpsApplications';
import { OPS_STATUS_LABEL, OPS_STATUS_TONE, SLOW_AFTER_MS, waitedFor } from '@/lib/opsApplications';
import { formatIst } from '@/lib/orderDetail';
import { cn } from '@/lib/utils';
import { isOpenApplicationStatus } from '@shared/applicationStatus';

/**
 * Account applications: signups waiting for the Bombino team (account review,
 * docs/account-review.md). Oldest first, so the longest wait is at the top.
 */

const FILTERS: Array<{ value: OpsApplicationFilter; label: string }> = [
  { value: 'open', label: 'Open' },
  { value: 'submitted', label: 'New' },
  { value: 'in_review', label: 'In review' },
  { value: 'changes_requested', label: 'Waiting on customer' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'all', label: 'All' },
];

function FilterChip({
  selected,
  onClick,
  children,
  testId,
}: {
  selected: boolean;
  onClick: () => void;
  children: string;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={cn(
        'h-8 px-3 rounded-lg text-xs font-bold transition-colors',
        selected ? 'bg-[#C62828] text-white' : 'bg-[#F3F4F6] text-foreground hover:bg-muted',
      )}
    >
      {children}
    </button>
  );
}

export function StatusPill({ status }: { status: OpsApplicationRow['status'] }) {
  return (
    <span
      className={cn(
        'inline-block whitespace-nowrap text-[11px] font-bold uppercase tracking-wide rounded-md px-2 py-1',
        OPS_STATUS_TONE[status],
      )}
    >
      {OPS_STATUS_LABEL[status]}
    </span>
  );
}

/** Something on an approved application that needs a person: a half-finished move, or no email. */
function needsAttention(row: OpsApplicationRow): string | null {
  if (row.status !== 'approved') return null;
  if (row.finalize_error) return 'Not fully moved';
  if (!row.email_sent_at && row.email_error) return 'Email not sent';
  return null;
}

export default function OpsApplications() {
  const [filter, setFilter] = useState<OpsApplicationFilter>('open');
  const list = useOpsApplications(filter);
  const rows = list.data?.applications ?? [];
  const now = Date.now();

  return (
    <OpsShell
      title="Applications"
      subtitle="New accounts waiting for the Bombino team"
      actions={<OpsApplicationSettings />}
      wide
    >
      {list.data && !list.data.enabled && (
        <div
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 mb-4 text-sm text-amber-900"
          data-testid="ops-applications-review-off"
        >
          Account review is switched off, so signup opens accounts straight away and nothing new arrives here.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5 mb-4" data-testid="ops-applications-filter">
        {FILTERS.map((f) => (
          <FilterChip
            key={f.value}
            selected={filter === f.value}
            onClick={() => setFilter(f.value)}
            testId={`ops-applications-filter-${f.value}`}
          >
            {f.label}
          </FilterChip>
        ))}
      </div>

      {list.isLoading && (
        <div className="flex justify-center py-16" data-testid="ops-applications-loading">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {list.isError && (
        <p className="text-sm text-red-600 py-8 text-center" data-testid="ops-applications-error">
          Could not load applications. Try refreshing.
        </p>
      )}

      {!list.isLoading && !list.isError && rows.length === 0 && (
        <p className="text-sm text-muted-foreground py-12 text-center" data-testid="ops-applications-empty">
          {filter === 'open' ? 'Nothing waiting. New applications appear here.' : 'No applications here.'}
        </p>
      )}

      {!list.isLoading && !list.isError && rows.length > 0 && (
        <div className="rounded-2xl border border-border bg-white overflow-x-auto" data-testid="ops-applications-list">
          <table className="w-full text-sm" data-testid="ops-applications-table">
            <thead>
              <tr className="text-left text-xs font-semibold text-muted-foreground border-b border-border">
                <th className="px-4 py-3">Applicant</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Account</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Sent</th>
                <th className="px-4 py-3">Waiting</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const open = isOpenApplicationStatus(row.status);
                const slow = open && now - new Date(row.submitted_at).getTime() > SLOW_AFTER_MS;
                const attention = needsAttention(row);
                return (
                  <tr
                    key={row.id}
                    className="border-b border-border last:border-b-0 hover:bg-muted/40"
                    data-testid={`ops-application-row-${row.id}`}
                  >
                    <td className="px-4 py-3">
                      <Link href={`/ops/applications/${row.id}`} className="font-extrabold text-foreground hover:underline">
                        {row.name ?? row.phone}
                      </Link>
                      <p className="text-xs text-muted-foreground truncate max-w-[16rem]">{row.email}</p>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground tabular-nums whitespace-nowrap">{row.phone}</td>
                    <td className="px-4 py-3">
                      <span className="inline-block text-[11px] font-bold uppercase tracking-wide rounded-md bg-[#F3F4F6] px-2 py-1">
                        {row.category_label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusPill status={row.status} />
                        {row.resubmission_count > 0 && open && (
                          <span className="text-[11px] font-semibold text-muted-foreground">
                            resent {row.resubmission_count}×
                          </span>
                        )}
                        {attention && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-red-700">
                            <AlertTriangle className="w-3 h-3" aria-hidden />
                            {attention}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{formatIst(row.submitted_at)}</td>
                    <td className={cn('px-4 py-3 tabular-nums whitespace-nowrap', slow ? 'font-bold text-red-700' : 'text-muted-foreground')}>
                      {open ? waitedFor(row.submitted_at, now) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </OpsShell>
  );
}
