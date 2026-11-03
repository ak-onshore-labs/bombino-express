import { useState } from 'react';
import { Link } from 'wouter';
import { format, isValid, parseISO } from 'date-fns';
import { ChevronRight, MapPin, PackageOpen, Send } from 'lucide-react';
import { StatusBadge } from '@/components/StatusBadge';
import { useParcelsOverview } from '@/hooks/useParcelsOverview';
import { useNotifications } from '@/hooks/useCustomerOrders';
import { AttentionBlock } from '@/components/NeedsAttention';
import { useAppStore } from '@/lib/store';
import type { DisplayRow } from '@/lib/shipmentRows';
import { cn } from '@/lib/utils';

type Side = 'sending' | 'receiving';

const PREVIEW = 3;

/** Where a row opens: the receiver's screen, the order, or the AWB. */
function hrefFor(row: DisplayRow): string {
  if (row.incoming) return `/incoming/${encodeURIComponent(row.displayId)}`;
  return `${row.isOrder ? '/order' : '/shipment'}/${encodeURIComponent(row.displayId)}`;
}

function formatBooked(value: string | null): string | null {
  if (!value) return null;
  const d = parseISO(value.length <= 10 ? `${value}T12:00:00Z` : value);
  return isValid(d) ? format(d, 'dd MMM') : null;
}

function PreviewRow({ row }: { row: DisplayRow }) {
  // Incoming: "From aditya · Raigarh(MH)" then where it is going.
  // Sent: "To Arbaaz · Adrian".
  const person = row.incoming ? row.recipient : `To ${row.recipient}`;
  const booked = formatBooked(row.bookingDate);
  const meta = [row.service, booked ? `Booked ${booked}` : null].filter(Boolean).join(' · ');

  return (
    <Link
      href={hrefFor(row)}
      className="flex items-start gap-3 px-4 py-3 hover:bg-[#F8F9FA] active:bg-[#F3F4F6] transition-colors"
      data-testid={`home-parcel-${row.displayId}`}
    >
      <div
        className={cn(
          'mt-0.5 w-8 h-8 rounded-full grid place-items-center shrink-0',
          row.incoming ? 'bg-[#F2A123]/12 text-[#B26A00]' : 'bg-primary/8 text-primary',
        )}
        aria-hidden
      >
        {row.incoming ? <PackageOpen className="w-4 h-4" /> : <Send className="w-4 h-4" />}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="flex items-center gap-1.5 min-w-0">
            {row.isOrder && !row.incoming && (
              <span className="shrink-0 text-[9px] font-bold uppercase tracking-[0.08em] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                Order
              </span>
            )}
            <span className="text-sm font-semibold tabular-nums text-foreground truncate">{row.displayId}</span>
          </p>
          <StatusBadge status={row.statusLabel} tone={row.statusTone} className="shrink-0" />
        </div>

        <p className="mt-1 text-xs text-foreground/80 truncate">
          <span className="font-medium">{person}</span>
          {row.city ? <span className="text-muted-foreground"> · {row.city}</span> : null}
        </p>
        {row.incoming && row.destination && (
          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground truncate">
            <MapPin className="w-3 h-3 shrink-0" aria-hidden />
            <span className="truncate">To you in {row.destination}</span>
          </p>
        )}

        <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span className="truncate">
            {meta && <span className="font-medium uppercase tracking-[0.04em]">{meta}</span>}
            {row.awb && (
              <span className="tabular-nums">
                {meta ? ' · ' : ''}AWB {row.awb}
              </span>
            )}
          </span>
          {row.amountStr && (
            <span className="shrink-0 text-xs font-semibold tabular-nums text-foreground/80">{row.amountStr}</span>
          )}
        </div>
      </div>
    </Link>
  );
}

/**
 * Home's preview of Orders: a Sending | Receiving switch, Sending first, and
 * the newest few parcels on whichever side is selected. Each side carries a
 * count of what moved since Orders was last open. "View all" opens Orders on
 * the same side.
 *
 * Only for someone who has proved a number; nothing to show otherwise.
 *
 * `embedded` drops the card's own border and shadow, for when it sits inside
 * a panel that already has them (mobile Home groups it with tracking and the
 * booking shortcuts).
 */
export function ParcelsQuickAccess({ className, embedded = false }: { className?: string; embedded?: boolean }) {
  const overview = useParcelsOverview();
  const [side, setSide] = useState<Side>('sending');
  // What the customer has to act on (an OTP, a payment, a decision), shown at
  // the top of this card. Accounts only, as before: it reads the account's
  // order facts and bell.
  const isLoggedIn = useAppStore((s) => s.isLoggedIn);
  const { data: bell } = useNotifications(isLoggedIn);
  if (!overview.hasIdentity) return null;

  const rows = side === 'sending' ? overview.sending : overview.receiving;
  const shown = rows.slice(0, PREVIEW);
  const more = rows.length - shown.length;

  const tabs = [
    { id: 'sending' as const, label: 'Sending', icon: Send, unseen: overview.unseenSending },
    { id: 'receiving' as const, label: 'Receiving', icon: PackageOpen, unseen: overview.unseenReceiving },
  ];

  return (
    <section
      className={cn(
        'bg-white overflow-hidden',
        !embedded && 'rounded-xl border border-[#E2E8F0] shadow-card',
        className,
      )}
      data-testid="zone-parcels"
    >
      <div className="px-4 pt-4 pb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground md:text-base">My parcels</h2>
        <Link
          href={`/orders?view=${side}`}
          className="text-xs text-[#F2A123] font-semibold flex items-center gap-0.5 hover:underline"
          data-testid="link-parcels-view-all"
        >
          View all <ChevronRight className="w-3 h-3" />
        </Link>
      </div>

      {isLoggedIn && (
        <div className="mb-3">
          <AttentionBlock rows={overview.sending} bell={bell ?? []} loading={overview.loading} />
        </div>
      )}

      <div className="px-4">
        <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-[#F3F4F6]" role="tablist">
          {tabs.map(({ id, label, icon: Icon, unseen }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={side === id}
              onClick={() => setSide(id)}
              className={cn(
                'h-9 inline-flex items-center justify-center gap-1.5 rounded-md text-sm font-semibold transition-colors',
                side === id ? 'bg-white text-foreground shadow-card' : 'text-muted-foreground hover:text-foreground/80',
              )}
              data-testid={`home-tab-${id}`}
            >
              <Icon className="w-4 h-4" aria-hidden />
              {label}
              {unseen > 0 && (
                <span
                  className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-[#F2A123] text-[11px] font-bold text-white tabular-nums"
                  aria-label={`${unseen} new ${unseen === 1 ? 'update' : 'updates'}`}
                >
                  {unseen}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-2 divide-y divide-[#E2E8F0] border-t border-[#E2E8F0]" role="tabpanel">
        {overview.loading && rows.length === 0 ? (
          [1, 2].map((i) => (
            <div key={i} className="px-4 py-3 flex items-center justify-between animate-pulse motion-reduce:animate-none">
              <div className="space-y-1.5">
                <div className="h-3.5 w-28 bg-[#F3F4F6] rounded" />
                <div className="h-3 w-40 bg-[#F3F4F6] rounded" />
              </div>
              <div className="h-5 w-16 bg-[#F3F4F6] rounded-full" />
            </div>
          ))
        ) : shown.length === 0 ? (
          <div className="px-4 py-6 text-center">
            {side === 'sending' ? (
              <p className="text-sm text-muted-foreground">
                No parcels sent yet.{' '}
                <Link href="/create" className="text-[#F2A123] font-semibold hover:underline">
                  Ship now →
                </Link>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Nothing on its way to you yet. Parcels sent to your number show up here.
              </p>
            )}
          </div>
        ) : (
          shown.map((row) => <PreviewRow key={row.key} row={row} />)
        )}
      </div>

      {more > 0 && (
        <Link
          href={`/orders?view=${side}`}
          className="block px-4 py-2.5 text-center text-xs font-semibold text-muted-foreground border-t border-[#E2E8F0] hover:text-foreground"
        >
          {more} more {side === 'sending' ? 'sent' : 'coming to you'}
        </Link>
      )}
    </section>
  );
}
