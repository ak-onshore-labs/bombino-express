import type * as React from 'react';
import { Link } from 'wouter';
import {
  ChevronRight,
  Clock,
  CreditCard,
  MapPin,
  Package,
  PackagePlus,
  CalendarDays,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { todayInIst } from '@shared/istTime';
import { bandForDate } from '@/lib/agentGrouping';
import type { AgentPickup } from '@/hooks/useAgentPickups';

/**
 * One job, readable at arm's length in direct sunlight.
 *
 * The order number is the headline. It leads every card as a full-bleed navy
 * strip, because it is what the agent says on the phone and what ops asks for —
 * not the customer's name, which was once the loudest thing here and is useless
 * on a call.
 *
 * Every other fact gets its own row, an icon and a label. A card is never a run
 * of words: `Place`, `Time`, `Weight`, `Boxes`, `Goes to` each sit on their own
 * line with the label above the value, so an agent scanning for one fact never
 * has to read the others. That is the v4 correction — the earlier passes packed
 * the same facts into one mono meta line and nobody could find anything in it.
 *
 * Three forms:
 *
 *   JobCard  — the card shell: white, square, one hairline border, late variant.
 *   JobEntry — the job you are deciding about: number strip, name, fact rows.
 *   JobRow   — a job dated forward, which needs a date and a chevron, no more.
 *
 * Design commitments, per the handoff and PRODUCT.md:
 * - Status is one short word, set in weight and case — never a coloured chip.
 * - Amber means money, or the fact the agent needs next (place, time).
 * - Red means late and nothing else, and comes from the job's band.
 * - No sentence anywhere. If a label needs a verb, it is too long.
 * - Radius 0 everywhere. Nothing on this surface is soft.
 */

/** How many days past its date a job is. Zero when it is not late. */
function daysLate(pickupDate: string | null, today: string): number {
  if (!pickupDate || pickupDate >= today) return 0;
  return Math.round(
    (new Date(`${today}T00:00:00Z`).getTime() -
      new Date(`${pickupDate}T00:00:00Z`).getTime()) /
      86_400_000,
  );
}

/** Internal status → the one word that goes on the number strip. */
const STATUS_WORD: Record<string, string> = {
  pickup_requested: 'Free',
  agent_accepted: 'Mine',
  out_for_pickup: 'Going',
  picked_up: 'Done',
  received_at_hub: 'At hub',
  cancelled: 'Cancelled',
};

/**
 * The status word, from a closed set: Free · Mine · Going · Done · N days late.
 *
 * Late outranks everything. A job the agent accepted yesterday and never did is
 * not "Mine", it is one day late, and that is the only fact about it worth the
 * one slot the strip gives a status.
 */
export function statusWord(pickup: AgentPickup, today = todayInIst()): string {
  const late = daysLate(pickup.pickup_date, today);
  if (late > 0) return late === 1 ? '1 day late' : `${late} days late`;
  return STATUS_WORD[pickup.status] ?? pickup.status.replace(/_/g, ' ');
}

/**
 * The street line — house and area, no pincode.
 *
 * The pincode is on the docket and in the map link; on a card it is six digits
 * the agent never reads, pushing the area onto a second line.
 */
export function streetLine(pickup: AgentPickup): string {
  const a = pickup.origin_address;
  if (!a) return 'No address';
  return [a.address_line_1, a.city].filter(Boolean).join(', ');
}

/** Just the house, for the `Place` row's first line. */
export function houseLine(pickup: AgentPickup): string {
  return pickup.origin_address?.address_line_1 ?? 'No address';
}

/** Area, city and pincode — the `Place` row's second line. */
export function areaLine(pickup: AgentPickup): string | null {
  const a = pickup.origin_address;
  if (!a) return null;
  const line = [a.address_line_2, a.city, a.pincode].filter(Boolean).join(', ');
  return line || null;
}

/** The whole address, for the one screen that has room: One job. */
export function fullAddress(pickup: AgentPickup): string {
  const a = pickup.origin_address;
  if (!a) return 'No address';
  return [a.address_line_1, a.address_line_2, a.city, a.state, a.pincode]
    .filter(Boolean)
    .join(', ');
}

/** Every rupee figure on this surface, grouped the Indian way. */
export function money(amount: number): string {
  return amount.toLocaleString('en-IN');
}

/** `12 Aug` — short enough to sit in front of a window on one line. */
function shortDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
  });
}

/**
 * The appointment: `12 Aug`, and nothing finer.
 *
 * A pickup used to carry a two-hour window as well. It no longer does — the
 * customer picks a day and the agent collects when they reach the address — so
 * a date is the whole of what there is to say.
 *
 * Sentence case, not mono caps. The whole surface reads as plain sans now, and
 * a date shouted in capitals was the kind of formality the brief cut.
 */
export function windowLabel(pickup: AgentPickup): string {
  return pickup.pickup_date ? shortDate(pickup.pickup_date) : 'No date';
}

/**
 * The `Time` fact, as every screen says it: `Today` for today's work, and the
 * date itself for anything else.
 */
export function timeValue(pickup: AgentPickup, today = todayInIst()): string {
  const band = bandForDate(pickup.pickup_date, today);
  if (band === 'today') return 'Today';
  return windowLabel(pickup);
}

/** `12 Aug` — a forward-dated job's calendar line. */
export function dateValue(pickup: AgentPickup): string {
  return windowLabel(pickup);
}

export function weightLabel(pickup: AgentPickup): string {
  return pickup.booked_weight ? `${pickup.booked_weight} kg` : 'No weight';
}

/**
 * The packaging row, which exists only when the customer asked for it.
 *
 * Amber and never hidden behind a chevron: it is material the agent has to put
 * in the van before leaving the hub, so it belongs with `Place` and `Time` in
 * the set of facts that change what they do next. A job that does not need
 * packaging shows no row at all — a grey "No packaging" on every other card
 * would bury the handful that matter.
 */
export function PackagingRow({
  pickup,
  size = 'card',
  className,
}: {
  pickup: AgentPickup;
  size?: 'card' | 'sheet';
  className?: string;
}) {
  if (!pickup.packaging_required) return null;
  return (
    <FactRow
      icon={PackagePlus}
      tone="amber"
      label="Packaging"
      value="Carry material"
      size={size}
      className={className}
    />
  );
}

/**
 * Why a claimed job has no next step, when the reason is the calendar rather
 * than the state machine.
 *
 * The server refuses `start_pickup` before the pickup date (see
 * `pickupDateArrived` in server/orderLifecycle.ts) and simply omits it from
 * `availableActions`. Without this the agent is told nothing on a job they hold
 * and are expecting to work, which reads as a bug.
 *
 * Mirrors the server rule; it does not enforce it.
 */
export function notDueYetReason(pickup: AgentPickup): string | null {
  if (pickup.status !== 'agent_accepted') return null;
  if (!pickup.pickup_date) return null;
  if (pickup.pickup_date <= todayInIst()) return null;
  return `Starts ${shortDate(pickup.pickup_date)}`;
}

/** Money the agent must physically collect. Nothing else is their problem. */
export function amountOwedAtDoor(pickup: AgentPickup): number | null {
  if (pickup.payment_method !== 'pay_at_pickup') return null;
  if (pickup.payment_status === 'paid') return null;
  return pickup.quoted_amount ?? null;
}

/**
 * The card: white, square, one hairline.
 *
 * Sibling cards in a band sit 14px apart rather than sharing one panel — at
 * this scale two stacks of facts divided by a single hairline read as one long
 * job, and the number strip stops looking like a beginning.
 */
export function JobCard({
  late = false,
  className,
  children,
  testId,
}: {
  late?: boolean;
  className?: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <div
      className={cn(
        'border',
        late ? 'bg-[#FEF2F2] border-[#FECACA]!' : 'bg-white border-[#D8DFE7]!',
        className,
      )}
      data-testid={testId}
    >
      {children}
    </div>
  );
}

/**
 * The order number, full-bleed, as the first thing on every card.
 *
 * Navy normally; red when the job is late, and then the status word turns white
 * rather than amber — amber on this surface means money, and a late job that
 * shouted in the money colour would be read as one owing cash.
 *
 * `compact` is the rail's slightly smaller strip. Nothing else changes.
 */
export function NumberStrip({
  orderNo,
  word,
  late = false,
  compact = false,
}: {
  orderNo: string;
  word: string;
  late?: boolean;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3',
        compact ? 'px-3.5 py-[11px]' : 'px-4 py-[13px]',
        late ? 'bg-[#B91C1C]' : 'bg-[#1B2A41]',
      )}
      data-testid={`strip-number-${orderNo}`}
    >
      <span
        className={cn(
          'font-bold leading-none tracking-[0.02em] text-white',
          compact ? 'text-[19px]' : 'text-[21px]',
        )}
      >
        {orderNo}
      </span>
      <span
        className={cn(
          'font-bold uppercase tracking-[0.1em] shrink-0',
          compact ? 'text-[11px]' : 'text-xs',
          late ? 'text-white' : 'text-[#F2A123]',
        )}
      >
        {word}
      </span>
    </div>
  );
}

/**
 * One fact, on its own row: an icon, a label, and the value under it.
 *
 * The icon is amber when the fact is what the agent needs next — where to go,
 * when to be there — and grey when it is reference they will read once, like
 * weight or the destination. That is the whole rule; there is no third colour.
 *
 * `right` is a second short fact sharing the row (weight beside time, boxes
 * beside weight). Only ever two, only ever when both are short.
 */
export function FactRow({
  icon: Icon,
  tone = 'grey',
  label,
  value,
  second,
  right,
  size = 'card',
  valueClassName,
  className,
}: {
  icon: typeof MapPin;
  tone?: 'amber' | 'grey' | 'late';
  label: string;
  value: string;
  /** The address's second line. Lighter and smaller than the value. */
  second?: string | null;
  right?: { label: string; value: string };
  /** `sheet` is One job's roomier scale: 24px icon, 18/20px padding. */
  size?: 'card' | 'sheet';
  valueClassName?: string;
  className?: string;
}) {
  const sheet = size === 'sheet';
  const stroke =
    tone === 'amber' ? '#F2A123' : tone === 'late' ? '#B91C1C' : '#94A3B8';

  return (
    <div
      className={cn(
        'flex gap-[15px]',
        second ? 'items-start' : 'items-center',
        sheet ? 'px-5 py-[18px]' : 'px-4 py-[15px]',
        className,
      )}
      data-testid={`fact-${label.toLowerCase().replace(/\s+/g, '-')}`}
    >
      <Icon
        className={cn('shrink-0', sheet ? 'w-6 h-6' : 'w-[23px] h-[23px]', second && 'mt-0.5')}
        style={{ color: stroke }}
        strokeWidth={1.5}
      />

      <span className="flex-1 min-w-0">
        <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-[#94A3B8]">
          {label}
        </span>
        <span
          className={cn(
            'block text-xl font-bold leading-[1.25] text-[#1B2A41] mt-1.5',
            valueClassName,
          )}
        >
          {value}
        </span>
        {second && (
          <span className="block text-[17px] font-medium leading-[1.45] text-[#475569] mt-1">
            {second}
          </span>
        )}
      </span>

      {right && (
        <span className="shrink-0 text-right">
          <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-[#94A3B8]">
            {right.label}
          </span>
          <span className="block text-xl font-bold leading-[1.25] text-[#1B2A41] mt-1.5">
            {right.value}
          </span>
        </span>
      )}
    </div>
  );
}

/**
 * A job you are deciding about or working: number, name, then the facts.
 *
 * `children` is a full-bleed footer — an action row or the amber money strip —
 * so it cancels the entry's own padding rather than sitting inside it.
 */
export function JobEntry({
  pickup,
  today = todayInIst(),
  facts = 'shared',
  children,
}: {
  pickup: AgentPickup;
  today?: string;
  /**
   * `shared` puts weight on the time row, which is how a job being offered
   * reads. `split` gives weight its own row — the job in hand has the screen to
   * itself and every fact gets a line.
   */
  facts?: 'shared' | 'split';
  children?: React.ReactNode;
}) {
  const late = bandForDate(pickup.pickup_date, today) === 'overdue';
  const divider = late ? 'border-[#FECACA]!' : 'border-[#E8EDF2]!';

  return (
    <div data-testid={`job-entry-${pickup.order_no}`}>
      <NumberStrip
        orderNo={pickup.order_no}
        word={statusWord(pickup, today)}
        late={late}
      />

      <p className="px-4 pt-4 pb-3.5 text-[22px] font-bold leading-[1.2] text-[#1B2A41]">
        {pickup.origin_address?.full_name ?? 'No name'}
      </p>

      <FactRow
        icon={MapPin}
        tone={late ? 'late' : 'amber'}
        label="Place"
        value={houseLine(pickup)}
        second={areaLine(pickup)}
        valueClassName="text-[19px] leading-[1.3]"
        className={cn('border-t', divider)}
      />

      <FactRow
        icon={Clock}
        tone={late ? 'late' : 'amber'}
        label="Time"
        value={timeValue(pickup, today)}
        valueClassName={late ? 'text-[#B91C1C]' : undefined}
        right={facts === 'shared' ? { label: 'Weight', value: weightLabel(pickup) } : undefined}
        className={cn('border-t', divider)}
      />

      {facts === 'split' && (
        <FactRow
          icon={Package}
          label="Weight"
          value={weightLabel(pickup)}
          className={cn('border-t', divider)}
        />
      )}

      <PackagingRow pickup={pickup} className={cn('border-t', divider)} />

      {children}
    </div>
  );
}

/** The full-bleed amber strip: the one place a doorstep amount shouts. */
export function CollectStrip({ amount }: { amount: number }) {
  return (
    <div
      className="flex items-center justify-between gap-3 bg-[#F2A123] px-4 py-[15px]"
      data-testid="strip-take-money"
    >
      <span className="flex items-center gap-2.5">
        <CreditCard className="w-[21px] h-[21px] text-[#1B2A41]" strokeWidth={1.5} />
        <span className="text-[13px] font-bold uppercase tracking-[0.1em] text-[#1B2A41]">
          Take money
        </span>
      </span>
      <span className="text-[23px] font-bold leading-none text-[#1B2A41]">
        ₹{money(amount)}
      </span>
    </div>
  );
}

/*
 * There is no HubCodeStrip here any more.
 *
 * It displayed the hub code back when ops typed it in. The agent types it now,
 * read out to them at the counter from the ops console, and this app shows no
 * handover code anywhere — see `handoverCodes.ts` for why a verifier must never
 * be able to read the number they are about to enter.
 */

/**
 * A job dated forward: its number, where it is, and the day it starts.
 *
 * No status word and no facts beyond those two lines. Nothing about a job three
 * days out changes what the agent does now, so the row carries only what tells
 * them whether to plan around it — and a chevron to the sheet if they want more.
 */
export function JobRow({ pickup, today = todayInIst() }: { pickup: AgentPickup; today?: string }) {
  const starts = notDueYetReason(pickup);

  return (
    <Link
      href={`/agent/pickup/${pickup.id}`}
      className="flex items-center gap-3 p-4"
      data-testid={`job-row-${pickup.order_no}`}
    >
      <span className="flex-1 min-w-0">
        <span className="block text-[19px] font-bold tracking-[0.02em] text-[#1B2A41]">
          {pickup.order_no}
        </span>

        <span className="flex items-center gap-[9px] mt-2.5">
          <MapPin className="w-[18px] h-[18px] shrink-0 text-[#94A3B8]" strokeWidth={1.5} />
          <span className="min-w-0 truncate text-base font-semibold text-[#1B2A41]">
            {streetLine(pickup)}
          </span>
        </span>

        <span className="flex items-center gap-[9px] mt-1.5">
          <CalendarDays className="w-[18px] h-[18px] shrink-0 text-[#94A3B8]" strokeWidth={1.5} />
          <span className="min-w-0 truncate text-base font-semibold text-[#475569]">
            {starts ?? dateValue(pickup)}
          </span>
        </span>
      </span>

      <ChevronRight className="w-5 h-5 shrink-0 text-[#94A3B8]" strokeWidth={1.5} />
    </Link>
  );
}

/** The `Weight` icon, re-exported so screens do not each import it separately. */
export { Package as WeightIcon };
