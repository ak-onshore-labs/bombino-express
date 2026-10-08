/**
 * A shipment's printables — AWB label, box label, postal label, invoice.
 *
 * Every one comes from ITD's create_docket response, stored on the customer's
 * `shipments` row (server/docketFiling.ts → persistShipmentAfterCreate), and is
 * served by `/api/shipments/:awb/<kind>`. That row exists from the moment the
 * AWB does, which is the whole point: the box label has to be on the parcel
 * BEFORE the agent arrives or it reaches the hub counter, so the labels belong
 * wherever the customer is while the parcel is still with them — the booking
 * success screen and the order screen — not only on the post-dispatch
 * tracking screen.
 *
 * Desktop prints straight away (with a separate download); phones open the PDF
 * full screen, where Share reaches the system sheet and its Print entry.
 */

import { lazy, Suspense, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileText, Loader2, Printer } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  base64ToPdfFile,
  canSharePdfFile,
  downloadPdfBlob,
  printPdfBase64,
} from '@/lib/pdfUtils';
import {
  SHIPMENT_DOCUMENT_META,
  SHIPMENT_DOCUMENT_ORDER,
  type ShipmentDocumentKind,
} from '@/lib/shipmentDocuments';
import { isAndroid } from '@/lib/platform';
import { shareViaCapacitor } from '@/lib/nativeShare';
import { cn } from '@/lib/utils';

const PdfCanvasViewer = lazy(() => import('@/components/PdfCanvasViewer'));

const DOCUMENT_BUTTONS: Record<
  ShipmentDocumentKind,
  { testId: string; text: string; icon: typeof Download }
> = {
  label: { testId: 'button-download-label', text: 'AWB Label', icon: Printer },
  boxLabel: { testId: 'button-download-box-label', text: 'Box Label', icon: Printer },
  postalLabel: {
    testId: 'button-download-postal-label',
    text: 'Postal Label',
    icon: Printer,
  },
  invoice: { testId: 'button-download-invoice', text: 'Invoice', icon: FileText },
};

/** The two the customer must print before handover. */
const HANDOVER_KINDS: ShipmentDocumentKind[] = ['label', 'boxLabel'];

/** How long to wait for a just-filed docket's labels to be saved. */
const READY_POLL_MS = 3_000;
const READY_POLL_LIMIT = 10;

export function shipmentDocumentsKey(awb: string): readonly unknown[] {
  return ['/api/shipments', awb, 'documents'];
}

/** Which printables this AWB has. Empty when none, or the AWB is not ours. */
export function useShipmentDocuments(
  awb: string,
  options?: { pollUntilReady?: boolean; enabled?: boolean }
): { documents: ShipmentDocumentKind[]; isLoading: boolean; gaveUp: boolean } {
  const [polls, setPolls] = useState(0);
  const poll = options?.pollUntilReady ?? false;

  const { data, isLoading, dataUpdatedAt } = useQuery<{ documents: ShipmentDocumentKind[] }>({
    queryKey: shipmentDocumentsKey(awb),
    queryFn: async () => {
      const res = await fetch(`/api/shipments/${encodeURIComponent(awb)}/documents`, {
        credentials: 'include',
      });
      if (!res.ok) return { documents: [] };
      return (await res.json()) as { documents: ShipmentDocumentKind[] };
    },
    enabled: !!awb && (options?.enabled ?? true),
    retry: false,
    // The docket row is written fire-and-forget after booking, so the first
    // answer can be empty for a few seconds. Never longer than that.
    refetchInterval: (query) =>
      poll && polls < READY_POLL_LIMIT && (query.state.data?.documents.length ?? 0) === 0
        ? READY_POLL_MS
        : false,
  });

  useEffect(() => {
    if (poll && dataUpdatedAt) setPolls((n) => n + 1);
  }, [poll, dataUpdatedAt]);

  const documents = data?.documents ?? [];
  return {
    documents,
    isLoading: isLoading || (poll && documents.length === 0 && polls < READY_POLL_LIMIT),
    gaveUp: poll && documents.length === 0 && polls >= READY_POLL_LIMIT,
  };
}

/** Whether this browser gets the full-screen viewer rather than direct print. */
function usesOverlay(file: File): boolean {
  return isAndroid() || canSharePdfFile(file);
}

export function ShipmentDocuments({
  awb,
  variant = 'row',
  pollUntilReady = false,
  className,
}: {
  awb: string;
  /**
   * `row`: buttons only, for an existing action bar.
   * `card`: titled "print before handover" block, for screens the customer
   * sees while the parcel is still with them.
   */
  variant?: 'row' | 'card';
  pollUntilReady?: boolean;
  className?: string;
}) {
  const { toast } = useToast();
  const { documents, isLoading, gaveUp } = useShipmentDocuments(awb, { pollUntilReady });
  const [busy, setBusy] = useState<ShipmentDocumentKind | null>(null);
  const [pdfDataUrl, setPdfDataUrl] = useState<string | null>(null);
  const [pdfTitle, setPdfTitle] = useState('Shipment Label');
  const [pdfFileName, setPdfFileName] = useState('shipment-label.pdf');

  const available = SHIPMENT_DOCUMENT_ORDER.filter((k) => documents.includes(k));

  const fetchDocument = async (kind: ShipmentDocumentKind): Promise<string | null> => {
    const doc = SHIPMENT_DOCUMENT_META[kind];
    const notAvailable = (): null => {
      toast({
        title: `${doc.title} not available`,
        description: `The ${doc.title.toLowerCase()} for this shipment could not be found.`,
        variant: 'destructive',
      });
      return null;
    };
    try {
      const res = await fetch(`/api/shipments/${encodeURIComponent(awb)}/${doc.path}`, {
        credentials: 'include',
      });
      if (!res.ok) return notAvailable();
      const body = (await res.json()) as Record<string, string>;
      return body[doc.responseKey] || notAvailable();
    } catch {
      toast({
        title: 'Download failed',
        description: `Could not open the ${doc.title.toLowerCase()}.`,
        variant: 'destructive',
      });
      return null;
    }
  };

  /** Print on desktop; full-screen viewer on phones. */
  const openDocument = async (kind: ShipmentDocumentKind): Promise<void> => {
    const doc = SHIPMENT_DOCUMENT_META[kind];
    setBusy(kind);
    const base64 = await fetchDocument(kind);
    setBusy(null);
    if (!base64) return;

    if (usesOverlay(base64ToPdfFile(base64, doc.fileName))) {
      setPdfFileName(doc.fileName);
      setPdfTitle(doc.title);
      setPdfDataUrl(`data:application/pdf;base64,${base64}`);
    } else {
      printPdfBase64(base64, doc.fileName);
    }
  };

  const downloadDocument = async (kind: ShipmentDocumentKind): Promise<void> => {
    const doc = SHIPMENT_DOCUMENT_META[kind];
    const base64 = await fetchDocument(kind);
    if (base64) downloadPdfBlob(base64ToPdfFile(base64, doc.fileName), doc.fileName);
  };

  const handleShare = async (dataUrl: string): Promise<void> => {
    try {
      const base64 = dataUrl.split(',')[1];

      if (isAndroid()) {
        const ok = await shareViaCapacitor(base64, pdfFileName, pdfTitle);
        if (ok) return;
      }

      const file = base64ToPdfFile(base64, pdfFileName);
      if (canSharePdfFile(file)) {
        await navigator.share({ files: [file], title: pdfTitle });
      } else if (!isAndroid()) {
        downloadPdfBlob(file, pdfFileName);
      }
      // Android with no native plugin: silent no-op (as before)
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        toast({
          title: 'Share failed',
          description: 'Could not share the label.',
          variant: 'destructive',
        });
      }
    }
  };

  const buttons = available.map((kind) => {
    const { testId, text, icon: Icon } = DOCUMENT_BUTTONS[kind];
    const primary = HANDOVER_KINDS.includes(kind) || (variant === 'row' && kind === available[0]);
    return (
      <span key={kind} className="inline-flex items-stretch">
        <button
          type="button"
          onClick={() => void openDocument(kind)}
          disabled={busy === kind}
          className={cn(
            'inline-flex items-center gap-2 h-10 px-4 text-sm font-semibold transition-colors disabled:opacity-60',
            primary
              ? 'bg-[lab(34.0831_-9.57756_-27.7093)] text-white hover:bg-[#2F4468]'
              : 'border border-border bg-white text-foreground hover:border-foreground/30 hover:bg-muted/40',
            'rounded-l-lg',
            // Phones have no separate download — Share covers it.
            'max-md:rounded-r-lg'
          )}
          data-testid={testId}
        >
          {busy === kind ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Icon className={primary ? 'w-4 h-4' : 'w-4 h-4 text-muted-foreground'} />
          )}
          {text}
        </button>
        <button
          type="button"
          onClick={() => void downloadDocument(kind)}
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
      </span>
    );
  });

  const overlay = pdfDataUrl && (
    <div className="fixed inset-0 z-[100] bg-white flex flex-col" data-testid="label-preview">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-white safe-top">
        <span className="font-semibold text-sm text-foreground">{pdfTitle}</span>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => void handleShare(pdfDataUrl)}
            className="text-sm font-medium text-[#F2A123] hover:underline"
          >
            Share / Print
          </button>
          <button
            type="button"
            onClick={() => setPdfDataUrl(null)}
            className="text-sm font-medium text-foreground hover:underline"
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
          <PdfCanvasViewer base64={pdfDataUrl.split(',')[1]} title={pdfTitle} />
        </Suspense>
      ) : (
        <iframe src={pdfDataUrl} className="flex-1 w-full border-0" title={pdfTitle} />
      )}
    </div>
  );

  if (variant === 'row') {
    return (
      <>
        {buttons}
        {overlay}
      </>
    );
  }

  // A card with nothing in it is noise: an AWB recorded by hand, or a guest's
  // order, has no stored labels and never will.
  if (!isLoading && available.length === 0 && !gaveUp) return null;

  return (
    <div
      id="labels"
      className={cn('rounded-lg border border-[#E2E8F0] bg-white p-4 scroll-mt-24', className)}
      data-testid="card-shipment-labels"
    >
      <p className="inline-flex items-center gap-2 text-[11px] font-bold tracking-[0.12em] uppercase text-muted-foreground">
        <Printer className="w-3.5 h-3.5 text-[#F2A123]" />
        Print before handover
      </p>
      <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
        Stick the box label on the parcel and keep the AWB label with it. The
        pickup agent or hub counter needs both.
      </p>

      {available.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">{buttons}</div>
      ) : gaveUp ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Your labels are still being prepared. Open this order from My Orders in a
          minute to print them.
        </p>
      ) : (
        <p className="mt-3 inline-flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Preparing your labels
        </p>
      )}
      {overlay}
    </div>
  );
}
