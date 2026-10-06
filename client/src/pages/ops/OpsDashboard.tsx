import { useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowUpRight, ChevronRight, Search } from 'lucide-react';
import { isCodOrder, matchesOpsSection } from '@shared/opsBoardQuery';
import { OpsMobileField, OpsMobileItem, OpsMobileList } from '@/components/ops/OpsMobileList';
import { OpsShell } from '@/components/ops/OpsShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  useOpsCancellations,
  useOpsOrders,
  useOpsPayments,
  useOpsVerifications,
  type OpsBoardOrder,
} from '@/hooks/useOpsOrders';
import { useOpsApplications } from '@/hooks/useOpsApplications';
import { formatInr, formatIst } from '@/lib/orderDetail';
import { useCan, useOpsRole } from '@/lib/opsAccess';
import { DOC_SLOT_SPECS, isDocSlot } from '@shared/accountSpec';
import { roleLabel } from '@shared/staffAccess';

/**
 * The ops home: the six counts the team knows from the demo, then what needs
 * doing, where the parcels are, and the money.
 *
 * Built from what the signed-in role may see (shared/staffAccess.ts), so every
 * block on it is something that person can act on or is asked about. A branch
 * manager's numbers are already their own city's: the server filters them.
 *
 * Plain words over system words. "Pickups with no agent" rather than
 * "pickup_requested", and each count says what it counts.
 */

const todayLabel = new Date().toLocaleDateString('en-IN', {
  timeZone: 'Asia/Kolkata',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

// ── Building blocks ──────────────────────────────────────────────────────────

function SectionTitle({ title, note, action }: { title: string; note?: string; action?: React.ReactNode }) {
  return (
    // Heading and its button side by side: the heading takes what is left and
    // wraps if it must; the button stays compact and never shrinks.
    <div className="flex items-start justify-between gap-3 mb-2.5">
      <div className="min-w-0 flex-1">
        <h2 className="text-base font-bold text-foreground">{title}</h2>
        {note && <p className="text-xs text-muted-foreground mt-0.5">{note}</p>}
      </div>
      {action}
    </div>
  );
}

function SeeAll({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap h-8 sm:h-9 rounded-md border border-border bg-white pl-2.5 pr-1.5 sm:pl-3 sm:pr-2 text-xs sm:text-sm font-semibold text-foreground shadow-sm hover:bg-[#F8FAFC] hover:border-[#2F4468]/40 transition-colors"
    >
      {children}
      <ChevronRight className="w-4 h-4 text-muted-foreground" aria-hidden />
    </Link>
  );
}

/**
 * One line of work. The count is the point, so it sits right and large; the
 * words on the left say what it is and what to do about it. Zero reads as
 * done, not as an alarm.
 */
function WorkRow({
  label,
  detail,
  count,
  href,
  urgent = false,
  testId,
}: {
  label: string;
  detail: string;
  count: number;
  href: string;
  urgent?: boolean;
  testId: string;
}) {
  const clear = count === 0;
  return (
    <li>
      <Link
        href={href}
        className="ops-press flex items-center gap-4 px-4 py-3.5 hover:bg-[#F8FAFC] active:bg-[#F3F4F6]"
        data-testid={testId}
      >
        <div className="min-w-0 flex-1">
          <p className={cn('text-[15px] font-semibold', clear ? 'text-muted-foreground' : 'text-foreground')}>
            {label}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">{clear ? 'Nothing waiting' : detail}</p>
        </div>
        <span
          className={cn(
            'text-2xl font-extrabold tabular-nums',
            clear ? 'text-muted-foreground/60' : urgent ? 'text-[#B45309]' : 'text-foreground',
          )}
          data-testid={`${testId}-count`}
        >
          {count}
        </span>
        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden />
      </Link>
    </li>
  );
}

/** One of the six headline counts: label, number, and what is in it. */
function StockCard({
  label,
  hint,
  count,
  href,
  loading,
  testId,
}: {
  label: string;
  hint: string;
  count: number;
  href?: string;
  loading: boolean;
  testId: string;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">{label}</p>
        {href && (
          <ArrowUpRight
            className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
            aria-hidden
          />
        )}
      </div>
      {loading ? (
        <Skeleton className="h-8 w-14 mt-3 rounded-md" />
      ) : (
        <p
          className={cn(
            'text-[32px] leading-none font-extrabold tabular-nums mt-3',
            count === 0 ? 'text-muted-foreground/50' : 'text-foreground',
          )}
          data-testid={testId}
        >
          {count}
        </p>
      )}
      <p className="text-xs text-muted-foreground mt-2.5 leading-snug">{hint}</p>
    </>
  );
  const className = 'ops-press group block rounded-md border border-border bg-white px-4 py-4';
  if (href) {
    return (
      <Link href={href} className={cn(className, 'hover:border-[#2F4468]/40 hover:bg-[#FBFCFD]')}>
        {body}
      </Link>
    );
  }
  return <div className={className}>{body}</div>;
}

function Frame({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('rounded-md border border-border bg-white', className)}>{children}</div>;
}

function LoadingRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="p-4 space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-9 w-full rounded-md" />
      ))}
    </div>
  );
}

function LoadFailed({ what }: { what: string }) {
  return <p className="px-4 py-4 text-sm text-red-700">Could not load {what}. Refresh the page to try again.</p>;
}

// ── Where the parcels are ────────────────────────────────────────────────────

/** The order journey, in the words a caller would use, with the statuses each step covers. */
const JOURNEY: { label: string; statuses: string[]; href: string }[] = [
  { label: 'Booked, no agent', statuses: ['pickup_requested'], href: '/ops/pickups?assignment=unassigned' },
  { label: 'Agent assigned', statuses: ['agent_accepted'], href: '/ops/pickups?stage=inbound' },
  { label: 'Agent on the way', statuses: ['out_for_pickup'], href: '/ops/pickups?stage=inbound' },
  { label: 'Collected, coming to hub', statuses: ['picked_up'], href: '/ops/pickups?stage=inbound' },
  { label: 'Drop-off expected', statuses: ['awaiting_dropoff'], href: '/ops/dropoffs?stage=inbound' },
  { label: 'At hub, to weigh', statuses: ['received_at_hub'], href: '/ops/pickups?stage=hub' },
  { label: 'Weighed, to be paid', statuses: ['weighed'], href: '/ops/pickups?stage=hub' },
  { label: 'Paid, AWB next', statuses: ['settled', 'ready_for_docket'], href: '/ops/pickups?stage=settled' },
  { label: 'Dispatched', statuses: ['dispatched'], href: '/ops/dispatched' },
];

function Journey({ orders }: { orders: OpsBoardOrder[] }) {
  const counts = JOURNEY.map((step) => orders.filter((o) => step.statuses.includes(o.status)).length);
  return (
    <ol
      className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-9 gap-px rounded-md border border-border bg-border overflow-hidden [&>li:last-child]:col-span-2 sm:[&>li:last-child]:col-span-1"
      data-testid="ops-dash-journey"
    >
      {JOURNEY.map((step, i) => (
        <li key={step.label} className="bg-white">
          <Link
            href={step.href}
            className="h-full flex flex-col justify-between gap-2 px-3 py-3 hover:bg-[#F8FAFC] transition-colors"
          >
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground leading-snug">
              <span className="tabular-nums">{i + 1}.</span> {step.label}
            </span>
            <span
              className={cn('text-xl font-extrabold tabular-nums', counts[i] === 0 ? 'text-muted-foreground/60' : 'text-foreground')}
            >
              {counts[i]}
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function OpsDashboard() {
  const [, setLocation] = useLocation();
  const role = useOpsRole();
  const [jump, setJump] = useState('');
  const [jumpError, setJumpError] = useState('');

  const seesOrders = useCan('orders.view');
  const movesOrders = useCan('orders.act');
  const seesMoney = useCan('payments.view');
  const seesCustomers = useCan('customers.view');
  const reviews = useCan('applications.review');
  const scoped = role === 'branch_manager';

  const ordersQuery = useOpsOrders(seesOrders);
  const moneyQuery = useOpsPayments('today', seesMoney);
  const cancellationsQuery = useOpsCancellations(seesOrders);
  const verificationsQuery = useOpsVerifications(seesCustomers);
  const applicationsQuery = useOpsApplications('open', reviews);

  const orders = ordersQuery.data ?? [];
  const counts = useMemo(
    () => ({
      pickups: orders.filter((order) => matchesOpsSection(order, 'pickups')).length,
      dropoffs: orders.filter((order) => matchesOpsSection(order, 'dropoffs')).length,
      weigh: orders.filter((order) => order.status === 'received_at_hub').length,
      settle: orders.filter((order) => order.status === 'weighed').length,
      dispatched: orders.filter((order) => matchesOpsSection(order, 'dispatched')).length,
      cod: orders.filter((order) => isCodOrder(order)).length,
    }),
    [orders],
  );
  const work = useMemo(
    () => ({
      noAgent: orders.filter((o) => o.status === 'pickup_requested' && !o.agent_id).length,
      toWeigh: orders.filter((o) => o.status === 'received_at_hub').length,
      toSettle: orders.filter((o) => o.status === 'weighed').length,
      awbProblems: orders.filter((o) => !o.awb_no && !!o.docket_error).length,
    }),
    [orders],
  );

  const handleJump = (event: React.FormEvent): void => {
    event.preventDefault();
    const needle = jump.trim().toLowerCase();
    if (!needle) return;
    const match = orders.find((order) => order.order_no.toLowerCase().includes(needle));
    if (!match) {
      setJumpError('No order with that number in the latest 200. Try the Pickups search.');
      return;
    }
    setJumpError('');
    setLocation(`/ops/orders/${match.id}`);
  };

  const cancellations = cancellationsQuery.data?.cancellations ?? [];
  const waitingApplications = (applicationsQuery.data?.applications ?? []).filter(
    (a) => a.status === 'submitted',
  ).length;
  const unverified = verificationsQuery.data?.accounts ?? [];
  const totals = moneyQuery.data?.totals;

  const scopeNote = scoped ? 'Your city only' : 'All cities';

  return (
    <OpsShell
      title="Dashboard"
      subtitle={`${todayLabel} · ${roleLabel(role)}${seesOrders ? ` · ${scopeNote}` : ''}`}
      wide
    >
      {seesOrders && (
        <form onSubmit={handleJump} className="relative mb-5" data-testid="ops-dash-jump">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none"
            aria-hidden
          />
          <Input
            type="search"
            value={jump}
            onChange={(event) => {
              setJump(event.target.value);
              setJumpError('');
            }}
            placeholder="Jump to an order, e.g. BOM-100312"
            className="h-11 pl-9 pr-20 rounded-md bg-white"
            data-testid="ops-dash-jump-input"
            aria-label="Jump to order number"
          />
          <Button
            type="submit"
            size="sm"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 h-8 rounded-md px-4"
            data-testid="ops-dash-jump-submit"
          >
            Go
          </Button>
          {jumpError && (
            <p className="text-xs text-red-700 mt-1.5" data-testid="ops-dash-jump-miss">
              {jumpError}
            </p>
          )}
        </form>
      )}

      <div className="space-y-8">
        {/* ── The six counts, as in the demo ───────────────────────────── */}
        {seesOrders && (
          <section>
            {ordersQuery.isError ? (
              <Frame>
                <LoadFailed what="orders" />
              </Frame>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 ops-rise" data-testid="ops-dash-stock">
                <StockCard
                  label="Active pickups"
                  hint="Booked for pickup and not yet at the hub."
                  count={counts.pickups}
                  href="/ops/pickups"
                  loading={ordersQuery.isLoading}
                  testId="ops-dash-count-pickups"
                />
                <StockCard
                  label="Active drop-offs"
                  hint="Customer is bringing the parcel to the counter."
                  count={counts.dropoffs}
                  href="/ops/dropoffs"
                  loading={ordersQuery.isLoading}
                  testId="ops-dash-count-dropoffs"
                />
                <StockCard
                  label="Awaiting weigh"
                  hint="At the hub, still to be weighed."
                  count={counts.weigh}
                  href="/ops/pickups?stage=hub"
                  loading={ordersQuery.isLoading}
                  testId="ops-dash-count-weigh"
                />
                <StockCard
                  label="Awaiting settle"
                  hint="Weighed; the final amount is still to be paid."
                  count={counts.settle}
                  href="/ops/pickups?stage=hub"
                  loading={ordersQuery.isLoading}
                  testId="ops-dash-count-settle"
                />
                <StockCard
                  label="Dispatched"
                  hint="AWB made and sent on to the USA."
                  count={counts.dispatched}
                  href="/ops/dispatched"
                  loading={ordersQuery.isLoading}
                  testId="ops-dash-count-dispatched"
                />
                <StockCard
                  label="COD"
                  hint="Cash on delivery: the receiver pays in the USA."
                  count={counts.cod}
                  loading={ordersQuery.isLoading}
                  testId="ops-dash-count-cod"
                />
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-2">Counted from the latest 200 orders.</p>
          </section>
        )}

        {/* ── What needs doing ─────────────────────────────────────────── */}
        {(movesOrders || seesOrders || reviews) && (
          <section data-testid="ops-dash-work">
            <SectionTitle title="Needs action" note="Tap a line to see the orders or accounts behind it." />
            <Frame>
              {seesOrders && ordersQuery.isLoading ? (
                <LoadingRows rows={4} />
              ) : seesOrders && ordersQuery.isError ? (
                <LoadFailed what="orders" />
              ) : (
                <ul className="divide-y divide-border ops-rise">
                  {movesOrders && (
                    <>
                      <WorkRow
                        label="Pickups with no agent"
                        detail="Assign an agent so the pickup can go ahead."
                        count={work.noAgent}
                        href="/ops/pickups?assignment=unassigned"
                        urgent
                        testId="ops-dash-work-no-agent"
                      />
                      <WorkRow
                        label="Parcels at the hub to weigh"
                        detail="Weigh them so the final price can be charged."
                        count={work.toWeigh}
                        href="/ops/pickups?stage=hub"
                        testId="ops-dash-work-weigh"
                      />
                      <WorkRow
                        label="Weighed, payment still due"
                        detail="Collect what is owed before the AWB is made."
                        count={work.toSettle}
                        href="/ops/pickups?stage=hub"
                        testId="ops-dash-work-settle"
                      />
                    </>
                  )}
                  {seesOrders && (
                    <>
                      <WorkRow
                        label="AWB could not be made"
                        detail="ITD refused or failed. Open each order to see why."
                        count={work.awbProblems}
                        href="/ops/pickups?stage=settled"
                        urgent
                        testId="ops-dash-work-awb"
                      />
                      <WorkRow
                        label="Customers asking to cancel"
                        detail="Approve or decline each request."
                        count={cancellationsQuery.data?.count ?? 0}
                        href="#ops-dash-cancellations"
                        urgent
                        testId="ops-dash-work-cancel"
                      />
                    </>
                  )}
                  {reviews && (
                    <WorkRow
                      label="New accounts to review"
                      detail="Check documents and open or send back."
                      count={waitingApplications}
                      href="/ops/applications"
                      testId="ops-dash-work-applications"
                    />
                  )}
                </ul>
              )}
            </Frame>
          </section>
        )}

        {/* ── Where the parcels are ────────────────────────────────────── */}
        {seesOrders && (
          <section>
            <SectionTitle
              title="Where orders are now"
              note="Each step of the journey, from booking to dispatch. Counts the latest 200 orders."
            />
            {ordersQuery.isLoading ? (
              <Frame>
                <LoadingRows rows={2} />
              </Frame>
            ) : ordersQuery.isError ? (
              <Frame>
                <LoadFailed what="orders" />
              </Frame>
            ) : (
              <Journey orders={orders} />
            )}
          </section>
        )}

        <div className="grid gap-8 lg:grid-cols-2">
          {/* ── Money ──────────────────────────────────────────────────── */}
          {seesMoney && (
            <section data-testid="ops-dash-money">
              <SectionTitle
                title="Money received today"
                action={<SeeAll href="/ops/transactions">All transactions</SeeAll>}
              />
              <Frame>
                {moneyQuery.isLoading ? (
                  <LoadingRows rows={3} />
                ) : moneyQuery.isError || !totals ? (
                  <LoadFailed what="today's payments" />
                ) : (
                  <dl className="divide-y divide-border">
                    {(
                      [
                        ['Cash collected by agents and at the counter', totals.cash],
                        ['UPI collected by agents and at the counter', totals.upi],
                        ['Paid online by customers', totals.gateway],
                      ] as const
                    ).map(([label, amount]) => (
                      <div key={label} className="flex items-baseline justify-between gap-4 px-4 py-3 text-sm">
                        <dt className="text-foreground">{label}</dt>
                        <dd className="font-semibold tabular-nums whitespace-nowrap">{formatInr(amount) ?? '₹0'}</dd>
                      </div>
                    ))}
                    <div className="flex items-baseline justify-between gap-4 px-4 py-3">
                      <dt className="text-sm font-bold">
                        Total <span className="font-normal text-muted-foreground">({totals.count} payments)</span>
                      </dt>
                      <dd className="text-lg font-extrabold tabular-nums whitespace-nowrap">
                        {formatInr(totals.all) ?? '₹0'}
                      </dd>
                    </div>
                  </dl>
                )}
              </Frame>
            </section>
          )}

          {/* ── Cancellation requests ──────────────────────────────────── */}
          {seesOrders && (
            <section id="ops-dash-cancellations" data-testid="ops-dash-attention">
              <SectionTitle title="Cancellation requests" note="Customers who asked to cancel. Open the order to decide." />
              <Frame>
                {cancellationsQuery.isLoading ? (
                  <LoadingRows rows={2} />
                ) : cancellationsQuery.isError ? (
                  <LoadFailed what="cancellation requests" />
                ) : cancellations.length === 0 ? (
                  <p className="px-4 py-4 text-sm text-muted-foreground">No one is asking to cancel.</p>
                ) : (
                  <>
                  <OpsMobileList className="border-0 rounded-none">
                    {cancellations.map((row) => (
                      <OpsMobileItem
                        key={row.id}
                        href={`/ops/orders/${row.id}`}
                        title={row.order_no}
                        testId={`ops-dash-cancel-card-${row.order_no}`}
                      >
                        <OpsMobileField label="Reason">{row.reason || 'No reason given'}</OpsMobileField>
                        <OpsMobileField label="Asked on">{formatIst(row.requested_at)}</OpsMobileField>
                      </OpsMobileItem>
                    ))}
                  </OpsMobileList>
                  <div className="hidden md:block overflow-x-auto">
                    <table className="ops-table min-w-[420px]">
                      <thead>
                        <tr>
                          <th>Order</th>
                          <th>Reason given</th>
                          <th>Asked on</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cancellations.map((row) => (
                          <tr
                            key={row.id}
                            data-href={`/ops/orders/${row.id}`}
                            onClick={() => setLocation(`/ops/orders/${row.id}`)}
                          >
                            <td className="nowrap">
                              <Link
                                href={`/ops/orders/${row.id}`}
                                className="font-semibold hover:underline"
                                data-testid={`ops-dash-cancel-${row.order_no}`}
                              >
                                {row.order_no}
                              </Link>
                            </td>
                            <td>{row.reason || <span className="text-muted-foreground">No reason given</span>}</td>
                            <td className="nowrap text-muted-foreground">{formatIst(row.requested_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  </>
                )}
              </Frame>
            </section>
          )}
        </div>

        {/* ── Customers missing documents ──────────────────────────────── */}
        {seesCustomers && (
          <section data-testid="ops-dash-verifications">
            <SectionTitle
              title="Customers with documents missing"
              note="Their orders run until the AWB step, then stop until the documents are in."
              action={<SeeAll href="/ops/customers">All customers</SeeAll>}
            />
            <Frame>
              {verificationsQuery.isLoading ? (
                <LoadingRows rows={3} />
              ) : verificationsQuery.isError ? (
                <LoadFailed what="customers" />
              ) : unverified.length === 0 ? (
                <p className="px-4 py-4 text-sm text-muted-foreground">Every customer has sent their documents.</p>
              ) : (
                <>
                <OpsMobileList className="border-0 rounded-none">
                  {unverified.slice(0, 8).map((row) => (
                    <OpsMobileItem
                      key={row.id}
                      href={`/ops/customers/${row.id}`}
                      title={row.company_name || row.full_name || 'Unnamed account'}
                    >
                      <OpsMobileField label="Phone">{row.phone ? `+91 ${row.phone}` : '—'}</OpsMobileField>
                      {row.missing.length > 0 && (
                        <OpsMobileField label="Not sent">{slotNames(row.missing)}</OpsMobileField>
                      )}
                      {row.unverified.length > 0 && (
                        <OpsMobileField label="Unreadable">{slotNames(row.unverified)}</OpsMobileField>
                      )}
                    </OpsMobileItem>
                  ))}
                </OpsMobileList>
                <div className="hidden md:block overflow-x-auto">
                  <table className="ops-table min-w-[640px]">
                    <thead>
                      <tr>
                        <th>Customer</th>
                        <th>Phone</th>
                        <th>Not sent yet</th>
                        <th>Sent but unreadable</th>
                      </tr>
                    </thead>
                    <tbody>
                      {unverified.slice(0, 8).map((row) => (
                        <tr
                          key={row.id}
                          data-href={`/ops/customers/${row.id}`}
                          onClick={() => setLocation(`/ops/customers/${row.id}`)}
                        >
                          <td>
                            <Link href={`/ops/customers/${row.id}`} className="font-semibold hover:underline">
                              {row.company_name || row.full_name || 'Unnamed account'}
                            </Link>
                            {row.company_name && row.full_name && (
                              <p className="text-xs text-muted-foreground mt-0.5">{row.full_name}</p>
                            )}
                          </td>
                          <td className="nowrap tabular-nums">{row.phone ? `+91 ${row.phone}` : '—'}</td>
                          <td>{slotNames(row.missing)}</td>
                          <td>{slotNames(row.unverified)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                </>
              )}
            </Frame>
            {unverified.length > 0 && (
              <p className="text-xs text-muted-foreground mt-2" data-testid="ops-dash-verification-count">
                {unverified.length > 8
                  ? `Showing 8 of ${unverified.length} customers. The rest are on the Customers page.`
                  : `${unverified.length} customer${unverified.length === 1 ? '' : 's'}`}
              </p>
            )}
          </section>
        )}
      </div>
    </OpsShell>
  );
}

function slotNames(slots: string[]): React.ReactNode {
  if (slots.length === 0) return <span className="text-muted-foreground">—</span>;
  return slots.map((slot) => (isDocSlot(slot) ? DOC_SLOT_SPECS[slot].label : slot)).join(', ');
}
