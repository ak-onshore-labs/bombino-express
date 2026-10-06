import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Sheet, SheetContent } from '@/components/ui/sheet';

/**
 * Hub weigh input — actual kg, with booked weight shown for reference.
 */
export function OpsWeighSheet({
  open,
  onOpenChange,
  bookedWeight,
  onConfirm,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bookedWeight: number | null;
  onConfirm: (payload: { actual_weight: number }) => void;
  isPending: boolean;
}) {
  const [weight, setWeight] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setWeight('');
      setError('');
    }
  }, [open]);

  const submit = (): void => {
    const value = Number(weight);
    if (!Number.isFinite(value) || value <= 0) {
      setError('Enter the actual weight in kg');
      return;
    }
    setError('');
    onConfirm({ actual_weight: value });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-[20px] border-t-0 px-5 pb-8 pt-3"
        data-testid="sheet-ops-weigh"
      >
        <div className="mx-auto w-10 h-1 rounded-full bg-border mb-5" aria-hidden />
        <p className="text-[11px] uppercase tracking-[0.12em] font-bold text-muted-foreground">
          Weigh parcel
        </p>
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
          placeholder="0.00"
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
          onClick={submit}
          disabled={isPending}
          className="w-full h-14 rounded-md bg-primary text-white text-base font-bold active:scale-[0.98] transition-transform disabled:opacity-60 grid place-items-center"
          data-testid="button-confirm-weigh"
        >
          {isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Confirm weight'}
        </button>
      </SheetContent>
    </Sheet>
  );
}
