import { useEffect, useState } from 'react';
import { ArrowLeft, Loader2, X } from 'lucide-react';
import { Link, useParams } from 'wouter';
import { OpsShell } from '@/components/ops/OpsShell';
import { Button } from '@/components/ui/button';
import {
  fetchOpsCustomerDocumentFile,
  fetchOpsCustomerIdentityNumber,
  fetchOpsCustomerKycFile,
  useOpsCustomerDetail,
  type OpsIdentityMeta,
} from '@/hooks/useOpsCustomers';
import { useIsMobile } from '@/hooks/use-mobile';
import { parseApiErrorMessage } from '@/lib/apiError';
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

function ocrStatusLabel(status: string | null): string {
  if (!status) return '—';
  if (status === 'match') return 'Verified';
  if (status === 'unreadable') return 'Unreadable';
  if (status === 'unavailable') return 'Unavailable';
  if (status === 'skipped') return 'Skipped';
  if (status === 'bypassed') return 'Bypassed';
  return status;
}

function ViewDocumentPlaceholder() {
  return (
    <Button
      type="button"
      variant="outline"
      disabled
      className="h-9 rounded-lg text-xs font-semibold"
      data-testid="ops-kyc-view-document-placeholder"
    >
      View document
    </Button>
  );
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

  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [fileBusy, setFileBusy] = useState<string | null>(null);
  const [fileError, setFileError] = useState('');
  const [revealed, setRevealed] = useState<Partial<Record<OpsIdentityMeta['kind'], string>>>({});
  const [revealBusy, setRevealBusy] = useState<OpsIdentityMeta['kind'] | null>(null);
  const [revealError, setRevealError] = useState('');

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
    setFileError('');
    setFileBusy(key);
    try {
      const blob = await load();
      const objectUrl = URL.createObjectURL(blob);
      setPreview((current) => {
        if (current?.objectUrl) URL.revokeObjectURL(current.objectUrl);
        return { title, objectUrl, mime: blob.type };
      });
    } catch (err) {
      setFileError(parseApiErrorMessage(err, 'Could not load document.'));
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
              <section
                className="rounded-2xl border border-border bg-white px-4 mb-6"
                data-testid="ops-customer-facts"
              >
                <Fact label="Name" value={data.customer.full_name} />
                <Fact label="Phone" value={data.customer.phone} />
                <Fact
                  label="Account type"
                  value={data.customer.account_type === 'company' ? 'Company' : 'Personal'}
                />
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
                data-testid="ops-customer-kyc"
              >
                <div className="flex items-start justify-between gap-3 mb-4">
                  <h2 className="text-[11px] uppercase tracking-[0.14em] font-bold text-muted-foreground">
                    KYC
                  </h2>
                  <span
                    className={cn(
                      'inline-block text-[11px] font-bold rounded-md px-2 py-1',
                      data.kyc.on_file
                        ? 'bg-emerald-50 text-emerald-800'
                        : 'bg-[#F3F4F6] text-muted-foreground',
                    )}
                  >
                    {data.kyc.on_file ? 'KYC on file' : 'No KYC'}
                  </span>
                </div>

                {data.kyc.identity.length > 0 && (
                  <div className="mb-4" data-testid="ops-customer-kyc-identity">
                    <p className="text-xs font-semibold text-muted-foreground mb-2">
                      Identity numbers
                    </p>
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
                  </div>
                )}

                {data.kyc.documents.length > 0 && (
                  <div className="mb-4" data-testid="ops-customer-kyc-documents">
                    <p className="text-xs font-semibold text-muted-foreground mb-2">
                      Onboarding documents
                    </p>
                    <ul className="divide-y divide-border rounded-xl border border-border">
                      {data.kyc.documents.map((row) => (
                        <li
                          key={row.doc_slot}
                          className="flex items-center justify-between gap-3 px-3 py-2.5"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-semibold">
                              {isDocSlot(row.doc_slot)
                                ? DOC_SLOT_SPECS[row.doc_slot].label
                                : row.doc_slot}
                            </p>
                            <p className="text-xs text-muted-foreground mt-0.5 truncate">
                              {ocrStatusLabel(row.ocr_status)}
                              {row.original_filename ? ` · ${row.original_filename}` : ''}
                            </p>
                          </div>
                          {canViewKyc ? (
                            <Button
                              type="button"
                              variant="outline"
                              className="h-9 rounded-lg text-xs font-semibold shrink-0"
                              disabled={fileBusy === row.doc_slot}
                              onClick={() =>
                                void openBlob(row.doc_slot, row.original_filename || row.doc_slot, () =>
                                  fetchOpsCustomerDocumentFile(data.customer.id, row.doc_slot),
                                )
                              }
                              data-testid={`ops-kyc-view-slot-${row.doc_slot}`}
                            >
                              {fileBusy === row.doc_slot ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                'View'
                              )}
                            </Button>
                          ) : (
                            <ViewDocumentPlaceholder />
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {data.kyc.shipment_kyc && (
                  <div className="mb-4" data-testid="ops-customer-kyc-shipment">
                    <p className="text-xs font-semibold text-muted-foreground mb-2">
                      Shipment KYC
                    </p>
                    <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border border-border">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">
                          {data.kyc.shipment_kyc.document_type}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                          {ocrStatusLabel(data.kyc.shipment_kyc.ocr_status)}
                          {data.kyc.shipment_kyc.original_filename
                            ? ` · ${data.kyc.shipment_kyc.original_filename}`
                            : ''}
                        </p>
                      </div>
                      {canViewKyc ? (
                        <Button
                          type="button"
                          variant="outline"
                          className="h-9 rounded-lg text-xs font-semibold shrink-0"
                          disabled={fileBusy === 'shipment-kyc'}
                          onClick={() =>
                            void openBlob(
                              'shipment-kyc',
                              data.kyc.shipment_kyc!.original_filename ||
                                data.kyc.shipment_kyc!.document_type,
                              () => fetchOpsCustomerKycFile(data.customer.id),
                            )
                          }
                          data-testid="ops-kyc-view-shipment"
                        >
                          {fileBusy === 'shipment-kyc' ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            'View'
                          )}
                        </Button>
                      ) : (
                        <ViewDocumentPlaceholder />
                      )}
                    </div>
                  </div>
                )}

                {fileError && <p className="text-xs text-red-600 mb-2">{fileError}</p>}

                {!data.kyc.on_file && (
                  <p className="text-sm text-muted-foreground">No KYC records on file.</p>
                )}

                <p className="text-xs text-muted-foreground mt-2">
                  {canViewKyc
                    ? 'Each view is recorded. Numbers are revealed one at a time.'
                    : 'Document viewing is available on desktop for authorised reviewers.'}
                </p>
              </section>
            </>
          )}
        </>
      )}

      {preview && <DocumentPreviewOverlay preview={preview} onClose={closePreview} />}
    </OpsShell>
  );
}
