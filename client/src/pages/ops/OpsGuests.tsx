import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { Loader2, Search } from 'lucide-react';
import { OpsShell } from '@/components/ops/OpsShell';
import { Input } from '@/components/ui/input';
import { useOpsGuests, type OpsGuestAccountType } from '@/hooks/useOpsGuests';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

const LIST_CAP = 200;

function formatJoined(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function DesktopOnlyNotice() {
  return (
    <p
      className="text-sm text-muted-foreground py-10 text-center"
      data-testid="ops-guests-desktop-only"
    >
      Guest records are available on desktop.
    </p>
  );
}

function listCaption(n: number, filtered: boolean): string {
  if (n < LIST_CAP) return n === 1 ? '1 guest.' : `${n} guests.`;
  if (filtered) return '200 newest matching these filters.';
  return 'Latest 200 guests.';
}

function accountTypeLabel(accountType: OpsGuestAccountType): string {
  if (accountType === 'company') return 'Company';
  if (accountType === 'personal') return 'Personal';
  return 'Unset';
}

function guestDisplayName(fullName: string | null): string {
  const trimmed = fullName?.trim() ?? '';
  return trimmed !== '' ? trimmed : 'Unnamed guest';
}

type TypeFilter = 'all' | 'personal' | 'company' | 'unset';

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

function PresenceChip({
  label,
  testId,
}: {
  label: string;
  testId: string;
}) {
  return (
    <span
      className="inline-flex items-center h-6 px-2 rounded-md text-[11px] font-bold bg-[#F3F4F6] text-foreground"
      data-testid={testId}
    >
      {label}
    </span>
  );
}

export default function OpsGuests() {
  const isMobile = useIsMobile();
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');

  useEffect(() => {
    const timer = window.setTimeout(() => setQ(input.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [input]);

  const filtered = Boolean(q) || typeFilter !== 'all';
  const list = useOpsGuests({
    q,
    account_type: typeFilter === 'all' ? undefined : typeFilter,
  });

  return (
    <OpsShell title="Guests" subtitle="Find unverified bookers and KYC status" wide>
      {isMobile ? (
        <DesktopOnlyNotice />
      ) : (
        <>
          <div className="relative mb-3">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none"
              aria-hidden
            />
            <Input
              type="search"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Search name or phone"
              className="h-11 pl-9 rounded-xl bg-white"
              data-testid="ops-guests-search"
              aria-label="Search name or phone"
            />
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-4">
            <div className="flex items-center gap-1.5" data-testid="ops-guests-filter-type">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mr-1">
                Type
              </span>
              <FilterChip
                selected={typeFilter === 'all'}
                onClick={() => setTypeFilter('all')}
                testId="ops-guests-type-all"
              >
                All
              </FilterChip>
              <FilterChip
                selected={typeFilter === 'personal'}
                onClick={() => setTypeFilter('personal')}
                testId="ops-guests-type-personal"
              >
                Personal
              </FilterChip>
              <FilterChip
                selected={typeFilter === 'company'}
                onClick={() => setTypeFilter('company')}
                testId="ops-guests-type-company"
              >
                Company
              </FilterChip>
              <FilterChip
                selected={typeFilter === 'unset'}
                onClick={() => setTypeFilter('unset')}
                testId="ops-guests-type-unset"
              >
                Unset
              </FilterChip>
            </div>
          </div>

          {list.isLoading && (
            <div className="flex justify-center py-16" data-testid="ops-guests-loading">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {list.isError && (
            <p
              className="text-sm text-red-600 py-8 text-center"
              data-testid="ops-guests-error"
            >
              Could not load guests. Try refreshing.
            </p>
          )}

          {!list.isLoading && !list.isError && (list.data?.length ?? 0) === 0 && (
            <p
              className="text-sm text-muted-foreground py-12 text-center"
              data-testid="ops-guests-empty"
            >
              {filtered ? 'No guests match these filters.' : 'No guests yet.'}
            </p>
          )}

          {!list.isLoading && !list.isError && (list.data?.length ?? 0) > 0 && (
            <>
              <p
                className="text-xs text-muted-foreground mb-2"
                data-testid="ops-guests-caption"
              >
                {listCaption(list.data!.length, filtered)}
              </p>
              <div
                className="rounded-2xl border border-border bg-white overflow-x-auto"
                data-testid="ops-guests-list"
              >
                <table className="w-full text-sm" data-testid="ops-guests-table">
                  <thead>
                    <tr className="text-left text-xs font-semibold text-muted-foreground border-b border-border">
                      <th className="px-4 py-3">Guest</th>
                      <th className="px-4 py-3">Contact</th>
                      <th className="px-4 py-3">Type</th>
                      <th className="px-4 py-3">KYC/Documents</th>
                      <th className="px-4 py-3">Orders</th>
                      <th className="px-4 py-3">Joined</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.data!.map((row) => (
                      <tr
                        key={row.guest_ref}
                        className="border-b border-border last:border-b-0 hover:bg-muted/40"
                        data-testid={`ops-guest-row-${row.guest_ref}`}
                      >
                        <td className="px-4 py-3">
                          <Link
                            href={`/ops/guests/${row.guest_ref}`}
                            className="font-extrabold text-foreground hover:underline"
                          >
                            {guestDisplayName(row.full_name)}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground tabular-nums whitespace-nowrap">
                          {row.phone || '—'}
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-block text-[11px] font-bold uppercase tracking-wide rounded-md bg-[#F3F4F6] px-2 py-1">
                            {accountTypeLabel(row.account_type)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {row.kyc_on_file ? (
                            <PresenceChip
                              label="Shipment KYC"
                              testId={`ops-guest-doc-${row.guest_ref}-shipment`}
                            />
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 tabular-nums">
                          {row.order_count > 0 ? (
                            <Link
                              href={`/ops/guests/${row.guest_ref}`}
                              className="font-semibold text-foreground hover:underline"
                            >
                              {row.order_count}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                          {formatJoined(row.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </OpsShell>
  );
}
