/**
 * Renders every WhatsApp template against a fixture order and checks the
 * variables against Meta's rules, without a DB, a token or a network.
 *
 * Exists because the failure this guards is invisible any other way: an empty
 * or whitespace-mangled variable does not produce a bad message, it produces a
 * rejected API call, and the only trace is a `failed` row nobody is looking at.
 * Cheap to run, so run it after touching `whatsappTemplates.ts`.
 *
 *   npx tsx scripts/check-whatsapp-templates.ts
 */

import type { Order } from "../shared/orderContract.js";
import { toWaMsisdn } from "../server/whatsapp.js";
import {
  WA_TEMPLATE,
  NEW_TEMPLATES_LIVE,
  accountDecisionMessage,
  agentDailyDigestMessage,
  agentJobAssignedMessage,
  agentMorningJobsMessage,
  agentJobCancelledMessage,
  agentNewJobMessage,
  agentOnTheWayMessage,
  agentPickupCancelledMessage,
  arrivedAtHubMessage,
  cancellationApprovedMessage,
  cancellationDeclinedMessage,
  dispatchedMessage,
  extraChargeDueMessage,
  loginOtpMessage,
  orderBookedMessage,
  parcelPickedUpMessage,
  paymentFailedMessage,
  paymentReceivedMessage,
  pickupArea,
  pickupConfirmedMessage,
  pickupReassigningMessage,
  repriceMessage,
  staffAgentCancelledMessage,
  staffAwbFailedMessage,
  staffCancellationRequestMessage,
  staffCustomerActionNeededMessage,
  staffNewApplicationMessage,
  staffNewPickupMessage,
  staffDailySummaryMessage,
  staffParcelAtHubMessage,
  staffPickupOverdueMessage,
  staffPickupsUnassignedMessage,
  staffRefundDueMessage,
  staffWeighedHeavierMessage,
  type WhatsappMessage,
} from "../server/whatsappTemplates.js";

const order: Order = {
  id: "11111111-1111-1111-1111-111111111111",
  order_no: "BOM-100042",
  user_id: "22222222-2222-2222-2222-222222222222",
  status: "out_for_pickup",
  pickup_request: 1,
  pickup_date: "2026-08-23",
  origin_address_id: "33333333-3333-3333-3333-333333333333",
  consignee: {},
  items: {},
  booked_weight: 2,
  quoted_amount: 5860,
  payment_method: "pay_at_pickup",
  payment_status: "pending",
  is_cod: false,
  agent_id: "44444444-4444-4444-4444-444444444444",
  actual_weight: 3,
  final_amount: 6200,
  awb_no: "ITD123456789",
  metadata: null,
  created_at: "2026-08-20T06:00:00Z",
  updated_at: "2026-08-20T06:00:00Z",
};

const address = { city: "Mumbai", pincode: "400001" };

/**
 * Placeholders in the approved body, for the templates submitted from
 * scripts/order-debug/create-staff-templates.mjs. Meta rejects a send whose
 * count differs.
 */
const APPROVED_VARIABLES: Record<string, number> = {
  [WA_TEMPLATE.agentJobAssigned]: 4,
  [WA_TEMPLATE.agentMorningJobs]: 2,
  [WA_TEMPLATE.extraChargeDue]: 4,
  [WA_TEMPLATE.pickupReassigning]: 1,
  [WA_TEMPLATE.accountDecision]: 2,
  [WA_TEMPLATE.staffPickupsUnassigned]: 3,
  [WA_TEMPLATE.staffPickupOverdue]: 4,
  [WA_TEMPLATE.staffDailySummary]: 7,
  [WA_TEMPLATE.agentPickupCancelled]: 2,
  [WA_TEMPLATE.staffNewApplication]: 4,
  [WA_TEMPLATE.staffParcelAtHub]: 4,
  [WA_TEMPLATE.staffWeighedHeavier]: 5,
  [WA_TEMPLATE.staffCustomerActionNeeded]: 3,
  [WA_TEMPLATE.staffNewPickup]: 4,
  [WA_TEMPLATE.staffAgentCancelled]: 4,
  [WA_TEMPLATE.staffCancellationRequest]: 4,
  [WA_TEMPLATE.staffAwbFailed]: 3,
  [WA_TEMPLATE.staffRefundDue]: 4,
  [WA_TEMPLATE.cancellationDeclined]: NEW_TEMPLATES_LIVE ? 3 : 2,
};

let failures = 0;
function fail(what: string): void {
  failures++;
  console.error(`  FAIL  ${what}`);
}

/** Meta rejects the call, not the message, on any of these. */
function checkMessage(label: string, message: WhatsappMessage | null): void {
  if (!message) {
    console.log(`  (none)  ${label}`);
    return;
  }

  const known = Object.values(WA_TEMPLATE) as string[];
  if (!known.includes(message.template)) {
    fail(`${label}: template "${message.template}" is not in WA_TEMPLATE`);
  }

  const expected = APPROVED_VARIABLES[message.template];
  if (expected !== undefined && message.variables.length !== expected) {
    fail(`${label}: ${message.variables.length} variables, approved body has ${expected}`);
  }

  message.variables.forEach((value, index) => {
    const n = index + 1;
    if (value === "") fail(`${label} {{${n}}}: empty`);
    if (/[\n\t]/.test(value)) fail(`${label} {{${n}}}: contains a newline or tab`);
    if (/ {4}/.test(value)) fail(`${label} {{${n}}}: four or more consecutive spaces`);
  });

  console.log(`  ok      ${message.template}  [${message.variables.join(" | ")}]`);
}

console.log("\nCustomer templates");
checkMessage("orderBooked", orderBookedMessage({ order, customerName: "Priya Nair" }));
checkMessage(
  "orderBooked/dropoff",
  orderBookedMessage({
    order: { ...order, pickup_request: 2, pickup_date: null },
    customerName: null,
  })
);
checkMessage(
  "paymentReceived",
  paymentReceivedMessage({ order, amount: 5860, txnId: "TXN-20260820-0007" })
);
checkMessage("paymentFailed", paymentFailedMessage({ order, amount: 5860, attemptRef: "pay_x" }));
checkMessage("pickupConfirmed", pickupConfirmedMessage({ order, agentName: "Ravi Deshmukh" }));
checkMessage(
  "agentOnTheWay",
  agentOnTheWayMessage({ order, agentName: "Ravi Deshmukh", handoverCode: "0417" })
);
checkMessage("parcelPickedUp", parcelPickedUpMessage(order));
checkMessage("arrivedAtHub", arrivedAtHubMessage(order));
checkMessage("amountDue", repriceMessage({ order, quoted: 5860, final: 6200 }));
checkMessage("refundDue", repriceMessage({ order, quoted: 5860, final: 5680 }));
checkMessage("dispatched", dispatchedMessage({ orderNo: order.order_no, awb: "ITD123456789" }));
checkMessage("cancellationApproved", cancellationApprovedMessage(order));
checkMessage("cancellationDeclined", cancellationDeclinedMessage({ order, note: null, supportPhone: "2266400000" }));
checkMessage(
  "cancellationDeclined/note",
  cancellationDeclinedMessage({ order, note: "Your parcel has already been dispatched.", supportPhone: "917045999553" })
);
checkMessage("loginOtp", loginOtpMessage("482913"));
checkMessage("extraChargeDue", extraChargeDueMessage({ order, extra: 340, supportPhone: "2266400000" }));
checkMessage("extraChargeDue/mobile", extraChargeDueMessage({ order, extra: 340, supportPhone: "917045999553" }));
checkMessage("pickupReassigning", pickupReassigningMessage({ order, at: "x" }));
checkMessage("accountDecision/approved", accountDecisionMessage({ kind: "approved" }, "x"));
checkMessage("accountDecision/sent back", accountDecisionMessage({ kind: "sent_back" }, "x"));
checkMessage("accountDecision/declined", accountDecisionMessage({ kind: "declined", reason: "GST number does not match" }, "x"));
checkMessage("accountDecision/declined, no reason", accountDecisionMessage({ kind: "declined", reason: null }, "x"));

console.log("\nAgent templates");
checkMessage("agentNewJob", agentNewJobMessage({ order, area: pickupArea(address) }));
checkMessage(
  "agentNewJob/prepaid",
  agentNewJobMessage({ order: { ...order, payment_method: "pay_now", payment_status: "paid" }, area: pickupArea(null) })
);
checkMessage(
  "agentDailyDigest",
  agentDailyDigestMessage({ agentName: null, jobCount: 3, date: "2026-08-23" })
);
checkMessage("agentJobCancelled", agentJobCancelledMessage({ order, cancelled: true }));
checkMessage("agentJobCancelledRequest", agentJobCancelledMessage({ order, cancelled: false }));
checkMessage("agentJobAssigned", agentJobAssignedMessage({ order, area: pickupArea(address), at: order.updated_at }));
checkMessage("agentMorningJobs", agentMorningJobsMessage({ agentName: "Ravi Deshmukh", jobCount: 4, date: "2026-08-23" }));
checkMessage("agentPickupCancelled", agentPickupCancelledMessage({ order, area: pickupArea(null) }));

console.log("\nStaff templates");
const customer = "Priya Nair, +91 98200 12345";
checkMessage(
  "staffNewApplication",
  staffNewApplicationMessage({ resent: false, name: "Sharma Exports", accountType: "Company", phone: "+91 98200 12345", at: "x" })
);
checkMessage("staffParcelAtHub", staffParcelAtHubMessage({ order, city: "Mumbai", customer }));
checkMessage("staffParcelAtHub/no city", staffParcelAtHubMessage({ order: { ...order, pickup_request: 2 }, city: null, customer: "-" }));
checkMessage("staffWeighedHeavier", staffWeighedHeavierMessage({ order, extra: 340, customer }));
checkMessage(
  "staffCustomerActionNeeded",
  staffCustomerActionNeededMessage({ order, missing: "identity document missing", customer })
);
checkMessage("staffNewPickup", staffNewPickupMessage({ order, area: pickupArea(address) }));
checkMessage(
  "staffAgentCancelled",
  staffAgentCancelledMessage({ order, agentName: null, area: pickupArea(address), at: "x" })
);
checkMessage(
  "staffCancellationRequest",
  staffCancellationRequestMessage({ order: { ...order, status: "agent_accepted" }, city: "Mumbai", reason: null, at: "x" })
);
checkMessage(
  "staffAwbFailed",
  staffAwbFailedMessage({ order, city: null, reason: "Receiver ZIP must be 5 digits.\nState missing. ".repeat(6), stage: "precheck" })
);
checkMessage(
  "staffPickupsUnassigned",
  staffPickupsUnassignedMessage({ count: 3, city: "Mumbai", date: "2026-08-23", slot: "morning" })
);
checkMessage(
  "staffPickupOverdue",
  staffPickupOverdueMessage({ order, city: "Mumbai", agentName: null, runDate: "2026-08-23" })
);
checkMessage(
  "staffDailySummary/quiet",
  staffDailySummaryMessage({
    city: null,
    date: "2026-08-22",
    summary: { newBookings: 0, collected: 0, atHub: 0, dispatched: 0, attention: [] },
  })
);
checkMessage(
  "staffDailySummary",
  staffDailySummaryMessage({
    city: "Mumbai",
    date: "2026-08-22",
    summary: { newBookings: 12, collected: 9, atHub: 4, dispatched: 7, attention: ["2 pickups with no agent", "1 AWB failed"] },
  })
);
checkMessage(
  "staffRefundDue",
  staffRefundDueMessage({ order, amount: 180, customer, reason: "weighed lighter" })
);

console.log("\nThe rule that matters: no agent template carries the handover code");
const CODE = "0417";
const agentMessages: WhatsappMessage[] = [
  agentNewJobMessage({ order, area: pickupArea(address) }),
  agentDailyDigestMessage({ agentName: "Ravi", jobCount: 1, date: "2026-08-23" }),
  agentJobCancelledMessage({ order, cancelled: true }),
  agentJobAssignedMessage({ order, area: pickupArea(address), at: order.updated_at }),
  agentPickupCancelledMessage({ order, area: pickupArea(address) }),
  agentMorningJobsMessage({ agentName: "Ravi", jobCount: 1, date: "2026-08-23" }),
];
for (const message of agentMessages) {
  if (message.variables.some((value) => value.includes(CODE))) {
    fail(`${message.template} carries the handover code`);
  }
}
if (failures === 0) console.log("  ok      none of them contains it");

console.log("\nPhone normalisation");
const phoneCases: [string | null, string | null][] = [
  ["9820012345", "919820012345"],
  ["+91 98200 12345", "919820012345"],
  ["09820012345", "919820012345"],
  ["919820012345", "919820012345"],
  ["98200-12345", "919820012345"],
  ["1234567890", null], // not an Indian mobile prefix
  ["12345", null],
  ["", null],
  [null, null],
];
for (const [input, expected] of phoneCases) {
  const actual = toWaMsisdn(input);
  if (actual !== expected) {
    fail(`toWaMsisdn(${JSON.stringify(input)}) = ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  }
}
if (failures === 0) console.log(`  ok      ${phoneCases.length} cases`);

console.log("\nEven reprice sends nothing");
if (repriceMessage({ order, quoted: 5860, final: 5860 }) !== null) {
  fail("a zero delta produced a message");
} else {
  console.log("  ok      zero delta is silent");
}

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} failure(s).\n`);
process.exit(failures === 0 ? 0 : 1);
