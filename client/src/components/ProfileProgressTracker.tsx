import { useState } from 'react';
import { Check, ChevronDown, Loader2, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  SHADOW_STATUS_META,
  formatGuestPhone,
  shadowProfileProgress,
  type GuestProfile,
  type ShadowProfileFieldState,
} from '@/lib/shadowProfile';

interface ProfileProgressTrackerProps {
  profile: GuestProfile;
  /**
   * Rendered under the list, inside the same card.
   *
   * The action belongs where the gaps are listed. A separate card underneath
   * repeated the same sentence in different words and made the screen look
   * like it had two asks rather than one.
   */
  footer?: React.ReactNode;
  className?: string;
}

/**
 * Who this guest is, and what is still outstanding.
 *
 * One card, not two. The screen used to open with an identity card holding a
 * name and a number, then repeat both inside a completion card directly under
 * it — the same two facts, twice, before anything useful was said.
 *
 * What is LEFT leads. It carried three indicators of the same thing (a
 * percentage, a fraction, a segmented bar) and a chip counting the gaps, all
 * shouting above the button that closes them. A customer wants to know what is
 * missing and how to fix it; the arithmetic is a detail.
 *
 * Answered rows fold away. Four green ticks are a wall to scroll past on the
 * way to the two rows that need work, and the reassurance they carry is worth
 * one line, not four.
 */
export function ProfileProgressTracker({
  profile,
  footer,
  className,
}: ProfileProgressTrackerProps): React.JSX.Element {
  const { fields, completed, total, pending } = shadowProfileProgress(profile);
  const done = fields.filter((field) => field.status !== 'pending');
  const [showDone, setShowDone] = useState(false);

  return (
    <section
      className={cn('overflow-hidden rounded-2xl border border-border bg-card shadow-sm', className)}
      aria-label="Your profile"
      data-testid="profile-progress-tracker"
    >
      {/* Identity, stated once and only here. */}
      <div className="flex items-center gap-3 border-b border-border p-4">
        <span
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-bold text-primary"
          aria-hidden
        >
          {initials(profile.full_name) || <ShieldCheck className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-foreground">
            {profile.full_name?.trim() || 'Guest'}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
            <ShieldCheck className="h-4 w-4 shrink-0 text-green-600" aria-label="Verified" />
            <span className="truncate">{formatGuestPhone(profile.phone)}</span>
          </p>
        </div>
      </div>

      <div className="p-4">
        {/* The count, then the bar. One number, not three. */}
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-semibold text-foreground">
            {pending.length === 0
              ? 'Everything on file'
              : pending.length === 1
                ? '1 thing left'
                : `${pending.length} things left`}
          </p>
          <p className="shrink-0 text-xs text-muted-foreground" data-testid="text-profile-percent">
            {completed} of {total}
          </p>
        </div>

        <div
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={completed}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-label="Profile completion"
        >
          <div
            className="h-full rounded-full bg-green-500 transition-[width] duration-300"
            style={{ width: `${total === 0 ? 0 : (completed / total) * 100}%` }}
          />
        </div>

        {/* Outstanding first, and on their own. */}
        {pending.length > 0 && (
          <ul className="mt-4 space-y-3">
            {pending.map((field) => (
              <PendingRow key={field.spec.key} field={field} />
            ))}
          </ul>
        )}

        {done.length > 0 && (
          <div className={cn(pending.length > 0 && 'mt-4 border-t border-border pt-3')}>
            <button
              type="button"
              onClick={() => setShowDone((open) => !open)}
              className="flex w-full items-center justify-between gap-2 text-left"
              aria-expanded={showDone}
              data-testid="button-toggle-completed"
            >
              <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Check className="h-3.5 w-3.5 shrink-0 text-green-600" aria-hidden />
                {done.length} already on file
              </span>
              <ChevronDown
                className={cn(
                  'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                  showDone && 'rotate-180'
                )}
                aria-hidden
              />
            </button>

            {showDone && (
              <ul className="mt-3 space-y-2.5" data-testid="list-completed-fields">
                {done.map((field) => (
                  <li key={field.spec.key} className="flex items-start gap-2.5">
                    <span
                      className={cn(
                        'mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full',
                        field.status === 'in_review'
                          ? 'bg-blue-100 text-blue-600'
                          : 'bg-green-100 text-green-700'
                      )}
                      aria-hidden
                    >
                      {field.status === 'in_review' ? (
                        <Loader2 className="h-2.5 w-2.5 animate-spin" />
                      ) : (
                        <Check className="h-2.5 w-2.5" strokeWidth={3.5} />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="text-xs text-muted-foreground">{field.spec.label}</span>
                      <span className="mt-0.5 block truncate text-sm text-foreground">
                        {field.value}
                      </span>
                    </span>
                    {field.status === 'in_review' && (
                      <span
                        className={cn(
                          'shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                          SHADOW_STATUS_META.in_review.badge
                        )}
                      >
                        {SHADOW_STATUS_META.in_review.label}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {footer && <div className="mt-4 border-t border-border pt-4">{footer}</div>}
      </div>
    </section>
  );
}

/** One outstanding item: what it is, and why it is wanted. */
function PendingRow({ field }: { field: ShadowProfileFieldState }): React.JSX.Element {
  const Icon = field.spec.icon;
  return (
    <li className="flex items-start gap-3" data-testid={`pending-${field.spec.key}`}>
      <span
        className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-amber-50 text-amber-700"
        aria-hidden
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">{field.spec.label}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
          {field.spec.pendingHint}
        </span>
      </span>
    </li>
  );
}

/** Two letters at most. A monogram, not a name badly abbreviated. */
function initials(name: string | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  const letters = parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0];
  return letters.toUpperCase();
}
