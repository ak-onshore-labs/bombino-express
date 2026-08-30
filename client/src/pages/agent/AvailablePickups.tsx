import { Loader2 } from 'lucide-react';
import { Link } from 'wouter';
import { cn } from '@/lib/utils';
import { AgentShell } from '@/components/agent/AgentShell';
import { BandHeader } from '@/components/agent/BandHeader';
import { PanelAction } from '@/components/agent/ActionButtons';
import { JobCard, JobEntry } from '@/components/agent/PickupCard';
import { BAND_LABEL, bandForEntry } from '@/lib/agentGrouping';
import {
  useAvailablePickups,
  useOrderAction,
  type PickupEntry,
} from '@/hooks/useAgentPickups';
import { todayInIst } from '@shared/istTime';

/**
 * Jobs nobody has taken, in three bands: Late, Today, then Later.
 *
 * Every free job is a full card with its own `Take job`, including the ones
 * dated ahead. This screen is the queue — the one place an agent goes to find
 * work — so a job that exists and is claimable belongs here in full, and a
 * booking made a minute ago should be visible a minute later without anyone
 * refreshing anything. Compact rows were tried for `Later` and read as a
 * footnote to the screen rather than part of it.
 *
 * The subtitle counts what renders, never what the endpoint returned — it and
 * the nav badge both count every free job, so they agree.
 *
 * Within a band the queue is still oldest-first, so nothing rots at the bottom
 * of the list — the FIFO fairness the server orders by is untouched.
 *
 * Every job is a full card and every card carries its own `Take job`. The v2
 * pass put one button per band, on the job at the top, to stop the column
 * turning into a wall of identical buttons — but at v4's scale each card is
 * plainly its own object, and an agent who wanted the second job had to open it
 * to take it. One decision per card, taken where the card is.
 */
export default function AvailablePickups() {
  const { data: pickups, isLoading, isError, refetch } = useAvailablePickups();
  const action = useOrderAction();
  const today = todayInIst();

  /**
   * Taking a job says nothing on success: it leaves this list and appears in My
   * jobs, which is a louder answer than any confirmation. The agent surface
   * carries no toasts at all (see `SurfaceToaster` in App.tsx).
   *
   * A failure still has to be said, and is said at the top of the list — a
   * claim that silently does nothing is the exact failure §5 warns about.
   */
  const handleAccept = (orderId: string, actionName: string): void => {
    action.mutate({ orderId, action: actionName });
  };

  // 409 is the expected outcome of a lost race, not a malfunction.
  const failure = action.error
    ? action.error.status === 409
      ? 'Someone else took it'
      : action.error.message
    : null;

  // Undated jobs ride with today: they have no date to push them into a band,
  // and they are still work nobody has taken.
  const late: PickupEntry[] = [];
  const now: PickupEntry[] = [];
  const later: PickupEntry[] = [];
  for (const entry of pickups ?? []) {
    const band = bandForEntry(entry, today);
    if (band === 'overdue') late.push(entry);
    else if (band === 'scheduled') later.push(entry);
    else now.push(entry);
  }
  // Every free job renders somewhere now, so the count is simply all of them —
  // and it agrees with the nav badge, which counts the same list.
  const shown = late.length + now.length + later.length;

  // Within Later the queue is by date rather than by booking order: what an
  // agent wants to know about a job three days out is which day.
  later.sort((a, b) =>
    (a.order.pickup_date ?? '').localeCompare(b.order.pickup_date ?? ''),
  );

  const bands = [
    { key: 'overdue' as const, entries: late },
    { key: 'today' as const, entries: now },
    { key: 'scheduled' as const, entries: later },
  ].filter((b) => b.entries.length > 0);

  return (
    <AgentShell title="New jobs" meta={shown === 0 ? 'None free' : `${shown} free`}>
      {failure && (
        <p
          className="bg-white border border-[#B91C1C]! px-4 py-3.5 text-[15px] font-bold text-[#B91C1C]"
          data-testid="claim-error"
        >
          {failure}
        </p>
      )}

      {isLoading && (
        <div className="flex items-center justify-center gap-2.5 py-16 text-[#64748B]">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-[17px] font-semibold">Loading…</span>
        </div>
      )}

      {isError && (
        <JobCard>
          <p className="px-4 pt-5 text-[17px] font-medium text-[#334155]">Could not load.</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="h-14 px-4 text-[17px] font-bold text-[#1B2A41]"
            data-testid="button-retry-available"
          >
            Try again
          </button>
        </JobCard>
      )}

      {!isLoading && !isError && shown === 0 && (
        <JobCard testId="empty-available">
          <p className="px-4 py-6 text-[17px] font-medium text-[#334155]">No jobs free now.</p>
        </JobCard>
      )}

      {!isLoading &&
        !isError &&
        bands.map(({ key, entries }) => {
          const isLate = key === 'overdue';
          const edge = isLate ? 'border-[#FECACA]!' : 'border-[#D8DFE7]!';

          return (
            <section key={key}>
              <BandHeader label={BAND_LABEL[key]} band={key} testId={`band-${key}`} />

              {/* Separate cards, 14px apart. One panel of hairlined entries read
                  as a single long job at this scale. */}
              <div className="flex flex-col gap-3.5">
                {entries.map((entry) => {
                  const take = entry.availableActions.find((a) => a.action === 'claim');

                  return (
                    <JobCard key={entry.order.id} late={isLate}>
                      {/* The body is a link, the button is not — a button inside
                          an anchor is invalid markup and an ambiguous tap. */}
                      <Link
                        href={`/agent/pickup/${entry.order.id}`}
                        className="block"
                        data-testid={`link-job-${entry.order.order_no}`}
                      >
                        <JobEntry pickup={entry.order} today={today} />
                      </Link>

                      {take && (
                        <PanelAction
                          label="Take job"
                          onClick={() => handleAccept(entry.order.id, take.action)}
                          pending={action.isPending && action.variables?.orderId === entry.order.id}
                          disabled={action.isPending}
                          className={cn('border-t', edge)}
                          testId={`button-take-${entry.order.order_no}`}
                        />
                      )}
                    </JobCard>
                  );
                })}
              </div>
            </section>
          );
        })}

    </AgentShell>
  );
}
