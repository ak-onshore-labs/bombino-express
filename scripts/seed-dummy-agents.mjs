/**
 * Seed dummy pickup agents *with work on them*, for A5 testing.
 *
 * `create-test-agent.mjs` makes one empty agent account. That is enough to log
 * in and enough to prove nothing: every agent screen — Calls, My Pickups,
 * Schedule, Collections — renders its empty state and stays there. This script
 * creates the accounts and the data that makes those screens say something:
 *
 *   · 3 agent accounts (role = 'agent')
 *   · 1 dummy customer + pickup addresses across Mumbai
 *   · orders spread over the agent-visible lifecycle: unclaimed (the Calls
 *     pool), agent_accepted, out_for_pickup, picked_up, one overdue
 *   · collected payments dated today, so Collections reconciles to a number
 *
 * Usage:
 *   node --env-file=.env scripts/seed-dummy-agents.mjs
 *   node --env-file=.env scripts/seed-dummy-agents.mjs --reset   # re-seed clean
 *
 * WRITES TO THE SHARED SUPABASE PROJECT. Every row is tagged
 * `metadata.seeded_by = 'scripts/seed-dummy-agents.mjs'` so `--reset` can find
 * and remove exactly what this wrote and nothing else. Phone numbers are in the
 * 90000000xx block — obviously fake, and never a real Indian subscriber.
 *
 * Not idempotent by accident: a second run without `--reset` refuses rather
 * than doubling the orders, because "some data" that silently triples is worse
 * than no data.
 */

import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const SEED_TAG = 'scripts/seed-dummy-agents.mjs';
const RESET = process.argv.includes('--reset');

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (pass --env-file=.env).');
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function die(what, error) {
  console.error(`${what} failed:`, error?.code ?? '', error?.message ?? error);
  process.exit(1);
}

const seedMeta = () => ({ seeded_by: SEED_TAG, seeded_at: new Date().toISOString() });

// ── Dates ────────────────────────────────────────────────────────────────────
// Pickup dates are bare `date` columns compared against IST elsewhere
// (shared/pickupSlots.ts), so they are computed in IST here too. A UTC-derived
// "today" flips a day early every evening and would silently mark fresh jobs
// overdue.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
function istDate(offsetDays = 0) {
  const t = new Date(Date.now() + IST_OFFSET_MS + offsetDays * 86_400_000);
  return t.toISOString().slice(0, 10);
}
const TODAY = istDate(0);
const TOMORROW = istDate(1);
const DAY_AFTER = istDate(2);
const YESTERDAY = istDate(-1);

// ── Cast ─────────────────────────────────────────────────────────────────────
// Availability is the current two-hour vocabulary. Each agent works a different
// shape of week so the schedule screen and the slot API have something to
// differentiate.
//
// Rosters used to be seeded here too — a weekly pattern per agent, so the slot
// picker had someone to offer. `migrations/drop_pickup_slots.sql` dropped both
// availability tables when pickups stopped carrying a time window, and this
// script kept writing to `agent_weekly_availability` for a while after: the
// insert failed, `die()` fired, and the run aborted before creating a single
// order. Nothing replaces it, because nothing narrows a pickup by time any
// more. What narrows it now is geography — see `pickup_beats` — and beat
// membership is ops' to assign at /ops/beats, not this script's to invent.
const AGENTS = [
  {
    key: 'ravi',
    // 9000000011 is taken by the Test Super Admin from create-test-admin.mjs.
    // Check the 90000000xx block before adding an agent — `upsertUser` now
    // refuses to touch an account it did not create, so a collision fails loudly
    // rather than quietly demoting an admin to an agent.
    phone: '9000000014',
    full_name: 'Ravi Deshmukh',
    email: 'ravi.agent@bombino.test',
  },
  {
    key: 'imran',
    phone: '9000000012',
    full_name: 'Imran Shaikh',
    email: 'imran.agent@bombino.test',
  },
  {
    key: 'sunita',
    phone: '9000000013',
    full_name: 'Sunita Pawar',
    email: 'sunita.agent@bombino.test',
  },
];

const CUSTOMER = {
  phone: '9000000090',
  full_name: 'Test Customer (seed)',
  email: 'seed.customer@bombino.test',
};

// Pickup addresses. Real Mumbai localities with invented street lines — the
// agent cards show `address_line_1, city pincode`, so a plausible pincode
// matters more than a plausible building.
const ADDRESSES = [
  {
    key: 'andheri',
    full_name: 'Meera Kulkarni',
    company: null,
    phone: '9820011221',
    address_line_1: '14 Sunbeam Apartments, Lokhandwala Complex',
    city: 'Mumbai',
    state: 'Maharashtra',
    pincode: '400053',
  },
  {
    key: 'bandra',
    full_name: 'Farhan Qureshi',
    company: 'Qureshi Textiles',
    phone: '9820033445',
    address_line_1: 'Shop 3, Hill Road, Bandra West',
    city: 'Mumbai',
    state: 'Maharashtra',
    pincode: '400050',
  },
  {
    key: 'dadar',
    full_name: 'Anjali Rane',
    company: null,
    phone: '9820055667',
    address_line_1: '602 Shivneri CHS, Gokhale Road, Dadar West',
    city: 'Mumbai',
    state: 'Maharashtra',
    pincode: '400028',
  },
  {
    key: 'powai',
    full_name: 'Karthik Iyer',
    company: null,
    phone: '9820077889',
    address_line_1: 'B-1104 Lake Homes, Chandivali Farm Road, Powai',
    city: 'Mumbai',
    state: 'Maharashtra',
    pincode: '400076',
  },
  {
    key: 'thane',
    full_name: 'Neha Bhosale',
    company: null,
    phone: '9820099001',
    address_line_1: '7 Vasant Vihar, Pokhran Road No. 2',
    city: 'Thane',
    state: 'Maharashtra',
    pincode: '400610',
  },
  {
    key: 'vashi',
    full_name: 'Sameer Joshi',
    company: 'Joshi Exports',
    phone: '9820012312',
    address_line_1: 'Plot 22, Sector 17, Vashi',
    city: 'Navi Mumbai',
    state: 'Maharashtra',
    pincode: '400703',
  },
];

// ── Booking blobs ────────────────────────────────────────────────────────────
// `items` is the ITD docket payload verbatim (client/src/lib/orderDetail.ts), so
// the shape is copied from what CreateShipment actually posts — weights in
// pounds, dimensions in inches — not invented. The order detail screen reads
// `docket_items[0]` and `free_form_line_items[0].hscode`, so both are present.

function consigneeFor(c) {
  return {
    name: c.name,
    company: c.company ?? null,
    email: c.email,
    phone: c.phone,
    address_line_1: c.address_line_1,
    city: c.city,
    state: c.state,
    pincode: c.pincode,
    country_code: 'US',
    country_name: 'UNITED STATES',
  };
}

function itemsFor({ origin, consignee, weightLb, pieces, contents, valueUsd, hscode, dims }) {
  return {
    product_code: 'EXPRESS',
    destination_code: 'US',
    booking_date: TODAY,
    booking_time: '10:30',
    pcs: String(pieces),
    shipment_value: String(valueUsd),
    shipment_value_currency: 'USD',
    actual_weight: weightLb.toFixed(2),
    shipment_invoice_no: 'TESTINV01',
    shipment_invoice_date: TODAY,
    shipment_content: contents,
    new_docket_free_form_invoice: '1',
    free_form_invoice_type_id: '1',
    free_form_currency: 'USD',
    terms_of_trade: 'FOB',
    entry_type: 2,
    api_service_code: 'EXP',
    shipper_name: origin.full_name,
    shipper_company_name: origin.company ?? origin.full_name,
    shipper_contact_no: origin.phone,
    shipper_email: 'seed.customer@bombino.test',
    shipper_address_line_1: origin.address_line_1,
    shipper_city: origin.city,
    shipper_state: origin.state,
    shipper_country: 'IN',
    shipper_zip_code: origin.pincode,
    consignee_name: consignee.name,
    consignee_company_name: consignee.company ?? consignee.name,
    consignee_contact_no: `+1${consignee.phone}`,
    consignee_email: consignee.email,
    consignee_address_line_1: consignee.address_line_1,
    consignee_city: consignee.city,
    consignee_state: consignee.state,
    consignee_country: 'US',
    consignee_zip_code: consignee.pincode,
    docket_items: [
      {
        actual_weight: weightLb.toFixed(2),
        length: dims[0],
        width: dims[1],
        height: dims[2],
        number_of_boxes: String(pieces),
      },
    ],
    free_form_line_items: [
      {
        description: contents,
        quantity: String(pieces),
        unit_value: String(valueUsd),
        hscode,
      },
    ],
  };
}

const CONSIGNEES = {
  edison: {
    name: 'Priya Kulkarni',
    company: null,
    email: 'priya.k@example.com',
    phone: '7325550183',
    address_line_1: '221 Oak Tree Road, Apt 4B',
    city: 'Edison',
    state: 'NJ',
    pincode: '08820',
  },
  jersey: {
    name: 'Aliya Qureshi',
    company: null,
    email: 'aliya.q@example.com',
    phone: '2015550147',
    address_line_1: '18 Newark Avenue',
    city: 'Jersey City',
    state: 'NJ',
    pincode: '07302',
  },
  sunnyvale: {
    name: 'Rohan Rane',
    company: null,
    email: 'rohan.rane@example.com',
    phone: '4085550192',
    address_line_1: '540 E Weddell Drive',
    city: 'Sunnyvale',
    state: 'CA',
    pincode: '94089',
  },
  chicago: {
    name: 'Nikhil Iyer',
    company: 'Iyer Consulting LLC',
    email: 'nikhil@example.com',
    phone: '3125550119',
    address_line_1: '1200 W Devon Avenue',
    city: 'Chicago',
    state: 'IL',
    pincode: '60660',
  },
  houston: {
    name: 'Sneha Bhosale',
    company: null,
    email: 'sneha.b@example.com',
    phone: '7135550168',
    address_line_1: '9330 Hillcroft Street',
    city: 'Houston',
    state: 'TX',
    pincode: '77096',
  },
  seattle: {
    name: 'Aditi Joshi',
    company: null,
    email: 'aditi.joshi@example.com',
    phone: '2065550134',
    address_line_1: '2411 NE 65th Street',
    city: 'Seattle',
    state: 'WA',
    pincode: '98115',
  },
};

/**
 * The work itself.
 *
 * `agent: null` means unclaimed — the Calls pool, which must be non-empty or
 * the claim race cannot be exercised at all. Statuses stay inside the set an
 * agent can still act on; nothing is seeded past `received_at_hub`, because
 * `getMyPickups` filters those out by design and they would just vanish.
 *
 * `collect` marks a pay-at-pickup job whose money has already been taken — it
 * produces a payments row dated now, which is what Collections reads.
 */
const JOBS = [
  // Ravi: a full day — one live, one accepted, one already in the bag, one late.
  {
    agent: 'ravi',
    address: 'andheri',
    consignee: 'edison',
    status: 'out_for_pickup',
    date: TODAY,
    slot: '09:00-11:00',
    payment_method: 'pay_at_pickup',
    payment_status: 'pending',
    weightKg: 4.5,
    quoted: 6480,
    contents: 'GIFTS',
    valueUsd: 120,
    hscode: '95030090',
    dims: ['14', '10', '8'],
  },
  {
    agent: 'ravi',
    address: 'dadar',
    consignee: 'sunnyvale',
    status: 'agent_accepted',
    date: TODAY,
    slot: '11:00-13:00',
    payment_method: 'pay_now',
    payment_status: 'paid',
    weightKg: 2.0,
    quoted: 3120,
    contents: 'DOCUMENTS',
    valueUsd: 20,
    hscode: '49111090',
    dims: ['12', '9', '2'],
  },
  {
    agent: 'ravi',
    address: 'powai',
    consignee: 'chicago',
    status: 'picked_up',
    date: TODAY,
    slot: '09:00-11:00',
    payment_method: 'pay_at_pickup',
    payment_status: 'paid',
    collect: { mode: 'cash', amount: 8950, reference: 'RCPT-0091' },
    weightKg: 7.2,
    quoted: 8950,
    contents: 'APPAREL',
    valueUsd: 260,
    hscode: '61091000',
    dims: ['18', '14', '10'],
  },
  {
    agent: 'ravi',
    address: 'thane',
    consignee: 'houston',
    status: 'agent_accepted',
    date: YESTERDAY, // overdue — drives the LATE band and red tone
    slot: '15:00-17:00',
    payment_method: 'pay_at_pickup',
    payment_status: 'pending',
    weightKg: 3.1,
    quoted: 4270,
    contents: 'MEDICINES',
    valueUsd: 85,
    hscode: '30049099',
    dims: ['10', '8', '6'],
  },

  // Imran: an evening round, one settled by UPI.
  {
    agent: 'imran',
    address: 'bandra',
    consignee: 'jersey',
    status: 'picked_up',
    date: TODAY,
    slot: '17:00-19:00',
    payment_method: 'pay_at_pickup',
    payment_status: 'paid',
    collect: { mode: 'upi', amount: 12400, reference: '461203998877' },
    weightKg: 11.0,
    quoted: 12400,
    contents: 'HANDICRAFTS',
    valueUsd: 410,
    hscode: '44219990',
    dims: ['22', '16', '12'],
  },
  {
    agent: 'imran',
    address: 'vashi',
    consignee: 'seattle',
    status: 'agent_accepted',
    date: TOMORROW,
    slot: '19:00-21:00',
    payment_method: 'cod',
    payment_status: 'pending',
    is_cod: true,
    weightKg: 5.6,
    quoted: 7310,
    contents: 'SPICES',
    valueUsd: 140,
    hscode: '09109930',
    dims: ['16', '12', '9'],
  },

  // Sunita: one job, scheduled out — exercises the "starts in N days" state.
  {
    agent: 'sunita',
    address: 'andheri',
    consignee: 'chicago',
    status: 'agent_accepted',
    date: DAY_AFTER,
    slot: '13:00-15:00',
    payment_method: 'pay_at_pickup',
    payment_status: 'pending',
    weightKg: 1.8,
    quoted: 2890,
    contents: 'BOOKS',
    valueUsd: 45,
    hscode: '49019900',
    dims: ['12', '9', '5'],
  },

  // Unclaimed — the Calls pool every agent sees and races for.
  {
    agent: null,
    address: 'bandra',
    consignee: 'edison',
    status: 'pickup_requested',
    date: TODAY,
    slot: '15:00-17:00',
    payment_method: 'pay_at_pickup',
    payment_status: 'pending',
    weightKg: 6.3,
    quoted: 7940,
    contents: 'GIFTS',
    valueUsd: 190,
    hscode: '95030090',
    dims: ['16', '14', '10'],
  },
  {
    agent: null,
    address: 'thane',
    consignee: 'seattle',
    status: 'pickup_requested',
    date: TOMORROW,
    slot: '11:00-13:00',
    payment_method: 'pay_now',
    payment_status: 'paid',
    weightKg: 2.4,
    quoted: 3560,
    contents: 'DOCUMENTS',
    valueUsd: 25,
    hscode: '49111090',
    dims: ['12', '9', '2'],
  },
  {
    agent: null,
    address: 'vashi',
    consignee: 'houston',
    status: 'pickup_requested',
    date: TOMORROW,
    slot: '17:00-19:00',
    payment_method: 'pay_at_pickup',
    payment_status: 'pending',
    weightKg: 9.1,
    quoted: 10480,
    contents: 'KITCHENWARE',
    valueUsd: 300,
    hscode: '73239390',
    dims: ['20', '16', '14'],
  },
];

/** The lifecycle log a real order would have accumulated to reach `status`. */
const EVENT_TRAIL = {
  pickup_requested: ['pickup_requested'],
  agent_accepted: ['pickup_requested', 'agent_accepted'],
  out_for_pickup: ['pickup_requested', 'agent_accepted', 'out_for_pickup'],
  picked_up: ['pickup_requested', 'agent_accepted', 'out_for_pickup', 'picked_up'],
};

// ── User upsert ──────────────────────────────────────────────────────────────

/**
 * Find-or-create an itd_users row. Same synthetic-id convention as
 * create-test-agent.mjs: these accounts do not exist inside ITD and never
 * authenticate against it.
 *
 * Deliberately will NOT change the role of an account this script did not
 * create. `create-test-agent.mjs` promotes freely, which is right for a script
 * you point at one deliberate phone number — but this one carries a hardcoded
 * list, and a number that has quietly been reused since would be demoted
 * without anyone noticing. That already happened once: 9000000011 belongs to
 * the Test Super Admin, and an earlier revision turned it into a pickup agent.
 */
async function upsertUser({ phone, full_name, email, role }) {
  const { data: existing, error: lookupError } = await db
    .from('itd_users')
    .select('id, phone, full_name, role, metadata')
    .eq('phone', phone)
    .maybeSingle();
  if (lookupError) die(`lookup ${phone}`, lookupError);

  if (existing) {
    if (existing.role === role) return { ...existing, created: false };
    console.error(
      `\n${phone} already belongs to "${existing.full_name}" with role "${existing.role}", ` +
        `not "${role}".\nThis script will not change it. Pick a free number in the ` +
        `90000000xx block and edit the list at the top.`
    );
    process.exit(1);
  }

  const syntheticId = `local-${randomUUID()}`;
  const { data: created, error } = await db
    .from('itd_users')
    .insert({
      itd_customer_id: syntheticId,
      itd_customer_code: syntheticId,
      full_name,
      email: email ?? '',
      username: phone,
      phone,
      role,
      // account_type left to its DEFAULT — a customer field that means nothing
      // for staff, but the column is NOT NULL. See create-test-agent.mjs.
      is_active: true,
      metadata: seedMeta(),
    })
    .select('id, phone, full_name, role')
    .single();
  if (error) die(`create ${phone}`, error);
  return { ...created, created: true };
}

async function findOrCreateAddress(userId, a) {
  const { data: existing, error: lookupError } = await db
    .from('addresses')
    .select('id')
    .eq('user_id', userId)
    .eq('type', 'sender')
    .eq('phone', a.phone)
    .eq('pincode', a.pincode)
    .maybeSingle();
  if (lookupError) die(`address lookup ${a.key}`, lookupError);
  if (existing) return existing.id;

  const { data, error } = await db
    .from('addresses')
    .insert({
      user_id: userId,
      type: 'sender',
      full_name: a.full_name,
      company: a.company,
      email: CUSTOMER.email,
      phone: a.phone,
      address_line_1: a.address_line_1,
      city: a.city,
      state: a.state,
      pincode: a.pincode,
      country_code: 'IN',
      country_name: 'India',
    })
    .select('id')
    .single();
  if (error) die(`address insert ${a.key}`, error);
  return data.id;
}

// ── Reset ────────────────────────────────────────────────────────────────────

/**
 * Remove what a previous run wrote. Orders are matched on the metadata tag, so
 * a hand-made order sitting in the same table is never touched; payments and
 * order_events go with them by ON DELETE CASCADE.
 */
async function resetSeed() {
  const { data: orders, error } = await db
    .from('orders')
    .delete()
    .eq('metadata->>seeded_by', SEED_TAG)
    .select('id');
  if (error) die('reset orders', error);

  console.log(`Reset: removed ${orders?.length ?? 0} seeded orders (payments cascade).`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

const agentRows = {};
for (const a of AGENTS) {
  const row = await upsertUser({ ...a, role: 'agent' });
  agentRows[a.key] = row;
  const note = row.created ? 'created' : 'already an agent';
  console.log(`agent  ${a.phone}  ${a.full_name.padEnd(18)} ${note}`);
}

const customer = await upsertUser({ ...CUSTOMER, role: 'customer' });
console.log(
  `customer ${CUSTOMER.phone}  ${CUSTOMER.full_name}  ${customer.created ? 'created' : 'reused'}`
);

if (RESET) {
  await resetSeed();
} else {
  const { count, error } = await db
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('metadata->>seeded_by', SEED_TAG);
  if (error) die('seed check', error);
  if (count && count > 0) {
    console.error(
      `\n${count} seeded orders already exist. Re-run with --reset to clear and re-seed:\n` +
        '  node --env-file=.env scripts/seed-dummy-agents.mjs --reset'
    );
    process.exit(1);
  }
}

// Addresses, one per locality, all owned by the dummy customer.
const addressIds = {};
for (const a of ADDRESSES) {
  addressIds[a.key] = await findOrCreateAddress(customer.id, a);
}
console.log(`addr   ${Object.keys(addressIds).length} pickup addresses ready`);

// Orders + their event trail + any collected payment.
let collected = 0;
for (const job of JOBS) {
  const address = ADDRESSES.find((a) => a.key === job.address);
  const consignee = CONSIGNEES[job.consignee];
  const agentId = job.agent ? agentRows[job.agent].id : null;

  const { data: order, error } = await db
    .from('orders')
    .insert({
      user_id: customer.id,
      status: job.status,
      pickup_request: 1,
      pickup_date: job.date,
      pickup_slot: job.slot,
      origin_address_id: addressIds[job.address],
      consignee: consigneeFor(consignee),
      items: itemsFor({
        origin: address,
        consignee,
        weightLb: job.weightKg * 2.20462,
        pieces: 1,
        contents: job.contents,
        valueUsd: job.valueUsd,
        hscode: job.hscode,
        dims: job.dims,
      }),
      booked_weight: job.weightKg,
      quoted_amount: job.quoted,
      payment_method: job.payment_method,
      payment_status: job.payment_status,
      is_cod: job.is_cod ?? false,
      agent_id: agentId,
      metadata: seedMeta(),
    })
    .select('id, order_no')
    .single();
  if (error) die(`order ${job.address}/${job.status}`, error);

  const trail = EVENT_TRAIL[job.status] ?? [job.status];
  const { error: eventError } = await db.from('order_events').insert(
    trail.map((status) => ({
      order_id: order.id,
      status,
      note: 'seeded',
      // The customer books; the agent moves it from there on.
      actor_user_id: status === 'pickup_requested' ? customer.id : agentId,
      metadata: seedMeta(),
    }))
  );
  if (eventError) die(`events ${order.order_no}`, eventError);

  if (job.collect) {
    const { error: payError } = await db.from('payments').insert({
      order_id: order.id,
      user_id: customer.id,
      amount: job.collect.amount,
      method: 'pay_at_pickup',
      status: 'collected',
      collection_mode: job.collect.mode,
      collected_by: agentId,
      collected_at: new Date().toISOString(),
      reference: job.collect.reference,
      metadata: seedMeta(),
    });
    if (payError) die(`payment ${order.order_no}`, payError);
    collected += job.collect.amount;
  }

  const who = job.agent ? agentRows[job.agent].full_name : 'UNCLAIMED';
  console.log(
    `order  ${order.order_no}  ${job.status.padEnd(16)} ${job.date}  ${job.slot}  ${who}`
  );
}

console.log(
  `\nSeeded ${JOBS.length} orders (${JOBS.filter((j) => !j.agent).length} unclaimed), ` +
    `₹${collected.toLocaleString('en-IN')} collected today.`
);
console.log('\nLog in as an agent:');
for (const a of AGENTS) {
  console.log(`  ${a.phone}  ${a.full_name}`);
}
console.log(
  '\n  1. POST /api/auth/otp/request   { "phone": "<phone>", "purpose": "auth" }\n' +
    '  2. POST /api/auth/phone/continue { "phone": "<phone>", "code": "000000" }\n' +
    '  (step 2 accepts any 6-digit code while the OTP comparison is stubbed)'
);
