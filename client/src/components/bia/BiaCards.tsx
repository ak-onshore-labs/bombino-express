import { ChevronRight, FileText, MapPin, Package, Radar, Truck } from 'lucide-react';
import type { BiaCard, BiaCardTone, ChecklistCard, OrderCard, PickupCard, RateCard } from '@shared/biaCards';
import { cn } from '@/lib/utils';

/**
 * The cards under a BIA reply (shared/biaCards.ts). Drawn on the chat's dark
 * glass, so the status colours are the app's badge tones re-tuned for a dark
 * ground rather than StatusBadge itself, which is made for light screens.
 */

const TONE_CLASS: Record<BiaCardTone, string> = {
  gray: 'bg-white/10 text-white/70',
  blue: 'bg-sky-400/15 text-sky-200',
  amber: 'bg-amber-400/15 text-amber-200',
  green: 'bg-emerald-400/15 text-emerald-200',
  red: 'bg-red-400/15 text-red-200',
  orange: 'bg-orange-400/20 text-orange-200',
};

const CARD = 'w-full rounded-xl border border-white/[0.12] bg-white/[0.05] px-3 py-2.5 text-left';

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });

export function BiaCards({
  cards,
  onNavigate,
}: {
  cards: BiaCard[];
  onNavigate: (to: string) => void;
}): React.JSX.Element | null {
  if (cards.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5" data-testid="bia-cards">
      {cards.map((card, i) => {
        switch (card.kind) {
          case 'order':
            return <OrderCardView key={`o-${card.orderNo ?? card.awb ?? i}`} card={card} onNavigate={onNavigate} />;
          case 'pickup':
            return <PickupCardView key={`p-${card.pincode}`} card={card} />;
          case 'rate':
            return <RateCardView key={`r-${card.destination}-${card.weightKg}`} card={card} />;
          case 'checklist':
            return <ChecklistCardView key={`c-${card.choice}`} card={card} />;
          default:
            return null;
        }
      })}
    </div>
  );
}

function OrderCardView({ card, onNavigate }: { card: OrderCard; onNavigate: (to: string) => void }): React.JSX.Element {
  const title = card.orderNo ?? (card.awb ? `AWB ${card.awb}` : 'Shipment');
  const body = (
    <>
      <Package className="h-4 w-4 shrink-0 text-[#FBAD1F]" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-white tabular-nums">{title}</span>
          <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium', TONE_CLASS[card.tone])}>
            {card.status}
          </span>
        </span>
        <span className="block truncate text-[11px] text-white/55">
          To {card.destination}
          {card.bookedOn ? ` · Booked ${card.bookedOn}` : ''}
          {card.orderNo && card.awb ? ` · AWB ${card.awb}` : ''}
        </span>
      </span>
      {card.href && <ChevronRight className="h-4 w-4 shrink-0 text-white/40" aria-hidden />}
    </>
  );

  if (!card.href) {
    return <div className={cn(CARD, 'flex items-center gap-3')}>{body}</div>;
  }
  const href = card.href;
  return (
    <button
      type="button"
      onClick={() => onNavigate(href)}
      className={cn(CARD, 'flex items-center gap-3 transition-colors hover:bg-white/[0.09]')}
      data-testid={`bia-card-order-${card.orderNo ?? card.awb}`}
    >
      {body}
    </button>
  );
}

function PickupCardView({ card }: { card: PickupCard }): React.JSX.Element {
  return (
    <div className={cn(CARD, 'flex flex-col gap-1.5')} data-testid={`bia-card-pickup-${card.pincode}`}>
      <div className="flex items-center gap-2">
        {card.available ? (
          <Truck className="h-4 w-4 shrink-0 text-[#FBAD1F]" aria-hidden />
        ) : (
          <MapPin className="h-4 w-4 shrink-0 text-[#FBAD1F]" aria-hidden />
        )}
        <span className="flex-1 text-sm font-semibold text-white tabular-nums">Pickup at {card.pincode}</span>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[10.5px] font-medium',
            card.available ? TONE_CLASS.green : TONE_CLASS.gray
          )}
        >
          {card.available ? 'Available' : 'Drop-off only'}
        </span>
      </div>
      {card.place && <p className="text-[11px] text-white/55">{card.place}</p>}
      {card.available ? (
        <p className="text-xs text-white/80">
          {card.cutoff ? `Book by ${card.cutoff} IST for same-day pickup.` : null}
          {card.earliest ? ` Earliest pickup: ${card.earliest}.` : null}
          {card.outOfCity ? ' Outside the usual round, so an extra charge may apply.' : null}
        </p>
      ) : card.counters.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {card.counters.map((c) => (
            <li key={`${c.city}-${c.address}`} className="text-xs text-white/80">
              <span className="font-medium text-white">{c.city}</span>
              <span className="text-white/55"> · {c.address}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-white/80">Drop the parcel at any Bombino counter.</p>
      )}
    </div>
  );
}

function ChecklistCardView({ card }: { card: ChecklistCard }): React.JSX.Element {
  return (
    <div className={cn(CARD, 'flex flex-col gap-1.5')} data-testid={`bia-card-checklist-${card.choice}`}>
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 shrink-0 text-[#FBAD1F]" aria-hidden />
        <span className="flex-1 text-sm font-semibold text-white">{card.title}</span>
      </div>
      <p className="text-[11px] text-white/55">Signup asks for:</p>
      <ul className="flex flex-col">
        {card.documents.map((d) => (
          <li key={d.label} className="border-t border-white/[0.07] py-1 first:border-t-0">
            <span className="block text-xs font-medium text-white/90">{d.label}</span>
            <span className="block text-[11px] text-white/50">{d.hint}</span>
          </li>
        ))}
      </ul>
      {card.fields.length > 0 && (
        <p className="text-[11px] text-white/55">
          And these details: <span className="text-white/80">{card.fields.join(', ')}</span>
        </p>
      )}
    </div>
  );
}

function RateCardView({ card }: { card: RateCard }): React.JSX.Element {
  return (
    <div className={cn(CARD, 'flex flex-col gap-1.5')} data-testid="bia-card-rate">
      <div className="flex items-center gap-2">
        <Radar className="h-4 w-4 shrink-0 text-[#FBAD1F]" aria-hidden />
        <span className="flex-1 text-sm font-semibold text-white">
          {card.weightKg} kg to {card.destination}
        </span>
      </div>
      <ul className="flex flex-col">
        {card.services.map((s, i) => (
          <li key={s.name} className="flex items-baseline justify-between gap-3 border-t border-white/[0.07] py-1 first:border-t-0">
            <span className="min-w-0 truncate text-xs text-white/80">
              {s.name}
              {i === 0 && card.services.length > 1 ? <span className="ml-1.5 text-[10.5px] text-emerald-200">Best value</span> : null}
            </span>
            <span className="shrink-0 text-xs font-semibold text-white tabular-nums">{inr.format(s.amount)}</span>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-white/45">
        An estimate: the final price is set when the parcel is weighed at our hub.
        {card.bookable ? '' : " This route can't be booked in the app."}
      </p>
    </div>
  );
}
