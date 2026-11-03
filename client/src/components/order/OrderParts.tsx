/**
 * Pieces shared by the customer's order screen and the public parcel page
 * (`/p/:token`), so the two read as one product: the progress bar, the
 * order-number / AWB cells, and plain label/value rows.
 */

import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';

export const NAVY = 'lab(34.0831 -9.57756 -27.7093)';

// ─── Progress ───────────────────────────────────────────────────────────────

export const HUB_STATUSES = new Set(['received_at_hub', 'weighed', 'settled', 'ready_for_docket']);

/**
 * The steps the customer can see, and which one they are on.
 *
 * The hub phase is one step on purpose, same reasoning as the status phrase
 * (see `getCustomerStatusLabel`): weighed/settled/ready are ours, not theirs.
 * A drop-off has no separate "collected": handing it in IS reaching the hub.
 */
export function progressFor(
  status: string,
  isPickup: boolean,
  delivered: boolean
): { steps: string[]; current: number } {
  const steps = isPickup
    ? ['Booked', 'Collected', 'At hub', 'Shipped', 'Delivered']
    : ['Booked', 'At hub', 'Shipped', 'Delivered'];
  const last = steps.length - 1;

  let current = 0;
  if (status === 'dispatched') current = delivered ? last : last - 1;
  else if (HUB_STATUSES.has(status)) current = isPickup ? 2 : 1;
  else if (status === 'picked_up') current = 1;

  return { steps, current };
}

/** Segmented bar: done segments navy, the current one amber, the rest grey. */
export function ProgressBar({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol
      className="grid gap-1.5"
      style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
      aria-label={`Step ${current + 1} of ${steps.length}: ${steps[current]}`}
      data-testid="order-progress"
    >
      {steps.map((label, i) => (
        <li key={label} aria-current={i === current ? 'step' : undefined}>
          <span
            className={cn(
              'block h-1 rounded-full transition-colors duration-200',
              i < current && 'bg-[lab(34.0831_-9.57756_-27.7093)]',
              i === current && 'bg-[#F2A123]',
              i > current && 'bg-[#E2E8F0]'
            )}
            aria-hidden
          />
          <span
            className={cn(
              'mt-1.5 block text-[11px] leading-tight truncate',
              i === current
                ? 'font-semibold text-foreground'
                : i < current
                  ? 'text-foreground/70'
                  : 'text-muted-foreground'
            )}
          >
            {label}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * One identifier: label, the number large, and the whole cell is the copy
 * button, so the target is the size of the thing being copied.
 */
export function IdCell({
  label,
  value,
  mono = false,
  copied,
  onCopy,
  testId,
  valueTestId,
}: {
  label: string;
  value: string;
  mono?: boolean;
  copied: boolean;
  onCopy: (v: string) => void;
  testId: string;
  valueTestId: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onCopy(value)}
      className="group min-w-0 px-4 py-3 text-left transition-colors hover:bg-[#F8F9FA] active:bg-[#F3F4F6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2F4468]/40"
      aria-label={copied ? `${label} copied` : `Copy ${label} ${value}`}
      data-testid={testId}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold tracking-[0.09em] uppercase text-muted-foreground truncate">
          {label}
        </span>
        {copied ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-green-700 shrink-0">
            <Check className="w-3.5 h-3.5" aria-hidden />
            Copied
          </span>
        ) : (
          <Copy
            className="w-3.5 h-3.5 shrink-0 text-muted-foreground/70 group-hover:text-foreground transition-colors"
            aria-hidden
          />
        )}
      </span>
      <span
        className={cn(
          'mt-1 block text-[17px] md:text-[19px] font-bold leading-tight tabular-nums break-all',
          mono ? 'font-mono tracking-tight' : 'tracking-tight'
        )}
        style={{ color: NAVY }}
        data-testid={valueTestId}
      >
        {value}
      </span>
    </button>
  );
}

/** Label left, value right. Renders nothing when the value is empty. */
export function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-sm text-muted-foreground shrink-0">{label}</dt>
      <dd className="text-sm text-foreground text-right break-words min-w-0 whitespace-pre-line">
        {value}
      </dd>
    </div>
  );
}

export function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <h3 className="text-[11px] font-semibold tracking-[0.09em] uppercase text-muted-foreground">
        {title}
      </h3>
      <dl className="mt-1 divide-y divide-[#E2E8F0]">{children}</dl>
    </div>
  );
}
