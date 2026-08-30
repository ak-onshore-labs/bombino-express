import { Link } from 'wouter';
import { Loader2, MapPin, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AgentShell } from '@/components/agent/AgentShell';
import { BandHeader } from '@/components/agent/BandHeader';
import {
  JobCard,
  JobRow,
  NumberStrip,
  amountOwedAtDoor,
  money,
  statusWord,
  streetLine,
  weightLabel,
  windowLabel,
} from '@/components/agent/PickupCard';
import { BAND_LABEL, bandForEntry, bandForDate } from '@/lib/agentGrouping';
import { useMyPickups, type PickupEntry } from '@/hooks/useAgentPickups';
import { todayInIst } from '@shared/istTime';

/**
 * The agent's own jobs, in two bands: Today, then Later.
 *
 * Today's jobs are separate cards 14px apart, each led by its number strip.
 * Their rows are tighter than a full job card's — no labels, one line per fact
 * — because this screen is read to answer "which one next", not "what is this
 * job". The answer to the second question is One job, which every card opens.
 *
 * No buttons here. It is the list, and every entry opens onto One job, which
 * carries the whole action bar. A list where each row also acted was two
 * screens in one.
 *
 * A job leaves this list at `received_at_hub`. That is the handoff to ops and
 * it is one-directional: the server stops returning it, so it disappears on the
 * next refetch. The agent is told at the moment it happens, on the job sheet,
 * rather than by a count here the client does not hold.
 */

/** One of today's jobs: number, name, where, and when + what it is worth. */
function TodayCard({ entry, today }: { entry: PickupEntry; today: string }) {
  const pickup = entry.order;
  const late = bandForDate(pickup.pickup_date, today) === 'overdue';
  const owed = amountOwedAtDoor(pickup);
  const edge = late ? 'border-[#FECACA]!' : 'border-[#E8EDF2]!';
  const icon = late ? 'text-[#B91C1C]' : 'text-[#F2A123]';

  return (
    <JobCard late={late}>
      <Link
        href={`/agent/pickup/${pickup.id}`}
        className="block"
        data-testid={`link-job-${pickup.order_no}`}
      >
        <NumberStrip orderNo={pickup.order_no} word={statusWord(pickup, today)} late={late} />

        <p className="px-4 pt-[15px] pb-[13px] text-[22px] font-bold leading-[1.2] text-[#1B2A41]">
          {pickup.origin_address?.full_name ?? 'No name'}
        </p>

        <span className={cn('flex items-center gap-3 px-4 py-3.5 border-t', edge)}>
          <MapPin className={cn('w-[21px] h-[21px] shrink-0', icon)} strokeWidth={1.5} />
          <span className="min-w-0 truncate text-[17px] font-semibold text-[#1B2A41]">
            {streetLine(pickup)}
          </span>
        </span>

        <span className={cn('flex items-center gap-3 px-4 py-3.5 border-t', edge)}>
          <Clock className={cn('w-[21px] h-[21px] shrink-0', icon)} strokeWidth={1.5} />
          <span
            className={cn(
              'text-[19px] font-bold shrink-0',
              late ? 'text-[#B91C1C]' : 'text-[#1B2A41]',
            )}
          >
            {windowLabel(pickup)}
          </span>
          <span className="text-[17px] font-semibold text-[#475569] shrink-0">
            {weightLabel(pickup)}
          </span>

          {owed !== null ? (
            <span
              className="ml-auto shrink-0 bg-[#F2A123] px-[9px] py-[5px] text-[17px] font-bold text-[#1B2A41]"
              data-testid="badge-money"
            >
              ₹{money(owed)}
            </span>
          ) : (
            <span
              className="ml-auto shrink-0 text-base font-semibold text-[#64748B]"
              data-testid="badge-no-money"
            >
              No money
            </span>
          )}
        </span>
      </Link>
    </JobCard>
  );
}

export default function MyPickups() {
  const { data: pickups, isLoading, isError, refetch } = useMyPickups();
  const today = todayInIst();

  // Late rides with today: it is work owed now, not a separate errand, and the
  // card carries its own red strip saying how late it is.
  const now: PickupEntry[] = [];
  const later: PickupEntry[] = [];
  for (const entry of pickups ?? []) {
    const band = bandForEntry(entry, today);
    if (band === 'scheduled') later.push(entry);
    else now.push(entry);
  }
  const count = (pickups ?? []).length;

  return (
    <AgentShell
      title="My jobs"
      meta={count === 0 ? 'No jobs' : `${count} ${count === 1 ? 'job' : 'jobs'}`}
    >
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
            data-testid="button-retry-mine"
          >
            Try again
          </button>
        </JobCard>
      )}

      {!isLoading && !isError && count === 0 && (
        <JobCard testId="empty-mine">
          <p className="px-4 py-6 text-[17px] font-medium text-[#334155]">
            Take a job to see it here.
          </p>
        </JobCard>
      )}

      {now.length > 0 && (
        <section>
          <BandHeader label={BAND_LABEL.today} testId="band-today" />
          <div className="flex flex-col gap-3.5">
            {now.map((entry) => (
              <TodayCard key={entry.order.id} entry={entry} today={today} />
            ))}
          </div>
        </section>
      )}

      {later.length > 0 && (
        <section>
          <BandHeader label={BAND_LABEL.scheduled} band="scheduled" testId="band-later" />
          <div className="flex flex-col gap-3.5">
            {later.map((entry) => (
              <JobCard key={entry.order.id}>
                <JobRow pickup={entry.order} today={today} />
              </JobCard>
            ))}
          </div>
        </section>
      )}
    </AgentShell>
  );
}
