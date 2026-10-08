/**
 * One printable document: a button that prints it, and a small one that saves
 * it.
 *
 * Desktop prints straight away (the browser's own dialog, "Save as PDF"
 * included) with a separate download beside it. Phones open the PDF full
 * screen, where Share reaches the system sheet and its Print entry; Android
 * draws it on a canvas because its WebView will not render a PDF iframe.
 *
 * The document is fetched on press, not up front, so a screen with four of
 * these costs nothing until someone wants one.
 */

import { lazy, Suspense, useState } from 'react';
import { Download, Loader2, Printer } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  base64ToPdfFile,
  canSharePdfFile,
  downloadPdfBlob,
  printPdfBase64,
} from '@/lib/pdfUtils';
import { isAndroid } from '@/lib/platform';
import { shareViaCapacitor } from '@/lib/nativeShare';
import { cn } from '@/lib/utils';

const PdfCanvasViewer = lazy(() => import('@/components/PdfCanvasViewer'));

/** Whether this browser gets the full-screen viewer rather than direct print. */
function usesOverlay(file: File): boolean {
  return isAndroid() || canSharePdfFile(file);
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
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  const open = async (): Promise<void> => {
    setBusy(true);
    const base64 = await fetchBase64();
    setBusy(false);
    if (!base64) return;
    if (usesOverlay(base64ToPdfFile(base64, fileName))) {
      setDataUrl(`data:application/pdf;base64,${base64}`);
    } else {
      printPdfBase64(base64, fileName);
    }
  };

  const save = async (): Promise<void> => {
    const base64 = await fetchBase64();
    if (base64) downloadPdfBlob(base64ToPdfFile(base64, fileName), fileName);
  };

  const share = async (url: string): Promise<void> => {
    try {
      const base64 = url.split(',')[1];
      if (isAndroid()) {
        const ok = await shareViaCapacitor(base64, fileName, title);
        if (ok) return;
      }
      const file = base64ToPdfFile(base64, fileName);
      if (canSharePdfFile(file)) {
        await navigator.share({ files: [file], title });
      } else if (!isAndroid()) {
        downloadPdfBlob(file, fileName);
      }
      // Android with no native plugin: silent no-op (as before)
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        toast({ title: 'Share failed', description: `Could not share the ${title.toLowerCase()}.`, variant: 'destructive' });
      }
    }
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
          // Phones have no separate download: Share covers it.
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

      {dataUrl && (
        <div className="fixed inset-0 z-[100] bg-white flex flex-col" data-testid="label-preview">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-white safe-top">
            <span className="font-semibold text-sm text-foreground">{title}</span>
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => void share(dataUrl)}
                className="h-10 text-sm font-medium text-[#B26A00] hover:underline"
              >
                Share / Print
              </button>
              <button
                type="button"
                onClick={() => setDataUrl(null)}
                className="h-10 text-sm font-medium text-foreground hover:underline"
              >
                Close
              </button>
            </div>
          </div>
          {isAndroid() ? (
            <Suspense
              fallback={
                <div className="flex-1 grid place-items-center text-sm text-muted-foreground">
                  Loading PDF…
                </div>
              }
            >
              <PdfCanvasViewer base64={dataUrl.split(',')[1]} title={title} />
            </Suspense>
          ) : (
            <iframe src={dataUrl} className="flex-1 w-full border-0" title={title} />
          )}
        </div>
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
