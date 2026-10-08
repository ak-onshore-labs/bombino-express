/**
 * One printable document: a button that opens it, and a small one that saves
 * it.
 *
 * Pressing the button always shows the document first, full screen, so the
 * customer sees what they are about to stick on a box, then offers Print,
 * Download and Close. Desktop prints from the viewer itself; phones go through
 * the system share sheet, whose Print entry reaches the phone's own printing.
 * Android draws the PDF on a canvas because its WebView will not render a PDF
 * iframe.
 *
 * The document is fetched on press, not up front, so a screen with four of
 * these costs nothing until someone wants one.
 */

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Loader2, Printer, Share2, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { base64ToPdfFile, canSharePdfFile, downloadPdfBlob, printPdfBase64 } from '@/lib/pdfUtils';
import { isAndroid } from '@/lib/platform';
import { shareViaCapacitor } from '@/lib/nativeShare';
import { cn } from '@/lib/utils';

const PdfCanvasViewer = lazy(() => import('@/components/PdfCanvasViewer'));

function PdfViewer({
  base64,
  title,
  fileName,
  onClose,
}: {
  base64: string;
  title: string;
  fileName: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const file = useMemo(() => base64ToPdfFile(base64, fileName), [base64, fileName]);
  // Same-origin blob URL: the one way every desktop browser both renders the
  // PDF in a frame and lets the page call print() on it.
  const blobUrl = useMemo(() => (isAndroid() ? null : URL.createObjectURL(file)), [file]);
  useEffect(() => () => {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
  }, [blobUrl]);

  // A phone that can share a file prints through the share sheet; a desktop
  // prints the frame it is already showing.
  const viaShareSheet = isAndroid() || canSharePdfFile(file);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const share = async (): Promise<void> => {
    try {
      if (isAndroid()) {
        const ok = await shareViaCapacitor(base64, fileName, title);
        if (ok) return;
      }
      if (canSharePdfFile(file)) {
        await navigator.share({ files: [file], title });
      } else {
        downloadPdfBlob(file, fileName);
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        toast({ title: 'Share failed', description: `Could not share the ${title.toLowerCase()}.`, variant: 'destructive' });
      }
    }
  };

  const print = (): void => {
    if (viaShareSheet) {
      void share();
      return;
    }
    try {
      frameRef.current?.contentWindow?.focus();
      frameRef.current?.contentWindow?.print();
    } catch {
      printPdfBase64(base64, fileName);
    }
  };

  const headerButton =
    'inline-flex items-center gap-1.5 h-10 px-3 rounded-lg text-sm font-semibold transition-colors';

  return (
    <div
      className="fixed inset-0 z-[100] bg-[#F3F4F6] flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid="label-preview"
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[#E2E8F0] bg-white safe-top">
        <span className="pl-1 font-semibold text-sm text-foreground truncate">{title}</span>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={print}
            className={cn(headerButton, 'bg-[lab(34.0831_-9.57756_-27.7093)] text-white hover:bg-[#2F4468]')}
            data-testid="button-viewer-print"
          >
            {viaShareSheet ? <Share2 className="w-4 h-4" /> : <Printer className="w-4 h-4" />}
            {viaShareSheet ? 'Share / Print' : 'Print'}
          </button>
          {!viaShareSheet && (
            <button
              type="button"
              onClick={() => downloadPdfBlob(file, fileName)}
              className={cn(headerButton, 'text-foreground hover:bg-muted')}
              data-testid="button-viewer-download"
            >
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Download</span>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="grid place-items-center w-10 h-10 rounded-lg text-foreground hover:bg-muted transition-colors"
            aria-label="Close"
            data-testid="button-viewer-close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>
      {isAndroid() ? (
        <Suspense
          fallback={
            <div className="flex-1 grid place-items-center text-sm text-muted-foreground">Loading PDF…</div>
          }
        >
          <PdfCanvasViewer base64={base64} title={title} />
        </Suspense>
      ) : (
        <iframe ref={frameRef} src={blobUrl ?? undefined} className="flex-1 w-full border-0" title={title} />
      )}
    </div>
  );
}

export function PdfDocButton({
  text,
  title,
  fileName,
  fetchBase64,
  icon: Icon = Printer,
  primary = false,
  testId,
}: {
  text: string;
  /** Title in the viewer and the share sheet. */
  title: string;
  fileName: string;
  /** The PDF as base64, or null after saying why (the caller toasts). */
  fetchBase64: () => Promise<string | null>;
  icon?: React.ComponentType<{ className?: string }>;
  primary?: boolean;
  testId: string;
}) {
  const [busy, setBusy] = useState(false);
  const [base64, setBase64] = useState<string | null>(null);

  const open = async (): Promise<void> => {
    setBusy(true);
    const doc = await fetchBase64();
    setBusy(false);
    if (doc) setBase64(doc);
  };

  const save = async (): Promise<void> => {
    const doc = await fetchBase64();
    if (doc) downloadPdfBlob(base64ToPdfFile(doc, fileName), fileName);
  };

  return (
    <span className="inline-flex items-stretch">
      <button
        type="button"
        onClick={() => void open()}
        disabled={busy}
        className={cn(
          'inline-flex items-center gap-2 h-10 px-4 text-sm font-semibold transition-colors disabled:opacity-60',
          primary
            ? 'bg-[lab(34.0831_-9.57756_-27.7093)] text-white hover:bg-[#2F4468]'
            : 'border border-border bg-white text-foreground hover:border-foreground/30 hover:bg-muted/40',
          'rounded-l-lg',
          // Phones have no separate download: the viewer's Share covers it.
          'max-md:rounded-r-lg'
        )}
        data-testid={testId}
      >
        {busy ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Icon className={primary ? 'w-4 h-4' : 'w-4 h-4 text-muted-foreground'} />
        )}
        {text}
      </button>
      <button
        type="button"
        onClick={() => void save()}
        className={cn(
          'hidden md:inline-flex items-center h-10 px-2.5 rounded-r-lg border-l transition-colors',
          primary
            ? 'bg-[lab(34.0831_-9.57756_-27.7093)] text-white/85 border-white/20 hover:bg-[#2F4468]'
            : 'border border-border bg-white text-muted-foreground hover:bg-muted/40'
        )}
        aria-label={`Download ${text}`}
        data-testid={`${testId}-save`}
      >
        <Download className="w-3.5 h-3.5" />
      </button>

      {base64 && (
        <PdfViewer base64={base64} title={title} fileName={fileName} onClose={() => setBase64(null)} />
      )}
    </span>
  );
}

/**
 * Fetch `{ [key]: base64 }` from `url`, toasting a literal reason on failure.
 * The shape every document endpoint here answers with.
 */
export async function fetchPdfBase64(
  url: string,
  key: string,
  what: string,
  toast: ReturnType<typeof useToast>['toast']
): Promise<string | null> {
  try {
    const res = await fetch(url, { credentials: 'include' });
    if (res.ok) {
      const body = (await res.json()) as Record<string, string>;
      if (body[key]) return body[key];
    }
    toast({
      title: `${what} not available`,
      description: `The ${what.toLowerCase()} for this order could not be found.`,
      variant: 'destructive',
    });
    return null;
  } catch {
    toast({
      title: 'Download failed',
      description: `Could not open the ${what.toLowerCase()}. Check your connection and try again.`,
      variant: 'destructive',
    });
    return null;
  }
}
