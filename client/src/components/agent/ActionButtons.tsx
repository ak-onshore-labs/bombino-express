import { Loader2, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { money } from '@/components/agent/PickupCard';
import { PressableButton } from '@/components/motion/Pressable';
import type { AvailableAction } from '@shared/orderContract';

/**
 * Renders one button per entry in `availableActions` and nothing else.
 *
 * Holds NO lifecycle knowledge: not which action follows which, not who may
 * perform what, not what any status means. The server sends the list. Adding a
 * transition server-side makes a button appear here with no change to this
 * file — that is the point of the uniform action endpoint.
 *
 * The one thing it does read is which action is about money, because the colour
 * law puts that button in amber and every other button in navy. That is a
 * presentation rule, not a lifecycle rule.
 *
 * Actions that need input are not handled inline. The parent owns that: it
 * receives the action name and opens whatever surface the input belongs in
 * (payment gets a bottom sheet). Keeping that out of here is what stops this
 * component accumulating per-action special cases.
 *
 * 56px tall, per the field-conditions requirement in PRODUCT.md — above the
 * 44px baseline, because these are pressed with gloves on.
 */

const MONEY_ACTION = 'collect_payment';

/**
 * Square corners, no radius: buttons on this surface are stamped, not soft.
 *
 * The press itself is no longer a CSS `active:` scale — `PressableButton`
 * springs it, which releases rather than snapping back and holds up better when
 * a gloved finger slides off the target mid-press. Only the colour transition
 * stays here.
 */
const BUTTON_BASE =
  'flex items-center justify-center gap-2.5 transition-colors duration-150 disabled:opacity-60';

/** The fixed bar's buttons. Cards use 64 — see `PanelAction`. */
const BAR_HEIGHT = 'h-[60px]';

/**
 * The job sheet's fixed action bar.
 *
 * Money gets its own full-width amber row wherever the server places it in the
 * list, because an agent who taps "Mark picked up" while still owed ₹4,820 has
 * lost the money. Everything else shares the row below it: the first action the
 * server sends is the expected next step and takes the navy fill; the rest are
 * alternatives on a hairline and must not compete with it.
 */
export function ActionBar({
  actions,
  owed,
  onAction,
  pendingAction,
  disabled = false,
  trailing,
}: {
  actions: AvailableAction[];
  /** Puts the amount in the money button's label, as the design does. */
  owed?: number | null;
  onAction: (action: string) => void;
  /** Action in flight, so only its own button shows a spinner. */
  pendingAction?: string | null;
  disabled?: boolean;
  /**
   * A fixed control that shares the primary row — the `Problem` escape hatch.
   * Passed in rather than declared here because it is not a lifecycle action
   * and this component must keep holding no lifecycle knowledge.
   */
  trailing?: React.ReactNode;
}) {
  if (actions.length === 0 && !trailing) return null;

  const moneyAction = actions.find((a) => a.action === MONEY_ACTION);
  const rest = actions.filter((a) => a.action !== MONEY_ACTION);
  const [primary, ...secondary] = rest;

  return (
    <>
      {moneyAction && (
        <PressableButton
          type="button"
          onClick={() => onAction(moneyAction.action)}
          disabled={disabled || pendingAction === moneyAction.action}
          className={cn(BUTTON_BASE, BAR_HEIGHT, 'w-full bg-[#F2A123] text-xl font-bold text-[#1B2A41]')}
          data-testid={`button-action-${moneyAction.action}`}
        >
          {pendingAction === moneyAction.action ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : typeof owed === 'number' ? (
            `Take ₹${money(owed)}`
          ) : (
            moneyAction.label
          )}
        </PressableButton>
      )}

      {(primary || trailing) && (
        <div className="flex gap-2">
          {primary && (
            <PressableButton
              type="button"
              onClick={() => onAction(primary.action)}
              disabled={disabled || pendingAction === primary.action}
              className={cn(BUTTON_BASE, BAR_HEIGHT, 'flex-1 bg-[#1B2A41] text-[19px] font-bold text-white')}
              data-testid={`button-action-${primary.action}`}
            >
              {pendingAction === primary.action ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                primary.label
              )}
            </PressableButton>
          )}

          {secondary.map(({ action, label }) => (
            <PressableButton
              key={action}
              type="button"
              onClick={() => onAction(action)}
              disabled={disabled || pendingAction === action}
              className={cn(
                BUTTON_BASE,
                BAR_HEIGHT,
                'min-w-[112px] px-3 border border-[#CBD5E1]! bg-white text-[19px] font-semibold text-[#1B2A41]',
              )}
              data-testid={`button-action-${action}`}
            >
              {pendingAction === action ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                label
              )}
            </PressableButton>
          ))}

          {/* 112px beside a primary, as the design has it. On its own it fills
              the row instead — a lone 112px button pinned to the left edge
              reads as a layout fault rather than a deliberate escape hatch. */}
          {trailing && (
            <div className={cn(BAR_HEIGHT, primary ? 'w-[112px]' : 'flex-1')}>{trailing}</div>
          )}
        </div>
      )}
    </>
  );
}

/**
 * The one navy action that runs edge to edge inside a panel.
 *
 * Used where a job sits in a list and there is a single obvious move — accept
 * an unclaimed call, advance the job in hand. The negative margin cancels the
 * panel's padding so the button touches both hairlines; a button inset inside a
 * panel reads as a second box.
 */
export function PanelAction({
  label,
  onClick,
  pending = false,
  disabled = false,
  arrow = false,
  height = 64,
  className,
  testId,
}: {
  label: string;
  onClick: () => void;
  pending?: boolean;
  disabled?: boolean;
  /** The amber arrow, for a lifecycle step rather than a claim. */
  arrow?: boolean;
  /** 64 in a full card, 60 on a rail card. Nothing else. */
  height?: 60 | 64;
  className?: string;
  testId?: string;
}) {
  return (
    <PressableButton
      type="button"
      onClick={onClick}
      disabled={disabled || pending}
      className={cn(
        BUTTON_BASE,
        'w-full bg-[#1B2A41] text-[19px] font-bold tracking-[0.01em] text-white',
        height === 60 ? 'h-[60px]' : 'h-16',
        className,
      )}
      data-testid={testId}
    >
      {pending ? (
        <Loader2 className="w-5 h-5 animate-spin" />
      ) : (
        <>
          {label}
          {arrow && <ArrowRight className="w-[18px] h-[18px] text-[#F2A123]" strokeWidth={2.5} />}
        </>
      )}
    </PressableButton>
  );
}
