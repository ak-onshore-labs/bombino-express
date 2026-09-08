import { Loader2, Wallet, CreditCard, Smartphone } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AgentShell } from '@/components/agent/AgentShell';
import { BandHeader } from '@/components/agent/BandHeader';
import { JobCard, money } from '@/components/agent/PickupCard';
import { StaggerItem } from '@/components/motion/Stagger';
import { useCollections } from '@/hooks/useAgentPickups';

/**
 * What the agent is carrying, and where it came from.
 *
 * One amber field with the cash figure at 50px and one line saying what to do
 * with it, then the day's takings as a plain ledger. The UPI-vs-cash split, the
 * collection count and the transaction ids are gone: only the cash is
 * physically in the bag, and only the order number is what anyone asks about on
 * the phone.
 */

/** `9:12 AM` — the time the money changed hands, nothing more precise. */
function formatTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export default function Collections() {
  const { data, isLoading, isError, refetch } = useCollections();

  return (
    <AgentShell title="Money" meta="Today">
      {isLoading && (
        <div className="flex items-center justify-center gap-2.5 py-20 text-[#64748B]">
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
            data-testid="button-retry-collections"
          >
            Try again
          </button>
        </JobCard>
      )}

      {data && (
        <>
          {/* Two blocks, not the rows inside them: the collections are
              hairlined into one panel, and lifting each row separately reads as
              the panel coming apart rather than arriving. */}
          <StaggerItem index={0} className="bg-[#F2A123] p-5" data-testid="field-cash-with-you">
            <span className="flex items-center gap-2.5">
              <Wallet className="w-[21px] h-[21px] text-[#1B2A41]" strokeWidth={1.5} />
              <span className="text-[13px] font-bold uppercase tracking-[0.1em] text-[#1B2A41]">
                Cash with you
              </span>
            </span>
            <p className="text-[50px] font-bold leading-none tracking-[-0.02em] text-[#1B2A41] mt-3">
              ₹{money(data.totals.cash)}
            </p>
            <p className="text-sm font-bold uppercase tracking-[0.06em] text-[#1B2A41] mt-[18px] pt-4 border-t border-[#1B2A41]/[0.28]!">
              Give to hub today
            </p>
          </StaggerItem>

          <StaggerItem index={1}>
            <section>
              <BandHeader label="Taken today" testId="band-taken-today" />
              <JobCard>
                {data.collections.length === 0 ? (
                  <p className="px-4 py-6 text-[17px] font-medium text-[#334155]">No money yet.</p>
                ) : (
                  data.collections.map((c, i) => {
                    const Icon = c.collection_mode === 'cash' ? CreditCard : Smartphone;

                    return (
                      <div
                        key={c.id}
                        className={cn(
                          'flex items-center gap-3 p-4',
                          i < data.collections.length - 1 && 'border-b border-[#E8EDF2]!',
                        )}
                        data-testid={`collection-${c.order_no ?? c.id}`}
                      >
                        <span className="flex-1 min-w-0">
                          <span className="block text-[19px] font-bold tracking-[0.02em] text-[#1B2A41] truncate">
                            {c.order_no ?? '—'}
                          </span>
                          <span className="flex items-center gap-2 mt-[7px]">
                            <Icon
                              className="w-[17px] h-[17px] shrink-0 text-[#94A3B8]"
                              strokeWidth={1.5}
                            />
                            <span className="text-[15px] font-medium text-[#64748B] truncate">
                              {c.collection_mode === 'cash' ? 'Cash' : 'UPI'} ·{' '}
                              {formatTime(c.collected_at)}
                            </span>
                          </span>
                        </span>
                        <span className="shrink-0 text-[21px] font-bold text-[#1B2A41]">
                          ₹{money(c.amount)}
                        </span>
                      </div>
                    );
                  })
                )}
              </JobCard>
            </section>
          </StaggerItem>
        </>
      )}
    </AgentShell>
  );
}
