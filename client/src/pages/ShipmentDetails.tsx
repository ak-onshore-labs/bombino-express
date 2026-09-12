import { lazy, Suspense, useState } from 'react';
import { AskBiaTopButton } from '@/components/bia/AskBiaTopButton';
import { useRoute, useLocation } from 'wouter';
import {
  ArrowLeft,
  Copy,
  Check,
  Plane,
  Download,
  FileText,
  Phone,
  AlertTriangle,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow, format, parseISO, isValid } from 'date-fns';
import { BottomNav } from '@/components/BottomNav';
import { StatusBadge } from '@/components/StatusBadge';
import { TrackingTimeline } from '@/components/TrackingTimeline';
import type { TrackingEvent } from '@/lib/mockData';
import { getStatusLabel, getStatusColor, isAwbStatusFinal } from '@/lib/awbStatus';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import {
  base64ToPdfFile,
  canSharePdfFile,
  downloadPdfBlob,
  openPdfOverlayOrDownload,
} from '@/lib/pdfUtils';
import {
  SHIPMENT_DOCUMENT_META,
  SHIPMENT_DOCUMENT_ORDER,
  type ShipmentDocumentKind,
} from '@/lib/shipmentDocuments';
import { isAndroid } from '@/lib/platform';
import { shareViaCapacitor } from '@/lib/nativeShare';
import whatsAppLogo from '@/assets/WhatsApp.svg.png';

const PdfCanvasViewer = lazy(() => import('@/components/PdfCanvasViewer'));

// ─── Types (unchanged) ──────────────────────────────────────────────────────
interface DocketEvent {
  id?: string;
  event_at: string;
  event_description: string;
  event_remark: string;
  event_state: string;
  event_location: string;
}

interface ITDTrackingResult {
  errors: boolean;
  tracking_no: string;
  chargeable_weight: string;
  forwarding_no: string;
  docket_info: [string, string][];
  docket_events: DocketEvent[];
}

export type TrackingResponse =
  | { results: ITDTrackingResult[]; fromCache: false; lastTrackedAt: string }
  | { fromCache: true; lastTrackedAt: string; currentStatus: string; message: string };

/**
 * The carrier's latest scan state, across both response shapes.
 *
 * Mirrors how the badge picks `rawStateForBadge` further down — the last docket
 * event wins, then the docket's own Status field. Used to decide whether this
 * shipment is still worth polling; null means "cannot tell", which is treated
 * as still moving.
 */
function latestScanState(data: TrackingResponse | undefined): string | null {
  if (!data) return null;
  if (data.fromCache) return data.currentStatus?.trim() || null;
  const result = data.results?.[0];
  if (!result) return null;
  const events = result.docket_events ?? [];
  const last = events.length > 0 ? events[events.length - 1] : undefined;
  return (
    last?.event_state?.trim() || getDocketValue(result.docket_info ?? [], 'Status') || null
  );
}

// ─── Small helpers ──────────────────────────────────────────────────────────
function getDocketValue(docketInfo: [string, string][], label: string): string {
  const entry = docketInfo.find(([key]) => key.trim() === label);
  return entry?.[1]?.trim() ?? '';
}

function joinLocationParts(...parts: string[]): string {
  return parts.map((p) => p.trim()).filter(Boolean).join(', ');
}

function withKg(value: string): string {
  let trimmed = value.trim();
  if (!trimmed) return '';
  // Drop trailing zeros: "2.000" -> "2", "2.50" -> "2.5"
  const num = parseFloat(trimmed.replace(/[^0-9.]/g, ''));
  if (Number.isFinite(num)) {
    const hasKg = /\bkg\b/i.test(trimmed);
    trimmed = num.toString();
    return hasKg || !/^\d/.test(value) ? `${trimmed} kg` : `${trimmed} kg`;
  }
  return /\bkg\b/i.test(trimmed) ? trimmed : `${trimmed} kg`;
}

/** Format "2026-05-17" or "2026-05-17T..." -> "17 May 2026". Falls back to original if unparseable. */
function formatNiceDate(value: string): string {
  if (!value) return '';
  const trimmed = value.trim();
  // Try ISO/date-only first, with a noon stamp to avoid TZ flips on date-only strings
  const candidate = trimmed.length <= 10 ? `${trimmed}T12:00:00Z` : trimmed;
  const d = parseISO(candidate);
  if (isValid(d)) return format(d, 'dd MMM yyyy');
  return trimmed;
}

function mapEvents(docketEvents: DocketEvent[]): TrackingEvent[] {
  return docketEvents.map((e, index) => ({
    id: e.id || `${e.event_at}-${index}`,
    status: e.event_description,
    note: e.event_remark || e.event_state || '',
    location: e.event_location || '',
    timestamp: new Date(e.event_at),
  }));
}

function isTrackingResponse(body: unknown): body is TrackingResponse {
  if (!body || typeof body !== 'object') return false;
  const o = body as Record<string, unknown>;
  if (o.fromCache === true) {
    return (
      typeof o.lastTrackedAt === 'string' &&
      typeof o.currentStatus === 'string' &&
      typeof o.message === 'string'
    );
  }
  if (o.fromCache === false) {
    return Array.isArray(o.results) && typeof o.lastTrackedAt === 'string';
  }
  return false;
}

// ─── Reusable shell pieces ──────────────────────────────────────────────────
function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-background pb-nav" data-testid="screen-shipment">
      <main className="max-w-3xl mx-auto px-5 md:px-0 pt-4 pb-10 md:pt-6 md:pb-14">
        {children}
      </main>
      <BottomNav />
    </div>
  );
}

function TopBar({
  onBack,
  onRefresh,
  isFetching,
}: {
  onBack: () => void;
  onRefresh?: () => void;
  isFetching?: boolean;
}) {
  return (
    <div className="flex items-center justify-between mb-7 md:mb-10">
      <button
        type="button"
        onClick={onBack}
        className="-ml-2 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors px-2 py-1.5 rounded-lg"
        data-testid="button-back"
      >
        <ArrowLeft className="w-4 h-4" />
        Back
      </button>
      <div className="-mr-2 flex items-center gap-1">
      {onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          disabled={isFetching}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1.5 rounded-lg disabled:opacity-50"
          aria-label="Refresh tracking"
          data-testid="button-refresh-tracking"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', isFetching && 'animate-spin')} />
          {isFetching ? 'Refreshing' : 'Refresh'}
        </button>
      )}
      <AskBiaTopButton withLabel />
      </div>
    </div>
  );
}

// ─── Hero: AWB · Status · Route ──────────────────────────────────────────────
function ShipmentHero({
  awb,
  copied,
  onCopy,
  statusLabel,
  statusTone,
  fromLine,
  toLine,
}: {
  awb: string;
  copied: boolean;
  onCopy: () => void;
  statusLabel: string;
  statusTone: ReturnType<typeof getStatusColor>;
  fromLine?: string;
  toLine?: string;
}) {
  return (
    <section className="space-y-6 md:space-y-7">
      {/* SHIPMENT eyebrow + amber gradient line */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold tracking-[0.18em] uppercase text-[#F2A123]">Shipment</span>
        <span className="h-px flex-1 bg-gradient-to-r from-[#F2A123]/30 to-transparent" aria-hidden />
      </div>

      {/* AWB block — number left, status right, both vertically aligned */}
      <div className="flex items-end justify-between gap-4 flex-wrap -mt-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold tracking-[0.14em] uppercase text-muted-foreground">
            AWB number
          </p>
          <div className="flex items-center gap-2 mt-1.5">
            <h1
              className="text-2xl md:text-[28px] font-bold tabular-nums tracking-tight text-[#112330]"
              data-testid="text-awb"
            >
              {awb}
            </h1>
            <button
              type="button"
              onClick={onCopy}
              className="p-1.5 rounded-md hover:bg-muted/80 transition-colors text-muted-foreground"
              aria-label="Copy AWB number"
              data-testid="button-copy-awb"
            >
              {copied ? (
                <Check className="w-4 h-4 text-emerald-600" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
        <StatusBadge status={statusLabel} tone={statusTone} className="shrink-0 mb-1" />
      </div>

      {/* Route — bigger, visual lane with dot ··· plane ··· dot */}
      {(fromLine || toLine) && (
        <div className="rounded-xl bg-gradient-to-br from-[#F8F9FA] to-white border border-[#E2E8F0] p-4 md:p-5">
          <div className="flex items-center gap-3 md:gap-5">
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold tracking-[0.14em] uppercase text-muted-foreground">
                From
              </p>
              <p className="text-[15px] md:text-[16px] font-semibold mt-1.5 truncate text-[#112330]">
                {fromLine || '—'}
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0" aria-hidden>
              <span className="w-1.5 h-1.5 rounded-full bg-[#F2A123]" />
              <span className="block h-px w-6 md:w-10 bg-gradient-to-r from-[#F2A123]/60 to-[#F2A123]/20" />
              <Plane className="w-4 h-4 rotate-45 text-[#F2A123]" />
              <span className="block h-px w-6 md:w-10 bg-gradient-to-r from-[#F2A123]/20 to-[#F2A123]/60" />
              <span className="w-1.5 h-1.5 rounded-full bg-[#F2A123]" />
            </div>
            <div className="flex-1 min-w-0 text-right">
              <p className="text-[10px] font-bold tracking-[0.14em] uppercase text-muted-foreground">
                To
              </p>
              <p className="text-[15px] md:text-[16px] font-semibold mt-1.5 truncate text-[#112330]">
                {toLine || '—'}
              </p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ─── Definition list row ────────────────────────────────────────────────────
function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium text-[#112330] mt-1 break-words">{value}</dd>
    </div>
  );
}

// ─── Action row (documents · WhatsApp · Call) ──────────────────────────────
const DOCUMENT_BUTTONS: Record<
  ShipmentDocumentKind,
  { testId: string; text: string; icon: typeof Download }
> = {
  label: { testId: 'button-download-label', text: 'AWB Label', icon: Download },
  boxLabel: { testId: 'button-download-box-label', text: 'Box Label', icon: Download },
  postalLabel: {
    testId: 'button-download-postal-label',
    text: 'Postal Label',
    icon: Download,
  },
  invoice: { testId: 'button-download-invoice', text: 'Invoice', icon: FileText },
};

function ActionRow({
  onDownloadDocument,
  documents,
}: {
  onDownloadDocument: (kind: ShipmentDocumentKind) => void;
  documents: ShipmentDocumentKind[];
}) {
  const available = SHIPMENT_DOCUMENT_ORDER.filter((k) => documents.includes(k));

  return (
    <section className="mt-10 md:mt-12 pt-6 border-t border-border">
      <div className="flex flex-wrap items-center gap-2">
        {available.map((kind, i) => {
          const { testId, text, icon: Icon } = DOCUMENT_BUTTONS[kind];
          return (
            <button
              key={kind}
              type="button"
              onClick={() => onDownloadDocument(kind)}
              className={
                i === 0
                  ? 'inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-[lab(34.0831_-9.57756_-27.7093)] text-white text-sm font-semibold hover:bg-[#2F4468] transition-colors'
                  : 'inline-flex items-center gap-2 h-10 px-4 rounded-lg border border-border bg-white text-sm font-semibold text-foreground hover:border-foreground/30 hover:bg-muted/40 transition-colors'
              }
              data-testid={testId}
            >
              <Icon className={i === 0 ? 'w-4 h-4' : 'w-4 h-4 text-muted-foreground'} />
              {text}
            </button>
          );
        })}
        <div className="flex-1" />
        <a
          href="https://api.whatsapp.com/send?phone=917045999553"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 h-10 px-3.5 rounded-lg border border-border text-sm font-medium text-foreground hover:border-emerald-200 hover:bg-emerald-50/40 transition-colors"
          data-testid="button-whatsapp"
        >
          <img src={whatsAppLogo} alt="" className="w-4 h-4 object-contain" aria-hidden />
          WhatsApp
        </a>
        <a
          href="tel:+912266400000"
          className="inline-flex items-center gap-2 h-10 px-3.5 rounded-lg border border-border text-sm font-medium text-foreground hover:border-foreground/30 hover:bg-muted/60 transition-colors"
          data-testid="button-call"
        >
          <Phone className="w-4 h-4 text-muted-foreground" />
          Call
        </a>
      </div>
    </section>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────
export default function ShipmentDetails() {
  const [, params] = useRoute('/shipment/:awb');
  const [, setLocation] = useLocation();
  const [copied, setCopied] = useState(false);
  const [pdfDataUrl, setPdfDataUrl] = useState<string | null>(null);
  const [pdfTitle, setPdfTitle] = useState('Shipment Label');
  const [pdfFileName, setPdfFileName] = useState('shipment-label.pdf');
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const awb = params?.awb ? decodeURIComponent(params.awb) : '';

  const { data, isLoading, isFetching, error } = useQuery<TrackingResponse>({
    queryKey: ['/api/track', awb],
    queryFn: async () => {
      const res = await fetch(`/api/track/${encodeURIComponent(awb)}`, {
        credentials: 'include',
      });
      const body: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          typeof body === 'object' &&
          body !== null &&
          'message' in body &&
          typeof (body as { message: unknown }).message === 'string'
            ? (body as { message: string }).message
            : res.statusText;
        throw new Error(`${res.status}: ${msg}`);
      }
      if (!isTrackingResponse(body)) {
        throw new Error('Invalid tracking response');
      }
      return body;
    },
    enabled: !!awb,
    retry: false,
    // Carrier scans arrive while the customer is watching. The global default
    // is `staleTime: Infinity`, which on a tracking screen means the page was
    // only ever as fresh as the moment it was opened.
    //
    // Two minutes, not twenty seconds: each call is a round trip to ITD, and a
    // parcel does not change state faster than that. Stops once ITD has said
    // its last word (`isAwbStatusFinal`) — a delivered parcel is not going to
    // move again, and this screen is one people leave open.
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchInterval: (query) =>
      isAwbStatusFinal(latestScanState(query.state.data)) ? false : 120_000,
  });

  // Which printables this shipment actually has — invoice and postal label are
  // only present on some shipments, so buttons are driven by this.
  const { data: documentsData } = useQuery<{ documents: ShipmentDocumentKind[] }>({
    queryKey: ['/api/shipments', awb, 'documents'],
    queryFn: async () => {
      const res = await fetch(
        `/api/shipments/${encodeURIComponent(awb)}/documents`,
        { credentials: 'include' }
      );
      if (!res.ok) return { documents: [] };
      return (await res.json()) as { documents: ShipmentDocumentKind[] };
    },
    enabled: !!awb,
    retry: false,
  });

  const availableDocuments = documentsData?.documents ?? [];

  const copyAWB = () => {
    void navigator.clipboard.writeText(awb);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const invalidateTrack = () => {
    void queryClient.invalidateQueries({ queryKey: ['/api/track', awb] });
  };

  const handleBack = () => {
    if (window.history.length > 1) window.history.back();
    else setLocation('/home');
  };

  const handleDownloadDocument = async (kind: ShipmentDocumentKind) => {
    const doc = SHIPMENT_DOCUMENT_META[kind];
    try {
      const res = await fetch(
        `/api/shipments/${encodeURIComponent(awb)}/${doc.path}`,
        { credentials: 'include' }
      );
      if (!res.ok) {
        toast({
          title: `${doc.title} not available`,
          description: `The ${doc.title.toLowerCase()} for this shipment could not be found.`,
          variant: 'destructive',
        });
        return;
      }
      const body = (await res.json()) as Record<string, string>;
      const base64 = body[doc.responseKey];
      if (!base64) {
        toast({
          title: `${doc.title} not available`,
          description: `The ${doc.title.toLowerCase()} for this shipment could not be found.`,
          variant: 'destructive',
        });
        return;
      }
      setPdfFileName(doc.fileName);
      openPdfOverlayOrDownload(
        base64,
        doc.fileName,
        doc.title,
        setPdfTitle,
        setPdfDataUrl
      );
    } catch {
      toast({
        title: 'Download failed',
        description: `Could not open the ${doc.title.toLowerCase()}.`,
        variant: 'destructive',
      });
    }
  };

  const handleShareLabel = async (dataUrl: string) => {
    try {
      const base64 = dataUrl.split(',')[1];
      const fileName = pdfFileName;

      if (isAndroid()) {
        const ok = await shareViaCapacitor(base64, fileName, pdfTitle);
        if (ok) return;
      }

      const file = base64ToPdfFile(base64, fileName);

      if (canSharePdfFile(file)) {
        await navigator.share({ files: [file], title: pdfTitle });
      } else if (!isAndroid()) {
        downloadPdfBlob(file, fileName);
      }
      // Android with no native plugin: silent no-op (as today)
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

  // ─── Loading ─────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <PageShell>
        <TopBar onBack={handleBack} />
        <div className="space-y-6 animate-pulse">
          <div>
            <div className="h-3 w-16 bg-muted rounded" />
            <div className="h-8 w-56 bg-muted rounded mt-2" />
          </div>
          <div className="flex items-center gap-4">
            <div className="flex-1 space-y-2">
              <div className="h-3 w-10 bg-muted rounded" />
              <div className="h-4 w-40 bg-muted rounded" />
            </div>
            <div className="w-4 h-4 bg-muted rounded" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-10 bg-muted rounded ml-auto" />
              <div className="h-4 w-40 bg-muted rounded ml-auto" />
            </div>
          </div>
          <div className="pt-4 border-t border-border">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto mt-6" />
          </div>
        </div>
      </PageShell>
    );
  }

  // ─── Error / Not found ───────────────────────────────────────────────────
  if (error || !data) {
    return (
      <PageShell>
        <TopBar onBack={handleBack} onRefresh={awb ? invalidateTrack : undefined} isFetching={isFetching} />
        <section className="py-10 text-center">
          <div className="w-12 h-12 mx-auto rounded-full bg-red-50 text-red-500 flex items-center justify-center">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <h2 className="text-base font-semibold mt-4">Shipment not found</h2>
          {awb && (
            <p className="text-sm text-muted-foreground mt-1 tabular-nums">AWB {awb}</p>
          )}
          <p className="text-xs text-muted-foreground mt-3 max-w-xs mx-auto leading-relaxed">
            {error instanceof Error
              ? error.message.replace(/^\d+:\s*/, '')
              : 'No tracking data available for this number.'}
          </p>
        </section>
      </PageShell>
    );
  }

  // ─── Cached (tracking temporarily unavailable) ───────────────────────────
  if (data.fromCache) {
    const rawState = data.currentStatus;
    return (
      <PageShell>
        <TopBar onBack={handleBack} onRefresh={invalidateTrack} isFetching={isFetching} />

        <ShipmentHero
          awb={awb}
          copied={copied}
          onCopy={copyAWB}
          statusLabel={getStatusLabel(rawState)}
          statusTone={getStatusColor(rawState)}
        />

        <div className="mt-8 rounded-lg border border-amber-200 bg-amber-50/60 p-4">
          <div className="flex gap-3">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold text-amber-900">Tracking temporarily unavailable</p>
              <p className="text-xs text-amber-800/90 mt-1 leading-relaxed">{data.message}</p>
              <p className="text-[11px] text-amber-700 mt-2">
                Last updated {formatDistanceToNow(new Date(data.lastTrackedAt), { addSuffix: true })} ·{' '}
                <button
                  type="button"
                  onClick={invalidateTrack}
                  className="text-amber-900 font-semibold hover:underline"
                >
                  Refresh
                </button>
              </p>
            </div>
          </div>
        </div>

        <ActionRow
          onDownloadDocument={(kind) => void handleDownloadDocument(kind)}
          documents={[]}
        />
      </PageShell>
    );
  }

  // ─── Full result ─────────────────────────────────────────────────────────
  const trackingData = data.results[0];
  if (!trackingData || data.results.length === 0 || trackingData.errors) {
    return (
      <PageShell>
        <TopBar onBack={handleBack} onRefresh={invalidateTrack} isFetching={isFetching} />
        <section className="py-10 text-center">
          <div className="w-12 h-12 mx-auto rounded-full bg-red-50 text-red-500 flex items-center justify-center">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <h2 className="text-base font-semibold mt-4">Shipment not found</h2>
          <p className="text-sm text-muted-foreground mt-1 tabular-nums">AWB {awb}</p>
          <p className="text-xs text-muted-foreground mt-3">No tracking data available.</p>
        </section>
      </PageShell>
    );
  }

  const info = trackingData.docket_info ?? [];
  const docketEvents = trackingData.docket_events ?? [];
  const events = mapEvents(docketEvents);
  const lastEv = docketEvents.length > 0 ? docketEvents[docketEvents.length - 1] : undefined;
  const rawStateForBadge =
    (lastEv?.event_state?.trim() || getDocketValue(info, 'Status') || 'INTRANSIT').trim() ||
    'INTRANSIT';

  const currentStatus = getDocketValue(info, 'Status') || getStatusLabel(rawStateForBadge);
  const fromCountry = getDocketValue(info, 'Origin');
  const toCountry = getDocketValue(info, 'Destination');
  const fromCity = getDocketValue(info, 'Shipper City');
  const toCity = getDocketValue(info, 'Consignee City');
  const bookingDate = formatNiceDate(getDocketValue(info, 'Booking Date') || getDocketValue(info, 'Created'));
  const serviceName = getDocketValue(info, 'Service Name');
  const chargeableWeight = withKg(
    trackingData.chargeable_weight || getDocketValue(info, 'Chargeable Weight')
  );
  const shipperName = getDocketValue(info, 'Shipper Name');
  const shipperCompany = getDocketValue(info, 'Shipper Company');
  const consigneeName = getDocketValue(info, 'Consignee Name');
  const consigneeCompany = getDocketValue(info, 'Consignee Company');
  const consigneeState = getDocketValue(info, 'Consignee State');
  const consigneeCountry = getDocketValue(info, 'Consignee Country') || toCountry;
  const fromLine = joinLocationParts(fromCity, fromCountry);
  const toLine = joinLocationParts(toCity, toCountry);
  const consigneeLocation = joinLocationParts(toCity, consigneeState, consigneeCountry);
  const isHoldOrException = currentStatus === 'Customs Hold' || currentStatus === 'Exception';
  const forwardingNo = trackingData.forwarding_no?.trim() ?? '';

  const shipmentFields = [
    { label: 'Booking date', value: bookingDate },
    { label: 'Service', value: serviceName },
    { label: 'Chargeable weight', value: chargeableWeight },
    { label: 'Forwarding no.', value: forwardingNo },
  ].filter((f) => f.value);

  const partyFields = [
    { label: 'Shipper', value: shipperName },
    { label: 'Shipper company', value: shipperCompany },
    { label: 'Shipper city', value: fromCity },
    { label: 'Consignee', value: consigneeName },
    { label: 'Consignee company', value: consigneeCompany },
    { label: 'Consignee location', value: consigneeLocation },
  ].filter((f) => f.value);

  return (
    <PageShell>
      <TopBar onBack={handleBack} onRefresh={invalidateTrack} isFetching={isFetching} />

      <ShipmentHero
        awb={awb}
        copied={copied}
        onCopy={copyAWB}
        statusLabel={getStatusLabel(rawStateForBadge)}
        statusTone={getStatusColor(rawStateForBadge)}
        fromLine={fromLine}
        toLine={toLine}
      />

      {isHoldOrException && (
        <div className="mt-8 rounded-lg border border-red-200 bg-red-50/60 p-4">
          <div className="flex gap-3">
            <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold text-red-700">{currentStatus}</p>
              <p className="text-xs text-red-600/90 mt-1 leading-relaxed">
                Please contact support for details on this shipment.
              </p>
              <a
                href="https://api.whatsapp.com/send?phone=917045999553"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 mt-2 text-xs font-semibold text-red-700 hover:underline"
                data-testid="link-support-hold"
              >
                <img src={whatsAppLogo} alt="" className="w-3.5 h-3.5 object-contain" aria-hidden />
                Contact support
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Tracking history */}
      <section className="mt-10 md:mt-12 pt-8 border-t border-border">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-[11px] font-bold tracking-[0.14em] uppercase text-muted-foreground">
            Tracking history
          </h2>
          <p className="text-[11px] text-muted-foreground">
            Updated {formatDistanceToNow(new Date(data.lastTrackedAt), { addSuffix: true })} ·{' '}
            <button
              type="button"
              onClick={invalidateTrack}
              className="font-semibold text-foreground hover:underline"
              data-testid="button-refresh-tracking-inline"
            >
              Refresh
            </button>
          </p>
        </div>
        {events.length > 0 ? (
          <TrackingTimeline events={events} currentStatus={currentStatus} />
        ) : (
          <p className="text-sm text-muted-foreground">No tracking events yet.</p>
        )}
      </section>

      {/* Details — asymmetric panels (4-field meta + 6-field parties) */}
      <section className="mt-10 md:mt-12 grid grid-cols-1 md:grid-cols-[5fr_7fr] gap-4 md:gap-5">
        <div className="relative rounded-xl bg-white border border-[#E2E8F0] shadow-[0_1px_1px_lab(34.0831_-9.57756_-27.7093_/_0.03),0_2px_6px_lab(34.0831_-9.57756_-27.7093_/_0.05),0_12px_28px_-14px_lab(34.0831_-9.57756_-27.7093_/_0.16)] p-5 md:p-6">
          <div className="flex items-center gap-2 mb-5">
            <span className="block w-1 h-3.5 rounded-sm bg-[#F2A123]" aria-hidden />
            <h2 className="text-[11px] font-bold tracking-[0.14em] uppercase text-muted-foreground">
              Shipment
            </h2>
          </div>
          <dl className="grid grid-cols-2 md:grid-cols-1 gap-x-4 gap-y-5 md:gap-y-4">
            {shipmentFields.map((f) => (
              <Field key={f.label} label={f.label} value={f.value} />
            ))}
          </dl>
        </div>
        <div className="relative rounded-xl bg-white border border-[#E2E8F0] shadow-[0_1px_1px_lab(34.0831_-9.57756_-27.7093_/_0.03),0_2px_6px_lab(34.0831_-9.57756_-27.7093_/_0.05),0_12px_28px_-14px_lab(34.0831_-9.57756_-27.7093_/_0.16)] p-5 md:p-6">
          <div className="flex items-center gap-2 mb-5">
            <span className="block w-1 h-3.5 rounded-sm bg-[#F2A123]" aria-hidden />
            <h2 className="text-[11px] font-bold tracking-[0.14em] uppercase text-muted-foreground">
              Parties
            </h2>
          </div>
          <dl className="grid grid-cols-2 md:grid-cols-2 gap-x-6 gap-y-5 md:gap-y-5">
            {partyFields.map((f) => (
              <Field key={f.label} label={f.label} value={f.value} />
            ))}
          </dl>
        </div>
      </section>

      <ActionRow
        onDownloadDocument={(kind) => void handleDownloadDocument(kind)}
        documents={availableDocuments}
      />

      {/* PDF preview overlay (label or invoice) */}
      {pdfDataUrl && (
        <div className="fixed inset-0 z-[100] bg-white flex flex-col" data-testid="label-preview">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-white safe-top">
            <span className="font-semibold text-sm text-foreground">{pdfTitle}</span>
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => void handleShareLabel(pdfDataUrl)}
                className="text-sm font-medium text-[#F2A123] hover:underline"
              >
                Share
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
      )}
    </PageShell>
  );
}

