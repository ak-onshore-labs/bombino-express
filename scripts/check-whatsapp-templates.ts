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
  agentDailyDigestMessage,
  agentJobCancelledMessage,
  agentNewJobMessage,
  agentOnTheWayMessage,
  arrivedAtHubMessage,
  cancellationApprovedMessage,
  cancellationDeclinedMessage,
  dispatchedMessage,
  loginOtpMessage,
  orderBookedMessage,
  parcelPickedUpMessage,
  paymentFailedMessage,
  paymentReceivedMessage,
  pickupArea,
  pickupConfirmedMessage,
  repriceMessage,
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
checkMessage("cancellationDeclined", cancellationDeclinedMessage({ order, note: null }));
checkMessage("loginOtp", loginOtpMessage("482913"));

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

console.log("\nThe rule that matters: no agent template carries the handover code");
const CODE = "0417";
const agentMessages: WhatsappMessage[] = [
  agentNewJobMessage({ order, area: pickupArea(address) }),
  agentDailyDigestMessage({ agentName: "Ravi", jobCount: 1, date: "2026-08-23" }),
  agentJobCancelledMessage({ order, cancelled: true }),
];
for (const message of agentMessages) {
  if (message.variables.some((value) => value.includes(CODE))) {
    fail(`${message.template} carries the handover code`);
  }
}
if (failures === 0) console.log("  ok      none of the three contains it");

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
