import { cn } from '@/lib/utils';

/**
 * Marks a test order or test account (shared/testOrders.ts). Only test staff, signed
 * in on a test number, ever see one.
 */
export function TestBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full bg-[#C62828] px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none tracking-wide text-white',
        className
      )}
      title="Test order: booked on a test number. Its AWB is a test AWB and nothing went to ITD."
      data-testid="ops-test-badge"
    >
      Test
    </span>
  );
}
