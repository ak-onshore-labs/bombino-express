import { useState, type ReactNode } from 'react';
import { formatInr, formatIst } from '@/lib/orderDetail';
import { signOutAndRedirect } from '@/lib/session';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, LogOut } from 'lucide-react';
import { Link, useLocation, useParams } from 'wouter';
import { ActionBar } from '@/components/agent/ActionButtons';
import { OpsSenderCell } from '@/components/ops/OpsSenderCell';
import { OpsShell } from '@/components/ops/OpsShell';
import { OpsCollectPaymentSheet } from '@/components/ops/OpsCollectPaymentSheet';
import { OpsDropoffOtpSheet } from '@/components/ops/OpsDropoffOtpSheet';
import { OpsWeighSheet } from '@/components/ops/OpsWeighSheet';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { parseApiErrorMessage } from '@/lib/apiError';
import { apiRequest } from '@/lib/queryClient';
import {
  opsOrderDetailKey,
  useOpsAssign,
  useOpsOrderAction,
  useOpsOrderDetail,
  useOpsStaffUsers,
  type OpsActionError,
} from '@/hooks/useOpsOrders';
import { getOrderStatusLabel } from '@/lib/orderStatus';

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="py-2.5 border-b border-border last:border-b-0">
      <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
        {label}
      </p>
      <p className="text-sm font-semibold text-foreground mt-0.5 break-words">
        {value ?? '—'}
      </p>
    </div>
  );
}

/** The shared helpers answer '—' for nothing; these keep this page's wording. */
const formatMoney = (value: number | null | undefined): string => formatInr(value) ?? '—';
const formatWhen = (iso: string): string => formatIst(iso);

function consigneeLines(consignee: unknown): { name: string; city: string; phone: string } {
  if (!consignee || typeof consignee !== 'object' || Array.isArray(consignee)) {
    return { name: '—', city: '—', phone: '—' };
  }
  const c = consignee as Record<string, unknown>;
  const str = (k: string) =>
    typeof c[k] === 'string' && (c[k] as string).trim() !== ''
      ? (c[k] as string).trim()
      : '—';
  return {
    name: str('name') !== '—' ? str('name') : str('full_name'),
    city: str('city') !== '—' ? str('city') : str('consignee_city'),
    phone: str('phone'),
  };
}

/**
 * Ops order detail + event timeline + lifecycle actions.
 */
export default function OpsOrderDetail() {
  const params = useParams<{ id: string }>();
  const orderId = params.id;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading, error, isError } = useOpsOrderDetail(orderId);
  const action = useOpsOrderAction(orderId);
  const assign = useOpsAssign(orderId);
  const staff = useOpsStaffUsers();
  const [selectedAgentId, setSelectedAgentId] = useState('');

  const regenerateHandover = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('POST', `/api/orders/${id}/handover-code`);
      return (await res.json()) as { handover: { kind: string; code: string } };
    },
    onSuccess: () => {
      if (orderId) {
        void queryClient.invalidateQueries({ queryKey: opsOrderDetailKey(orderId) });
      }
      toast({
        title: 'New code ready',
        description: 'Read this number to the pickup agent.',
      });
    },
    onError: (err: unknown) => {
      toast({
        title: 'Could not get a new code',
        description: parseApiErrorMessage(err, 'Please try again.'),
        variant: 'destructive',
      });
    },
  });

  const [weighOpen, setWeighOpen] = useState(false);
  const [collectOpen, setCollectOpen] = useState(false);
  const [dropoffOpen, setDropoffOpen] = useState(false);
  const [dropoffError, setDropoffError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{ txnId: string | null; amount: number } | null>(
    null,
  );
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  // Enter AWB from ITD portal: the number ops filed by hand.
  const [awbOpen, setAwbOpen] = useState(false);
  const [awbValue, setAwbValue] = useState('');
  const [awbError, setAwbError] = useState<string | null>(null);

  const forbidden =
    isError &&
    error instanceof Error &&
    error.message.startsWith('403:');

  const handleLogout = (): Promise<void> => signOutAndRedirect(setLocation);

  const runAction = (actionName: string, payload?: Record<string, unknown>): void => {
    setPendingAction(actionName);
    if (actionName === 'mark_received_dropoff') {
      setDropoffError(null);
    }
    action.mutate(
      { action: actionName, payload },
      {
        onSuccess: (result) => {
          setPendingAction(null);
          if (result.receipt) {
            setReceipt(result.receipt);
            return;
          }
          setWeighOpen(false);
          setCollectOpen(false);
          setDropoffOpen(false);
          setDropoffError(null);
          setAwbOpen(false);
          toast({
            title: 'Updated',
            description: `${result.order.order_no} — ${getOrderStatusLabel(result.order.status)}`,
          });
        },
        onError: (err: OpsActionError) => {
          setPendingAction(null);
          if (actionName === 'record_awb') {
            setAwbError(err.message);
            return;
          }
          // A failed filing writes its reason onto the order: show it.
          if (actionName === 'generate_docket' || actionName === 'retry_docket') {
            void queryClient.invalidateQueries({ queryKey: opsOrderDetailKey(orderId) });
            toast({ title: 'AWB not issued', description: err.message, variant: 'destructive' });
            return;
          }
          const isOtpError =
            actionName === 'mark_received_dropoff' &&
            typeof err.code === 'string' &&
            err.code.startsWith('OTP_');
          if (isOtpError) {
            setDropoffError(err.message);
            return;
          }
          if (actionName === 'mark_received_dropoff') {
            setDropoffOpen(false);
            setDropoffError(null);
          }
          const isRetryReprice = err.code === 'RETRY_REPRICE';
          toast({
            title: isRetryReprice
              ? 'Could not reprice'
              : err.status === 409
                ? 'Order moved on'
                : 'Could not update',
            description: isRetryReprice
              ? err.message ||
                'Reprice failed. The order was not changed — fix rates inputs or try again.'
              : err.message,
            variant: 'destructive',
          });
        },
      },
    );
  };

  const handleAction = (actionName: string): void => {
    if (actionName === 'weigh') {
      setWeighOpen(true);
      return;
    }
    if (actionName === 'collect_payment') {
      setReceipt(null);
      setCollectOpen(true);
      return;
    }
    if (actionName === 'mark_received_dropoff') {
      setDropoffError(null);
      setDropoffOpen(true);
      return;
    }
    if (actionName === 'settle') {
      if (!window.confirm('Settle this order?')) return;
    }
    if (actionName === 'record_awb') {
      setAwbValue('');
      setAwbError(null);
      setAwbOpen(true);
      return;
    }
    if (actionName === 'generate_docket' || actionName === 'retry_docket') {
      // A real ITD shipment, and ITD cannot amend one once filed.
      if (!window.confirm('File a real ITD docket for this order now? ITD cannot change it afterwards.')) return;
    }
    runAction(actionName);
  };

  if (forbidden) {
    return (
      <OpsShell title="Order" subtitle="Access required">
        <div className="rounded-2xl border border-border bg-white p-6 text-center">
          <p className="text-base font-semibold">Ops access required</p>
          <Button
            type="button"
            onClick={() => void handleLogout()}
            className="mt-5 bg-[#F2A123] hover:bg-[#F2A123]/90 text-[lab(34.0831_-9.57756_-27.7093)] font-semibold"
          >
            <LogOut className="w-4 h-4 mr-2" />
            Sign out
          </Button>
        </div>
      </OpsShell>
    );
  }

  if (isLoading) {
    return (
      <OpsShell title="Order" subtitle="Loading">
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </OpsShell>
    );
  }

  if (isError || !data) {
    const notFound =
      error instanceof Error && error.message.startsWith('404:');
    return (
      <OpsShell title="Order" subtitle={notFound ? 'Not found' : 'Error'}>
        <Link
          href="/ops"
          className="inline-flex items-center gap-1 text-sm font-semibold text-[#F2A123] mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to board
        </Link>
        <p className="text-sm text-muted-foreground">
          {notFound ? 'That order could not be found.' : 'Could not load this order.'}
        </p>
      </OpsShell>
    );
  }

  const { order, events, handover } = data;
  // One way to an AWB is offered, whichever fits the customer: a real filing
  // on their own ITD login, or ops entering one filed in ITD's portal.
  const availableActions = data.availableActions.filter((a) =>
    data.owner_has_itd_login ? a.action !== 'record_awb' : a.action !== 'generate_docket'
  );
  const docketRetryLabel =
    order.docket_retry === 'auto'
      ? 'Retrying automatically'
      : order.docket_retry === 'check_itd'
        ? 'Check ITD portal first'
        : 'Needs ops';
  const consignee = consigneeLines(order.consignee);
  const dueAmount = order.final_amount ?? order.quoted_amount ?? 0;
  const needsNewHubCode = Boolean(handover && (handover.locked || !handover.code));

  return (
    <OpsShell title={order.order_no} subtitle={getOrderStatusLabel(order.status)}>
      <Link
        href="/ops"
        className="inline-flex items-center gap-1 text-sm font-semibold text-[#F2A123] mb-4"
        data-testid="link-ops-back-board"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to board
      </Link>

      {handover && (
        <div
          className="rounded-2xl border border-[#F2A123] bg-[#F2A123]/15 px-4 py-3 mb-4"
          data-testid="ops-hub-handover-code"
        >
          <p className="text-[11px] uppercase tracking-[0.14em] font-bold text-muted-foreground">
            Hub handover code
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            Read this to the pickup agent
          </p>
          {needsNewHubCode ? (
            <>
              <p className="text-sm font-semibold text-foreground mt-2">
                {handover.locked
                  ? 'This code is locked after too many wrong tries.'
                  : 'No hub code on this order yet.'}
              </p>
              <Button
                type="button"
                onClick={() => regenerateHandover.mutate(order.id)}
                disabled={regenerateHandover.isPending}
                className="mt-3 h-11 rounded-xl bg-primary text-white font-bold"
                data-testid="button-ops-regenerate-hub-code"
              >
                {regenerateHandover.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  'Regenerate code'
                )}
              </Button>
            </>
          ) : (
            <p className="text-2xl font-extrabold tabular-nums tracking-[0.2em] text-foreground mt-1">
              {handover.code}
            </p>
          )}
        </div>
      )}

      {order.awb_no && (
        <div
          className="rounded-2xl border border-[#F2A123] bg-[#F2A123]/15 px-4 py-3 mb-4"
          data-testid="ops-order-awb"
        >
          <p className="text-[11px] uppercase tracking-[0.14em] font-bold text-muted-foreground">
            AWB
          </p>
          <p className="text-lg font-extrabold tabular-nums text-foreground mt-0.5">
            {order.awb_no}
          </p>
        </div>
      )}

      {/* An AWB this order was supposed to have and does not, why, and who acts
          next (server/docketFiling.ts): the automatic retry, ops after a
          correction, or a check of ITD's portal before filing again. */}
      {!order.awb_no && order.docket_error && (
        <div
          className="rounded-2xl border border-destructive bg-destructive/10 px-4 py-3 mb-4"
          data-testid="ops-order-docket-error"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] uppercase tracking-[0.14em] font-bold text-destructive">
              Airway bill not issued
            </p>
            <span
              className="shrink-0 rounded-full border border-destructive/40 bg-white px-2 py-0.5 text-[11px] font-semibold text-destructive"
              data-testid="ops-order-docket-retry"
            >
              {docketRetryLabel}
            </span>
          </div>
          <p className="text-sm font-semibold text-foreground mt-1 leading-snug">
            {order.docket_error}
          </p>
          {order.docket_error_problems && order.docket_error_problems.length > 0 && (
            <ul className="mt-1.5 list-disc pl-5 text-sm text-foreground space-y-0.5" data-testid="ops-order-docket-problems">
              {order.docket_error_problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          {order.docket_error_hint && (
            <p className="text-xs text-foreground mt-1.5 leading-relaxed" data-testid="ops-order-docket-hint">
              {order.docket_error_hint}
            </p>
          )}
          <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
            The order itself is unaffected.
          </p>
        </div>
      )}

      <section
        className="rounded-2xl border border-border bg-white px-4 mb-6"
        data-testid="ops-order-facts"
      >
        <Fact label="Status" value={getOrderStatusLabel(order.status)} />
        <Fact
          label="Mode"
          value={order.pickup_request === 2 ? 'Drop-off' : 'Pickup'}
        />
        <Fact
          label="Pickup date"
          value={order.pickup_date ?? '—'}
        />
        <Fact label="Booked weight" value={order.booked_weight != null ? `${order.booked_weight} kg` : '—'} />
        <Fact label="Actual weight" value={order.actual_weight != null ? `${order.actual_weight} kg` : '—'} />
        <Fact label="Quoted amount" value={formatMoney(order.quoted_amount)} />
        <Fact label="Final amount" value={formatMoney(order.final_amount)} />
        <Fact
          label="Payment"
          value={
            order.is_cod
              ? 'COD'
              : `${order.payment_method.replace(/_/g, ' ')} · ${order.payment_status}`
          }
        />
        {order.user_id ? (
          <Fact
            label="Customer"
            value={<OpsSenderCell order={order} context="detail" />}
          />
        ) : (
          <>
            <Fact
              label="Sender"
              value={<OpsSenderCell order={order} context="detail" />}
            />
            <Fact label="Sender phone" value={order.guest_phone?.trim() || '—'} />
            <Fact label="Sender email" value={order.guest_email?.trim() || '—'} />
          </>
        )}
        <Fact label="Consignee" value={consignee.name} />
        <Fact label="City" value={consignee.city} />
        <Fact label="Phone" value={consignee.phone} />
        <Fact
          label="Agent"
          value={
            order.agent_id ? order.agent_name?.trim() || 'Assigned' : 'Unassigned'
          }
        />
        <Fact label="AWB" value={order.awb_no ?? '—'} />
        <Fact label="Created" value={formatWhen(order.created_at)} />
      </section>

      {order.pickup_request === 1 &&
        order.status === 'pickup_requested' &&
        !order.agent_id && (
          <section
            className="rounded-2xl border border-border bg-white p-4 mb-6"
            data-testid="ops-assign-agent"
          >
            <h2 className="text-[11px] uppercase tracking-[0.14em] font-bold text-muted-foreground mb-3">
              Assign to agent
            </h2>
            <Label className="text-sm font-medium">Pickup agent</Label>
            <Select
              value={selectedAgentId || undefined}
              onValueChange={setSelectedAgentId}
            >
              <SelectTrigger
                className="h-12 bg-[#F3F4F6] border border-[#E2E8F0] rounded-xl mt-2 w-full"
                data-testid="select-ops-assign-agent"
              >
                <SelectValue placeholder="Select an agent" />
              </SelectTrigger>
              <SelectContent>
                {(staff.data ?? [])
                  .filter((user) => user.role === 'agent' && user.is_active)
                  .map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.full_name}
                      {user.phone ? ` · ${user.phone}` : ''}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {staff.isError && (
              <p className="text-sm text-red-600 mt-2">Could not load agents.</p>
            )}
            <Button
              type="button"
              disabled={!selectedAgentId || assign.isPending}
              onClick={() => {
                assign.mutate(
                  { agentId: selectedAgentId },
                  {
                    onSuccess: (result) => {
                      setSelectedAgentId('');
                      toast({
                        title: 'Assigned',
                        description: `${result.order.order_no} — ${getOrderStatusLabel(result.order.status)}`,
                      });
                    },
                    onError: (err: OpsActionError) => {
                      toast({
                        title:
                          err.status === 409 ? 'Pickup already taken' : 'Could not assign',
                        description:
                          err.status === 409
                            ? 'This pickup was just taken or assigned.'
                            : err.message,
                        variant: 'destructive',
                      });
                    },
                  },
                );
              }}
              className="mt-4 w-full h-12 rounded-xl bg-primary text-white font-bold"
              data-testid="button-ops-assign-agent"
            >
              {assign.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                'Confirm'
              )}
            </Button>
          </section>
        )}

      <section className="mb-6" data-testid="ops-order-actions">
        <h2 className="text-[11px] uppercase tracking-[0.14em] font-bold text-muted-foreground mb-3">
          Actions
        </h2>
        <ActionBar
          actions={availableActions}
          onAction={handleAction}
          pendingAction={pendingAction}
          disabled={action.isPending}
        />
      </section>

      <Dialog open={awbOpen} onOpenChange={(open) => !action.isPending && setAwbOpen(open)}>
        <DialogContent className="max-w-[calc(100vw-32px)] sm:max-w-md rounded-lg">
          <DialogHeader>
            <DialogTitle>Enter AWB from ITD portal</DialogTitle>
            <DialogDescription>
              This customer has no ITD login of their own. File the docket in ITD's portal, then enter
              the AWB it gave you. The order moves to Dispatched.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setAwbError(null);
              runAction('record_awb', { awb_no: awbValue.trim() });
            }}
          >
            <Label htmlFor="ops-awb-input">AWB</Label>
            <Input
              id="ops-awb-input"
              value={awbValue}
              onChange={(e) => setAwbValue(e.target.value)}
              autoFocus
              autoComplete="off"
              className="mt-1.5 font-mono"
              aria-invalid={awbError ? true : undefined}
              aria-describedby={awbError ? 'ops-awb-error' : undefined}
              data-testid="input-ops-awb"
            />
            {awbError && (
              <p id="ops-awb-error" className="mt-1.5 text-sm text-destructive" role="alert">
                {awbError}
              </p>
            )}
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setAwbOpen(false)} disabled={action.isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={action.isPending || awbValue.trim().length < 6} data-testid="button-ops-awb-save">
                {action.isPending && pendingAction === 'record_awb' ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : null}
                Save AWB
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <section data-testid="ops-order-timeline">
        <h2 className="text-[11px] uppercase tracking-[0.14em] font-bold text-muted-foreground mb-3">
          Timeline
        </h2>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No events yet.</p>
        ) : (
          <ol className="rounded-2xl border border-border bg-white divide-y divide-border">
            {events.map((ev) => (
              <li key={ev.id} className="px-4 py-3">
                <p className="text-sm font-extrabold text-foreground">
                  {getOrderStatusLabel(ev.status)}
                </p>
                {ev.note && (
                  <p className="text-sm text-muted-foreground mt-0.5">{ev.note}</p>
                )}
                <p className="text-[11px] font-medium text-muted-foreground mt-1 tabular-nums">
                  {formatWhen(ev.created_at)}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <OpsWeighSheet
        open={weighOpen}
        onOpenChange={setWeighOpen}
        bookedWeight={order.booked_weight}
        isPending={action.isPending && pendingAction === 'weigh'}
        onConfirm={(payload) => runAction('weigh', payload)}
      />

      <OpsCollectPaymentSheet
        open={collectOpen}
        onOpenChange={(open) => {
          setCollectOpen(open);
          if (!open) setReceipt(null);
        }}
        orderNo={order.order_no}
        dueAmount={dueAmount}
        isPending={action.isPending && pendingAction === 'collect_payment'}
        receipt={receipt}
        onConfirm={(payload) => runAction('collect_payment', payload)}
      />

      <OpsDropoffOtpSheet
        open={dropoffOpen}
        onOpenChange={(open) => {
          setDropoffOpen(open);
          if (!open) setDropoffError(null);
        }}
        isPending={action.isPending && pendingAction === 'mark_received_dropoff'}
        error={dropoffError}
        onConfirm={({ otp }) => runAction('mark_received_dropoff', { otp })}
      />
    </OpsShell>
  );
}
