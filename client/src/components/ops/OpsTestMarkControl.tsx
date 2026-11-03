import { Switch } from '@/components/ui/switch';
import { useOpsSetTestMark } from '@/hooks/useOpsOrders';
import { parseApiErrorMessage } from '@/lib/apiError';

/**
 * Mark an order test or real by hand. Shown only to the accounts the server
 * allows (TEST_ORDER_MARKER_PHONES in server/testOrders.ts).
 *
 * A test order is hidden from the team; marking one real shows it to them and
 * takes off its test AWB. A real ITD AWB stays whichever way it is marked.
 */
export function OpsTestMarkControl({
  orderId,
  isTest,
  awbNo,
}: {
  orderId: string;
  isTest: boolean;
  awbNo: string | null;
}) {
  const setMark = useOpsSetTestMark(orderId);
  const hasTestAwb = !!awbNo && /^TEST/i.test(awbNo);

  return (
    <section
      className="mb-4 rounded-md border border-dashed border-[#C62828]/40 bg-white p-4"
      data-testid="ops-order-test-mark"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-foreground">Test order</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isTest
              ? hasTestAwb
                ? `Hidden from the team. Turning this off shows it to them and removes test AWB ${awbNo}.`
                : 'Hidden from the team. Turning this off shows it to them.'
              : 'Shown to the team. Turning this on hides it from them.'}
          </p>
          {awbNo && !hasTestAwb && (
            <p className="text-xs text-muted-foreground mt-1">
              AWB {awbNo} is a real ITD shipment and stays either way.
            </p>
          )}
        </div>
        <Switch
          checked={isTest}
          disabled={setMark.isPending}
          onCheckedChange={(test) => setMark.mutate(test)}
          aria-label="Test order"
          data-testid="switch-ops-order-test"
        />
      </div>
      {setMark.isError && (
        <p className="text-sm font-semibold text-red-600 mt-3">
          {parseApiErrorMessage(setMark.error, 'Could not change this order')}
        </p>
      )}
    </section>
  );
}
