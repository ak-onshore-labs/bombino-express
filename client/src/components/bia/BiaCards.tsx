import { ChevronRight, FileText, LifeBuoy, MapPin, Package, Radar, Tag, Truck } from 'lucide-react';
import type { BiaCard, BiaCardTone, CaseCard, ChecklistCard, DocStatusCard, HsnCard, OrderCard, PickupCard, RateCard } from '@shared/biaCards';
import { cn } from '@/lib/utils';
import { CARD, TONE_CLASS } from './cardStyles';
import { DocUploadCardView } from './DocUploadCard';

/**
 * The cards under a BIA reply (shared/biaCards.ts). Drawn on the chat's dark
 * glass, so the status colours are the app's badge tones re-tuned for a dark
 * ground rather than StatusBadge itself, which is made for light screens.
 */

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });

export function BiaCards({
  cards,
  onNavigate,
  turnId,
}: {
  cards: BiaCard[];
  onNavigate: (to: string) => void;
  /** The reply's turn, so an upload from one of its cards can be logged against it. */
  turnId?: string;
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
          case 'docStatus':
            return <DocStatusCardView key={`d-${card.scope}`} card={card} />;
          case 'docUpload':
            return (
              <DocUploadCardView
                key={`u-${card.target}-${card.slot ?? card.documentType}`}
                card={card}
                turnId={turnId}
                onNavigate={onNavigate}
              />
            );
          case 'case':
            return <CaseCardView key={`case-${card.caseNo}`} card={card} />;
          case 'hsn':
            return <HsnCardView key={`hsn-${card.item}`} card={card} />;
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

/** Codes from Bombino's contents list. Nothing to tap: the customer chooses in the form. */
function HsnCardView({ card }: { card: HsnCard }): React.JSX.Element {
  return (
    <div className={cn(CARD, 'flex flex-col gap-1.5')} data-testid="bia-card-hsn">
      <div className="flex items-center gap-2">
        <Tag className="h-4 w-4 shrink-0 text-[#FBAD1F]" aria-hidden />
        <span className="flex-1 min-w-0 break-words text-sm font-semibold text-white">HS codes for “{card.item}”</span>
        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium', TONE_CLASS[card.sure ? 'green' : 'blue'])}>
          {card.sure ? 'Exact' : 'Closest'}
        </span>
      </div>
      <ul className="flex flex-col">
        {card.candidates.map((c) => (
          <li key={c.description} className="flex items-baseline justify-between gap-3 border-t border-white/[0.07] py-1 first:border-t-0">
            <span className="min-w-0 text-xs text-white/90">{c.description}</span>
            <span className="shrink-0 font-mono text-xs tabular-nums text-white/80">{c.code}</span>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-white/55">Choose it in “Shipment Content” on the package step; the form fills in its code.</p>
    </div>
  );
}

const CASE_STATUS: Record<CaseCard['status'], { label: string; tone: BiaCardTone }> = {
  open: { label: 'Open', tone: 'blue' },
  answered: { label: 'Answered', tone: 'green' },
  closed: { label: 'Closed', tone: 'gray' },
};

function CaseCardView({ card }: { card: CaseCard }): React.JSX.Element {
  const status = CASE_STATUS[card.status];
  return (
    <div className={cn(CARD, 'flex flex-col gap-1.5')} data-testid="bia-card-case">
      <div className="flex items-center gap-2">
        <LifeBuoy className="h-4 w-4 shrink-0 text-[#FBAD1F]" aria-hidden />
        <span className="flex-1 text-sm font-semibold text-white tabular-nums">Case {card.caseNo}</span>
        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium', TONE_CLASS[status.tone])}>
          {status.label}
        </span>
      </div>
      <p className="text-xs text-white/80">
        {card.topic}
        {card.orderNo ? ` · ${card.orderNo}` : ''}
      </p>
      <p className="text-[11px] text-white/55">
        {card.existing ? 'Already open from earlier. ' : ''}Our team can see this conversation. Quote the case number if you message us.
      </p>
    </div>
  );
}

const DOC_STATE: Record<DocStatusCard['items'][number]['state'], { label: string; tone: BiaCardTone }> = {
  on_file: { label: 'On file', tone: 'green' },
  attention: { label: 'Needs attention', tone: 'orange' },
  missing: { label: 'To upload', tone: 'gray' },
};

function DocStatusCardView({ card }: { card: DocStatusCard }): React.JSX.Element {
  return (
    <div className={cn(CARD, 'flex flex-col gap-1.5')} data-testid={`bia-card-docstatus-${card.scope}`}>
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 shrink-0 text-[#FBAD1F]" aria-hidden />
        <span className="flex-1 text-sm font-semibold text-white">{card.title}</span>
        {card.total !== null && (
          <span className="shrink-0 text-xs font-semibold text-white/80 tabular-nums">
            {card.done} of {card.total}
          </span>
        )}
      </div>
      <ul className="flex flex-col">
        {card.items.map((item) => (
          <li
            key={item.label}
            className="flex items-start justify-between gap-3 border-t border-white/[0.07] py-1 first:border-t-0"
          >
            <span className="min-w-0">
              <span className="block text-xs text-white/90">{item.label}</span>
              {item.note && <span className="block text-[11px] text-white/50">{item.note}</span>}
            </span>
            <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium', TONE_CLASS[DOC_STATE[item.state].tone])}>
              {DOC_STATE[item.state].label}
            </span>
          </li>
        ))}
      </ul>
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
