import { useEffect, useRef, useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { AGENT_SHEET_MOTION } from '@/lib/motion';
import { PressableButton } from '@/components/motion/Pressable';
import { type AgentPickup } from '@/hooks/useAgentPickups';

/**
 * A four-digit code somebody else is holding, typed in by the agent.
 *
 * Two handovers use this sheet, at the two ends of a job:
 *
 *   pickup — the customer's code, on their screen, read out at their door
 *   hub    — the hub's code, on the ops console, read out at the counter
 *
 * Neither number appears anywhere in the agent app, and that is the point: a
 * verifier who could read the code is not being tested by it. Typing it is the
 * proof the agent was standing in front of the other party.
 *
 * Same square-cornered, no-handle treatment as the payment sheet: a form to be
 * filled and confirmed, not a panel to flick away. Digits are set large and
 * mono because they are entered on a doorstep, one-handed, often in sunlight.
 *
 * The server owns every rule about the code — how many attempts remain, whether
 * it is locked. This shows what the server said and does not second-guess it;
 * an attempts counter maintained on the phone would be wrong the moment two
 * devices tried.
 */

/**
 * A code is four digits, and the field takes exactly four.
 *
 * It briefly took six as well, for codes minted before the change. The server
 * no longer accepts those, so a field that kept swallowing a fifth digit would
 * only be inviting the agent to type something that will be refused.
 */
const OTP_LENGTH = 4;

export type HandoverOtpKind = 'pickup' | 'hub';

/**
 * The words for each handover. Held as data rather than branched inline so the
 * sheet reads as one form with two labels, which is what it is.
 *
 * `body` takes the sender's name because at a door the agent is addressing a
 * person; at a counter they are addressing a desk, and naming it would be odd.
 */
const COPY: Record<
  HandoverOtpKind,
  { title: string; body: (sender: string) => string; field: string; confirm: string; hint: string }
> = {
  pickup: {
    title: 'Ask for the code',
    body: (sender) => `${sender} has a 4-digit code in their app.`,
    field: 'Pickup code',
    confirm: 'Picked up',
    hint: 'No code? They can make a new one. Phone dead? Call the office.',
  },
  hub: {
    title: 'Ask the hub for the code',
    body: () => 'The counter has a 4-digit code on their screen.',
    field: 'Hub code',
    confirm: 'Given to hub',
    hint: 'The hub can make a new one if this stops working.',
  },
};

export function HandoverOtpSheet({
  open,
  onOpenChange,
  pickup,
  kind,
  onConfirm,
  isPending,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pickup: AgentPickup;
  /** Which handover is being confirmed — decides every word on the sheet. */
  kind: HandoverOtpKind;
  onConfirm: (payload: { otp: string }) => void;
  isPending: boolean;
  /** Server's verdict on the last attempt — wrong code, locked, no code. */
  error: string | null;
}) {
  const copy = COPY[kind];
  const [otp, setOtp] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Clear on open so a previous door's digits cannot be submitted at this one.
  useEffect(() => {
    if (open) {
      setOtp('');
      // Deferred a frame: the sheet animates in, and focusing mid-transition
      // leaves the keyboard covering a half-drawn sheet on Android.
      const t = setTimeout(() => inputRef.current?.focus(), 250);
      return () => clearTimeout(t);
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
        className={cn(
          'agent-surface rounded-none border-t-2 border-[#1B2A41] p-0 [&>button]:hidden',
          'max-h-[92dvh] overflow-y-auto',
          // The shared primitive's 500ms open is a desktop drawer's timing. An
          // agent opens this one standing at a door with a code being read out
          // to them; it has to be there when they look down.
          AGENT_SHEET_MOTION,
        )}
        data-testid="sheet-handover-otp"
      >
        <div className="px-5 pt-5 pb-4 border-b border-[#E8EDF2]!">
          <span className="text-[21px] font-bold tracking-[0.02em] text-[#1B2A41]">
            {pickup.order_no}
          </span>
          <h2 className="text-[24px] font-bold tracking-[-0.02em] leading-[1.15] text-[#1B2A41] mt-2">
            {copy.title}
          </h2>
          <p className="text-[17px] font-medium leading-[1.45] text-[#334155] mt-2">
            {copy.body(pickup.origin_address?.full_name ?? 'The sender')}
          </p>
        </div>

        <div className="px-5 py-5">
          <input
            ref={inputRef}
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, OTP_LENGTH))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="————"
            aria-label={copy.field}
            className={cn(
              'w-full h-[70px] text-center text-[34px] font-bold tracking-[0.3em]',
              'border-2 bg-white text-[#1B2A41] placeholder:text-[#CBD5E1] outline-none',
              error ? 'border-[#B91C1C]' : 'border-[#CBD5E1] focus:border-[#1B2A41]',
            )}
            data-testid="input-handover-otp"
          />

          {error ? (
            <p
              className="mt-3 text-[15px] font-bold leading-[1.4] text-[#B91C1C]"
              data-testid="error-handover-otp"
            >
              {error}
            </p>
          ) : (
            <p className="mt-3 flex items-start gap-2 text-[15px] font-medium leading-[1.4] text-[#64748B]">
              <ShieldCheck className="w-[17px] h-[17px] mt-px shrink-0" strokeWidth={1.5} />
              {copy.hint}
            </p>
          )}
        </div>

        <div className="flex gap-2.5 px-5 pb-6">
          <PressableButton
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
            className="h-[60px] min-w-[112px] px-3 border border-[#CBD5E1]! bg-white text-[19px] font-semibold text-[#1B2A41] disabled:opacity-60"
            data-testid="button-otp-cancel"
          >
            Back
          </PressableButton>
          <PressableButton
            type="button"
            onClick={submit}
            disabled={!complete || isPending}
            className="h-[60px] flex-1 flex items-center justify-center bg-[#1B2A41] text-[19px] font-bold text-white disabled:opacity-60"
            data-testid="button-otp-confirm"
          >
            {isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : copy.confirm}
          </PressableButton>
        </div>
      </SheetContent>
    </Sheet>
  );
}
