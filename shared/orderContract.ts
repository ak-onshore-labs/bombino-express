/**
 * M0 item 3 — the shared order vocabulary.
 *
 * Imported by both server and client. Nothing in here may import from
 * `server/` or `client/`, and nothing here may touch the database or the
 * network: it is types plus pure functions, so both lanes can compile against
 * it independently.
 *
 * The status vocabulary is frozen. No additions without both developers
 * agreeing — see docs/final-phase/markdowns/final-phase-modules.md §3.
 */

// ── Status ────────────────────────────────────────────────────────────────

/**
 * Pickup path:   pickup_requested → agent_accepted → out_for_pickup
 *                  → picked_up → received_at_hub
 * Drop-off path: awaiting_dropoff → received_at_hub
 * Both, at hub:  received_at_hub → weighed → settled → ready_for_docket
 *                  → dispatched
 * Plus `cancelled` from most states.
 */
export type OrderStatus =
  | 'pickup_requested'
  | 'agent_accepted'
  | 'out_for_pickup'
  | 'picked_up'
  | 'awaiting_dropoff'
  | 'received_at_hub'
  | 'weighed'
  | 'settled'
  | 'ready_for_docket'
  | 'dispatched'
  | 'cancelled';

/** Runtime companion to `OrderStatus` — mirrors the DB CHECK constraint. */
export const ORDER_STATUSES: readonly OrderStatus[] = [
  'pickup_requested',
  'agent_accepted',
  'out_for_pickup',
  'picked_up',
  'awaiting_dropoff',
  'received_at_hub',
  'weighed',
  'settled',
  'ready_for_docket',
  'dispatched',
  'cancelled',
] as const;

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === 'string' && (ORDER_STATUSES as readonly string[]).includes(value);
}

// ── Roles ─────────────────────────────────────────────────────────────────

export type Role = 'customer' | 'agent' | 'admin' | 'super_admin';

export const ROLES: readonly Role[] = ['customer', 'agent', 'admin', 'super_admin'] as const;

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/**
 * Anything ops can do, super_admin can do. Kept as a helper rather than
 * baked into each transition row so M7 landing (or not landing) changes one
 * place. Note this is *not* a general hierarchy — an admin is not an agent,
 * because ops must never claim a pickup on an agent's behalf (§1).
 */
export function roleSatisfies(callerRole: Role, requiredRole: Role): boolean {
  if (callerRole === requiredRole) return true;
  return callerRole === 'super_admin' && requiredRole === 'admin';
}

// ── Payment ───────────────────────────────────────────────────────────────

export type PaymentMethod = 'pay_now' | 'pay_at_pickup' | 'pay_at_dropoff' | 'cod';

export type PaymentStatus = 'pending' | 'paid' | 'partially_paid' | 'refund_due' | 'failed';

// ── Order ─────────────────────────────────────────────────────────────────

/**
 * The order as both lanes see it. Field names match the `orders` columns
 * one-for-one so a row can be handed across without a mapping layer.
 *
 * Fulfilment columns are nullable because A3 never writes them — see the
 * column-partition table in §4.
 */
export interface Order {
  id: string;
  order_no: string;
  user_id: string;
  status: OrderStatus;

  // [A3] booking
  /** ITD's convention: 1 = pickup, 2 = drop-off. */
  pickup_request: 1 | 2;
  pickup_date: string | null;
  origin_address_id: string | null;
  consignee: unknown;
  items: unknown;
  booked_weight: number | null;
  quoted_amount: number | null;
  /**
   * The customer asked us to pack the parcel. Nothing about it is priced at
   * booking — packaging cost, where it applies, lands in `final_amount` at the
   * hub like every other reprice. It is here so the agent knows to carry
   * material before they leave, and ops knows to pack at the counter.
   */
  packaging_required: boolean;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  is_cod: boolean;

  // [fulfilment] M2/M3/M5/A5
  agent_id: string | null;
  actual_weight: number | null;
  final_amount: number | null;
  awb_no: string | null;

  metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

// ── Actions ───────────────────────────────────────────────────────────────

/**
 * Every lifecycle verb, for every role and surface. One endpoint consumes
 * these: POST /api/orders/:id/actions.
 */
export type Action =
  // agent (A5)
  | 'claim'
  | 'start_pickup'
  | 'mark_picked_up'
  | 'mark_received_at_hub'
  // collection — agent at the door (A5), ops at the counter (M3)
  | 'collect_payment'
  // ops (M2/M3/M5)
  | 'mark_received_dropoff'
  // ops — complete an OTP-gated handover without the code. The customer's
  // phone is dead, the agent is at the door, and the parcel must not be
  // stranded for it. Always audited.
  | 'override_handover'
  | 'weigh'
  | 'settle'
  | 'generate_docket'
  // customer — asks; does not decide. See `cancel` below.
  | 'request_cancellation'
  // ops — the other half of the decision. `cancel` approves a request;
  // this declines it and leaves the order running.
  | 'reject_cancellation'
  // ops only. A customer cannot cancel their own order: the parcel may already
  // be routed, an agent may be en route, and money may have moved. They raise a
  // request and ops acts on it.
  | 'cancel';

/**
 * One entry per button the caller may legally press right now. The server
 * computes these; the UI renders one control per entry and holds no copy of
 * the state machine itself. That is what lets either developer add or rename
 * a transition without touching the other's code.
 */
export interface AvailableAction {
  action: Action;
  label: string;
  /** True when the action needs input (a weight, an amount) before it fires. */
  requiresPayload?: boolean;
}

// ── Cancellation requests ─────────────────────────────────────────────────

/**
 * A customer asking for their order to be cancelled.
 *
 * Lives in `orders.metadata.cancellation_request` — the escape hatch §4 keeps
 * for exactly this, and the same place A4 keeps its gateway ids. No column,
 * because `orders` is column-partitioned between the two lanes and a request is
 * neither a booking fact nor a fulfilment fact: it is a message from the
 * customer to ops, and it stops mattering the moment ops acts.
 *
 * The request never moves the order. `status` still says `agent_accepted`
 * because the agent is still expected to collect the parcel until ops says
 * otherwise — a pending request is not a cancelled order, and treating it as
 * one is how a customer ends up with a parcel nobody came for.
 */
export interface CancellationRequest {
  /** ISO instant the customer asked. */
  requested_at: string;
  /** `itd_users.id` of the customer who asked. */
  requested_by: string;
  /** Free text, or null when they gave no reason. */
  reason: string | null;
  /**
   * Where ops has got to. Absent on rows written before decisions existed,
   * which `cancellationState` reads as still pending — the safe direction,
   * since an undecided request is exactly what those rows were.
   */
  status?: CancellationRequestStatus;
  decided_at?: string | null;
  /** `itd_users.id` of the ops user who approved or declined. */
  decided_by?: string | null;
  /** Why ops declined. The customer reads this, so it is never an id or a code. */
  decision_note?: string | null;
}

export type CancellationRequestStatus = 'pending' | 'approved' | 'rejected';

/**
 * Where an order stands on cancellation, as one value the UI can switch on.
 *
 * `approved` is derived from `status === 'cancelled'` rather than trusted from
 * metadata: the order row is the truth about whether an order is cancelled, and
 * a metadata blob that disagreed with it would be a bug that showed the
 * customer a cancelled parcel still coming, or the reverse.
 */
export type CancellationState = 'none' | 'pending' | 'approved' | 'rejected';

function isCancellationRequest(value: unknown): value is CancellationRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  return typeof r.requested_at === 'string' && typeof r.requested_by === 'string';
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

export function readCancellationRequest(
  order: Pick<Order, 'metadata'>
): CancellationRequest | null {
  const raw = order.metadata?.cancellation_request;
  if (!isCancellationRequest(raw)) return null;
  return {
    requested_at: raw.requested_at,
    requested_by: raw.requested_by,
    reason: optionalString(raw.reason),
    status: raw.status === 'approved' || raw.status === 'rejected' ? raw.status : 'pending',
    decided_at: optionalString(raw.decided_at),
    decided_by: optionalString(raw.decided_by),
    decision_note: optionalString(raw.decision_note),
  };
}

export function cancellationState(
  order: Pick<Order, 'metadata' | 'status'>
): CancellationState {
  if (order.status === 'cancelled') {
    // Cancelled with no request behind it — ops acted on a phone call. Still
    // an approved cancellation as far as anyone reading the order is concerned.
    return 'approved';
  }
  const request = readCancellationRequest(order);
  if (!request) return 'none';
  return request.status === 'rejected' ? 'rejected' : 'pending';
}

/**
 * A request still waiting on ops.
 *
 * Guards the customer's request button (no asking twice) and ops' decision
 * buttons (nothing to decide without an open request).
 */
export function hasOpenCancellationRequest(order: Pick<Order, 'metadata' | 'status'>): boolean {
  return cancellationState(order) === 'pending';
}

// ── Customer-facing derivation (M6 owns the fan-out; this is the mapping) ──

/**
 * Internal status → the phrase the customer reads. The customer never sees
 * `weighed`, `settled` or `ready_for_docket`: between arriving at the hub and
 * being dispatched their view deliberately sits still, so all three resolve
 * to the same "Arrived at Bombino hub" the parcel already showed.
 */
const CUSTOMER_STATUS: Record<OrderStatus, string> = {
  pickup_requested: 'Pickup requested',
  awaiting_dropoff: 'Awaiting drop-off',
  agent_accepted: 'Pickup confirmed',
  out_for_pickup: 'Agent on the way',
  picked_up: 'Parcel picked up',
  received_at_hub: 'Arrived at Bombino hub',
  // Internal — no visible change. Not a bug: see §2 of roles-and-flows.
  weighed: 'Arrived at Bombino hub',
  settled: 'Arrived at Bombino hub',
  ready_for_docket: 'Arrived at Bombino hub',
  dispatched: 'In transit',
  cancelled: 'Cancelled',
};

/**
 * The same mapping, keyed by a bare status.
 *
 * The list screens hold an order row, not a whole `Order` — `GET /api/orders`
 * returns a narrower projection than the detail endpoint. Without this they
 * were reaching for their own label table and printing `weighed` / `settled`
 * to the customer, which is precisely what `CUSTOMER_STATUS` exists to stop.
 * One vocabulary, two call shapes.
 */
export function customerStatusForStatus(status: string): string {
  return CUSTOMER_STATUS[status as OrderStatus] ?? 'Processing';
}

export function deriveCustomerStatus(order: Order): string {
  return customerStatusForStatus(order.status);
}

/**
 * Statuses the order row never moves out of. Nothing more will happen to it in
 * our database: `dispatched` hands the parcel to ITD (tracking continues under
 * the AWB, not here) and `cancelled` is the end of the road.
 *
 * Read by the client to stop polling. Never use it as an authorisation check —
 * the legal transitions live in `server/orderLifecycle.ts` and only there.
 */
export const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = [
  'dispatched',
  'cancelled',
] as const;

export function isTerminalOrderStatus(status: string): boolean {
  return (TERMINAL_ORDER_STATUSES as readonly string[]).includes(status);
}

/**
 * Statuses that produce no customer-visible change and must fire no
 * notification. M6 reads this to stay silent.
 */
export const INTERNAL_ONLY_STATUSES: readonly OrderStatus[] = [
  'weighed',
  'settled',
  'ready_for_docket',
] as const;

export function isInternalOnlyStatus(status: OrderStatus): boolean {
  return (INTERNAL_ONLY_STATUSES as readonly string[]).includes(status);
}

// ── Payment gate ──────────────────────────────────────────────────────────

/**
 * The single helper both lanes use to answer "may this order advance toward a
 * docket?".
 *
 * STUB — M3 owns the real implementation (reconciliation against `payments`
 * rows and the reprice delta). The signature is fixed here so A5 and M3 can be
 * written against it in parallel.
 *
 * Returns false for everything except COD, which passes by design and must
 * never block a docket (§4, Flow C). Erring closed means a premature caller
 * gets a refusal rather than a wrongly-dispatched parcel.
 */
export function isPaymentSatisfied(order: Order): boolean {
  if (order.is_cod || order.payment_method === 'cod') return true;
  return order.payment_status === 'paid';
}
