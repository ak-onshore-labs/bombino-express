import { useMemo } from 'react';
import { useLocation, useSearch } from 'wouter';
import { ArrowLeft, MapPin, ExternalLink } from 'lucide-react';
import { BRANCHES, branchMapsUrl, type Branch } from '@shared/branches';
import { cn } from '@/lib/utils';

/**
 * Every counter a parcel can be handed in at.
 *
 * The drop-off card on the booking form and the order screen shows only the
 * branches in the customer's own state — enough to act on, and short. This is
 * where the rest live, for the customer who is posting from one city and
 * travelling to another, or who simply wants to see the whole list before
 * committing.
 *
 * `?near=<state>` floats that state to the top. The card links here with the
 * sender's state already filled in, so arriving from a booking lands on the
 * relevant addresses without a scroll; opening the page cold is just the list.
 */

interface StateGroup {
  state: string;
  branches: Branch[];
}

function groupByState(branches: readonly Branch[]): StateGroup[] {
  const byState = new Map<string, Branch[]>();
  for (const branch of branches) {
    const list = byState.get(branch.state);
    if (list) list.push(branch);
    else byState.set(branch.state, [branch]);
  }

  return Array.from(byState.entries())
    .map(([state, list]) => ({
      state,
      branches: [...list].sort((a, b) => a.pincode.localeCompare(b.pincode)),
    }))
    .sort((a, b) => a.state.localeCompare(b.state));
}

const norm = (value: string): string => value.trim().toLowerCase();

export default function Locations(): React.JSX.Element {
  const [, setLocation] = useLocation();
  const search = useSearch();

  const near = useMemo((): string => {
    return new URLSearchParams(search).get('near')?.trim() ?? '';
  }, [search]);

  const groups = useMemo((): StateGroup[] => {
    const all = groupByState(BRANCHES);
    if (!near) return all;

    // The customer's own state first, the rest in order behind it.
    const mine = all.filter((g) => norm(g.state) === norm(near));
    const rest = all.filter((g) => norm(g.state) !== norm(near));
    return [...mine, ...rest];
  }, [near]);

  const total = BRANCHES.length;

  const goBack = (): void => {
    // Reached from a booking in progress far more often than opened cold, and
    // sending someone back to a half-filled form's start would lose it.
    if (window.history.length > 1) window.history.back();
    else setLocation('/home');
  };

  return (
    <div className="min-h-[100dvh] bg-background safe-top safe-bottom">
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-white/95 px-4 py-3 backdrop-blur-sm">
        <button
          onClick={goBack}
          className="rounded-lg p-1 transition-colors hover:bg-gray-100"
          aria-label="Go back"
          data-testid="button-locations-back"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-lg font-semibold">Drop-off locations</h1>
      </div>

      <div className="mx-auto max-w-2xl px-4 py-5">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Hand your parcel in at any of our {total} branches. Bring the parcel unsealed —
          we weigh and pack it at the counter — along with your handover code.
        </p>

        <div className="mt-5 space-y-6">
          {groups.map((group, index) => {
            const isNear = near !== '' && index === 0 && norm(group.state) === norm(near);

            return (
              <section key={group.state} data-testid={`group-state-${group.state}`}>
                <div className="flex items-baseline gap-2">
                  <h2 className="text-sm font-semibold text-foreground">{group.state}</h2>
                  {isNear && (
                    <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                      Closest to you
                    </span>
                  )}
                </div>

                <ul className="mt-2 space-y-2">
                  {group.branches.map((branch) => (
                    <li
                      key={branch.pincode}
                      className={cn(
                        'rounded-lg border p-3',
                        isNear ? 'border-primary/30 bg-primary/5' : 'border-border bg-muted/30'
                      )}
                    >
                      <div className="flex gap-2">
                        <MapPin
                          className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                          aria-hidden="true"
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground">{branch.city}</p>
                          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                            {branch.address}
                          </p>
                          <a
                            href={branchMapsUrl(branch)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline"
                            data-testid={`link-locations-directions-${branch.pincode}`}
                          >
                            Directions
                            <ExternalLink className="h-3 w-3" aria-hidden="true" />
                          </a>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>

        <p className="mt-6 text-[11px] leading-relaxed text-muted-foreground">
          Doorstep pickup is a separate thing — we collect from selected pincodes in a handful
          of cities. The booking form tells you whether yours is one of them.
        </p>
      </div>
    </div>
  );
}
