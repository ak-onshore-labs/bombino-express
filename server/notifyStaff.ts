/**
 * Telling the team — WhatsApp to the ops console's people at the moments they
 * have to act.
 *
 * `notify.ts` speaks to the customer and the agent holding the job. This file
 * speaks to staff, and its only real job is choosing who: the role sheet in
 * docs/final-phase/staff-whatsapp-templates.xlsx, as approved by the team.
 *
 *   new account request     customer support, KYC
 *   parcel received at hub  the branch; support too for a customer drop-off
 *   weighed heavier         support, accounts, the branch
 *   AWB waiting on customer support, admin
 *   new pickup              the branch
 *   agent cancelled pickup  the branch
 *   cancellation requested  admin, the branch, support
 *   AWB failed              admin, super admin, the branch
 *   refund due              accounts, admin
 *
 * And on a clock (`staffSchedule.ts`):
 *
 *   daily summary 9 am      each branch its city; admins, super admins all
 *   unassigned 9 am / 6 pm  the branch (today's / tomorrow's pickups)
 *   overdue 8 pm            the branch, per pickup still not collected
 *
 * "The branch" is the branch managers of the order's pickup city, worked out
 * the same way as the city filter on their boards (`pickupCity`). When nobody
 * on the list exists yet (a city with no branch manager, no accounts team) the
 * message goes to the admins instead, or the super admins if there are no
 * admins, so nothing anyone has to act on is told to nobody.
 *
 * Test orders go to test staff only, and real orders to real staff only — the
 * same split as the boards (server/testOrders.ts).
 *
 * Recipients are read fresh on every event: staff are few, events are not
 * frequent, and a branch manager added this morning hears about this
 * afternoon's pickups without a restart.
 *
 * NON-FATAL, like everything in `notify.ts`. Call with `void`.
 */

import type { Order } from "../shared/orderContract.js";
import { readAgentCancellation, readCancellationRequest } from "../shared/orderContract.js";
import { explainDocketError } from "../shared/docketError.js";
import { hubCityForId } from "../shared/hubs.js";
import { OPS_ROLES, isOpsRole, type OpsRole } from "../shared/staffAccess.js";
import { isTestOrderMetadata } from "../shared/testOrders.js";
import { pickupCity } from "./assignableAgents.js";
import { dbClient, logDbError } from "./db/client.js";
import { deliver } from "./notify.js";
import { getOrderById, getUserContactsByIds } from "./ordersDb.js";
import { isTestPhone } from "./testOrders.js";
import {
  displayIndianPhone,
  orderArea,
  staffAgentCancelledMessage,
  staffAwbFailedMessage,
  staffCancellationRequestMessage,
  staffCustomerActionNeededMessage,
  staffDailySummaryMessage,
  staffNewApplicationMessage,
  staffNewPickupMessage,
  staffParcelAtHubMessage,
  staffPickupOverdueMessage,
  staffPickupsUnassignedMessage,
  staffRefundDueMessage,
  staffWeighedHeavierMessage,
  type DailySummary,
  type WhatsappMessage,
} from "./whatsappTemplates.js";

const getSupabaseClient = () => dbClient("notifyStaff");

export interface StaffMember {
  id: string;
  phone: string;
  role: OpsRole;
  city: string | null;
  test: boolean;
}

export interface Audience {
  /** Everyone in these roles, every city. Never `branch_manager`: use `branch`. */
  roles: OpsRole[];
  /** The order city's branch managers, or the admins where it has none. */
  branch?: boolean;
}

/** Every active ops account with a number to message. Empty on a DB miss. */
async function loadStaff(): Promise<StaffMember[]> {
  const client = getSupabaseClient();
  if (!client) return [];

  const { data, error } = await client
    .from("itd_users")
    .select("id, phone, role, metadata")
    .in("role", [...OPS_ROLES])
    .eq("is_active", true);
  if (error) {
    logDbError("notifyStaff", "loadStaff", error);
    return [];
  }

  const out: StaffMember[] = [];
  for (const row of data ?? []) {
    const phone = typeof row.phone === "string" ? row.phone.trim() : "";
    if (!phone || !isOpsRole(row.role)) continue;
    const metadata =
      row.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>) : {};
    out.push({
      id: String(row.id),
      phone,
      role: row.role,
      city: hubCityForId(metadata.hub_id),
      test: isTestPhone(phone),
    });
  }
  return out;
}

/** Who hears it. Pure; exported for the tests. */
export function pickStaff(staff: StaffMember[], audience: Audience, city: string | null, test: boolean): StaffMember[] {
  const side = staff.filter((s) => s.test === test);
  const chosen = side.filter((s) => audience.roles.includes(s.role));
  if (audience.branch) {
    chosen.push(...side.filter((s) => s.role === "branch_manager" && city !== null && s.city === city));
  }
  // Nobody holds the roles yet (no accounts team, no branch in that city):
  // the admins hear it instead, and the super admins if there are no admins.
  // Something someone has to act on must never go to nobody.
  for (const fallback of ["admin", "super_admin"] as const) {
    if (chosen.length > 0) break;
    chosen.push(...side.filter((s) => s.role === fallback));
  }
  return [...new Map(chosen.map((s) => [s.id, s])).values()];
}

async function tell(input: {
  audience: Audience;
  message: WhatsappMessage;
  city: string | null;
  test: boolean;
  orderId: string | null;
  /** The dedupe scope; each recipient's id is appended. */
  scope: string;
}): Promise<void> {
  try {
    const people = pickStaff(await loadStaff(), input.audience, input.city, input.test);
    await Promise.all(
      people.map((person) =>
        deliver({
          message: input.message,
          to: person.phone,
          userId: person.id,
          orderId: input.orderId,
          scope: `${input.scope}:staff:${person.id}`,
        })
      )
    );
  } catch (error) {
    console.error("[notifyStaff] fan-out threw (swallowed)", {
      template: input.message.template,
      scope: input.scope,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Order events: the order's city, its test side, scoped to the order. */
async function tellAboutOrder(order: Order, audience: Audience, message: WhatsappMessage): Promise<void> {
  await tell({
    audience,
    message,
    city: await pickupCity(order.items),
    test: isTestOrderMetadata(order.metadata),
    orderId: order.id,
    scope: order.id,
  });
}

function displayPhone(phone: string | null | undefined): string | null {
  return phone ? displayIndianPhone(phone) : null;
}

/** "Name, +91 …" for whoever booked: the account, else the guest's details. */
async function customerLine(order: Order): Promise<string> {
  let name = order.guest_name ?? null;
  let phone = order.guest_phone ?? null;
  if (order.user_id) {
    const contact = (await getUserContactsByIds([order.user_id])).get(order.user_id);
    name = contact?.full_name ?? name;
    phone = contact?.phone ?? phone;
  }
  return [name, displayPhone(phone)].filter(Boolean).join(", ") || "-";
}

// ── Events ────────────────────────────────────────────────────────────────

export async function notifyStaffOfApplication(input: {
  applicationId: string;
  resent: boolean;
  name: string;
  accountType: string;
  phone: string;
  at: string;
}): Promise<void> {
  await tell({
    audience: { roles: ["customer_support", "kyc_reviewer"] },
    message: staffNewApplicationMessage({
      resent: input.resent,
      name: input.name,
      accountType: input.accountType,
      phone: displayPhone(input.phone) ?? input.phone,
      at: input.at,
    }),
    city: null,
    test: isTestPhone(input.phone),
    orderId: null,
    scope: `application:${input.applicationId}`,
  });
}

/** A pickup booked. Since 6 Oct the branch assigns every one, so it has to know. */
export async function notifyStaffOfBooking(order: Order): Promise<void> {
  if (order.pickup_request !== 1) return;
  await tellAboutOrder(order, { roles: [], branch: true }, staffNewPickupMessage({ order, area: orderArea(order) }));
}

/**
 * Whatever an order action means for the team. Called from the action
 * endpoint with the order before and after, once the write has landed.
 */
export async function notifyStaffOfAction(input: {
  before: Order;
  after: Order;
  action: string;
  actorUserId: string | null;
}): Promise<void> {
  const { before, after, action } = input;

  if (after.status === "received_at_hub" && before.status !== "received_at_hub") {
    // Support hears about drop-offs only: a pickup's arrival is the agent's
    // doing and shows in the branch's own board (team review, question 1).
    const dropoff = after.pickup_request === 2;
    await tellAboutOrder(
      after,
      { roles: dropoff ? ["customer_support"] : [], branch: true },
      staffParcelAtHubMessage({ order: after, city: await pickupCity(after.items), customer: await customerLine(after) })
    );
    return;
  }

  if (action === "weigh") {
    const extra =
      after.final_amount !== null && after.quoted_amount !== null
        ? Math.round(after.final_amount - after.quoted_amount)
        : 0;
    if (extra <= 0) return;
    await tellAboutOrder(
      after,
      { roles: ["customer_support", "accounts"], branch: true },
      staffWeighedHeavierMessage({ order: after, extra, customer: await customerLine(after) })
    );
    return;
  }

  if (action === "release_pickup") {
    const agentId = readAgentCancellation(after)?.agent_id ?? input.actorUserId ?? before.agent_id;
    const agentName = agentId ? (await getUserContactsByIds([agentId])).get(agentId)?.full_name ?? null : null;
    await tellAboutOrder(
      after,
      { roles: [], branch: true },
      staffAgentCancelledMessage({
        order: after,
        agentName,
        area: orderArea(after),
        at: readAgentCancellation(after)?.at ?? after.updated_at,
      })
    );
    return;
  }

  if (action === "request_cancellation") {
    const request = readCancellationRequest(after);
    await tellAboutOrder(
      after,
      { roles: ["admin", "customer_support"], branch: true },
      staffCancellationRequestMessage({
        order: after,
        city: await pickupCity(after.items),
        reason: request?.reason ?? null,
        at: request?.requested_at ?? after.updated_at,
      })
    );
  }
}

/**
 * A docket that did not file, as `docketFiling.ts` recorded it.
 *
 * Silent while the retry sweep still owns it (`retry: "auto"`): those mostly
 * clear by themselves, and the sweep hands over with `retry: "ops"` when they
 * don't. Waiting on the customer's ID document is support's to chase.
 */
export async function notifyStaffOfDocketProblem(
  order: Order,
  detail: { stage: string; retry: string; message: string }
): Promise<void> {
  if (detail.stage === "kyc") {
    await tellAboutOrder(
      order,
      { roles: ["customer_support", "admin"] },
      staffCustomerActionNeededMessage({
        order,
        missing: "identity document missing",
        customer: await customerLine(order),
      })
    );
    return;
  }
  if (detail.retry === "auto") return;

  await tellAboutOrder(
    order,
    { roles: ["admin", "super_admin"], branch: true },
    staffAwbFailedMessage({
      order,
      city: await pickupCity(order.items),
      reason: explainDocketError(detail.message, detail.stage, detail.retry).reason,
      stage: detail.stage,
    })
  );
}

// ── On a clock (`staffSchedule.ts`) ───────────────────────────────────────

/** One reminder per city: the count, not a list. The board has the list. */
export async function notifyStaffOfUnassignedPickups(input: {
  city: string | null;
  count: number;
  date: string;
  slot: string;
  test: boolean;
}): Promise<void> {
  if (input.count <= 0) return;
  await tell({
    audience: { roles: [], branch: true },
    message: staffPickupsUnassignedMessage(input),
    city: input.city,
    test: input.test,
    orderId: null,
    scope: `unassigned:${input.city ?? "no-city"}`,
  });
}

export async function notifyStaffOfOverduePickup(input: {
  order: Order;
  city: string | null;
  agentName: string | null;
  runDate: string;
}): Promise<void> {
  await tell({
    audience: { roles: [], branch: true },
    message: staffPickupOverdueMessage(input),
    city: input.city,
    test: isTestOrderMetadata(input.order.metadata),
    orderId: input.order.id,
    scope: input.order.id,
  });
}

/**
 * The morning summary: each branch manager gets their own city, admins and
 * super admins every city. A branch manager with no city on their account sees
 * no orders on their board either, so gets nothing here.
 */
export async function notifyStaffDailySummary(input: {
  date: string;
  test: boolean;
  all: DailySummary;
  byCity: Map<string, DailySummary>;
  empty: DailySummary;
}): Promise<void> {
  try {
    const staff = (await loadStaff()).filter((s) => s.test === input.test);
    const sends: Promise<void>[] = [];
    for (const person of staff) {
      let city: string | null;
      let summary: DailySummary;
      if (person.role === "admin" || person.role === "super_admin") {
        city = null;
        summary = input.all;
      } else if (person.role === "branch_manager" && person.city) {
        city = person.city;
        summary = input.byCity.get(person.city) ?? input.empty;
      } else {
        continue;
      }
      sends.push(
        deliver({
          message: staffDailySummaryMessage({ city, date: input.date, summary }),
          to: person.phone,
          userId: person.id,
          orderId: null,
          scope: `summary:staff:${person.id}`,
        })
      );
    }
    await Promise.all(sends);
  } catch (error) {
    console.error("[notifyStaff] daily summary threw (swallowed)", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** The order now holds more money than it costs (`paymentsDb.reconcilePaymentStatus`). */
export async function notifyStaffOfRefundDue(input: { order: Order; amount: number }): Promise<void> {
  const { amount } = input;
  if (amount <= 0) return;
  // paymentsDb's row has no guest columns; the customer line needs them.
  const order = (await getOrderById(input.order.id)) ?? input.order;
  await tellAboutOrder(
    order,
    { roles: ["accounts", "admin"] },
    staffRefundDueMessage({
      order,
      amount,
      customer: await customerLine(order),
      reason: order.status === "cancelled" ? "cancelled after payment" : "weighed lighter",
    })
  );
}
