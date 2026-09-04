import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { Loader2, Search } from 'lucide-react';
import { OpsShell } from '@/components/ops/OpsShell';
import { Input } from '@/components/ui/input';
import { useOpsCustomers } from '@/hooks/useOpsCustomers';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

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
      data-testid="ops-customers-desktop-only"
    >
      Customer records are available on desktop.
    </p>
  );
}

export default function OpsCustomers() {
  const isMobile = useIsMobile();
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => setQ(input.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [input]);

  const list = useOpsCustomers(q);

  return (
    <OpsShell title="Customers" subtitle="Find accounts and KYC status" wide>
      {isMobile ? (
        <DesktopOnlyNotice />
      ) : (
        <>
          <div className="relative mb-4">
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
              data-testid="ops-customers-search"
              aria-label="Search name or phone"
            />
          </div>

          {list.isLoading && (
            <div className="flex justify-center py-16" data-testid="ops-customers-loading">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {list.isError && (
            <p
              className="text-sm text-red-600 py-8 text-center"
              data-testid="ops-customers-error"
            >
              Could not load customers. Try refreshing.
            </p>
          )}

          {!list.isLoading && !list.isError && (list.data?.length ?? 0) === 0 && (
            <p
              className="text-sm text-muted-foreground py-12 text-center"
              data-testid="ops-customers-empty"
            >
              {q ? 'No customers match that search.' : 'No customers yet.'}
            </p>
          )}

          {!list.isLoading && !list.isError && (list.data?.length ?? 0) > 0 && (
            <ul
              className="rounded-2xl border border-border bg-white divide-y divide-border"
              data-testid="ops-customers-list"
            >
              {list.data!.map((row) => (
                <li key={row.id}>
                  <Link
                    href={`/ops/customers/${row.id}`}
                    className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-muted/40 transition-colors"
                    data-testid={`ops-customer-row-${row.id}`}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-extrabold text-foreground truncate">
                        {row.full_name}
                      </p>
                      <p className="text-sm text-muted-foreground tabular-nums mt-0.5">
                        {row.phone ?? '—'}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Joined {formatJoined(row.created_at)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right flex flex-col items-end gap-1">
                      <span className="inline-block text-[11px] font-bold uppercase tracking-wide rounded-md bg-[#F3F4F6] px-2 py-1">
                        {row.account_type === 'company' ? 'Company' : 'Personal'}
                      </span>
                      <span
                        className={cn(
                          'inline-block text-[11px] font-bold rounded-md px-2 py-1',
                          row.kyc_on_file
                            ? 'bg-emerald-50 text-emerald-800'
                            : 'bg-[#F3F4F6] text-muted-foreground',
                        )}
                      >
                        {row.kyc_on_file ? 'KYC on file' : 'No KYC'}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </OpsShell>
  );
}
