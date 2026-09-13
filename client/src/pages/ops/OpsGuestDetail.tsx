import { ArrowLeft, Loader2 } from 'lucide-react';
import { Link, useParams } from 'wouter';
import { OpsShell } from '@/components/ops/OpsShell';
import { OpsOrderCard } from '@/components/ops/OpsOrderCard';
import { Button } from '@/components/ui/button';
import {
  useOpsGuestDetail,
  useOpsGuestOrders,
  type OpsGuestAccountType,
} from '@/hooks/useOpsGuests';
import { useIsMobile } from '@/hooks/use-mobile';
import { formatIst } from '@/lib/orderDetail';
import {
  COMPANY_CATEGORY_SPECS,
  EXTRA_FIELD_SPECS,
  EXTRA_FIELDS,
  isCompanyCategory,
  type ExtraField,
} from '@shared/accountSpec';
import { INDIA_HUBS } from '@shared/hubs';

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

function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="py-2.5 border-b border-border last:border-b-0">
      <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
        {label}
      </p>
      <p className="text-sm font-semibold text-foreground mt-0.5 break-words">
        {value && value.trim() !== '' ? value : '—'}
      </p>
    </div>
  );
}

function formatMemberSince(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
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

function documentLabel(raw: string): string {
  if (raw === 'aadhaar') return 'Aadhaar Card';
  if (raw === 'pan') return 'PAN Card';
  if (raw === 'gstin') return 'GSTIN';
  return raw.trim() !== '' ? raw : 'Document';
}

function ocrStatusLabel(status: string | null): string | null {
  if (!status) return null;
  if (status === 'verified') return 'Verified';
  if (status === 'pending') return 'Pending';
  if (status === 'failed') return 'Failed';
  return status;
}

function mimeKind(mime: string): 'image' | 'pdf' | 'other' {
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  return 'other';
}

function hubLabel(hubId: string | null): string | null {
  if (!hubId) return null;
  const n = Number(hubId);
  const hub = INDIA_HUBS.find((h) => h.id === n);
  return hub?.name ?? hubId;
}

function extraLabel(key: string): string {
  if ((EXTRA_FIELDS as readonly string[]).includes(key)) {
    return EXTRA_FIELD_SPECS[key as ExtraField].label;
  }
  return key;
}

function formatAddress(parts: {
  address_line_1: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
}): string | null {
  const line = [parts.address_line_1, parts.city, parts.state, parts.pincode]
    .map((p) => p?.trim() ?? '')
    .filter((p) => p !== '');
  return line.length > 0 ? line.join(', ') : null;
}

export default function OpsGuestDetail() {
  const params = useParams<{ ref: string }>();
  const ref = params.ref;
  const isMobile = useIsMobile();
  const { data, isLoading, isError, error } = useOpsGuestDetail(ref);
  const ordersQuery = useOpsGuestOrders(ref);

  const notFound =
    isError && error instanceof Error && error.message.startsWith('404:');

  const shipment = data?.kyc.shipment_kyc ?? null;
  const extras = data?.guest.extras ?? {};
  const extraEntries = Object.entries(extras).filter(
    (entry): entry is [string, string] =>
      typeof entry[1] === 'string' && entry[1].trim() !== '',
  );

  return (
    <OpsShell
      title={data ? guestDisplayName(data.guest.full_name) : 'Guest'}
      subtitle="Guest profile and KYC status"
      wide
    >
      {isMobile ? (
        <DesktopOnlyNotice />
      ) : (
        <>
          <Link
            href="/ops/guests"
            className="inline-flex items-center gap-1 text-sm font-semibold text-[#F2A123] mb-4"
            data-testid="link-ops-back-guests"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to guests
          </Link>

          {isLoading && (
            <div className="flex justify-center py-16" data-testid="ops-guest-detail-loading">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {isError && (
            <p
              className="text-sm text-muted-foreground py-8"
              data-testid="ops-guest-detail-error"
            >
              {notFound ? 'That guest could not be found.' : 'Could not load this guest.'}
            </p>
          )}

          {data && (
            <>
              <div
                className="flex flex-wrap items-center gap-2 mb-5"
                data-testid="ops-guest-header"
              >
                <span className="inline-block text-[11px] font-bold uppercase tracking-wide rounded-md bg-[#C62828] text-white px-2 py-1">
                  Guest
                </span>
                <span className="inline-block text-[11px] font-bold uppercase tracking-wide rounded-md bg-[#F3F4F6] px-2 py-1">
                  {accountTypeLabel(data.guest.account_type)}
                </span>
                <p className="text-sm text-muted-foreground tabular-nums">
                  {data.guest.phone || '—'}
                </p>
              </div>

              <section
                className="rounded-2xl border border-border bg-white p-4 mb-6"
                data-testid="ops-guest-kyc-documents"
              >
                <h2 className="text-base font-extrabold text-foreground mb-3">Documents</h2>

                {!shipment ? (
                  <p
                    className="text-sm text-muted-foreground"
                    data-testid={data.kyc.on_file ? 'ops-kyc-no-documents' : 'ops-kyc-empty'}
                  >
                    {data.kyc.on_file
                      ? 'No documents on file to view.'
                      : 'No KYC records on file — nothing to verify.'}
                  </p>
                ) : (
                  <>
                    <ul className="divide-y divide-border rounded-xl border border-border">
                      <li className="flex items-start justify-between gap-3 px-3 py-2.5">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold">
                              {documentLabel(shipment.document_type)}
                            </p>
                            {mimeKind(shipment.mime_type) !== 'other' && (
                              <span className="inline-block text-[11px] font-bold rounded-md bg-[#F3F4F6] px-2 py-0.5">
                                {mimeKind(shipment.mime_type) === 'pdf' ? 'PDF' : 'Image'}
                              </span>
                            )}
                            {ocrStatusLabel(shipment.ocr_status) && (
                              <span className="inline-block text-[11px] font-bold rounded-md bg-[#F3F4F6] px-2 py-0.5">
                                {ocrStatusLabel(shipment.ocr_status)}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">
                            {shipment.original_filename || '—'}
                            {shipment.updated_at
                              ? ` · uploaded ${formatIst(shipment.updated_at)}`
                              : ''}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-9 rounded-lg text-xs font-semibold shrink-0"
                          disabled
                          data-testid="ops-guest-kyc-view-shipment"
                        >
                          View
                        </Button>
                      </li>
                    </ul>
                    <p className="text-xs text-muted-foreground mt-3">
                      Document viewing for guests needs a super-admin account and is coming next.
                    </p>
                  </>
                )}
              </section>

              <section
                className="rounded-2xl border border-border bg-white px-4 mb-6"
                data-testid="ops-guest-facts"
              >
                <Fact label="Phone" value={data.guest.phone} />
                <Fact label="Email" value={data.guest.email} />
                {data.guest.account_type === 'company' && (
                  <>
                    <Fact label="Company" value={data.guest.company_name} />
                    <Fact
                      label="Category"
                      value={
                        isCompanyCategory(data.guest.company_category)
                          ? COMPANY_CATEGORY_SPECS[data.guest.company_category].label
                          : data.guest.company_category
                      }
                    />
                    <Fact label="GSTIN" value={data.guest.gstin} />
                    <Fact
                      label="GST registered name"
                      value={data.guest.gstin_verified_name}
                    />
                    <Fact label="Contact person" value={data.guest.contact_person} />
                    <Fact
                      label="Address"
                      value={formatAddress({
                        address_line_1: data.guest.address_line_1,
                        city: data.guest.city,
                        state: data.guest.state,
                        pincode: data.guest.pincode,
                      })}
                    />
                    <Fact label="Hub" value={hubLabel(data.guest.hub_id)} />
                    {extraEntries.map(([key, value]) => (
                      <Fact key={key} label={extraLabel(key)} value={value} />
                    ))}
                  </>
                )}
                <Fact label="Guest since" value={formatMemberSince(data.guest.created_at)} />
              </section>

              <section
                className="rounded-2xl border border-border bg-white p-4 mb-6"
                data-testid="ops-guest-orders"
              >
                <h2 className="text-base font-extrabold text-foreground mb-3">Orders</h2>
                {ordersQuery.isLoading && (
                  <div className="flex justify-center py-8">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                )}
                {ordersQuery.isError && (
                  <p className="text-sm text-muted-foreground">Could not load orders.</p>
                )}
                {!ordersQuery.isLoading &&
                  !ordersQuery.isError &&
                  (ordersQuery.data?.length ?? 0) === 0 && (
                    <p className="text-sm text-muted-foreground">No orders on file.</p>
                  )}
                {!ordersQuery.isLoading &&
                  !ordersQuery.isError &&
                  (ordersQuery.data?.length ?? 0) > 0 && (
                    <div className="rounded-xl border border-border px-3">
                      {ordersQuery.data!.map((order) => (
                        <OpsOrderCard key={order.id} order={order} />
                      ))}
                    </div>
                  )}
              </section>
            </>
          )}
        </>
      )}
    </OpsShell>
  );
}
