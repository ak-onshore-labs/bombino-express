import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

/** Codes are four digits, and the field takes exactly four. */
const OTP_LENGTH = 4;

/**
 * Drop-off receipt OTP — the customer reads their code, ops types it.
 * Ops-styled twin of the weigh sheet; digit rules copied from the agent OTP
 * sheet, not imported from it.
 */
export function OpsDropoffOtpSheet({
  open,
  onOpenChange,
  onConfirm,
  isPending,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (payload: { otp: string }) => void;
  isPending: boolean;
  error: string | null;
}) {
  const [otp, setOtp] = useState('');

  useEffect(() => {
    if (open) {
      setOtp('');
    }
  }, [open]);

  const complete = otp.length === OTP_LENGTH;

  const submit = (): void => {
    if (!complete || isPending) return;
    onConfirm({ otp });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-[20px] border-t-0 px-5 pb-8 pt-3"
        data-testid="sheet-ops-dropoff-otp"
      >
        <div className="mx-auto w-10 h-1 rounded-full bg-border mb-5" aria-hidden />
        <p className="text-[11px] uppercase tracking-[0.12em] font-bold text-muted-foreground">
          Ask the customer for their drop-off code
        </p>
        <p className="text-sm text-muted-foreground mt-1 mb-5">
          Enter the code from the customer's app
        </p>

        <label
          htmlFor="ops-dropoff-otp"
          className="block text-[11px] uppercase tracking-[0.12em] font-bold text-muted-foreground mb-2"
        >
          Drop-off code
        </label>
        <input
          id="ops-dropoff-otp"
          value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, OTP_LENGTH))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="————"
          className={cn(
            'w-full h-16 rounded-xl border-2 bg-white px-4 outline-none text-center text-2xl font-extrabold tabular-nums tracking-[0.3em] focus:border-primary transition-colors mb-3',
            error ? 'border-red-600' : 'border-border',
          )}
          data-testid="input-ops-dropoff-otp"
        />

        {error && (
          <p className="text-sm font-semibold text-red-600 mb-3" data-testid="error-ops-dropoff-otp">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={!complete || isPending}
          className="w-full h-14 rounded-xl bg-primary text-white text-base font-bold active:scale-[0.98] transition-transform disabled:opacity-60 grid place-items-center"
          data-testid="button-confirm-dropoff-otp"
        >
          {isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Mark received'}
        </button>
      </SheetContent>
    </Sheet>
  );
}
