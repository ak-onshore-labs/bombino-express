import { Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  SHADOW_STATUS_META,
  shadowProfileProgress,
  type GuestProfile,
  type ShadowProfileFieldState,
} from '@/lib/shadowProfile';

interface ProfileProgressTrackerProps {
  profile: GuestProfile;
  /**
   * Rendered under the rail, inside the same card.
   *
   * The action belongs where the gaps are listed. A separate card underneath
   * repeated the same sentence in different words and made the screen look
   * like it had two asks rather than one.
   */
  footer?: React.ReactNode;
  className?: string;
}

/**
 * How far along a shadow profile is, as one rail of four stops.
 *
 * Segmented rather than a single sliding bar, deliberately: the point is not
 * "you are 25% of the way there" in the abstract, it is "this one is done and
 * these three are not", and a segment maps one-to-one onto a field below.
 * The percentage is still printed, because a number is what people quote back.
 */
export function ProfileProgressTracker({
  profile,
  footer,
  className,
}: ProfileProgressTrackerProps): React.JSX.Element {
  const { fields, completed, total, percent, pending } = shadowProfileProgress(profile);

  return (
    <section
      className={cn('rounded-xl border border-border bg-card p-4 shadow-sm', className)}
      aria-label="Profile completion"
      data-testid="profile-progress-tracker"
    >
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Profile strength
          </p>
          <p className="mt-1 text-sm text-foreground">
            <span className="text-2xl font-bold leading-none" data-testid="text-profile-percent">
              {percent}%
            </span>
            <span className="ml-2 text-xs text-muted-foreground">
              {completed} of {total} complete
            </span>
          </p>
        </div>
        {pending.length > 0 && (
          <span
            className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-medium text-amber-700"
            data-testid="badge-profile-pending-count"
          >
            {pending.length} pending
          </span>
        )}
      </div>

      {/* One segment per field, in the same order as the list below. */}
      <div className="mt-3 flex gap-1.5" role="presentation">
        {fields.map((field) => (
          <div
            key={field.spec.key}
            className={cn(
              'h-1.5 flex-1 rounded-full transition-colors',
              field.status === 'verified' && 'bg-green-500',
              field.status === 'provided' && 'bg-slate-400',
              field.status === 'in_review' && 'bg-blue-400',
              field.status === 'pending' && 'bg-muted'
            )}
            data-testid={`segment-progress-${field.spec.key}`}
          />
        ))}
      </div>

      <ol className="mt-4 space-y-0">
        {fields.map((field, i) => (
          <TrackerStop
            key={field.spec.key}
            field={field}
            isLast={i === fields.length - 1}
          />
        ))}
      </ol>

      {footer && <div className="mt-4 border-t border-border pt-4">{footer}</div>}
    </section>
  );
}

/**
 * One stop on the rail. The connector is drawn only between stops, and takes
 * the colour of the stop above it, so a finished run reads as one green line
 * that stops exactly where the work stops.
 */
function TrackerStop({
  field,
  isLast,
}: {
  field: ShadowProfileFieldState;
  isLast: boolean;
}): React.JSX.Element {
  const settled = field.status !== 'pending';
  const meta = SHADOW_STATUS_META[field.status];

  return (
    <li className="flex gap-3" data-testid={`tracker-stop-${field.spec.key}`}>
      <div className="flex flex-col items-center">
        <span
          className={cn(
            'grid h-6 w-6 shrink-0 place-items-center rounded-full border-2',
            field.status === 'verified' && 'border-green-500 bg-green-500 text-white',
            field.status === 'provided' && 'border-slate-400 bg-slate-400 text-white',
            field.status === 'in_review' && 'border-blue-400 bg-blue-50 text-blue-600',
            field.status === 'pending' && 'border-dashed border-border bg-background'
          )}
          aria-hidden
        >
          {(field.status === 'verified' || field.status === 'provided') && (
            <Check className="h-3.5 w-3.5" strokeWidth={3} />
          )}
          {field.status === 'in_review' && <Loader2 className="h-3 w-3 animate-spin" />}
        </span>
        {!isLast && (
          <span
            className={cn(
              'w-0.5 flex-1',
              field.status === 'verified' && 'bg-green-200',
              field.status === 'provided' && 'bg-slate-200',
              (field.status === 'in_review' || field.status === 'pending') && 'bg-border'
            )}
            aria-hidden
          />
        )}
      </div>

      <div className={cn('min-w-0 flex-1', isLast ? 'pb-0' : 'pb-4')}>
        <div className="flex items-center gap-2">
          <p
            className={cn(
              'truncate text-sm font-medium',
              settled ? 'text-foreground' : 'text-muted-foreground'
            )}
          >
            {field.spec.label}
          </p>
          <span
            className={cn(
              'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold',
              meta.badge
            )}
          >
            {meta.label}
          </span>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {field.value ?? field.spec.pendingHint}
        </p>
      </div>
    </li>
  );
}
