import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Loader2, X } from 'lucide-react';
import { Link, useParams } from 'wouter';
import { OpsShell } from '@/components/ops/OpsShell';
import { OpsOrderCard } from '@/components/ops/OpsOrderCard';
import { Button } from '@/components/ui/button';
import {
  fetchOpsCustomerDocumentFile,
  fetchOpsCustomerIdentityNumber,
  fetchOpsCustomerKycFile,
  useOpsCustomerDetail,
  useOpsCustomerOrders,
  type OpsAccountDocMeta,
  type OpsCustomerDetail,
  type OpsIdentityMeta,
  type OpsShipmentKycMeta,
} from '@/hooks/useOpsCustomers';
import { useIsMobile } from '@/hooks/use-mobile';
import { parseApiErrorMessage } from '@/lib/apiError';
import { formatIst } from '@/lib/orderDetail';
import { useAppStore } from '@/lib/store';
import {
  COMPANY_CATEGORY_SPECS,
  DOC_SLOT_SPECS,
  isCompanyCategory,
  isDocSlot,
} from '@shared/accountSpec';
import { cn } from '@/lib/utils';

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

function identityKindLabel(kind: string): string {
  if (kind === 'aadhaar') return 'Aadhaar';
  if (kind === 'pan') return 'PAN';
  if (kind === 'gstin') return 'GSTIN';
  return kind;
}

function identityStatusLabel(status: string): string {
  if (status === 'verified') return 'Verified';
  if (status === 'self_declared') return 'Self declared';
  if (status === 'bypassed') return 'Bypassed';
  return status;
}

function documentLabel(raw: string): string {
  if (isDocSlot(raw)) return DOC_SLOT_SPECS[raw].label;
  if (raw === 'aadhaar') return 'Aadhaar Card';
  if (raw === 'pan') return 'PAN Card';
  if (raw === 'gstin') return 'GSTIN';
  return raw.trim() !== '' ? raw : 'Document';
}

type MimeKind = 'image' | 'pdf' | 'other';

function mimeKind(mime: string): MimeKind {
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  return 'other';
}

type ViewableDoc = {
  key: string;
  label: string;
  source: 'onboarding' | 'shipment';
  mime_type: string;
  original_filename: string;
  updated_at: string;
  load: () => Promise<Blob>;
};

function viewableDocuments(data: OpsCustomerDetail): ViewableDoc[] {
  const rows: ViewableDoc[] = data.kyc.documents.map((row: OpsAccountDocMeta) => ({
    key: row.doc_slot,
    label: documentLabel(row.doc_slot),
    source: 'onboarding' as const,
    mime_type: row.mime_type,
    original_filename: row.original_filename,
    updated_at: row.updated_at,
    load: () => fetchOpsCustomerDocumentFile(data.customer.id, row.doc_slot),
  }));

  const shipment: OpsShipmentKycMeta | null = data.kyc.shipment_kyc;
  if (shipment) {
    rows.push({
      key: 'shipment-kyc',
      label: documentLabel(shipment.document_type),
      source: 'shipment',
      mime_type: shipment.mime_type,
      original_filename: shipment.original_filename,
      updated_at: shipment.updated_at,
      load: () => fetchOpsCustomerKycFile(data.customer.id),
    });
  }
  return rows;
}

type PreviewState = {
  title: string;
  objectUrl: string;
  mime: string;
};

function DocumentPreviewOverlay({
  preview,
  onClose,
}: {
  preview: PreviewState;
  onClose: () => void;
}) {
  const isPdf = preview.mime === 'application/pdf' || preview.title.toLowerCase().endsWith('.pdf');
  const isImage = preview.mime.startsWith('image/');

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/70"
      data-testid="ops-kyc-document-preview"
      role="dialog"
      aria-modal="true"
      aria-label={preview.title}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 bg-white">
        <p className="text-sm font-semibold truncate">{preview.title}</p>
        <Button
          type="button"
          variant="outline"
          className="h-9 rounded-lg shrink-0"
          onClick={onClose}
          data-testid="ops-kyc-preview-close"
        >
          <X className="w-4 h-4 mr-1" />
          Close
        </Button>
      </div>
      <div className="flex-1 overflow-auto p-4 flex justify-center">
        {isImage && (
          <img
            src={preview.objectUrl}
            alt={preview.title}
            className="max-w-full max-h-full object-contain bg-white rounded-lg"
          />
        )}
        {isPdf && !isImage && (
          <iframe
            title={preview.title}
            src={preview.objectUrl}
            className="w-full h-full min-h-[70vh] bg-white rounded-lg"
          />
        )}
        {!isImage && !isPdf && (
          <p className="text-sm text-white self-center">Preview is not available for this file type.</p>
        )}
      </div>
    </div>
  );
}

export default function OpsCustomerDetail() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const isMobile = useIsMobile();
  const role = useAppStore((s) => s.user?.role);
  const canViewKyc = role === 'super_admin';
  const { data, isLoading, isError, error } = useOpsCustomerDetail(id);
  const ordersQuery = useOpsCustomerOrders(id);

  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [fileBusy, setFileBusy] = useState<string | null>(null);
  const [fileErrors, setFileErrors] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Partial<Record<OpsIdentityMeta['kind'], string>>>({});
  const [revealBusy, setRevealBusy] = useState<OpsIdentityMeta['kind'] | null>(null);
  const [revealError, setRevealError] = useState('');

  const docs = useMemo(() => (data ? viewableDocuments(data) : []), [data]);
  const showSource = docs.some((doc) => doc.source === 'onboarding') &&
    docs.some((doc) => doc.source === 'shipment');

  useEffect(() => {
    return () => {
      if (preview?.objectUrl) URL.revokeObjectURL(preview.objectUrl);
    };
  }, [preview?.objectUrl]);

  const notFound =
    isError && error instanceof Error && error.message.startsWith('404:');

  const closePreview = (): void => {
    setPreview((current) => {
      if (current?.objectUrl) URL.revokeObjectURL(current.objectUrl);
      return null;
    });
  };

  const openBlob = async (
    key: string,
    title: string,
    load: () => Promise<Blob>,
  ): Promise<void> => {
    if (!id) return;
    setFileErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setFileBusy(key);
    try {
      const blob = await load();
      const objectUrl = URL.createObjectURL(blob);
      setPreview((current) => {
        if (current?.objectUrl) URL.revokeObjectURL(current.objectUrl);
        return { title, objectUrl, mime: blob.type };
      });
    } catch (err) {
      setFileErrors((prev) => ({
        ...prev,
        [key]: parseApiErrorMessage(err, 'Could not load document.'),
      }));
    } finally {
      setFileBusy(null);
    }
  };

  const revealNumber = async (kind: OpsIdentityMeta['kind']): Promise<void> => {
    if (!id) return;
    setRevealError('');
    setRevealBusy(kind);
    try {
      const result = await fetchOpsCustomerIdentityNumber(id, kind);
      setRevealed((prev) => ({ ...prev, [kind]: result.document_no }));
    } catch (err) {
      setRevealError(parseApiErrorMessage(err, 'Could not reveal number.'));
    } finally {
      setRevealBusy(null);
    }
  };

  return (
    <OpsShell
      title={data?.customer.full_name ?? 'Customer'}
      subtitle="Account and KYC status"
      wide
    >
      {isMobile ? (
        <DesktopOnlyNotice />
      ) : (
        <>
          <Link
            href="/ops/customers"
            className="inline-flex items-center gap-1 text-sm font-semibold text-[#F2A123] mb-4"
            data-testid="link-ops-back-customers"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to customers
          </Link>

          {isLoading && (
            <div className="flex justify-center py-16" data-testid="ops-customer-detail-loading">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {isError && (
            <p
              className="text-sm text-muted-foreground py-8"
              data-testid="ops-customer-detail-error"
            >
              {notFound ? 'That customer could not be found.' : 'Could not load this customer.'}
            </p>
          )}

          {data && (
            <>
              <div
                className="flex flex-wrap items-center gap-2 mb-5"
                data-testid="ops-customer-header"
              >
                <span className="inline-block text-[11px] font-bold uppercase tracking-wide rounded-md bg-[#F3F4F6] px-2 py-1">
                  {data.customer.account_type === 'company' ? 'Company' : 'Personal'}
                </span>
                <p className="text-sm text-muted-foreground tabular-nums">
                  {data.customer.phone ?? '—'}
                </p>
              </div>

              <section
                className="rounded-2xl border border-border bg-white p-4 mb-6"
                data-testid="ops-customer-kyc-documents"
              >
                <h2 className="text-base font-extrabold text-foreground mb-3">Documents</h2>

                {docs.length === 0 ? (
                  <p
                    className="text-sm text-muted-foreground"
                    data-testid={data.kyc.on_file ? 'ops-kyc-no-documents' : 'ops-kyc-empty'}
                  >
                    {data.kyc.on_file
                      ? 'No documents on file to view.'
                      : 'No KYC records on file — nothing to verify.'}
                  </p>
                ) : (
                  <ul className="divide-y divide-border rounded-xl border border-border">
                    {docs.map((doc) => {
                      const kind = mimeKind(doc.mime_type);
                      return (
                        <li
                          key={doc.key}
                          className="flex items-start justify-between gap-3 px-3 py-2.5"
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-semibold">{doc.label}</p>
                              {kind !== 'other' && (
                                <span className="inline-block text-[11px] font-bold rounded-md bg-[#F3F4F6] px-2 py-0.5">
                                  {kind === 'pdf' ? 'PDF' : 'Image'}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5 truncate">
                              {showSource
                                ? `${doc.source === 'shipment' ? 'Shipment' : 'Onboarding'} · `
                                : ''}
                              {doc.original_filename || '—'}
                              {doc.updated_at ? ` · uploaded ${formatIst(doc.updated_at)}` : ''}
                            </p>
                            {fileErrors[doc.key] && (
                              <p className="text-xs text-red-600 mt-1">{fileErrors[doc.key]}</p>
                            )}
                          </div>
                          {canViewKyc ? (
                            <Button
                              type="button"
                              variant="outline"
                              className="h-9 rounded-lg text-xs font-semibold shrink-0"
                              disabled={fileBusy === doc.key}
                              onClick={() =>
                                void openBlob(doc.key, doc.original_filename || doc.key, () =>
                                  doc.load(),
                                )
                              }
                              data-testid={
                                doc.key === 'shipment-kyc'
                                  ? 'ops-kyc-view-shipment'
                                  : `ops-kyc-view-slot-${doc.key}`
                              }
                            >
                              {fileBusy === doc.key ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                'View'
                              )}
                            </Button>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}

                {docs.length > 0 && !canViewKyc && (
                  <p className="text-xs text-muted-foreground mt-3" data-testid="ops-kyc-admin-note">
                    Document viewing needs a super-admin account.
                  </p>
                )}
                {canViewKyc && docs.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-3">
                    Each view is recorded.
                  </p>
                )}
              </section>

              {data.kyc.identity.length > 0 && (
                <section
                  className="rounded-2xl border border-border bg-white p-4 mb-6"
                  data-testid="ops-customer-kyc-identity"
                >
                  <h2 className="text-sm font-semibold text-foreground mb-3">Identity numbers</h2>
                  <ul className="divide-y divide-border rounded-xl border border-border">
                    {data.kyc.identity.map((row) => (
                      <li
                        key={row.kind}
                        className="flex items-center justify-between gap-3 px-3 py-2.5"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-semibold">{identityKindLabel(row.kind)}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {identityStatusLabel(row.status)}
                          </p>
                          {revealed[row.kind] && (
                            <p
                              className="text-sm font-mono font-semibold mt-1 break-all"
                              data-testid={`ops-kyc-revealed-${row.kind}`}
                            >
                              {revealed[row.kind]}
                            </p>
                          )}
                        </div>
                        {canViewKyc ? (
                          <Button
                            type="button"
                            variant="outline"
                            className="h-9 rounded-lg text-xs font-semibold shrink-0"
                            disabled={revealBusy === row.kind}
                            onClick={() => void revealNumber(row.kind)}
                            data-testid={`ops-kyc-reveal-${row.kind}`}
                          >
                            {revealBusy === row.kind ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              'Reveal number'
                            )}
                          </Button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  {revealError && (
                    <p className="text-xs text-red-600 mt-2">{revealError}</p>
                  )}
                  {canViewKyc && (
                    <p className="text-xs text-muted-foreground mt-3">
                      Numbers are revealed one at a time.
                    </p>
                  )}
                </section>
              )}

              <section
                className="rounded-2xl border border-border bg-white px-4 mb-6"
                data-testid="ops-customer-facts"
              >
                <Fact label="Phone" value={data.customer.phone} />
                {data.customer.account_type === 'company' && (
                  <>
                    <Fact label="Company" value={data.customer.company_name} />
                    <Fact
                      label="Category"
                      value={
                        isCompanyCategory(data.customer.company_category)
                          ? COMPANY_CATEGORY_SPECS[data.customer.company_category].label
                          : data.customer.company_category
                      }
                    />
                    <Fact label="GSTIN" value={data.customer.gstin} />
                  </>
                )}
                <Fact label="Member since" value={formatMemberSince(data.customer.created_at)} />
              </section>

              <section
                className="rounded-2xl border border-border bg-white p-4 mb-6"
                data-testid="ops-customer-orders"
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
                {!ordersQuery.isLoading && !ordersQuery.isError && (ordersQuery.data?.length ?? 0) === 0 && (
                  <p className="text-sm text-muted-foreground">No orders on file.</p>
                )}
                {!ordersQuery.isLoading && !ordersQuery.isError && (ordersQuery.data?.length ?? 0) > 0 && (
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

      {preview && <DocumentPreviewOverlay preview={preview} onClose={closePreview} />}
    </OpsShell>
  );
}
