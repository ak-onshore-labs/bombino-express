import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { apiRequest } from '@/lib/queryClient';
import { parseApiErrorMessage } from '@/lib/apiError';
import { formatInr } from '@/lib/orderDetail';

/** The server's price at a weight, before anything is saved. */
interface WeighPreview {
  actual_weight: number;
  booked_weight: number | null;
  quoted_amount: number | null;
  final_amount: number;
  delta: number | null;
}

const money = (value: number | null | undefined): string => formatInr(value) ?? '—';

/**
 * Hub weigh, in two steps: enter the weight, then review the new price and
 * confirm it once.
 *
 * Confirming is final. The order moves on, the price is set and the customer
 * is sent the amount due or refund on WhatsApp, and there is no reweigh. So
 * the review shows exactly that, and "Edit weight" goes back with the number
 * still in the box.
 */
export function OpsWeighSheet({
  open,
  onOpenChange,
  orderId,
  bookedWeight,
  onConfirm,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  bookedWeight: number | null;
  onConfirm: (payload: { actual_weight: number }) => void;
  isPending: boolean;
}) {
  const [weight, setWeight] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<WeighPreview | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (open) {
      setWeight('');
      setError('');
      setPreview(null);
      setChecking(false);
    }
  }, [open]);

  const review = async (): Promise<void> => {
    const value = Number(weight);
    if (!Number.isFinite(value) || value <= 0) {
      setError('Enter the actual weight in kg');
      return;
    }
    setError('');
    setChecking(true);
    try {
      const res = await apiRequest('POST', `/api/orders/${orderId}/weigh-preview`, {
        actual_weight: value,
      });
      setPreview((await res.json()) as WeighPreview);
    } catch (err) {
      setError(parseApiErrorMessage(err, "Couldn't work out the new price. Try again."));
    } finally {
      setChecking(false);
    }
  };

  const delta = preview?.delta ?? null;
  const roundedDelta = delta === null ? null : Math.round(delta);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-[20px] border-t-0 px-5 pb-8 pt-3"
        data-testid="sheet-ops-weigh"
      >
        <div className="mx-auto w-10 h-1 rounded-full bg-border mb-5" aria-hidden />
        <p className="text-[11px] uppercase tracking-[0.12em] font-bold text-muted-foreground">
          {preview ? 'Check and confirm' : 'Weigh parcel'}
        </p>

        {!preview ? (
          <>
            <p className="text-sm text-muted-foreground mt-1 mb-5">
              Booked{' '}
              <span className="font-semibold text-foreground tabular-nums">
                {bookedWeight != null ? `${bookedWeight} kg` : '—'}
              </span>
            </p>

            <label
              htmlFor="ops-actual-weight"
              className="block text-[11px] uppercase tracking-[0.12em] font-bold text-muted-foreground mb-2"
            >
              Actual weight (kg)
            </label>
            <input
              id="ops-actual-weight"
              inputMode="decimal"
              value={weight}
              onChange={(e) => {
                setWeight(e.target.value);
                if (error) setError('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void review();
              }}
              placeholder="0.00"
              autoFocus
              className="w-full rounded-md border-2 border-border bg-white px-4 h-14 outline-none text-2xl font-extrabold tabular-nums focus:border-primary transition-colors mb-3"
              data-testid="input-ops-actual-weight"
            />

            {error && (
              <p className="text-sm font-semibold text-red-600 mb-3" data-testid="error-ops-weigh">
                {error}
              </p>
            )}

            <button
              type="button"
              onClick={() => void review()}
              disabled={checking}
              className="w-full h-14 rounded-md bg-primary text-white text-base font-bold active:scale-[0.98] transition-transform disabled:opacity-60 grid place-items-center"
              data-testid="button-review-weigh"
            >
              {checking ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Review'}
            </button>
          </>
        ) : (
          <>
            <dl className="mt-4 grid grid-cols-[auto_1fr_auto_1fr] items-baseline gap-x-3 gap-y-3 text-sm">
              <dt className="text-muted-foreground">Weight</dt>
              <dd className="tabular-nums text-muted-foreground">
                {preview.booked_weight != null ? `${preview.booked_weight} kg` : '—'}
              </dd>
              <dd className="text-muted-foreground" aria-hidden>→</dd>
              <dd className="tabular-nums text-xl font-extrabold text-foreground" data-testid="text-weigh-actual">
                {preview.actual_weight} kg
              </dd>

              <dt className="text-muted-foreground">Price</dt>
              <dd className="tabular-nums text-muted-foreground">{money(preview.quoted_amount)}</dd>
              <dd className="text-muted-foreground" aria-hidden>→</dd>
              <dd className="tabular-nums text-xl font-extrabold text-foreground" data-testid="text-weigh-final">
                {money(preview.final_amount)}
              </dd>
            </dl>

            <p
              className={
                'mt-4 rounded-md px-3 py-2.5 text-sm font-semibold ' +
                (roundedDelta && roundedDelta > 0
                  ? 'bg-amber-50 text-amber-900'
                  : roundedDelta && roundedDelta < 0
                    ? 'bg-sky-50 text-sky-900'
                    : 'bg-muted text-foreground')
              }
              data-testid="text-weigh-outcome"
            >
              {roundedDelta === null
                ? 'No booked price to compare with.'
                : roundedDelta > 0
                  ? `Customer owes ${money(roundedDelta)} more. They'll get a WhatsApp asking them to pay.`
                  : roundedDelta < 0
                    ? `Refund of ${money(Math.abs(roundedDelta))} due. The customer will get a WhatsApp about it.`
                    : 'No change to the price. Nothing is sent to the customer.'}
            </p>

            <p className="mt-3 text-xs text-muted-foreground">
              You can't change the weight after confirming.
            </p>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setPreview(null)}
                disabled={isPending}
                className="h-14 rounded-md border-2 border-border bg-white text-base font-bold text-foreground disabled:opacity-60"
                data-testid="button-edit-weigh"
              >
                Edit weight
              </button>
              <button
                type="button"
                onClick={() => onConfirm({ actual_weight: preview.actual_weight })}
                disabled={isPending}
                className="h-14 rounded-md bg-primary text-white text-base font-bold active:scale-[0.98] transition-transform disabled:opacity-60 grid place-items-center"
                data-testid="button-confirm-weigh"
              >
                {isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : `Confirm ${preview.actual_weight} kg`}
              </button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
