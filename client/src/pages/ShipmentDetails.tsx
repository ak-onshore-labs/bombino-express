import { useState } from 'react';
import { AskBiaTopButton } from '@/components/bia/AskBiaTopButton';
import { useRoute, useLocation } from 'wouter';
import {
  ArrowLeft,
  Copy,
  Check,
  Plane,
  Phone,
  AlertTriangle,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow, format, parseISO, isValid } from 'date-fns';
import { BottomNav } from '@/components/BottomNav';
import { StatusBadge } from '@/components/StatusBadge';
import { TrackingTimeline } from '@/components/TrackingTimeline';
import { getStatusLabel, getStatusColor } from '@/lib/awbStatus';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import { useSupportContacts } from '@/hooks/useSupportContacts';
import whatsAppLogo from '@/assets/WhatsApp.svg.png';
import { ShipmentDocuments } from '@/components/ShipmentDocuments';
import {
  getDocketValue,
  mapEvents,
  trackingKey,
  useAwbTracking,
  withKg,
} from '@/hooks/useAwbTracking';

// ─── Small helpers ──────────────────────────────────────────────────────────
function joinLocationParts(...parts: string[]): string {
  return parts.map((p) => p.trim()).filter(Boolean).join(', ');
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
/** `awb` null: no document buttons (tracking served from cache). */
function ActionRow({ awb }: { awb: string | null }) {
  const { waHref, telHref } = useSupportContacts();

  return (
    <section className="mt-10 md:mt-12 pt-6 border-t border-border">
      <div className="flex flex-wrap items-center gap-2">
        {awb && <ShipmentDocuments awb={awb} />}
        <div className="flex-1" />
        <a
          href={waHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 h-10 px-3.5 rounded-lg border border-border text-sm font-medium text-foreground hover:border-emerald-200 hover:bg-emerald-50/40 transition-colors"
          data-testid="button-whatsapp"
        >
          <img src={whatsAppLogo} alt="" className="w-4 h-4 object-contain" aria-hidden />
          WhatsApp
        </a>
        <a
          href={telHref}
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
  const { waHref } = useSupportContacts();
  const [copied, setCopied] = useState(false);
  const queryClient = useQueryClient();
  const isLoggedIn = useAppStore((s) => s.isLoggedIn);

  const awb = params?.awb ? decodeURIComponent(params.awb) : '';

  const { data, isLoading, isFetching, error } = useAwbTracking(awb);

  const copyAWB = () => {
    void navigator.clipboard.writeText(awb);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const invalidateTrack = () => {
    void queryClient.invalidateQueries({ queryKey: trackingKey(awb) });
  };

  const handleBack = () => {
    if (window.history.length > 1) window.history.back();
    else setLocation('/home');
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

        <ActionRow awb={null} />
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
                href={waHref}
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
          {/* Not the owner: the server sent cities only (trackingRedact.ts). */}
          {data.restricted && (
            <p className="mt-5 text-[13px] text-muted-foreground leading-relaxed" data-testid="text-tracking-restricted">
              Names and contact details are shown only to the account that booked this shipment.
            </p>
          )}
        </div>
      </section>

      {/* Labels are the booking account's; nobody else is asked for them. */}
      <ActionRow awb={isLoggedIn ? awb : null} />
    </PageShell>
  );
}

