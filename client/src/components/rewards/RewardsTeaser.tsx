import { Link } from 'wouter';
import { ChevronRight, Gift, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatKg, formatPoints, useRewards, useRewardsAccess } from '@/lib/rewards';
import { MeterBar } from './ProgressRing';

/**
 * The rewards card on Home: points balance and the year's weight milestone in
 * one tap-through to /rewards. Account holders only; renders nothing while
 * loading or on error so Home never shows a broken card.
 */
export function RewardsTeaser({ className }: { className?: string }) {
  const rewardsOn = useRewardsAccess();
  const { data } = useRewards({ enabled: rewardsOn });
  if (!rewardsOn || !data) return null;

  const { milestone } = data;

  return (
    <Link
      href="/rewards"
      className={cn(
        'group relative block overflow-hidden rounded-lg bg-gradient-to-br from-[#2F4468] to-[#16243A] p-4 text-white shadow-[0_8px_28px_oklch(17%_0.048_248/0.22)] transition-transform active:scale-[0.99]',
        className,
      )}
      data-testid="card-rewards-teaser"
    >
      <div
        className="pointer-events-none absolute -right-10 -top-12 h-36 w-36 rounded-full bg-[#F2A123]/15 blur-2xl"
        aria-hidden
      />
      <div className="relative flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-white/10 ring-1 ring-white/15">
          <Gift className="h-5 w-5 text-[#F7C35C]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#F7C35C]">Bombino Rewards</p>
          <p className="text-base font-bold leading-tight">
            {milestone.reached ? 'Rewards await you' : 'Unlock special rewards'}
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-sm bg-white/10 px-2.5 py-1 text-xs font-semibold tabular-nums ring-1 ring-white/15">
          <Sparkles className="h-3.5 w-3.5 text-[#F7C35C]" />
          {formatPoints(data.balance)} pts
        </span>
      </div>

      {!milestone.reached && (
        <div className="relative mt-4">
          <div className="flex items-baseline justify-between text-xs">
            <span className="font-semibold tabular-nums">
              {formatKg(milestone.shippedKg)} of {formatKg(milestone.targetKg)}
            </span>
            <span className="text-white/65">{formatKg(milestone.remainingKg)} to go</span>
          </div>
          <MeterBar value={Math.max(milestone.progress, 0.03)} className="mt-1.5 h-2" />
        </div>
      )}

      {data.pending.points > 0 && (
        <p className="relative mt-3 text-xs text-white/70" data-testid="text-teaser-points-on-the-way">
          <span className="font-semibold text-[#F7C35C]">+{formatPoints(data.pending.points)} pts</span> arrive in
          your wallet after delivery
        </p>
      )}

      <div className="relative mt-3 flex items-center justify-end gap-0.5 text-xs font-semibold text-[#F7C35C]">
        View rewards
        <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}
