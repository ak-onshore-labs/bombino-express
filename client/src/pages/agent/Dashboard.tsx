import { useMemo } from 'react';
import { Loader2, Wallet } from 'lucide-react';
import { AgentShell } from '@/components/agent/AgentShell';
import { BandHeader } from '@/components/agent/BandHeader';
import { ActiveJobPanel } from '@/components/agent/ActiveJobCard';
import { JobCard, money } from '@/components/agent/PickupCard';
import { StaggerItem } from '@/components/motion/Stagger';
import { bandForDate, isTodaysWork } from '@/lib/agentGrouping';
import { useMyPickups, useCollections } from '@/hooks/useAgentPickups';
import { todayInIst } from '@shared/istTime';
import { ScanParcelButton } from '@/components/ScanParcelSheet';

/**
 * The agent's home. Two things and nothing else.
 *
 *   DOING NOW — the job furthest along, the one physically in their hands
 *   CASH      — one amber bar with what is in the bag
 *
 * There is no new-jobs rail. Since 6 Oct 2026 agents are not shown new
 * bookings: the branch head assigns each pickup from the ops console and it
 * arrives here as the agent's own job.
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

export default function Dashboard() {
  const { data: mine, isLoading: loadingMine } = useMyPickups();
  const { data: collections } = useCollections();

  const today = todayInIst();
  const isLoading = loadingMine;

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


  return (
    <AgentShell gap={22}>
      {/* A guest's box carries our QR, not an AWB: scanning it opens the job. */}
      <ScanParcelButton surface="agent" />
      {isLoading ? (
        <div className="flex items-center justify-center gap-2.5 py-20 text-[#64748B]">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-[17px] font-semibold">Loading…</span>
        </div>
      ) : (
        <>
          {/* No new-jobs rail: agents are not shown new bookings. The branch
              head assigns each pickup, and it arrives here as their own job. */}
          <StaggerItem index={0}>
            <section>
              <BandHeader label="Doing now" testId="band-doing-now" />
              {liveJobs.length > 0 ? (
                <ActiveJobPanel entry={liveJobs[0]} />
              ) : (
                <JobCard>
                  <p className="px-4 py-6 text-[17px] font-medium text-[#334155]">
                    No jobs yet. Your branch will assign you pickups.
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
