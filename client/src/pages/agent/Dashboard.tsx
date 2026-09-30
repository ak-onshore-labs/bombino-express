import { useMemo, useRef } from 'react';
import { Loader2, ChevronLeft, ChevronRight, MapPin, Clock, Wallet } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { cn } from '@/lib/utils';
import { AgentShell } from '@/components/agent/AgentShell';
import { BandHeader } from '@/components/agent/BandHeader';
import { ActiveJobPanel } from '@/components/agent/ActiveJobCard';
import { PanelAction } from '@/components/agent/ActionButtons';
import {
  JobCard,
  NumberStrip,
  houseLine,
  money,
  statusWord,
  timeValue,
  weightLabel,
} from '@/components/agent/PickupCard';
import { StaggerItem } from '@/components/motion/Stagger';
import { bandForDate, isTodaysWork } from '@/lib/agentGrouping';
import {
  useAvailablePickups,
  useMyPickups,
  useCollections,
  type PickupEntry,
} from '@/hooks/useAgentPickups';
import { todayInIst } from '@shared/istTime';

/**
 * The agent's home. Three things and nothing else.
 *
 *   NEW JOBS  — every free job, as a swipeable rail
 *   DOING NOW — the job furthest along, the one physically in their hands
 *   CASH      — one amber bar with what is in the bag
 *
 * The rail leads. What an idle agent opens this screen for is work to take, and
 * a job they are already holding is one they can also reach from My jobs — so
 * the free queue gets the first screenful and the job in hand follows it, past
 * the fold. Long is fine; the screen scrolls.
 *
 * The screen carries no title at all. The date sits in the top bar, and the
 * two bands name themselves — a heading over them said nothing that was not
 * already on the screen.
 *
 * There is no list of the agent's other jobs here. That is My jobs, and its nav
 * badge counts them — a second list on this screen made two screens of one, and
 * a job that appeared in both read as two jobs.
 *
 * The stats strip is gone too: three figures at the top of a screen are an
 * analytics register, and an agent needs the next action.
 */

/** Furthest along wins when several jobs are held — that one is in their hands. */
const PROGRESS_RANK: Record<string, number> = {
  picked_up: 3,
  out_for_pickup: 2,
  agent_accepted: 1,
};

/** One card plus the gap: the rail moves exactly one job per arrow press. */
const RAIL_CARD = 286;
const RAIL_STEP = RAIL_CARD + 12;

/**
 * The free queue as a horizontal rail.
 *
 * Cards rather than rows because a job being offered has to show enough to
 * decide on — where, when, how heavy — and because a rail keeps the whole queue
 * inside one screenful however long it is.
 *
 * Two scrolling traps, both hit in review and both encoded here:
 *
 *   - `scroll-snap-type: x mandatory` silently swallows a backward programmatic
 *     scroll in Chromium, which leaves the Back arrow looking dead while Next
 *     works. `proximity` does not.
 *   - Scroll to an absolute clamped target, not a relative offset, or the arrow
 *     drifts out of step with the cards at the ends of the rail.
 */
function NewJobsRail({
  entries,
  today,
  onView,
}: {
  entries: PickupEntry[];
  today: string;
  onView: (orderId: string) => void;
}) {
  const rail = useRef<HTMLDivElement>(null);

  const step = (dir: 1 | -1): void => {
    const el = rail.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    el.scrollTo({ left: Math.max(0, Math.min(max, el.scrollLeft + dir * RAIL_STEP)) });
  };

  return (
    <section data-testid="section-new-jobs">
      <div className="flex items-center gap-2.5 mb-3">
        <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-[#64748B] shrink-0">
          New jobs
        </h2>
        {/* The one count on this screen, and it counts the cards beside it. */}
        {entries.length > 0 && (
          <span
            className="bg-[#F2A123] px-[7px] py-[2px] text-xs font-bold leading-[1.4] text-[#1B2A41]"
            data-testid="count-new-jobs"
          >
            {entries.length}
          </span>
        )}

        {/* Joined pair, so they read as one control rather than two buttons.
            Hidden when there is nothing to scroll — two dead arrows over an
            empty band read as a broken screen. */}
        <span className={cn('flex shrink-0 ml-auto', entries.length === 0 && 'hidden')}>
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label="Previous job"
            className="w-10 h-9 grid place-items-center border border-[#CBD5E1]! bg-white active:bg-[#EEF2F6]"
            data-testid="button-rail-back"
          >
            <ChevronLeft className="w-[19px] h-[19px] text-[#1B2A41]" strokeWidth={1.5} />
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            aria-label="Next job"
            className="w-10 h-9 grid place-items-center border border-l-0 border-[#CBD5E1]! bg-white active:bg-[#EEF2F6]"
            data-testid="button-rail-next"
          >
            <ChevronRight className="w-[19px] h-[19px] text-[#1B2A41]" strokeWidth={1.5} />
          </button>
        </span>
      </div>

      {entries.length === 0 ? (
        <JobCard testId="empty-new-jobs">
          <p className="px-4 py-6 text-[17px] font-medium text-[#334155]">
            No new jobs right now.
          </p>
        </JobCard>
      ) : (
      <>
      {/* Bleeds the screen's padding so a card can sit half off the edge — the
          cut card is what says the rail scrolls.
          `scroll-pl-5` is not optional: a snap point aligns to the scroll
          container's padding box, so without it the browser immediately
          scrolls the 20px of left padding away and the first card sits flush
          against the edge of the phone. */}
      <div
        ref={rail}
        className="no-scrollbar flex gap-3 overflow-x-auto snap-x scroll-pl-5 -mx-5 px-5"
        data-testid="rail-new-jobs"
      >
        {entries.map((entry) => {
          const pickup = entry.order;
          const late = bandForDate(pickup.pickup_date, today) === 'overdue';
          const edge = late ? 'border-[#FECACA]!' : 'border-[#E8EDF2]!';

          return (
            <JobCard
              key={pickup.id}
              late={late}
              className="shrink-0 snap-start"
              testId={`rail-card-${pickup.order_no}`}
            >
              <div style={{ width: RAIL_CARD - 2 }}>
                <NumberStrip
                  orderNo={pickup.order_no}
                  word={statusWord(pickup, today)}
                  late={late}
                  compact
                />

                <Link
                  href={`/agent/pickup/${pickup.id}`}
                  className="block"
                  data-testid={`link-rail-${pickup.order_no}`}
                >
                  <span className="flex items-start gap-[11px] p-3.5">
                    <MapPin
                      className={cn(
                        'w-5 h-5 shrink-0 mt-px',
                        late ? 'text-[#B91C1C]' : 'text-[#F2A123]',
                      )}
                      strokeWidth={1.5}
                    />
                    <span className="flex-1 min-w-0">
                      <span className="block text-[17px] font-bold leading-[1.3] text-[#1B2A41] truncate">
                        {houseLine(pickup)}
                      </span>
                      <span className="block text-[15px] font-medium text-[#475569] truncate mt-[3px]">
                        {pickup.origin_address?.city ?? '—'}
                      </span>
                    </span>
                  </span>

                  <span className={cn('flex items-center gap-[11px] px-3.5 py-3 border-t', edge)}>
                    <Clock
                      className={cn(
                        'w-5 h-5 shrink-0',
                        late ? 'text-[#B91C1C]' : 'text-[#F2A123]',
                      )}
                      strokeWidth={1.5}
                    />
                    <span
                      className={cn(
                        'text-lg font-bold truncate',
                        late ? 'text-[#B91C1C]' : 'text-[#1B2A41]',
                      )}
                    >
                      {timeValue(pickup, today)}
                    </span>
                    <span className="ml-auto shrink-0 text-base font-semibold text-[#475569]">
                      {weightLabel(pickup)}
                    </span>
                  </span>
                </Link>

                {/* View, not Take. A one-tap claim from a rail card was pressed
                    by agents who only meant to look — it claimed the job and
                    told the customer an agent was coming. Taking happens on
                    the job's own screen, with the whole job in front of them. */}
                <PanelAction
                  label="View job"
                  height={60}
                  onClick={() => onView(pickup.id)}
                  className={cn('border-t', edge)}
                  testId={`button-view-${pickup.order_no}`}
                />
              </div>
            </JobCard>
          );
        })}
      </div>
      </>
      )}
    </section>
  );
}

export default function Dashboard() {
  const { data: available, isLoading: loadingAvailable } = useAvailablePickups();
  const { data: mine, isLoading: loadingMine } = useMyPickups();
  const { data: collections } = useCollections();
  const [, setLocation] = useLocation();

  const today = todayInIst();
  const isLoading = loadingAvailable || loadingMine;

  // Every held job, today's work first. A job dated forward used to be left
  // off entirely, so taking one for tomorrow left "Doing now" saying "Take a
  // job above to start" as if nothing had happened. It now shows when there is
  // nothing due today; each panel states its own date.
  //
  // Furthest along leads, because that is the parcel physically in their hands.
  // Only then does lateness break the tie: two jobs both merely accepted are
  // separated by which promise is already broken, and after that by which
  // window opens first.
  const liveJobs = useMemo(() => {
    return [...(mine ?? [])]
      .sort((a, b) => {
        const todayA = isTodaysWork(a, today) ? 0 : 1;
        const todayB = isTodaysWork(b, today) ? 0 : 1;
        if (todayA !== todayB) return todayA - todayB;

        const byProgress =
          (PROGRESS_RANK[b.order.status] ?? 0) - (PROGRESS_RANK[a.order.status] ?? 0);
        if (byProgress !== 0) return byProgress;

        const lateA = bandForDate(a.order.pickup_date, today) === 'overdue' ? 0 : 1;
        const lateB = bandForDate(b.order.pickup_date, today) === 'overdue' ? 0 : 1;
        if (lateA !== lateB) return lateA - lateB;

        return (a.order.pickup_date ?? '').localeCompare(b.order.pickup_date ?? '');
      });
  }, [mine, today]);

  /**
   * Every free job, newest booking first, oldest at the end. Each card still
   * states its own date, so a late or future job reads as one without the
   * rail being grouped by it.
   */
  const freeJobs = useMemo(() => {
    // Copied before sorting: `available` is React Query's cached array and
    // sorting in place rewrites what every other screen reads.
    return [...(available ?? [])].sort(
      (a, b) => new Date(b.order.created_at).getTime() - new Date(a.order.created_at).getTime(),
    );
  }, [available, today]);

  return (
    <AgentShell gap={22}>
      {isLoading ? (
        <div className="flex items-center justify-center gap-2.5 py-20 text-[#64748B]">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-[17px] font-semibold">Loading…</span>
        </div>
      ) : (
        <>
          <NewJobsRail
            entries={freeJobs}
            today={today}
            onView={(orderId) => setLocation(`/agent/pickup/${orderId}`)}
          />

          {/* The rail above is deliberately not staggered: it drives its own
              imperative `scrollTo` against `snap-x mandatory`, and the two
              Chromium traps documented on it are not worth reopening for an
              entrance. It is the top block, so it simply arrives. What follows
              it ladders in. */}
          <StaggerItem index={0}>
            <section>
              <BandHeader label="Doing now" testId="band-doing-now" />
              {liveJobs.length > 0 ? (
                <ActiveJobPanel entry={liveJobs[0]} />
              ) : (
                <JobCard>
                  <p className="px-4 py-6 text-[17px] font-medium text-[#334155]">
                    {freeJobs.length > 0 ? 'View a job above to take it.' : 'No jobs yet.'}
                  </p>
                </JobCard>
              )}
            </section>
          </StaggerItem>

          <StaggerItem
            index={1}
            className="flex items-center justify-between gap-3 bg-[#F2A123] p-4"
            data-testid="bar-cash-with-you"
          >
            <span className="flex items-center gap-2.5">
              <Wallet className="w-[21px] h-[21px] text-[#1B2A41]" strokeWidth={1.5} />
              <span className="text-[13px] font-bold uppercase tracking-[0.1em] text-[#1B2A41]">
                Cash with you
              </span>
            </span>
            <span className="text-[25px] font-bold leading-none text-[#1B2A41]">
              ₹{money(collections?.totals.cash ?? 0)}
            </span>
          </StaggerItem>
        </>
      )}
    </AgentShell>
  );
}
