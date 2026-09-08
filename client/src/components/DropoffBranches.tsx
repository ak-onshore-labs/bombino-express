import React from 'react';
import { Link } from 'wouter';
import { MapPin, ExternalLink, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { dropoffBranchesFor, branchMapsUrl, BRANCHES } from '@shared/branches';

interface DropoffBranchesProps {
  /** Sender pincode, and the city/state the lookup filled in beside it. */
  pincode: string | null | undefined;
  city?: string | null;
  state?: string | null;
  /** Heading above the list. */
  title?: string;
  className?: string;
}

/**
 * The counters a customer can hand a parcel in at, given where they are.
 *
 * Where a state has more than one counter the customer sees all of them, own
 * city first. Two Gujarat addresses is a choice; one wrong one is a wasted
 * trip. See `shared/branches.ts` for why this is not a nearest-branch sort.
 *
 * With no branch in the customer's state we drop the list and keep the link to
 * `/locations`: naming the state's absence helps nobody, but someone posting
 * from a state we do not cover is precisely who needs the full set.
 */
export function DropoffBranches({
  pincode,
  city,
  state,
  title = 'Where to drop it off',
  className,
}: DropoffBranchesProps): React.JSX.Element {
  const branches = dropoffBranchesFor(pincode, city, state);

  // No branch in reach is exactly when the whole list is worth offering, so a
  // blank result still renders — as the link on its own, without the heading.
  const allHref = state?.trim()
    ? `/locations?near=${encodeURIComponent(state.trim())}`
    : '/locations';

  const seeAll = (
    <Link
      href={allHref}
      className="inline-flex items-center gap-0.5 text-[11px] font-medium text-primary underline-offset-2 hover:underline"
      data-testid="link-all-dropoff-locations"
    >
      {branches.length > 0
        ? `See all ${BRANCHES.length} locations`
        : `See our ${BRANCHES.length} drop-off locations`}
      <ChevronRight className="h-3 w-3" aria-hidden="true" />
    </Link>
  );

  if (branches.length === 0) {
    return <div className={cn('mt-3', className)}>{seeAll}</div>;
  }

  return (
    <div className={cn('mt-3 rounded-lg border border-border bg-muted/40 p-3', className)}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>

      <ul className="mt-2 space-y-2.5" data-testid="list-dropoff-branches">
        {branches.map((branch) => (
          <li key={branch.pincode} className="flex gap-2">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-foreground">{branch.city}</p>
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                {branch.address}
              </p>
              <a
                href={branchMapsUrl(branch)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-primary underline-offset-2 hover:underline"
                data-testid={`link-directions-${branch.pincode}`}
              >
                Directions
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            </div>
          </li>
        ))}
      </ul>

      {branches.length > 1 && (
        <p className="mt-2.5 text-[11px] leading-snug text-muted-foreground">
          Any of these will do — pick whichever is easiest to reach.
        </p>
      )}

      <div className="mt-2.5 border-t border-border/60 pt-2.5">{seeAll}</div>
    </div>
  );
}
