import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { Loader2, Search } from 'lucide-react';
import { OpsDocumentPreviewOverlay, useOpsDocumentPreview } from '@/components/ops/OpsDocumentPreview';
import { OpsShell } from '@/components/ops/OpsShell';
import { Input } from '@/components/ui/input';
import {
  fetchOpsCustomerDocumentFile,
  fetchOpsCustomerKycFile,
  useOpsCustomers,
  type OpsCustomerListRow,
} from '@/hooks/useOpsCustomers';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAppStore } from '@/lib/store';
import { DOC_SLOT_SPECS, isDocSlot } from '@shared/accountSpec';
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
      data-testid="ops-customers-desktop-only"
    >
      Customer records are available on desktop.
    </p>
  );
}

function slotLabel(slot: string): string {
  return isDocSlot(slot) ? DOC_SLOT_SPECS[slot].label : slot;
}

function identityKindLabel(kind: string): string {
  if (kind === 'aadhaar') return 'Aadhaar';
  if (kind === 'pan') return 'PAN';
  if (kind === 'gstin') return 'GSTIN';
  return kind;
}

function listCaption(n: number, filtered: boolean): string {
  if (n < LIST_CAP) return n === 1 ? '1 customer.' : `${n} customers.`;
  if (filtered) return '200 newest matching these filters.';
  return 'Latest 200 customers.';
}

type TypeFilter = 'all' | 'personal' | 'company';
type KycFilter = 'all' | 'on_file' | 'none';

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

function FileChip({
  label,
  busy,
  error,
  onView,
  testId,
}: {
  label: string;
  busy: boolean;
  error?: string;
  onView: () => void;
  testId: string;
}) {
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onView();
        }}
        disabled={busy}
        data-testid={testId}
        className="inline-flex items-center gap-1 h-6 px-2 rounded-md text-[11px] font-bold bg-[#F3F4F6] text-foreground hover:bg-muted disabled:opacity-60"
      >
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
        {label}
      </button>
      {error ? <span className="text-[10px] text-red-600 max-w-[10rem]">{error}</span> : null}
    </span>
  );
}

function DocumentChips({
  row,
  canView,
  fileBusy,
  fileErrors,
  onOpenSlot,
  onOpenShipment,
}: {
  row: OpsCustomerListRow;
  canView: boolean;
  fileBusy: string | null;
  fileErrors: Record<string, string>;
  onOpenSlot: (slot: string) => void;
  onOpenShipment: () => void;
}) {
  const hasAny =
    row.doc_slots.length > 0 || row.shipment_kyc || row.identity_kinds.length > 0;
  if (!hasAny) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {row.doc_slots.map((slot) => {
        const label = slotLabel(slot);
        const key = `${row.id}:${slot}`;
        return canView ? (
          <FileChip
            key={slot}
            label={label}
            busy={fileBusy === key}
            error={fileErrors[key]}
            onView={() => onOpenSlot(slot)}
            testId={`ops-customer-doc-${row.id}-${slot}`}
          />
        ) : (
          <PresenceChip
            key={slot}
            label={label}
            testId={`ops-customer-doc-${row.id}-${slot}`}
          />
        );
      })}
      {row.shipment_kyc ? (
        canView ? (
          <FileChip
            label="Shipment KYC"
            busy={fileBusy === `${row.id}:shipment`}
            error={fileErrors[`${row.id}:shipment`]}
            onView={onOpenShipment}
            testId={`ops-customer-doc-${row.id}-shipment`}
          />
        ) : (
          <PresenceChip
            label="Shipment KYC"
            testId={`ops-customer-doc-${row.id}-shipment`}
          />
        )
      ) : null}
      {row.identity_kinds.map((kind) => (
        <PresenceChip
          key={kind}
          label={identityKindLabel(kind)}
          testId={`ops-customer-id-${row.id}-${kind}`}
        />
      ))}
    </div>
  );
}

export default function OpsCustomers() {
  const isMobile = useIsMobile();
  const canViewKyc = useAppStore((s) => s.user?.role) === 'super_admin';
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [kycFilter, setKycFilter] = useState<KycFilter>('all');
  const { preview, closePreview, openBlob, fileBusy, fileErrors } = useOpsDocumentPreview();

  useEffect(() => {
    const timer = window.setTimeout(() => setQ(input.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [input]);

  const filtered = Boolean(q) || typeFilter !== 'all' || kycFilter !== 'all';
  const list = useOpsCustomers({
    q,
    account_type: typeFilter === 'all' ? undefined : typeFilter,
    kyc: kycFilter === 'all' ? undefined : kycFilter,
  });

  const openSlot = (customerId: string, slot: string): void => {
    void openBlob(`${customerId}:${slot}`, `${slotLabel(slot)}.pdf`, () =>
      fetchOpsCustomerDocumentFile(customerId, slot),
    );
  };

  const openShipment = (customerId: string): void => {
    void openBlob(`${customerId}:shipment`, 'Shipment KYC.pdf', () =>
      fetchOpsCustomerKycFile(customerId),
    );
  };

  return (
    <OpsShell title="Customers" subtitle="Find accounts and KYC status" wide>
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
              data-testid="ops-customers-search"
              aria-label="Search name or phone"
            />
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-4">
            <div className="flex items-center gap-1.5" data-testid="ops-customers-filter-type">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mr-1">
                Type
              </span>
              <FilterChip
                selected={typeFilter === 'all'}
                onClick={() => setTypeFilter('all')}
                testId="ops-customers-type-all"
              >
                All
              </FilterChip>
              <FilterChip
                selected={typeFilter === 'personal'}
                onClick={() => setTypeFilter('personal')}
                testId="ops-customers-type-personal"
              >
                Personal
              </FilterChip>
              <FilterChip
                selected={typeFilter === 'company'}
                onClick={() => setTypeFilter('company')}
                testId="ops-customers-type-company"
              >
                Company
              </FilterChip>
            </div>
            <div className="flex items-center gap-1.5" data-testid="ops-customers-filter-kyc">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mr-1">
                KYC
              </span>
              <FilterChip
                selected={kycFilter === 'all'}
                onClick={() => setKycFilter('all')}
                testId="ops-customers-kyc-all"
              >
                All
              </FilterChip>
              <FilterChip
                selected={kycFilter === 'on_file'}
                onClick={() => setKycFilter('on_file')}
                testId="ops-customers-kyc-on-file"
              >
                On file
              </FilterChip>
              <FilterChip
                selected={kycFilter === 'none'}
                onClick={() => setKycFilter('none')}
                testId="ops-customers-kyc-none"
              >
                None
              </FilterChip>
            </div>
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
              {filtered ? 'No customers match these filters.' : 'No customers yet.'}
            </p>
          )}

          {!list.isLoading && !list.isError && (list.data?.length ?? 0) > 0 && (
            <>
              <p
                className="text-xs text-muted-foreground mb-2"
                data-testid="ops-customers-caption"
              >
                {listCaption(list.data!.length, filtered)}
              </p>
              <div
                className="rounded-2xl border border-border bg-white overflow-x-auto"
                data-testid="ops-customers-list"
              >
                <table className="w-full text-sm" data-testid="ops-customers-table">
                  <thead>
                    <tr className="text-left text-xs font-semibold text-muted-foreground border-b border-border">
                      <th className="px-4 py-3">Customer</th>
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
                        key={row.id}
                        className="border-b border-border last:border-b-0 hover:bg-muted/40"
                        data-testid={`ops-customer-row-${row.id}`}
                      >
                        <td className="px-4 py-3">
                          <Link
                            href={`/ops/customers/${row.id}`}
                            className="font-extrabold text-foreground hover:underline"
                          >
                            {row.full_name}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground tabular-nums whitespace-nowrap">
                          {row.phone ?? '—'}
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-block text-[11px] font-bold uppercase tracking-wide rounded-md bg-[#F3F4F6] px-2 py-1">
                            {row.account_type === 'company' ? 'Company' : 'Personal'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <DocumentChips
                            row={row}
                            canView={canViewKyc}
                            fileBusy={fileBusy}
                            fileErrors={fileErrors}
                            onOpenSlot={(slot) => openSlot(row.id, slot)}
                            onOpenShipment={() => openShipment(row.id)}
                          />
                        </td>
                        <td className="px-4 py-3 tabular-nums">
                          {row.order_count > 0 ? (
                            <Link
                              href={`/ops/customers/${row.id}`}
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

      {preview && <OpsDocumentPreviewOverlay preview={preview} onClose={closePreview} />}
    </OpsShell>
  );
}
