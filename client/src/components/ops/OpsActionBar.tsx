/**
 * An order's actions, at office scale.
 *
 * Ops used to borrow the agent's `ActionBar`: 60px stamped buttons with 19px
 * type, built for a gloved thumb in sunlight. On a laptop that read as a
 * different app bolted in, and it put "Cancel order" in the same row and the
 * same weight as the routine next step, one slip away.
 *
 * Same rule as the agent bar, otherwise: the server sends the legal actions in
 * order and this renders them, holding no lifecycle knowledge beyond how much
 * weight each one gets.
 *   - Money first, amber: the one colour that means cash.
 *   - The first other action is the expected next step: navy.
 *   - The rest are alternatives: outlined.
 *   - `cancel` is irreversible: last, apart, quiet red, and it asks first, in
 *     place rather than in a dialog.
 */

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { AvailableAction } from '@shared/orderContract';

const MONEY_ACTION = 'collect_payment';
const DESTRUCTIVE_ACTIONS = new Set(['cancel']);

export function OpsActionBar({
  actions,
  onAction,
  pendingAction,
  disabled = false,
  orderNo,
}: {
  actions: AvailableAction[];
  onAction: (action: string) => void;
  pendingAction?: string | null;
  disabled?: boolean;
  /** Named in the cancel confirmation, so there is no doubt which order. */
  orderNo: string;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  if (actions.length === 0) return null;

  const money = actions.find((a) => a.action === MONEY_ACTION);
  const destructive = actions.filter((a) => DESTRUCTIVE_ACTIONS.has(a.action));
  const rest = actions.filter((a) => a !== money && !DESTRUCTIVE_ACTIONS.has(a.action));
  const [primary, ...secondary] = rest;

  const busy = (action: string): boolean => disabled || pendingAction === action;
  const label = (a: AvailableAction) =>
    pendingAction === a.action ? <Loader2 className="w-4 h-4 animate-spin" /> : a.label;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {money && (
          <Button
            type="button"
            onClick={() => onAction(money.action)}
            disabled={busy(money.action)}
            className="h-10 px-5 rounded-md bg-[#F2A123] text-[#1B2A41] font-semibold hover:bg-[#F2A123]/90 max-sm:w-full"
            data-testid={`button-action-${money.action}`}
          >
            {label(money)}
          </Button>
        )}
        {primary && (
          <Button
            type="button"
            onClick={() => onAction(primary.action)}
            disabled={busy(primary.action)}
            className="h-10 px-5 rounded-md bg-[#1B2A41] text-white font-semibold hover:bg-[#2F4468] max-sm:w-full"
            data-testid={`button-action-${primary.action}`}
          >
            {label(primary)}
          </Button>
        )}
        {secondary.map((a) => (
          <Button
            key={a.action}
            type="button"
            variant="outline"
            onClick={() => onAction(a.action)}
            disabled={busy(a.action)}
            className="h-10 px-4 rounded-md font-medium max-sm:w-full"
            data-testid={`button-action-${a.action}`}
          >
            {label(a)}
          </Button>
        ))}

        {destructive.map((a) =>
          confirming === a.action ? null : (
            <Button
              key={a.action}
              type="button"
              variant="ghost"
              onClick={() => setConfirming(a.action)}
              disabled={busy(a.action)}
              className="h-10 px-3 rounded-md font-medium text-red-700 hover:text-red-800 hover:bg-red-50 sm:ml-auto max-sm:w-full"
              data-testid={`button-action-${a.action}`}
            >
              {label(a)}
            </Button>
          )
        )}
      </div>

      {confirming && (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3"
          role="alert"
          data-testid="confirm-destructive-action"
        >
          <p className="text-sm text-red-900">
            Cancel <span className="font-semibold">{orderNo}</span>? This cannot be undone.
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirming(null)}
              className="h-9 rounded-md bg-white"
              data-testid="button-keep-order"
            >
              Keep order
            </Button>
            <Button
              type="button"
              onClick={() => {
                const action = confirming;
                setConfirming(null);
                onAction(action);
              }}
              disabled={busy(confirming)}
              className="h-9 rounded-md bg-red-700 text-white hover:bg-red-800"
              data-testid="button-confirm-destructive-action"
            >
              {pendingAction === confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Yes, cancel order'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
