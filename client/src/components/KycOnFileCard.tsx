import React, { Suspense, lazy, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ShieldCheck,
  FileText,
  Loader2,
  ChevronDown,
  Maximize2,
  X,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { isAndroid } from '@/lib/platform';
import type { KycOnFile } from '@/hooks/useKycOnFile';

// Android WebViews will not render a PDF in an iframe — same split used for AWB labels.
// The chunk pulls in pdfjs-dist; if that fails to load, say so in place rather
// than taking the whole page down.
const PdfCanvasViewer = lazy(() =>
  import('@/components/PdfCanvasViewer').catch(() => ({
    default: (_props: { base64: string; title?: string }) => (
      <div className="p-3 text-xs text-muted-foreground">
        Inline preview unavailable on this device.
      </div>
    ),
  })),
);

interface KycOnFileCardProps {
  kyc: KycOnFile;
  /** Open the document preview as soon as the card mounts. */
  defaultOpen?: boolean;
  className?: string;
}

function formatFileSize(bytes: number | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUploadedAt(iso: string | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read your document.'));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      resolve(result.split(',')[1] ?? '');
    };
    reader.readAsDataURL(blob);
  });
}

function DetailRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </p>
      <p className="text-xs text-foreground font-medium truncate mt-0.5" title={value}>
        {value}
      </p>
    </div>
  );
}

export function KycOnFileCard({
  kyc,
  defaultOpen = false,
  className,
}: KycOnFileCardProps): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  /**
   * Whether anything actually read this document.
   *
   * `match` is Smart OCR agreeing the number on the card is the number the
   * customer typed. `unreadable`, `unavailable`, `skipped` and `bypassed` are
   * the ops queue: the file is stored and nobody has confirmed it.
   */
  const checked = kyc.ocr_status === 'match';
  const [fullscreen, setFullscreen] = useState(false);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [blobMime, setBlobMime] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Falls back to the fetched blob's own type when the summary carries no metadata.
  const mimeType = kyc.mime_type ?? blobMime;
  const isImage = mimeType.startsWith('image/');
  const isPdf = mimeType === 'application/pdf';
  const useCanvasPdf = isPdf && isAndroid();

  // Re-fetch whenever the stored document changes (updated_at moves on re-upload).
  useEffect(() => {
    if (!open) return;
    let revoked = false;
    let url: string | null = null;

    setLoading(true);
    setError('');
    void (async () => {
      try {
        const res = await fetch('/api/kyc/me/file', {
          credentials: 'include',
          cache: 'no-store',
        });
        if (!res.ok) throw new Error('Could not load your document.');
        const blob = await res.blob();
        if (revoked) return;
        setBlobMime(blob.type);
        if ((kyc.mime_type ?? blob.type) === 'application/pdf' && isAndroid()) {
          const base64 = await blobToBase64(blob);
          if (revoked) return;
          setPdfBase64(base64);
        }
        url = URL.createObjectURL(blob);
        setObjectUrl(url);
      } catch (err) {
        if (!revoked) {
          setError(err instanceof Error ? err.message : 'Could not load your document.');
        }
      } finally {
        if (!revoked) setLoading(false);
      }
    })();

    return () => {
      revoked = true;
      setObjectUrl(null);
      setPdfBase64(null);
      setBlobMime('');
      if (url) URL.revokeObjectURL(url);
    };
  }, [open, kyc.updated_at, kyc.mime_type]);

  // Full-screen preview owns a history entry, so the Android hardware back
  // button and the browser back gesture close the overlay instead of leaving
  // the page. Escape does the same on desktop.
  useEffect(() => {
    if (!fullscreen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.history.pushState({ kycFullPreview: true }, '');

    const handlePop = (): void => setFullscreen(false);
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeFullscreen();
    };
    window.addEventListener('popstate', handlePop);
    window.addEventListener('keydown', handleKey);

    return () => {
      window.removeEventListener('popstate', handlePop);
      window.removeEventListener('keydown', handleKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [fullscreen]);

  function closeFullscreen(): void {
    // Pop the entry pushed on open so history stays balanced; the popstate
    // handler flips the state back.
    if ((window.history.state as { kycFullPreview?: boolean } | null)?.kycFullPreview) {
      window.history.back();
      return;
    }
    setFullscreen(false);
  }

  function renderMedia(variant: 'inline' | 'full'): React.JSX.Element | null {
    if (!objectUrl) return null;
    const full = variant === 'full';

    if (isImage) {
      return (
        <img
          src={objectUrl}
          alt={`${kyc.document_type} document`}
          className={cn(
            'object-contain bg-white',
            full
              ? 'w-full h-full'
              : 'w-full max-h-64 rounded-lg border border-border',
          )}
          data-testid={full ? 'img-kyc-preview-full' : 'img-kyc-preview'}
        />
      );
    }

    if (isPdf && useCanvasPdf) {
      if (!pdfBase64) return null;
      return (
        <Suspense
          fallback={
            <div className={cn('grid place-items-center text-xs text-muted-foreground', full ? 'h-full' : 'h-64')}>
              Loading PDF…
            </div>
          }
        >
          <div
            className={cn(
              'overflow-y-auto bg-white',
              full ? 'h-full' : 'max-h-64 rounded-lg border border-border',
            )}
          >
            <PdfCanvasViewer base64={pdfBase64} title={`${kyc.document_type} document`} />
          </div>
        </Suspense>
      );
    }

    if (isPdf) {
      return (
        <iframe
          src={objectUrl}
          title={`${kyc.document_type} document`}
          className={cn(
            'w-full bg-white',
            full ? 'h-full border-0' : 'h-64 rounded-lg border border-border',
          )}
          data-testid={full ? 'iframe-kyc-preview-full' : 'iframe-kyc-preview'}
        />
      );
    }

    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-white p-3">
        <FileText className="w-4 h-4 text-muted-foreground" />
        <p className="text-xs text-muted-foreground truncate">
          {kyc.original_filename || 'Preview not supported for this file type'}
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'rounded-xl border p-4 shadow-sm space-y-3',
        checked ? 'border-green-200 bg-green-50/50' : 'border-blue-200 bg-blue-50/40',
        className,
      )}
      data-testid="kyc-on-file-badge"
    >
      <div className="flex items-center gap-3">
        <div
          className={cn(
            'w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0',
            checked ? 'bg-green-100' : 'bg-blue-100'
          )}
        >
          <ShieldCheck className={cn('w-5 h-5', checked ? 'text-green-700' : 'text-blue-700')} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-foreground">
              {checked ? 'Identity verified' : 'Document on file'}
            </p>
            {/* Said plainly, because "KYC on file" read as a tick whatever
                Smart OCR made of the upload. Only `match` means the number on
                the document was read and agreed with the number typed; every
                other verdict is a document nobody has confirmed, and ops still
                has to look at it. */}
            <span
              className={cn(
                'shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                checked
                  ? 'border-green-200 bg-green-50 text-green-700'
                  : 'border-blue-200 bg-blue-50 text-blue-700'
              )}
              data-testid="badge-kyc-ocr-status"
            >
              {checked ? 'Checked' : 'In review'}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {kyc.document_type} ••{kyc.last_four}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 text-[11px] font-semibold text-primary shrink-0"
          aria-expanded={open}
          data-testid="button-kyc-preview-toggle"
        >
          {open ? 'Hide' : 'Preview'}
          <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', open && 'rotate-180')} />
        </button>
      </div>

      <div
        className={cn(
          'grid grid-cols-2 gap-3 border-t pt-3',
          checked ? 'border-green-200/70' : 'border-blue-200/70'
        )}
      >
        <DetailRow label="Document type" value={kyc.document_type} />
        <DetailRow label="Number" value={`•••• ${kyc.last_four}`} />
        <DetailRow label="File" value={kyc.original_filename || '—'} />
        <DetailRow
          label="Uploaded"
          value={`${formatUploadedAt(kyc.updated_at)} · ${formatFileSize(kyc.file_size_bytes)}`}
        />
      </div>

      {open && (
        <div
          className={cn('border-t pt-3', checked ? 'border-green-200/70' : 'border-blue-200/70')}
          data-testid="kyc-preview"
        >
          {loading && (
            <div className="flex items-center justify-center gap-2 h-32 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-xs">Loading document…</span>
            </div>
          )}

          {!loading && error && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 p-3">
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
              <p className="text-xs text-red-600">{error}</p>
            </div>
          )}

          {!loading && !error && objectUrl && (
            <div className="space-y-2">
              {renderMedia('inline')}

              <button
                type="button"
                onClick={() => setFullscreen(true)}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary"
                data-testid="button-kyc-open-full"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                View full screen
              </button>
            </div>
          )}
        </div>
      )}

      {/* Portalled: a transformed ancestor would otherwise trap `position: fixed`. */}
      {fullscreen && objectUrl && createPortal(
        <div
          className="fixed inset-0 z-[100] bg-white flex flex-col"
          role="dialog"
          aria-modal="true"
          aria-label={`${kyc.document_type} document preview`}
          data-testid="kyc-preview-fullscreen"
        >
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border bg-white safe-top">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">
                {kyc.document_type} ••{kyc.last_four}
              </p>
              {kyc.original_filename && (
                <p className="text-[11px] text-muted-foreground truncate">
                  {kyc.original_filename}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={closeFullscreen}
              aria-label="Close preview"
              className="w-11 h-11 -mr-2 flex items-center justify-center rounded-full text-foreground hover:bg-muted shrink-0"
              data-testid="button-kyc-preview-close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-auto bg-muted/30 p-2 safe-bottom">
            {renderMedia('full')}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
