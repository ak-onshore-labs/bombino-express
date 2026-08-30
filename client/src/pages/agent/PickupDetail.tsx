import { useEffect, useState } from 'react';
import { useLocation, useRoute } from 'wouter';
import { Loader2, Phone, Navigation, MapPin, Clock, Package, Globe, CreditCard } from 'lucide-react';
import { AgentJobSheet } from '@/components/agent/AgentShell';
import { ActionBar } from '@/components/agent/ActionButtons';
import { CollectPaymentSheet } from '@/components/agent/CollectPaymentSheet';
import {
  FactRow,
  PackagingRow,
  amountOwedAtDoor,
  areaLine,
  houseLine,
  money,
  notDueYetReason,
  statusWord,
  timeValue,
  weightLabel,
} from '@/components/agent/PickupCard';
import { todayInIst } from '@shared/istTime';
import { docketItem, type OrderConsignee } from '@/lib/orderDetail';
import { HandoverOtpSheet, type HandoverOtpKind } from '@/components/agent/HandoverOtpSheet';
import { useAvailablePickups, useMyPickups, useOrderAction } from '@/hooks/useAgentPickups';
import type { AgentPickup } from '@/hooks/useAgentPickups';

/**
 * One job, as a single white sheet under a navy bar carrying its number.
 *
 * The customer appears once, at the top, at the size an agent reads from a
 * doorstep; then the two things they do with a phone; then four fields, which
 * is everything ops would print. Nothing is said twice and nothing is
 * explained — the labels are one word each.
 *
 * Reads from the two cached lists rather than a per-order endpoint: both are
 * already scoped by the server, and this avoids a second round trip on a phone
 * that may be on bad network.
 *
 * Both lists, not just `mine`: Today and New link free jobs straight here, so a
 * job the agent has not taken yet must resolve too. The buttons come from the
 * server either way, so a free job simply offers Take job and then carries on
 * down the same sheet.
 *
 * A consequence worth knowing: when the agent hands over at the hub the server
 * drops the job from `mine`, and it is in neither list. That is the handoff
 * working, not an error — but it is also the one moment the agent most needs
 * telling, so the sheet holds the returned order and reports the close rather
 * than letting the redirect swallow it. Everything else that vanishes (a
 * cancellation, a job taken back) still redirects.
 */

/** The office, for the `Problem` button. No endpoint behind it, by design. */
const OFFICE_PHONE = '+912266400000';

/**
 * The two actions that need a code, and which handover each one checks.
 *
 * Both are the agent typing in a number somebody else is holding — the customer
 * at the door, the hub at the counter. Neither number is anywhere in this app.
 */
const OTP_ACTIONS = {
  mark_picked_up: 'pickup',
  mark_received_at_hub: 'hub',
} as const satisfies Record<string, HandoverOtpKind>;

type OtpAction = keyof typeof OTP_ACTIONS;

function isOtpAction(action: string): action is OtpAction {
  return action in OTP_ACTIONS;
}

/** `Edison, NJ · USA` — where the parcel is going, from the booking. */
function destination(pickup: AgentPickup): string {
  const c = (pickup.consignee ?? null) as OrderConsignee | null;
  if (!c) return '—';
  const place = [c.city, c.state].filter(Boolean).join(', ');
  // `UNITED STATES` comes back shouting from the booking payload; the agent
  // surface shouts nothing that is not a label.
  const country = c.country_name
    ? c.country_name.replace(/\S+/g, (w) => w[0] + w.slice(1).toLowerCase())
    : c.country_code;
  return [place, country].filter(Boolean).join(' · ') || '—';
}

export default function PickupDetail() {
  const [, params] = useRoute('/agent/pickup/:id');
  const [, setLocation] = useLocation();
  const mine = useMyPickups();
  const available = useAvailablePickups();
  const action = useOrderAction();
  const today = todayInIst();

  const entry =
    mine.data?.find((p) => p.order.id === params?.id) ??
    available.data?.find((p) => p.order.id === params?.id);
  const order = entry?.order;

  const isLoading = mine.isLoading || available.isLoading;
  // Only fatal when we have nothing to show. One list failing while the other
  // holds the job is not worth an error screen.
  const isError = (mine.isError || available.isError) && !entry;

  // The order as the server returned it from a completed hub handover. Set once
  // and never cleared: the job has left both lists by then, and this is the only
  // copy of it the screen has. Declared up here because the redirect below reads
  // it.
  const [handedOver, setHandedOver] = useState<AgentPickup | null>(null);

  // The job left both queues (handed over, or cancelled). Go back rather than
  // sitting on a screen with nothing on it.
  //
  // Suppressed while either list is in flight: taking a job removes it from
  // `available` and adds it to `mine`, and if those two refetches land a beat
  // apart there is a moment where neither list has it. Redirecting on that
  // would throw the agent off the job they just took.
  //
  // Also suppressed once the hub handover lands. The job leaves both lists at
  // exactly that moment, and that departure is the thing being reported — this
  // is the one disappearance the agent should be shown rather than moved past.
  const settling = mine.isFetching || available.isFetching;
  const vanished = !isLoading && !settling && !isError && !entry && !handedOver;
  useEffect(() => {
    if (vanished) setLocation('/agent/mine', { replace: true });
  }, [vanished, setLocation]);

  // Where "back" goes depends on where the job actually is, not on where the
  // agent happened to tap in from.
  const isFree = !!entry && !mine.data?.some((p) => p.order.id === entry.order.id);
  const backHref = isFree ? '/agent/available' : '/agent/mine';
  const backLabel = isFree ? 'New jobs' : 'My jobs';

  const [sheetOpen, setSheetOpen] = useState(false);
  const [receipt, setReceipt] = useState<{ txnId: string | null; amount: number } | null>(null);
  // Which handover the OTP sheet is collecting a code for. Null means closed —
  // one piece of state rather than an `open` flag beside a `kind`, so the two
  // cannot disagree about which code the agent is being asked for.
  const [otpAction, setOtpAction] = useState<OtpAction | null>(null);
  // Anything that failed and is not the handover code, shown above the action
  // bar. This surface has no toasts (see `SurfaceToaster` in App.tsx), so a
  // failure that is not written onto the screen is a failure nobody sees.
  const [actionError, setActionError] = useState<string | null>(null);
  // The server's verdict on the last code, held so the sheet can show it. Not
  // a toast: the agent is retyping into the field the message is about.
  const [otpError, setOtpError] = useState<string | null>(null);

  const runAction = (actionName: string, payload?: Record<string, unknown>): void => {
    if (!order) return;
    action.mutate(
      { orderId: order.id, action: actionName, payload },
      {
        onSuccess: (result) => {
          if (isOtpAction(actionName)) {
            setOtpAction(null);
            setOtpError(null);
          }
          // The last thing the agent does with this parcel. Hold what came back
          // so the screen can say so — see `handedOver` above.
          if (actionName === 'mark_received_at_hub') {
            setHandedOver(result.order);
          }
          if (result.warning) {
            // The action landed but its history row did not — surfaced rather
            // than swallowed, because ops reads that history.
            console.warn('[PickupDetail]', result.warning);
          }
          if (result.receipt) {
            // Hold the sheet open and flip it to the amount taken.
            setReceipt(result.receipt);
            return;
          }
          // Nothing announces success. The sheet re-renders with the new status
          // word in its bar and the next action underneath, which is the same
          // fact told where the agent is already looking.
          setActionError(null);
        },
        onError: (err) => {
          // A rejected code belongs in the sheet, next to the field being
          // retyped — not somewhere the agent has to look away to read.
          if (isOtpAction(actionName)) {
            setOtpError(err.message);
            return;
          }
          setActionError(err.status === 409 ? 'This job moved on' : err.message);
        },
      },
    );
  };

  // Three actions need input before they can fire: money needs an amount and a
  // mode, and the two handovers each need the code the other party is holding.
  // All open a sheet. Everything else is a single decisive tap.
  const handleAction = (actionName: string): void => {
    if (actionName === 'collect_payment') {
      setReceipt(null);
      setSheetOpen(true);
      return;
    }
    if (isOtpAction(actionName)) {
      setOtpError(null);
      setOtpAction(actionName);
      return;
    }
    runAction(actionName);
  };

  const owed = order ? amountOwedAtDoor(order) : null;
  const address = order?.origin_address;
  const mapsQuery = [address?.address_line_1, address?.city, address?.pincode]
    .filter(Boolean)
    .join(', ');
  const pieces = order ? docketItem(order.items as Record<string, unknown> | null) : null;
  const notDueYet = order ? notDueYetReason(order) : null;

  return (
    <AgentJobSheet
      backHref={backHref}
      backLabel={backLabel}
      orderNo={handedOver?.order_no ?? order?.order_no}
      statusWord={
        handedOver ? 'At hub' : order ? statusWord(order, today) : undefined
      }
      actionBar={
        // Nothing is left to press on a parcel that is with the hub.
        handedOver ? undefined : order && entry ? (
          <>
            {actionError && (
              <p
                className="pb-1 text-[15px] font-bold text-[#B91C1C] bg-white"
                data-testid="action-error"
              >
                {actionError}
              </p>
            )}
            <ActionBar
              actions={entry.availableActions}
              owed={owed}
              pendingAction={action.isPending ? action.variables?.action ?? null : null}
              disabled={action.isPending}
              onAction={handleAction}
              trailing={
                <a
                  href={`tel:${OFFICE_PHONE}`}
                  className="w-full h-full flex items-center justify-center border border-[#CBD5E1]! bg-white text-[19px] font-semibold text-[#1B2A41]"
                  data-testid="button-problem"
                >
                  Problem
                </a>
              }
            />
          </>
        ) : undefined
      }
    >
      {/* The job is closed. Said plainly, once, and it stays said — the lists
          have already dropped it, so there is nothing behind this to go back
          to. No tick, no celebration: it is a receipt, not a reward. */}
      {handedOver && (
        <div className="px-5 pt-6">
          <div className="border border-[#D8DFE7]! p-5" data-testid="block-handed-over">
            <span className="block text-[13px] font-bold uppercase tracking-[0.1em] text-[#64748B]">
              Given to hub
            </span>
            <p className="text-[28px] font-bold leading-none tracking-[0.02em] text-[#1B2A41] mt-3">
              {handedOver.order_no}
            </p>
            <p className="text-[17px] font-medium leading-[1.45] text-[#334155] mt-3">
              Off your list.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setLocation('/agent/mine', { replace: true })}
            className="mt-5 h-[60px] w-full bg-[#1B2A41] text-xl font-bold text-white"
            data-testid="button-back-to-jobs"
          >
            My jobs
          </button>
        </div>
      )}

      {!handedOver && isLoading && (
        <div className="flex items-center justify-center gap-2.5 py-16 text-[#64748B]">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-[17px] font-semibold">Loading…</span>
        </div>
      )}

      {!handedOver && isError && (
        <p className="px-5 py-8 text-[17px] font-medium text-[#334155]">Could not load.</p>
      )}

      {!handedOver && order && entry && (
        <>
          <p className="px-5 pt-5 pb-[18px] text-[28px] font-bold tracking-[-0.02em] leading-[1.15] text-[#1B2A41]">
            {address?.full_name ?? 'No name'}
          </p>

          {/* One fact per row, labelled and iconed. Amber on what the agent
              needs next — where, and when — grey on what they read once. */}
          <FactRow
            size="sheet"
            icon={MapPin}
            tone="amber"
            label="Place"
            value={houseLine(order)}
            second={areaLine(order)}
            className="border-t border-[#E8EDF2]!"
          />
          <FactRow
            size="sheet"
            icon={Clock}
            tone="amber"
            label="Time"
            value={timeValue(order, today)}
            className="border-t border-[#E8EDF2]!"
          />
          <FactRow
            size="sheet"
            icon={Package}
            label="Weight"
            value={weightLabel(order)}
            right={{ label: 'Boxes', value: String(pieces?.number_of_boxes ?? '—') }}
            className="border-t border-[#E8EDF2]!"
          />
          <PackagingRow pickup={order} size="sheet" className="border-t border-[#E8EDF2]!" />
          <FactRow
            size="sheet"
            icon={Globe}
            label="Goes to"
            value={destination(order)}
            className="border-t border-[#E8EDF2]!"
          />

          {/* The two things done with a phone, one hairline apart. */}
          <div className="flex border-t border-[#E8EDF2]!">
            {address?.phone ? (
              <a
                href={`tel:${address.phone}`}
                className="flex-1 h-[68px] flex items-center justify-center gap-2.5 bg-[#15803D]"
                data-testid="button-call-sender"
              >
                <Phone className="w-[21px] h-[21px] text-white" strokeWidth={1.5} />
                <span className="text-[19px] font-bold text-white">Call</span>
              </a>
            ) : (
              <span
                className="flex-1 h-[68px] flex items-center justify-center border-r border-[#E8EDF2]! text-[17px] font-semibold text-[#94A3B8]"
                data-testid="no-phone"
              >
                No phone
              </span>
            )}
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}`}
              target="_blank"
              rel="noreferrer"
              className="flex-1 h-[68px] flex items-center justify-center gap-2.5 border-l border-[#E8EDF2]!"
              data-testid="button-navigate"
            >
              <Navigation className="w-[21px] h-[21px] text-[#1B2A41]" strokeWidth={1.5} />
              <span className="text-[19px] font-semibold text-[#1B2A41]">Map</span>
            </a>
          </div>

          {owed !== null && (
            <div
              className="mx-5 mt-[18px] mb-5 bg-[#F2A123] p-4 flex items-center justify-between gap-3"
              data-testid="field-take-money"
            >
              <span className="flex items-center gap-2.5">
                <CreditCard className="w-[21px] h-[21px] text-[#1B2A41]" strokeWidth={1.5} />
                <span className="text-[13px] font-bold uppercase tracking-[0.1em] text-[#1B2A41]">
                  Take money
                </span>
              </span>
              <span className="text-[28px] font-bold leading-none text-[#1B2A41]">
                ₹{money(owed)}
              </span>
            </div>
          )}

          {/* The server withholds start_pickup until the pickup date and sends
              no actions, so the bar is empty. Say when — an agent holding a job
              with no button and no date reads it as a fault. */}
          {notDueYet && (
            <p
              className="mx-5 mt-[18px] mb-5 border-t border-[#E8EDF2]! pt-4 text-[17px] font-bold text-[#1B2A41]"
              data-testid="not-due-yet"
            >
              {notDueYet}
            </p>
          )}

          <CollectPaymentSheet
            open={sheetOpen}
            onOpenChange={(next) => {
              setSheetOpen(next);
              if (!next) setReceipt(null);
            }}
            pickup={order}
            isPending={action.isPending}
            receipt={receipt}
            onConfirm={(payload) => runAction('collect_payment', payload)}
          />

          {otpAction && (
            <HandoverOtpSheet
              open
              onOpenChange={(next) => {
                if (!next) {
                  setOtpAction(null);
                  setOtpError(null);
                }
              }}
              pickup={order}
              kind={OTP_ACTIONS[otpAction]}
              isPending={action.isPending}
              error={otpError}
              onConfirm={(payload) => runAction(otpAction, payload)}
            />
          )}
        </>
      )}
    </AgentJobSheet>
  );
}
