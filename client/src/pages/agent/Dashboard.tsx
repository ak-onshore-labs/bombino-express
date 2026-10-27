import { useMemo, type ReactNode } from 'react';
import { Link } from 'wouter';
import { BellRing, ChevronRight, ClipboardList, Loader2, UserRound, Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AgentShell } from '@/components/agent/AgentShell';
import { BandHeader } from '@/components/agent/BandHeader';
import { ActiveJobPanel } from '@/components/agent/ActiveJobCard';
import { GoogleMapsIcon } from '@/components/agent/GoogleMapsIcon';
import { JobCard, money } from '@/components/agent/PickupCard';
import { PressableBox } from '@/components/motion/Pressable';
import { StaggerItem } from '@/components/motion/Stagger';
import { bandForDate, isTodaysWork } from '@/lib/agentGrouping';
import { seenJobIds } from '@/lib/agentSeenJobs';
import { useMyPickups, useCollections, type PickupEntry } from '@/hooks/useAgentPickups';
import { todayInIst } from '@shared/istTime';

/**
 * The agent's home, top to bottom:
 *
 *   NEW JOB    — only when the branch assigned a job this phone has not shown
 *                yet; one tap to My jobs
 *   SHORTCUTS  — four big tiles: My jobs, Cash with you, Directions, Profile
 *   DOING NOW  — the job furthest along, the one physically in their hands
 *
 * Since 6 Oct 2026 agents are not shown new bookings: the branch head assigns
 * each pickup from the ops console and it arrives as the agent's own job. Home
 * used to show only the job in hand, so a second assignment arrived silently —
 * this surface has no toasts. The new-job card is that missing word.
 *
 * The tiles are doors, not a stats strip: each one opens the screen its figure
 * belongs to. Cash moved into its tile from the amber bar that used to sit
 * under Doing now, still amber because amber is money.
 *
 * There is still no list of other jobs here. That is My jobs, and its nav
 * badge counts them.
 */

/** Furthest along wins when several jobs are held — that one is in their hands. */
const PROGRESS_RANK: Record<string, number> = {
  picked_up: 3,
  out_for_pickup: 2,
  agent_accepted: 1,
};

/** `2 new jobs assigned`, with the one job named when there is only one. */
function NewJobsCard({ jobs }: { jobs: PickupEntry[] }) {
  const only = jobs.length === 1 ? jobs[0].order : null;
  const detail = only
    ? [only.order_no, only.origin_address?.full_name].filter(Boolean).join(' · ')
    : 'Open My jobs to see them';

  return (
    <PressableBox>
      <Link
        href="/agent/mine"
        className="flex items-center gap-3.5 min-h-[68px] bg-white border border-[#D8DFE7]! border-l-4 border-l-[#F2A123]! px-4 py-3"
        data-testid="card-new-jobs"
      >
        <BellRing className="w-[22px] h-[22px] shrink-0 text-[#F2A123]" strokeWidth={1.75} />
        <span className="min-w-0 flex-1">
          <span className="block text-[17px] font-bold leading-tight text-[#1B2A41]">
            {jobs.length === 1 ? 'New job assigned' : `${jobs.length} new jobs assigned`}
          </span>
          <span className="block mt-0.5 truncate text-[15px] font-medium text-[#475569]">{detail}</span>
        </span>
        <ChevronRight className="w-[22px] h-[22px] shrink-0 text-[#64748B]" strokeWidth={1.75} />
      </Link>
    </PressableBox>
  );
}

const TILE =
  'flex flex-col justify-between gap-3 h-full min-h-[104px] p-4 border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1B2A41]';

/** One shortcut: label up top, the figure that matters at the bottom. */
function TileBody({
  icon,
  label,
  value,
  dark = false,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  dark?: boolean;
}) {
  return (
    <>
      <span className="flex items-center gap-2">
        {icon}
        <span
          className={cn(
            'text-[13px] font-bold uppercase tracking-[0.1em]',
            dark ? 'text-[#1B2A41]' : 'text-[#64748B]',
          )}
        >
          {label}
        </span>
      </span>
      <span className="text-[22px] font-bold leading-none text-[#1B2A41]">{value}</span>
    </>
  );
}

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

  const current = liveJobs[0] ?? null;

  // Assigned and not yet started, not the one already in Doing now, and not
  // yet shown on My jobs on this phone. Read fresh each poll, so the card goes
  // the moment My jobs has been opened.
  const newJobs = useMemo(() => {
    const seen = seenJobIds();
    return liveJobs.filter(
      (entry) =>
        entry !== current && entry.order.status === 'agent_accepted' && !seen.has(entry.order.id),
    );
  }, [liveJobs, current]);

  const address = current?.order.origin_address;
  const mapsQuery = [address?.address_line_1, address?.city, address?.pincode].filter(Boolean).join(', ');

  return (
    <AgentShell gap={22}>
      {isLoading ? (
        <div className="flex items-center justify-center gap-2.5 py-20 text-[#64748B]">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-[17px] font-semibold">Loading…</span>
        </div>
      ) : (
        <>
          {newJobs.length > 0 && (
            <StaggerItem index={0}>
              <NewJobsCard jobs={newJobs} />
            </StaggerItem>
          )}

          <StaggerItem index={1}>
            <nav aria-label="Shortcuts" className="grid grid-cols-2 gap-3" data-testid="grid-shortcuts">
              <PressableBox>
                <Link
                  href="/agent/mine"
                  className={cn(TILE, 'bg-white border-[#D8DFE7]!')}
                  data-testid="tile-my-jobs"
                >
                  <TileBody
                    icon={<ClipboardList className="w-[21px] h-[21px] text-[#1B2A41]" strokeWidth={1.5} />}
                    label="My jobs"
                    value={
                      liveJobs.length === 0
                        ? 'None'
                        : `${liveJobs.length} ${liveJobs.length === 1 ? 'job' : 'jobs'}`
                    }
                  />
                </Link>
              </PressableBox>

              <PressableBox>
                <Link
                  href="/agent/collections"
                  className={cn(TILE, 'bg-[#F2A123] border-[#F2A123]!')}
                  data-testid="tile-cash-with-you"
                >
                  <TileBody
                    dark
                    icon={<Wallet className="w-[21px] h-[21px] text-[#1B2A41]" strokeWidth={1.5} />}
                    label="Cash with you"
                    value={`₹${money(collections?.totals.cash ?? 0)}`}
                  />
                </Link>
              </PressableBox>

              {mapsQuery ? (
                <PressableBox>
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}`}
                    target="_blank"
                    rel="noreferrer"
                    className={cn(TILE, 'bg-white border-[#D8DFE7]!')}
                    data-testid="tile-directions"
                  >
                    <TileBody
                      icon={<GoogleMapsIcon className="h-[21px] w-auto" />}
                      label="Directions"
                      value={address?.city ?? 'Open map'}
                    />
                  </a>
                </PressableBox>
              ) : (
                <div
                  aria-disabled="true"
                  className={cn(TILE, 'bg-white border-[#E8EDF2]! opacity-60')}
                  data-testid="tile-directions"
                >
                  <TileBody
                    icon={<GoogleMapsIcon className="h-[21px] w-auto grayscale" />}
                    label="Directions"
                    value="No job"
                  />
                </div>
              )}

              <PressableBox>
                <Link
                  href="/agent/profile"
                  className={cn(TILE, 'bg-white border-[#D8DFE7]!')}
                  data-testid="tile-profile"
                >
                  <TileBody
                    icon={<UserRound className="w-[21px] h-[21px] text-[#1B2A41]" strokeWidth={1.5} />}
                    label="Profile"
                    value="My areas"
                  />
                </Link>
              </PressableBox>
            </nav>
          </StaggerItem>

          <StaggerItem index={2}>
            <section>
              <BandHeader label="Doing now" testId="band-doing-now" />
              {current ? (
                <ActiveJobPanel entry={current} />
              ) : (
                <JobCard>
                  <p className="px-4 py-6 text-[17px] font-medium text-[#334155]">
                    No jobs yet. Your branch will assign you pickups.
                  </p>
                </JobCard>
              )}
            </section>
          </StaggerItem>
        </>
      )}
    </AgentShell>
  );
}
