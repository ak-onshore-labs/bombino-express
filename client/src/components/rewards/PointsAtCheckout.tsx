import { Link } from 'wouter';
import { Gift, Minus, Plus, Sparkles } from 'lucide-react';
import { MIN_REDEEM_POINTS, RUPEES_PER_POINT, maxRedeemable } from '@shared/rewards';
import { Switch } from '@/components/ui/switch';
import { formatInr } from '@/lib/itdRates';
import { formatPoints } from '@/lib/rewards';
import { cn } from '@/lib/utils';

const STEP = 10;

interface PointsAtCheckoutProps {
  /** Spendable points. */
  balance: number;
  /** Booking total incl. GST, before points. */
  payable: number;
  /** Points chosen. 0 means the switch is off. */
  points: number;
  onPointsChange: (points: number) => void;
  className?: string;
}

/**
 * "Use reward points" at Review & Pay.
 *
 * Off by default. Switching it on takes as many points as the booking allows
 * (no cap: up to the whole bill, GST included), which is usually what someone
 * means by turning it on; they can then step down by 10s or drag the slider.
 * Under 100 points it says how far off they are instead of a bare disabled
 * switch.
 */
export function PointsAtCheckout({ balance, payable, points, onPointsChange, className }: PointsAtCheckoutProps) {
  const max = maxRedeemable(balance, payable);
  const on = points > 0;
  const shortOfMinimum = balance < MIN_REDEEM_POINTS;
  const clamp = (n: number): number => Math.min(Math.max(Math.round(n), 1), max);

  return (
    <section
      className={cn(
        'rounded-lg border p-3.5 transition-colors',
        on ? 'border-[#F2A123] bg-[#F2A123]/[0.07]' : 'border-[#E2E8F0] bg-white',
        className,
      )}
      data-testid="card-points-at-checkout"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#F2A123]/12">
          <Gift className="h-4 w-4 text-[#B76E00]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[lab(34.0831_-9.57756_-27.7093)]">Use reward points</p>
          <p className="text-xs text-[#64748B]">
            <span className="font-semibold tabular-nums text-[#334155]">{formatPoints(Math.max(balance, 0))}</span>{' '}
            available · 1 pt = ₹{RUPEES_PER_POINT}
          </p>
        </div>
        <Switch
          checked={on}
          disabled={max <= 0}
          onCheckedChange={(checked) => onPointsChange(checked ? max : 0)}
          aria-label="Use reward points"
          data-testid="switch-use-points"
        />
      </div>

      {shortOfMinimum && (
        <div className="mt-3">
          <div className="h-1.5 overflow-hidden rounded-sm bg-[#F3F4F6]">
            <div
              className="h-full rounded-sm bg-gradient-to-r from-[#F7C35C] to-[#F2A123]"
              style={{ width: `${(Math.max(balance, 0) / MIN_REDEEM_POINTS) * 100}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-[#64748B]">
            {formatPoints(MIN_REDEEM_POINTS - Math.max(balance, 0))} more points and you can use them on a booking.
          </p>
        </div>
      )}

      {on && (
        <div className="mt-3.5 space-y-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onPointsChange(clamp(points - STEP))}
              disabled={points <= 1}
              className="flex h-10 w-10 items-center justify-center rounded-md border border-[#E2E8F0] bg-white text-[#334155] transition-colors hover:border-[#F2A123]/60 disabled:opacity-40"
              aria-label="Use 10 fewer points"
            >
              <Minus className="h-4 w-4" />
            </button>
            <div className="min-w-0 flex-1 text-center">
              <p className="text-xl font-extrabold leading-none tabular-nums text-[lab(34.0831_-9.57756_-27.7093)]">
                {formatPoints(points)}
              </p>
              <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#64748B]">points</p>
            </div>
            <button
              type="button"
              onClick={() => onPointsChange(clamp(points + STEP))}
              disabled={points >= max}
              className="flex h-10 w-10 items-center justify-center rounded-md border border-[#E2E8F0] bg-white text-[#334155] transition-colors hover:border-[#F2A123]/60 disabled:opacity-40"
              aria-label="Use 10 more points"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>

          {max > 1 && (
            <input
              type="range"
              className="h-2 w-full cursor-pointer appearance-none rounded-sm bg-white accent-[#F2A123]"
              min={1}
              max={max}
              step={1}
              value={points}
              onChange={(e) => onPointsChange(clamp(Number(e.target.value)))}
              aria-label="Points to use"
            />
          )}

          <div className="flex items-center justify-between text-xs">
            <span className="text-[#64748B]">
              {points === max ? (
                balance > max ? 'Covers the whole booking' : 'All your points'
              ) : (
                <button
                  type="button"
                  onClick={() => onPointsChange(max)}
                  className="font-semibold text-[#B76E00] underline-offset-2 hover:underline"
                >
                  Use max ({formatPoints(max)})
                </button>
              )}
            </span>
            <span className="font-bold tabular-nums text-emerald-700">− {formatInr(points * RUPEES_PER_POINT)}</span>
          </div>
        </div>
      )}
    </section>
  );
}

/** The points this booking will earn once the parcel is delivered. */
export function PointsEarnNote({ points, className }: { points: number; className?: string }) {
  if (points <= 0) return null;
  return (
    <div className={cn('flex items-start gap-1.5 text-xs text-[#64748B]', className)} data-testid="text-points-earn">
      <Sparkles className="mt-px h-3.5 w-3.5 shrink-0 text-[#F2A123]" />
      <p className="min-w-0 flex-1 leading-snug">
        You'll earn <span className="font-semibold text-[#B76E00]">{formatPoints(points)} points</span> once this
        parcel is delivered.
      </p>
      <Link href="/rewards" className="shrink-0 font-semibold text-[#2F4468] underline-offset-2 hover:underline">
        Rewards
      </Link>
    </div>
  );
}
