import { useState } from 'react';
import { useLocation, useParams } from 'wouter';
import { format, isValid, parseISO } from 'date-fns';
import { ArrowLeft, Copy, MapPin, PackageOpen } from 'lucide-react';
import { Header } from '@/components/Header';
import { BottomNav } from '@/components/BottomNav';
import { SideMenu } from '@/components/SideMenu';
import { StatusBadge } from '@/components/StatusBadge';
import { TrackingTimeline } from '@/components/TrackingTimeline';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useReceivingDetail } from '@/hooks/useReceiving';
import { mapEvents, useAwbTracking } from '@/hooks/useAwbTracking';
import { getOrderStatusTone } from '@/lib/orderStatus';
import { isTestAwb } from '@shared/testOrders';

function formatWhen(value: string): string {
  const d = parseISO(value);
  return isValid(d) ? format(d, 'dd MMM yyyy, h:mm a') : '—';
}

/**
 * One parcel coming to this person's number.
 *
 * The receiver's screen, not the sender's: where the parcel is and who sent it,
 * and nothing to act on. Money, the sender's phone and address, the handover
 * code and the labels all stay on the sender's /order screen, which this
 * person cannot open. Carrier scans come from the public tracking endpoint, so
 * they are as redacted as they are for anyone holding the AWB.
 */
export default function IncomingParcel() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [, setLocation] = useLocation();
  const { orderNo = '' } = useParams<{ orderNo: string }>();
  const { toast } = useToast();
  const { data, isLoading, error } = useReceivingDetail(orderNo);

  const parcel = data?.parcel;
  const awb = parcel?.awb_no ?? '';
  const realAwb = !!awb && !isTestAwb(awb);
  const tracking = useAwbTracking(awb, { enabled: realAwb });
  const scans =
    tracking.data && !tracking.data.fromCache ? mapEvents(tracking.data.results?.[0]?.docket_events ?? []) : [];

  const goBack = () => setLocation('/orders?view=receiving');

  const copyAwb = () => {
    if (!awb) return;
    void navigator.clipboard.writeText(awb);
    toast({ title: 'Copied', description: awb });
  };

  return (
    <div className="min-h-[100dvh] bg-background pb-nav" data-testid="screen-incoming-parcel">
      <Header onMenuClick={() => setMenuOpen(true)} />
      <SideMenu isOpen={menuOpen} onClose={() => setMenuOpen(false)} />

      <main className="max-w-2xl mx-auto px-4 md:px-0 py-5 md:py-6 space-y-5">
        <button
          type="button"
          onClick={goBack}
          className="-ml-2 inline-flex items-center gap-1.5 h-10 px-2 text-sm text-muted-foreground hover:text-foreground transition-colors rounded-lg"
          data-testid="button-back"
        >
          <ArrowLeft className="w-4 h-4" />
          Receiving
        </button>

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-28 w-full rounded-2xl" />
            <Skeleton className="h-48 w-full rounded-2xl" />
          </div>
        ) : error || !parcel ? (
          <div className="text-center py-16">
            <div className="w-12 h-12 mx-auto rounded-full bg-[#F3F4F6] flex items-center justify-center">
              <PackageOpen className="w-5 h-5 text-muted-foreground" />
            </div>
            <h1 className="font-semibold text-foreground mt-4">Parcel not found</h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto">
              We could not find this parcel for your number. Sign in with the number the sender gave us.
            </p>
            <Button className="mt-5 rounded-lg" variant="outline" onClick={goBack}>
              Back to Receiving
            </Button>
          </div>
        ) : (
          <>
            {/* Summary */}
            <section className="rounded-2xl bg-white border border-[#E2E8F0] shadow-card p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                    Coming to you
                  </p>
                  <h1 className="text-lg font-bold tracking-tight text-[#112330] tabular-nums truncate">
                    {parcel.order_no}
                  </h1>
                </div>
                <StatusBadge
                  status={parcel.customer_status}
                  tone={getOrderStatusTone(parcel.status)}
                  className="shrink-0 mt-1"
                />
              </div>

              {awb && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">AWB</span>
                  <span className="font-mono tabular-nums text-foreground" data-testid="text-incoming-awb">
                    {awb}
                  </span>
                  <button
                    type="button"
                    onClick={copyAwb}
                    className="p-1.5 rounded-md hover:bg-muted text-muted-foreground"
                    aria-label={`Copy AWB ${awb}`}
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 pt-3 border-t border-dashed border-[#E2E8F0] text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">From</dt>
                  <dd className="font-semibold text-foreground">
                    {parcel.sender_first_name ?? 'A Bombino sender'}
                    {parcel.sender_city && (
                      <span className="block text-xs font-normal text-muted-foreground">{parcel.sender_city}, India</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">To</dt>
                  <dd className="font-semibold text-foreground flex items-start gap-1">
                    <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground" aria-hidden />
                    <span>
                      {[parcel.receiver_city, parcel.receiver_country].filter(Boolean).join(', ') || '—'}
                    </span>
                  </dd>
                </div>
                {parcel.service && (
                  <div>
                    <dt className="text-xs text-muted-foreground">Service</dt>
                    <dd className="font-semibold text-foreground">{parcel.service}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-xs text-muted-foreground">Booked</dt>
                  <dd className="font-semibold text-foreground">{formatWhen(parcel.created_at)}</dd>
                </div>
              </dl>
            </section>

            {/* Carrier scans, once it has an AWB and has left us */}
            {realAwb && (
              <section className="rounded-2xl bg-white border border-[#E2E8F0] shadow-card p-5">
                <h2 className="font-semibold text-foreground mb-4">Tracking</h2>
                {tracking.isLoading ? (
                  <Skeleton className="h-24 w-full" />
                ) : scans.length > 0 ? (
                  <TrackingTimeline events={scans} currentStatus={parcel.customer_status} />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No carrier scans yet. They appear here once the parcel is on its way.
                  </p>
                )}
              </section>
            )}

            {/* Our own steps, before the carrier has it */}
            {data.events.length > 0 && (
              <section className="rounded-2xl bg-white border border-[#E2E8F0] shadow-card p-5">
                <h2 className="font-semibold text-foreground mb-4">With Bombino</h2>
                <ol className="space-y-3">
                  {[...data.events].reverse().map((event, index) => (
                    <li key={`${event.status}-${event.at}`} className="flex gap-3">
                      <span
                        className={
                          index === 0
                            ? 'mt-1.5 w-2.5 h-2.5 rounded-full bg-[#F2A123] shrink-0'
                            : 'mt-1.5 w-2.5 h-2.5 rounded-full bg-muted-foreground/30 shrink-0'
                        }
                        aria-hidden
                      />
                      <div>
                        <p className="text-sm font-semibold text-foreground">{event.customer_status}</p>
                        <p className="text-xs text-muted-foreground">{formatWhen(event.at)}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            <p className="text-[11px] text-muted-foreground text-center">
              Questions about payment or pickup? The sender can see those details in their app.
            </p>
          </>
        )}
      </main>

      <BottomNav />
    </div>
  );
}
