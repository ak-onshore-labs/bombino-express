import { useState } from 'react';
import { Link } from 'wouter';
import { ChevronRight, LifeBuoy, Loader2 } from 'lucide-react';
import { OpsShell } from '@/components/ops/OpsShell';
import {
  CASE_CATEGORY_LABELS,
  CASE_STATUS_STYLE,
  CasesNotSetUpError,
  formatCaseTime,
  useOpsCases,
  type OpsCaseStatus,
} from '@/hooks/useOpsCases';
import { cn } from '@/lib/utils';

const FILTERS: { value: OpsCaseStatus | 'all'; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'answered', label: 'Answered' },
  { value: 'closed', label: 'Closed' },
  { value: 'all', label: 'All' },
];

/**
 * Support cases BIA opened for customers who needed a person (BIA 3.0, 4.2).
 * Newest first; open ones are the queue. A reply reaches the customer's bell.
 */
export default function OpsCases() {
  const [filter, setFilter] = useState<OpsCaseStatus | 'all'>('open');
  const { data, isLoading, isError, error } = useOpsCases(filter);
  const notSetUp = error instanceof CasesNotSetUpError;

  return (
    <OpsShell title="Cases" subtitle="Customers BIA handed to the team">
      <div className="flex flex-wrap gap-2 mb-4" role="tablist" aria-label="Case status">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            role="tab"
            aria-selected={filter === f.value}
            onClick={() => setFilter(f.value)}
            className={cn(
              'h-9 px-4 rounded-full border text-sm font-semibold',
              filter === f.value ? 'border-primary bg-primary text-white' : 'border-[#E2E8F0] bg-white text-foreground',
            )}
            data-testid={`button-ops-cases-${f.value}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="flex justify-center py-16" data-testid="ops-cases-loading">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {notSetUp && (
        <div className="rounded-2xl border border-border bg-white p-5 max-w-xl" data-testid="ops-cases-not-set-up">
          <h2 className="text-base font-extrabold mb-1">Cases aren't set up yet</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            BIA opens a case when a customer needs a person, once the support cases table exists. Run{' '}
            <code className="text-xs">migrations/create_support_cases.sql</code> in Supabase, then switch on
            the <code className="text-xs">handoff</code> module.
          </p>
        </div>
      )}

      {isError && !notSetUp && (
        <p className="text-sm text-muted-foreground py-8" data-testid="ops-cases-error">
          Could not load cases.
        </p>
      )}

      {data && data.length === 0 && (
        <div className="text-center py-14" data-testid="ops-cases-empty">
          <LifeBuoy className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            {filter === 'open' ? 'No open cases. Nobody is waiting on the team.' : 'No cases here.'}
          </p>
        </div>
      )}

      {data && data.length > 0 && (
        <ul className="flex flex-col gap-2" data-testid="ops-cases-list">
          {data.map((c) => {
            const status = CASE_STATUS_STYLE[c.status];
            return (
              <li key={c.id}>
                <Link
                  href={`/ops/cases/${c.id}`}
                  className="flex items-start gap-3 rounded-2xl border border-border bg-white p-4 hover:border-primary/40 transition-colors"
                  data-testid={`ops-case-${c.caseNo}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-extrabold tabular-nums">{c.caseNo}</span>
                      <span className={cn('text-[11px] font-bold rounded-full px-2 py-0.5', status.className)}>{status.label}</span>
                      <span className="text-[11px] font-semibold rounded-md bg-[#F3F4F6] px-2 py-0.5">
                        {CASE_CATEGORY_LABELS[c.category] ?? c.category}
                      </span>
                    </div>
                    <p className="text-sm text-foreground mt-1.5 line-clamp-2">{c.headline}</p>
                    <p className="text-xs text-muted-foreground mt-1 tabular-nums">
                      {c.customerName ?? (c.owner === 'guest' ? 'Guest' : 'Customer')}
                      {c.orderNo ? ` · ${c.orderNo}` : ''} · {formatCaseTime(c.createdAt)}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground mt-1 shrink-0" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </OpsShell>
  );
}
