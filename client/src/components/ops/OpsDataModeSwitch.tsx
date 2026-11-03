import { useOpsSetDataMode, useOpsTestAccess } from '@/hooks/useOpsOrders';
import { parseApiErrorMessage } from '@/lib/apiError';
import { cn } from '@/lib/utils';

/**
 * Test data or live data, for staff signed in on a test number
 * (server/testOrders.ts). Test shows only test orders and accounts; live shows
 * only real ones, exactly as the real team sees them. Nobody else sees this.
 */
export function OpsDataModeSwitch() {
  const access = useOpsTestAccess().data;
  const setMode = useOpsSetDataMode();
  if (!access?.test_staff) return null;

  const live = !access.sees_test;
  const options = [
    { mode: 'test', label: 'Test data', active: !live },
    { mode: 'live', label: 'Live data', active: live },
  ] as const;

  return (
    <div
      className={cn(
        'mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md border px-3 py-2',
        live ? 'border-amber-300 bg-amber-50' : 'border-dashed border-[#C62828]/40 bg-white'
      )}
      data-testid="ops-data-mode"
    >
      <p className="text-xs font-medium text-muted-foreground">
        {live
          ? 'Real customers and orders. Anything you change here is real.'
          : 'Only test orders and test accounts.'}
      </p>
      <div role="radiogroup" aria-label="Data shown" className="inline-flex rounded-md bg-muted p-0.5">
        {options.map((o) => (
          <button
            key={o.mode}
            type="button"
            role="radio"
            aria-checked={o.active}
            disabled={setMode.isPending}
            onClick={() => {
              if (!o.active) setMode.mutate(o.mode);
            }}
            className={cn(
              'rounded px-3 py-1 text-xs font-semibold transition-colors disabled:opacity-60',
              o.active
                ? o.mode === 'live'
                  ? 'bg-amber-500 text-white shadow-sm'
                  : 'bg-[#C62828] text-white shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
            data-testid={`button-ops-data-mode-${o.mode}`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {setMode.isError && (
        <p className="w-full text-xs font-semibold text-red-600">
          {parseApiErrorMessage(setMode.error, 'Could not switch. Please try again.')}
        </p>
      )}
    </div>
  );
}
