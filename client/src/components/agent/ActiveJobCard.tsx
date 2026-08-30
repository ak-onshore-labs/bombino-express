import { Link } from 'wouter';
import { Phone } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PanelAction } from '@/components/agent/ActionButtons';
import {
  CollectStrip,
  JobCard,
  JobEntry,
  amountOwedAtDoor,
  notDueYetReason,
} from '@/components/agent/PickupCard';
import { useOrderAction, type PickupEntry } from '@/hooks/useAgentPickups';
import { bandForDate } from '@/lib/agentGrouping';
import { todayInIst } from '@shared/istTime';

/**
 * The job in hand, with the next move on the row it belongs to.
 *
 * Number strip, name, then Place / Time / Weight as three labelled fact rows;
 * then the amber amount if money is owed at the door; then a full-bleed action
 * row split `116px | 1fr`: Call, and whatever the server says comes next.
 *
 * Call is filled green. It is the one control here that does not change the
 * job's state — it reaches a person — and an agent stood at a wrong gate needs
 * to find it without reading. Green is used nowhere else on this surface except
 * the schedule's `Saved`, so it cannot be confused with money (amber), a state
 * change (navy) or lateness (red).
 *
 * Used by Home for the one job leading the screen. My jobs shows plain entries
 * instead — the v2 pass took the buttons off that list so it reads as a list,
 * and every job there opens onto One job, which carries the full action bar.
 *
 * Two things deliberately do NOT fire from here:
 *
 *   Anything needing input. Money needs an amount and a mode; a handover needs
 *   the other party's code. Those carry their label and open the job sheet,
 *   where the sheets live. `requiresPayload` on the action is what decides it,
 *   so a new gated action needs no change here.
 *
 *   A job that is not due yet. The server withholds `start_pickup` until the
 *   pickup date and sends no actions; the card says when it starts rather than
 *   showing a dead row.
 *
 * The body links to the job sheet — the fields, the full address and Map are
 * all there, and an agent standing at a gate needs them.
 */

/** Actions whose input lives on the job sheet, not on a summary card. */
const NEEDS_THE_SHEET = new Set(['collect_payment']);

export function ActiveJobCard({ entry }: { entry: PickupEntry }) {
  const action = useOrderAction();

  const order = entry.order;
  const owed = amountOwedAtDoor(order);
  const next = entry.availableActions[0];
  const notDueYet = notDueYetReason(order);
  const phone = order.origin_address?.phone;
  const isClaim = next?.action === 'claim';
  const opensSheet = !!next && (next.requiresPayload || NEEDS_THE_SHEET.has(next.action));
  const href = `/agent/pickup/${order.id}`;

  /**
   * No toast on success. The agent surface has none (see `SurfaceToaster` in
   * App.tsx), and it does not need one here: the mutation invalidates both
   * lists, so the card the agent just pressed re-renders with its new status
   * and its next action. The screen answering is better than a card sliding
   * over it saying the same thing.
   *
   * Failure does need saying, and says it in place — a lost claim race that
   * reported nothing at all is the silent failure §5 calls out.
   */
  const run = (): void => {
    if (!next) return;
    action.mutate({ orderId: order.id, action: next.action });
  };

  const failure = action.error
    ? action.error.status === 409
      ? isClaim
        ? 'Someone else took it'
        : 'This job moved on'
      : action.error.message
    : null;

  return (
    <>
      {/* The body is a link, the action row is not — a button inside an anchor
          is invalid markup and, on a phone, an ambiguous tap. */}
      <Link href={href} className="block" data-testid={`link-job-${order.order_no}`}>
        <JobEntry pickup={order} facts="split" />
      </Link>

      {owed !== null && <CollectStrip amount={owed} />}

      {/* Red means late everywhere else on this surface; it means failed here,
          and only ever sits directly above the button that failed. */}
      {failure && (
        <p
          className="border-t border-[#E8EDF2]! px-4 py-3 text-[13px] font-bold uppercase tracking-[0.1em] text-[#B91C1C]"
          data-testid="job-action-error"
        >
          {failure}
        </p>
      )}

      {notDueYet ? (
        <div className="border-t border-[#E8EDF2]! px-4 py-4" data-testid="not-due-yet">
          <p className="text-[17px] font-bold text-[#1B2A41]">{notDueYet}</p>
        </div>
      ) : (
        <div className="flex border-t border-[#D8DFE7]!">
          {phone ? (
            <a
              href={`tel:${phone}`}
              className="w-[116px] h-16 flex items-center justify-center gap-2.5 bg-[#15803D]"
              data-testid="link-call-sender"
            >
              <Phone className="w-5 h-5 text-white" strokeWidth={1.5} />
              <span className="text-lg font-bold text-white">Call</span>
            </a>
          ) : (
            <span
              className="w-[116px] h-16 flex items-center justify-center border-r border-[#D8DFE7]! text-[15px] font-semibold text-[#94A3B8]"
              data-testid="no-phone"
            >
              No phone
            </span>
          )}

          {next ? (
            opensSheet ? (
              <Link
                href={href}
                className="flex-1 h-16 bg-[#1B2A41] flex items-center justify-center gap-2 text-[19px] font-bold text-white"
                data-testid="link-open-job"
              >
                {next.label}
              </Link>
            ) : (
              <PanelAction
                label={next.label}
                arrow
                onClick={run}
                pending={action.isPending}
                className="flex-1"
                testId="button-job-next"
              />
            )
          ) : (
            <Link
              href={href}
              className="flex-1 h-16 bg-[#1B2A41] flex items-center justify-center text-[19px] font-bold text-white"
              data-testid="link-open-job"
            >
              Open job
            </Link>
          )}
        </div>
      )}
    </>
  );
}

/** The same card as its own panel, for a screen showing exactly one. */
export function ActiveJobPanel({ entry, className }: { entry: PickupEntry; className?: string }) {
  // The card takes the late ground when the job is late, the same as every
  // other card on the surface — the red strip alone left it reading as a normal
  // job wearing a red hat.
  const late = bandForDate(entry.order.pickup_date, todayInIst()) === 'overdue';

  return (
    <JobCard late={late} className={className}>
      <ActiveJobCard entry={entry} />
    </JobCard>
  );
}
