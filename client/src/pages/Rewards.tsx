import { Link, Redirect } from 'wouter';
import { motion } from 'framer-motion';
import { format, isValid, parseISO } from 'date-fns';
import {
  ArrowLeft,
  CalendarClock,
  Clock,
  Gift,
  Lock,
  MinusCircle,
  PackageX,
  Package,
  RotateCcw,
  Scale,
  Sparkles,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import {
  MIN_REDEEM_POINTS,
  RUPEES_PER_EARNED_POINT,
  RUPEES_PER_POINT,
  type MilestoneProgress,
  type RewardLedgerKind,
  type RewardsSummary,
} from '@shared/rewards';
import { cn } from '@/lib/utils';
import {
  EXPIRY_WARNING_DAYS,
  daysLeftInFy,
  formatDayLong,
  formatKg,
  formatPoints,
  fyLabel,
  ledgerLabel,
  useRewards,
  useRewardsAccess,
} from '@/lib/rewards';
import { useCountUp } from '@/hooks/useCountUp';
import { StateBlock } from '@/components/StateBlock';
import { MeterBar, ProgressRing } from '@/components/rewards/ProgressRing';

const NAVY = 'text-[lab(34.0831_-9.57756_-27.7093)]';
const CARD = 'rounded-lg border border-[#E2E8F0] bg-white p-5 shadow-[0_2px_12px_oklch(17%_0.048_248/0.06)]';

/**
 * Bombino Rewards, phase 1: points plus one weight milestone.
 *
 * Figures come from GET /api/rewards; rules from @shared/rewards. Points are
 * spent at Review & Pay when booking (no cap: up to the whole bill).
 *
 * Mobile is one column in reading order: milestone, points, activity, how it
 * works. Desktop puts the milestone and activity on the left, the money on the
 * right; `contents` lets the mobile order differ without rendering twice.
 */
export default function Rewards() {
  const rewardsOn = useRewardsAccess();
  const { data, isLoading, isError, refetch } = useRewards({ enabled: rewardsOn });

  if (!rewardsOn) return <Redirect to="/home" />;

  return (
    <div className="min-h-[100dvh] bg-background pb-10" data-testid="screen-rewards">
      <header className="sticky top-0 z-40 border-b border-[#E2E8F0] bg-white/95 shadow-[0_1px_3px_oklch(17%_0.048_248_/_0.06)] backdrop-blur-sm safe-top md:hidden">
        <div className="mx-auto flex h-14 max-w-md items-center px-4">
          <button
            onClick={() => window.history.back()}
            className="-ml-2 rounded-xl p-2 transition-all hover:bg-muted active:scale-95"
            aria-label="Back"
            data-testid="button-back-rewards"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="ml-2 text-sm font-semibold">Rewards</h1>
        </div>
      </header>

      {isLoading ? (
        <RewardsSkeleton />
      ) : isError || !data ? (
        <StateBlock
          icon={Gift}
          title="Couldn't load your points"
          description="Check your connection and try again."
          action={{ label: 'Try again', onClick: () => void refetch() }}
          testId="rewards-error"
        />
      ) : (
        <RewardsBody data={data} />
      )}
    </div>
  );
}

function RewardsBody({ data }: { data: RewardsSummary }) {
  return (
    <main className="mx-auto flex max-w-md flex-col gap-5 px-4 py-5 md:grid md:max-w-none md:grid-cols-12 md:items-start md:gap-6 md:px-0 md:py-0">
      <div className="contents md:col-span-7 md:flex md:flex-col md:gap-6">
        <MilestoneHero milestone={data.milestone} fy={data.fy} className="order-1" />
        <Activity data={data} className="order-3" />
      </div>
      <div className="contents md:col-span-5 md:flex md:flex-col md:gap-6">
        <PointsWallet data={data} className="order-2" />
        <HowItWorks fyLastDay={data.fyLastDay} className="order-4" />
      </div>
    </main>
  );
}

function RewardsSkeleton() {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-5 px-4 py-5 md:max-w-none md:px-0 md:py-0" aria-busy>
      <div className="h-56 animate-pulse rounded-lg bg-[#2F4468]/15" />
      <div className="h-44 animate-pulse rounded-lg bg-[#F3F4F6]" />
      <div className="h-40 animate-pulse rounded-lg bg-[#F3F4F6]" />
    </div>
  );
}

// ─── Milestone hero ─────────────────────────────────────────────────────────

/**
 * The one milestone: kg shipped this financial year. Before it, an enticing
 * "Unlock special rewards" with the way there. After it, only "Rewards await
 * you" — what the rewards are comes in phase 2.
 */
function MilestoneHero({
  milestone,
  fy,
  className,
}: {
  milestone: MilestoneProgress;
  fy: string;
  className?: string;
}) {
  const pct = Math.round(milestone.progress * 100);
  const daysLeft = daysLeftInFy(fy);

  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-lg bg-gradient-to-br from-[#2F4468] via-[#22365A] to-[#0C1A25] p-5 text-white shadow-[0_16px_48px_oklch(17%_0.048_248/0.28)] md:p-7',
        className,
      )}
      data-testid="rewards-milestone"
    >
      <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-[#F2A123]/20 blur-3xl" aria-hidden />
      <HexPattern />

      <div className="relative flex items-center justify-between gap-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#F7C35C]">Bombino Rewards</p>
        <span className="rounded-sm bg-white/10 px-2.5 py-1 text-[11px] font-medium text-white/80 ring-1 ring-white/10">
          {fyLabel(fy)} · {daysLeft} {daysLeft === 1 ? 'day' : 'days'} left
        </span>
      </div>

      {milestone.reached ? (
        <div className="relative mt-6 flex flex-col items-center py-2 text-center" data-testid="rewards-await">
          <motion.div
            initial={{ scale: 0.6, opacity: 0, rotate: -8 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 220, damping: 14 }}
            className="relative"
          >
            <span className="absolute inset-0 rounded-full bg-[#F2A123]/30 blur-xl motion-safe:animate-pulse" aria-hidden />
            <span className="relative flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-[#F7C35C] to-[#F2A123] shadow-[0_8px_32px_rgba(242,161,35,0.45)]">
              <Gift className="h-9 w-9 text-[#1B2A44]" strokeWidth={2.2} />
            </span>
          </motion.div>
          <p className="mt-5 text-[28px] font-extrabold leading-tight tracking-tight md:text-[34px]">Rewards await you</p>
          <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-white/65">
            <Scale className="h-3.5 w-3.5 text-[#F7C35C]" />
            {formatKg(milestone.shippedKg)} shipped this year
          </p>
        </div>
      ) : (
        <>
          <div className="relative mt-5 flex items-center gap-4">
            <div className="min-w-0 flex-1">
              <p className="inline-flex items-center gap-1.5 text-xs font-medium text-[#F7C35C]">
                <Lock className="h-3.5 w-3.5" />
                Special rewards
              </p>
              <p className="mt-1 text-[26px] font-extrabold leading-[1.1] tracking-tight md:text-[32px]">
                Unlock special rewards
              </p>
              <p className="mt-2 text-xs leading-relaxed text-white/65">
                Ship {formatKg(milestone.targetKg)} with Bombino this year and something special opens up.
              </p>
            </div>
            <ProgressRing value={milestone.progress} size={96} stroke={9} label={`${pct}% of the way to special rewards`}>
              <span className="text-xl font-extrabold leading-none tabular-nums">{pct}%</span>
              <span className="mt-0.5 text-[10px] font-medium text-white/60">there</span>
            </ProgressRing>
          </div>

          <div className="relative mt-6">
            <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
              <span className="flex items-center gap-1.5 font-semibold">
                <Scale className="h-3.5 w-3.5 text-[#F7C35C]" />
                Weight shipped
              </span>
              <span className="tabular-nums text-white/70">
                {formatKg(milestone.shippedKg)} of {formatKg(milestone.targetKg)}
              </span>
            </div>
            <MeterBar value={milestone.progress} />
            <p className="mt-4 rounded-md bg-white/[0.06] px-4 py-3 text-[13px] leading-relaxed text-white/80 ring-1 ring-white/10">
              <span className="font-semibold text-white">{formatKg(milestone.remainingKg)}</span> more to unlock{' '}
              <span className="font-semibold text-[#F7C35C]">special rewards</span>.
            </p>
          </div>
        </>
      )}
    </section>
  );
}

/** Faint hexagons in the hero's corner. */
function HexPattern() {
  return (
    <svg className="pointer-events-none absolute -bottom-6 -left-6 h-40 w-40 text-white/[0.05]" viewBox="0 0 100 100" aria-hidden>
      {[
        [20, 20],
        [50, 20],
        [35, 46],
        [65, 46],
        [20, 72],
        [50, 72],
      ].map(([x, y]) => (
        <polygon
          key={`${x}-${y}`}
          points={`${x},${y - 13} ${x + 11},${y - 6.5} ${x + 11},${y + 6.5} ${x},${y + 13} ${x - 11},${y + 6.5} ${x - 11},${y - 6.5}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
      ))}
    </svg>
  );
}

// ─── Points wallet ──────────────────────────────────────────────────────────

function PointsWallet({ data, className }: { data: RewardsSummary; className?: string }) {
  const { balance, pending, canRedeem } = data;
  const shown = useCountUp(balance);
  const toUnlock = Math.max(0, MIN_REDEEM_POINTS - balance);
  const daysLeft = daysLeftInFy(data.fy);
  const expiryNear = balance > 0 && daysLeft <= EXPIRY_WARNING_DAYS;

  return (
    <section className={cn(CARD, className)} data-testid="rewards-wallet">
      <div className="flex items-center justify-between">
        <h2 className={cn('flex items-center gap-2 text-sm font-semibold', NAVY)}>
          <Wallet className="h-4 w-4 text-[#F2A123]" />
          Your points
        </h2>
        <span className="text-[11px] text-[#64748B]">₹{RUPEES_PER_EARNED_POINT} billed = 1 point</span>
      </div>

      <div className="mt-3 flex items-end gap-2">
        <p className={cn('text-[44px] font-extrabold leading-none tracking-tight tabular-nums', NAVY)} aria-live="polite">
          {balance < 0 ? '−' : ''}
          {formatPoints(Math.abs(shown))}
        </p>
        <span className="mb-1.5 text-sm font-medium text-[#64748B]">pts</span>
      </div>

      {pending.points > 0 && (
        <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-[#64748B]" data-testid="text-points-on-the-way">
          <Clock className="h-3.5 w-3.5 text-[#F2A123]" />
          <span>
            <span className="font-semibold text-[#B76E00]">+{formatPoints(pending.points)}</span> on the way, once{' '}
            {pending.orders.length === 1 ? 'your parcel is' : `${pending.orders.length} parcels are`} delivered
          </span>
        </p>
      )}

      {expiryNear && (
        <p
          className="mt-3 flex items-center gap-2 rounded-md bg-[#FEF3C7] px-3 py-2 text-xs font-medium text-[#92400E]"
          data-testid="text-points-expiring"
        >
          <CalendarClock className="h-4 w-4 shrink-0" />
          Your points expire on {formatDayLong(data.fyLastDay)} — {daysLeft} {daysLeft === 1 ? 'day' : 'days'} left.
        </p>
      )}

      {canRedeem ? (
        <>
          <p className="mt-2 text-xs text-[#64748B]">
            Worth up to{' '}
            <span className="font-semibold text-emerald-700">₹{formatPoints(balance * RUPEES_PER_POINT)}</span> off
            your bookings.
          </p>
          {/* Points are spent at the Review & Pay step of a booking. */}
          <Link
            href="/create"
            className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-md bg-[#F2A123] text-sm font-bold text-[#1B2A44] shadow-[0_8px_24px_rgba(242,161,35,0.3)] transition-transform hover:bg-[#F7B03F] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#F2A123]/40"
            data-testid="button-use-points"
          >
            <Gift className="h-4 w-4" />
            Use on a booking
          </Link>
          <p className="mt-2 text-center text-[11px] text-[#64748B]">Choose how many at Review &amp; Pay.</p>
        </>
      ) : (
        <div className="mt-5">
          <div className="mb-1.5 flex justify-between text-xs">
            <span className={cn('font-semibold', NAVY)}>
              {formatPoints(toUnlock)} more until you can use them
            </span>
            <span className="tabular-nums text-[#64748B]">
              {formatPoints(Math.max(balance, 0))}/{MIN_REDEEM_POINTS}
            </span>
          </div>
          <MeterBar value={Math.max(balance, 0) / MIN_REDEEM_POINTS} trackClassName="bg-[#F3F4F6]" />
          {balance < 0 && (
            <p className="mt-2 text-[11px] leading-relaxed text-[#64748B]">
              Points were taken back after a refund or return. New points fill this first.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

// ─── Activity ───────────────────────────────────────────────────────────────

function formatDay(iso: string): string {
  const d = parseISO(iso);
  return isValid(d) ? format(d, 'd MMM yyyy') : '';
}

const KIND_ICON: Record<RewardLedgerKind, LucideIcon> = {
  earn: Package,
  forfeit: PackageX,
  redeem: Gift,
  redeem_back: RotateCcw,
  clawback: MinusCircle,
  expiry: CalendarClock,
  adjust: Sparkles,
};

function Activity({ data, className }: { data: RewardsSummary; className?: string }) {
  const rows = data.history.slice(0, 20);
  const pending = data.pending.orders;

  return (
    <section className={cn(CARD, className)} data-testid="rewards-activity">
      <h2 className={cn('text-sm font-semibold', NAVY)}>Points activity</h2>
      {rows.length === 0 && pending.length === 0 ? (
        <p className="py-6 text-center text-sm text-[#64748B]">Your first shipment earns your first points.</p>
      ) : (
        <ul className="mt-2 divide-y divide-[#F1F5F9]">
          {/* Not spendable yet: they land when the parcel is delivered. */}
          {pending.map((row) => (
            <li key={`pending-${row.orderId}`} className="flex items-center gap-3 py-3" data-testid="row-points-pending">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-dashed border-[#F2A123]/60 text-[#B76E00]">
                <Clock className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className={cn('truncate text-sm font-medium', NAVY)}>On the way</p>
                <p className="text-xs text-[#64748B]">{row.orderNo} · once delivered</p>
              </div>
              <span className="text-sm font-bold tabular-nums text-[#B76E00]">+{formatPoints(row.points)}</span>
            </li>
          ))}
          {rows.map((row) => {
            const Icon = KIND_ICON[row.kind];
            const positive = row.points > 0;
            return (
              <li key={row.id} className="flex items-center gap-3 py-3" data-testid="row-points-ledger">
                <span
                  className={cn(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-md',
                    positive ? 'bg-[#F2A123]/12 text-[#B76E00]' : 'bg-[#2F4468]/10 text-[#2F4468]',
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cn('text-sm font-medium leading-snug', NAVY)}>{ledgerLabel(row.kind, row.note)}</p>
                  <p className="text-xs text-[#64748B]">
                    {row.orderNo ? `${row.orderNo} · ` : ''}
                    {formatDay(row.createdAt)}
                  </p>
                </div>
                <span
                  className={cn('text-sm font-bold tabular-nums', positive ? 'text-emerald-700' : 'text-[#64748B]')}
                >
                  {positive ? '+' : row.points < 0 ? '−' : ''}
                  {formatPoints(Math.abs(row.points))}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ─── How it works ───────────────────────────────────────────────────────────

function HowItWorks({ fyLastDay, className }: { fyLastDay: string; className?: string }) {
  const steps = [
    {
      icon: Package,
      title: 'Ship',
      body: `Every ₹${RUPEES_PER_EARNED_POINT} you're billed earns 1 point. GST isn't counted. Points land once your parcel is delivered.`,
    },
    {
      icon: Gift,
      title: 'Use',
      body: `From ${MIN_REDEEM_POINTS} points, each point is ₹${RUPEES_PER_POINT} off a booking, up to the whole bill.`,
    },
    {
      icon: Scale,
      title: 'Unlock',
      body: 'Ship enough weight in a year and special rewards open up.',
    },
  ];

  return (
    <section className={cn('rounded-lg bg-[#F3F4F6] p-5', className)} data-testid="rewards-how">
      <h2 className={cn('text-sm font-semibold', NAVY)}>How it works</h2>
      <ol className="mt-3 space-y-3">
        {steps.map((step, i) => (
          <li key={step.title} className="flex gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white text-xs font-bold text-[#2F4468] shadow-sm">
              {i + 1}
            </span>
            <div>
              <p className={cn('text-sm font-semibold', NAVY)}>{step.title}</p>
              <p className="text-xs leading-relaxed text-[#64748B]">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-[11px] leading-relaxed text-[#64748B]">
        For account holders who book directly with Bombino. The year runs April to March; unused points expire on{' '}
        {formatDayLong(fyLastDay)}.
      </p>
    </section>
  );
}
