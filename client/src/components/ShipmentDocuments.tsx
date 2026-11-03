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

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, Loader2, Printer } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  SHIPMENT_DOCUMENT_META,
  SHIPMENT_DOCUMENT_ORDER,
  type ShipmentDocumentKind,
} from '@/lib/shipmentDocuments';
import { cn } from '@/lib/utils';
import { PdfDocButton, fetchPdfBase64 } from '@/components/PdfDocButton';

const DOCUMENT_BUTTONS: Record<
  ShipmentDocumentKind,
  { testId: string; text: string; icon: typeof Printer }
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
  const available = SHIPMENT_DOCUMENT_ORDER.filter((k) => documents.includes(k));

  const buttons = available.map((kind) => {
    const { testId, text, icon } = DOCUMENT_BUTTONS[kind];
    const doc = SHIPMENT_DOCUMENT_META[kind];
    return (
      <PdfDocButton
        key={kind}
        text={text}
        title={doc.title}
        fileName={doc.fileName}
        icon={icon}
        primary={HANDOVER_KINDS.includes(kind) || (variant === 'row' && kind === available[0])}
        testId={testId}
        fetchBase64={() =>
          fetchPdfBase64(
            `/api/shipments/${encodeURIComponent(awb)}/${doc.path}`,
            doc.responseKey,
            doc.title,
            toast
          )
        }
      />
    );
  });

  if (variant === 'row') {
    return <>{buttons}</>;
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
    </div>
  );
}
