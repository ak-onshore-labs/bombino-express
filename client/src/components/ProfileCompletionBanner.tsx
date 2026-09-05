import { ArrowRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  listPendingLabels,
  shadowProfileProgress,
  type GuestProfile,
} from '@/lib/shadowProfile';

interface ProfileCompletionBannerProps {
  profile: GuestProfile;
  /** Tapping the body or the arrow. Usually routes to the guest dashboard. */
  onComplete: () => void;
  /** Omit and the close button is not rendered — some placements can't be dismissed. */
  onDismiss?: () => void;
  className?: string;
}

/**
 * A line, not a wall.
 *
 * The guest already got what they came for: the parcel is booked. This says
 * what is still missing and offers the door to fix it — it does not block,
 * does not colour itself red, and does not imply the order is at risk, because
 * it isn't. Amber rather than destructive for that reason.
 *
 * Renders nothing once every field is settled, so a caller can mount it
 * unconditionally and stop reasoning about when to hide it.
 *
 * Placement note: like the account verification banner, this has to sit BELOW
 * the sticky nav rather than above it — TopBar's `below` slot on mobile, under
 * `DesktopTopBar` in `AppLayout`. Mounted at router level it renders above the
 * whole shell and pushes the sidebar down the page.
 */
export function ProfileCompletionBanner({
  profile,
  onComplete,
  onDismiss,
  className,
}: ProfileCompletionBannerProps): React.JSX.Element | null {
  const { pending, completed, total, percent } = shadowProfileProgress(profile);

  if (pending.length === 0) return null;

  return (
    <div
      className={cn(
        'flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-3',
        className
      )}
      role="status"
      data-testid="banner-profile-completion"
    >
      {/* The ring carries the number, so the count is legible before a word is
          read. Progress is drawn with a conic gradient rather than an SVG:
          it is 24px of decoration and does not deserve a second DOM tree. */}
      <div
        className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full"
        style={{
          background: `conic-gradient(rgb(217 119 6) ${percent * 3.6}deg, rgb(253 230 138) 0deg)`,
        }}
        aria-hidden
      >
        <span className="grid h-9 w-9 place-items-center rounded-full bg-amber-50 text-xs font-bold text-amber-800">
          {completed}/{total}
        </span>
      </div>

      <button
        type="button"
        onClick={onComplete}
        className="min-w-0 flex-1 text-left"
        data-testid="button-profile-completion-complete"
      >
        <p className="text-sm font-semibold text-amber-900">
          Your profile is {percent}% complete
        </p>
        {/* Two lines rather than one truncated one. At this size the full list
            no longer fits on a phone, and "Add your full name, email addre…"
            is a sentence that stops before it says anything useful. */}
        <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-amber-900/80">
          Add your {listPendingLabels(pending)} to secure this account.
        </p>
      </button>

      <ArrowRight className="h-5 w-5 shrink-0 text-amber-700" aria-hidden />

      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-mr-1.5 grid h-9 w-9 shrink-0 place-items-center rounded-full text-amber-700 hover:bg-amber-100"
          data-testid="button-profile-completion-dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
