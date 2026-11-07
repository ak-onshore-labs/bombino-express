# Rewards: build plan (phase 1, points only)

Written 6 Nov 2026, for work starting 7 Nov. Rules come from Bombino's answers
(6 Nov) plus Aditya's calls on the gaps. The demo UI and its logic doc live in
the demo repo: `projects/bombino-express- demo`, `docs/rewards/rewards-logic.md`
and `client/src/{pages/Rewards.tsx, components/rewards/, lib/rewards*.ts}`.

## 1. Rules (agreed)

| Topic | Rule |
|---|---|
| Who | Account holders only. Guest bookings never earn, even after the guest makes an account. |
| Earn | ₹100 billed, before GST = 1 point. Billed = price before GST minus points used. `floor(billedExGst / 100)` per order. |
| Points land | When the parcel is **delivered** (changed 7 Nov; was paid and dispatched). Until then they show as pending ("on the way"). Not spendable while pending. A parcel that ends undelivered (RTO, part RTO, lost, abandoned, carrier-cancelled) never earns: a 0-point `forfeit` row. Only orders booked from `EARN_FROM_BOOKING_DATE` (7 Nov 2026) earn. |
| Use | ₹1 per point. Only once the balance is 100 or more. Taken off the price before GST; GST stays on the full price. |
| To pay | `(base − points) + GST(base)` = `total − points`. |
| Pickup / drop-off / COD | Points are taken at booking. The customer pays the rest at collection. |
| Cancel | Points used come back. Pending points are dropped. |
| Refund after landing, or RTO | Earned points are taken back. The balance can go **negative**; new points fill it first; no using points until it is back to 100. |
| Expiry | Every unused point expires at **midnight 31 Mar** (financial year, Apr–Mar), whenever it was earned. Hard reset. |
| Milestone | **One weight milestone only** (7 Nov: the billed-value milestone is gone). Before it: an enticing "Unlock special rewards" teaser with a progress meter in kg. Once reached: just **"Rewards await you"**. No actual perks in phase 1; they come in phase 2. Target assumed **700 kg** (old T1 weight), counted per FY. |
| Tiers | No ladder in phase 1. Phase 2: a tier earned in an FY holds through the next FY. |
| Invoice / ITD | Discounted price + full GST (see open questions A and B). |

## 2. What the code does today (checked 6 Nov)

- Booking price is ITD's rate `total` (incl. GST): `itdRateAtWeight` in
  `server/opsActions.ts` keeps only `total`, but the ITD rate row also has
  `gst_total` and `gst_per` (the client shows them in `Rates.tsx` /
  `CreateShipment.tsx`). The order stores only `quoted_amount` / `final_amount`.
- The amount due is `final_amount ?? quoted_amount` (`amountDue`,
  `server/routes/payments.ts:68`). `derivePaymentStatus` / `reconcilePaymentStatus`
  (`server/paymentsDb.ts`) compute paid / partial / refund_due from `payments`
  rows. COD returns null there: never collected by us.
- `payments.method` CHECK allows only `pay_now`, `pay_at_pickup`,
  `pay_at_dropoff` (`migrations/create_payments.sql`).
- ITD prices the docket itself at filing (`shared/usAddress.ts`); the create
  docket payload has no freight amount or discount field.
- The only "invoice" is ITD's freeform (customs) invoice for the goods. The app
  makes no tax invoice for freight.
- `settled` is already an internal order status (after weighing). In rewards
  code, say **"points land"**, never "settle".
- Clock jobs: `server/staffSchedule.ts` (`startScheduleTimer`, 5-minute tick,
  dedupe key per send). The expiry job goes there or alongside.
- No new env vars: constants in code ([no-new-env-vars]).

## 3. Design

### Money: points are a payment row
Points used = one `payments` row, `method = 'reward_points'`, `amount = N`,
status collected. Then `amountDue` and `derivePaymentStatus` work unchanged:
held includes the points, so the customer owes `total − N`, which equals
`(base − N) + GST(base)`.

- A hub reweigh moves `final_amount`; the points row stays fixed, so the rest
  moves. If the new due is below the points used, the extra goes back **as
  points** (`redeem_back` for the difference), never cash.
- Cancel: the points row is reversed (`redeem_back`), and it must not count as
  money to refund: `refund_due` is about cash held only.
- COD: `derivePaymentStatus` skips COD. Decide whether the COD amount sent to
  ITD / the courier is `total − N` (ties to question A).

### Keep the GST split at booking
Extend `itdRateAtWeight` to return `gstTotal` and `gstPer` too. Store on the
order (`metadata.pricing = { base, gst, gst_per }` or columns). At a hub
reprice: `base = final_amount / (1 + gst_per / 100)`.

### Ledger
New table `reward_ledger`:

| Column | Notes |
|---|---|
| id | uuid |
| user_id | `itd_users.id`; never null (no guests) |
| order_id | null for `expiry` / `adjust` |
| kind | `earn`, `redeem`, `redeem_back`, `clawback`, `expiry`, `adjust` |
| weight_kg | parcel kg toward the milestone: + on `earn`, − on `clawback` |
| points | signed int |
| fy | `'2026-27'` (FY of the event, IST) |
| note | free text; required on `adjust` |
| created_by | ops user on `adjust`, else null |
| created_at | |

- Unique `(order_id, kind)` for `earn` and `clawback`: retries and double
  events cannot count twice (same idea as the WhatsApp dedupe key).
- Balance = sum of all rows. **Pending is not stored** (changed 7 Nov): it is
  worked out on read from the account's open orders (not dispatched, not
  cancelled, no guest_ref). A cancelled order just stops showing; nothing to
  drop.
- Land: on the move to `dispatched` (settle already requires payment, so
  dispatched = paid and dispatched). Insert `earn` computed from what was
  actually billed. COD passes the payment gate at settle, so COD orders land
  at dispatch too (assumption; RTO clawback covers a COD that is never paid).
- Expiry at 00:00 IST 1 Apr: per user with balance > 0, one `expiry` row of
  `−balance`, fy = the year ending. Negative balances are left as they are.

### Weight milestone
- Shipped kg this FY = sum of `coalesce(actual_weight, booked_weight)` over the
  user's orders that have an `earn` row in this FY, minus orders later clawed
  back (refund / RTO). Same orders that earn points: account only, paid and
  dispatched. Computed on read; no new table.
- `MILESTONE_KG = 700` in `shared/rewards.ts`. Reached when kg ≥ 700. Starts
  again from 0 each FY (follows the points reset).
- No money or perk attached. Only the UI changes: meter before, "Rewards await
  you" after.

## 4. Build order

### Step 1: earning (no money changes; safe to ship first) — BUILT 7 Nov, uncommitted

Done: `migrations/create_reward_ledger.sql` (**not applied yet**),
`shared/rewards.ts` + tests, `server/rewardsDb.ts` (`landPoints`,
`rewardsOnTransition`, `rewardsSummaryFor`), hook in `notifyOrderTransition`
(`server/notify.ts`), `GET /api/rewards` (`server/routes/rewards.ts`),
`gst_per` kept on the order at booking (`gstPerFromRateRow` in
`server/opsActions.ts`). Everything reads the ledger defensively: before the
migration runs, nobody earns and the API answers zero.

Original list:
1. Migration `migrations/create_reward_ledger.sql`; also widen
   `payments.method` CHECK to include `reward_points` (ready for step 2).
2. `itdRateAtWeight` returns the GST split; booking stores `base / gst / gst_per`.
3. `server/rewardsDb.ts`: `balanceFor(userId)`, `pendingFor(userId)`,
   `addPending(order)`, `landPoints(order)`, `dropPending(order)`.
4. Hooks: booking (`POST /api/orders`, account bookings only) → pending;
   `notifyOrderTransition` / `reconcilePaymentStatus` → land when paid +
   dispatched; cancel → drop pending.
5. `shared/rewards.ts`: pure rules + constants (`RUPEES_PER_POINT = 1`,
   `RUPEES_PER_EARNED_POINT = 100`, `MIN_REDEEM = 100`, `MILESTONE_KG = 700`,
   `fyOf(date)`), with `node:test` tests.
6. `GET /api/rewards`: balance, pending, history, FY end date, `shippedKg`,
   `milestoneKg`, `milestoneReached`.

### Delivery (7 Nov)
Delivery comes from ITD tracking (no order status for it). `rewardsOnTrackingState`
runs whenever tracking is read (`/api/track`, the parcel page) and lands on
DELIVERED / forfeits on RTO-type states. `server/rewardsDelivery.ts` asks ITD
every 6 hours (production only, first run 2 min after boot) about dispatched
account orders from the last 120 days with no earn/forfeit row, 150 per run.
Test AWBs are never filed with ITD, so test orders land at dispatch.

### Step 2: using points (C answered: no cap) — BUILT 7 Nov

Changed from the design above: points used are **not** a `payments` row (the
Transactions totals and cash reports would count them as money). They live
only in the ledger (`redeem` / `redeem_back`) plus a copy on the order,
`metadata.reward_points_used`, which screens read. `reconcilePaymentStatus`
adds the points still applied to cash held, and gives points back first
(`settlePointsOnOrder`): all of them on a cancel, the part above the new price
on a lighter reweigh. The migration no longer touches `payments.method`.

Done: `points_to_redeem` on POST /api/orders (accounts, ITD-checked price,
clamped to balance and bill); gateway charges the rest; a booking covered in
full is paid at once; agent card, collect sheet, collect WhatsApp line, ops
order page and customer order page all show the amount after points; "Use
reward points" card at Review & Pay with To pay and the earn note.
Not done: using points later from an order's Payment due (only at booking).

Original list:
1. `points_to_redeem` on booking and on the pay-now / Payment due endpoint.
2. Server checks: account only, balance ≥ 100 and ≥ requested, cap (C),
   order not cancelled. Write the `reward_points` payment row + `redeem` ledger
   row together.
3. Pending earn recomputed on the net billed amount.
4. Every amount shown net of points: the agent's `collectLine`
   (`server/whatsappTemplates.ts`, uses `quoted_amount` today), extra-charge
   message, order screens, ops order page.
5. Gateway amount (when Razorpay is on) = amount due after points.

### Step 3: taking points back and expiry
1. Cancel → `redeem_back` + drop pending (both idempotent).
2. Refund after landing → `clawback` of the earned points (all of it, or
   proportional to a partial refund: decide).
3. ~~RTO → `clawback`~~ not needed: points land on delivery, RTO never earns.
4. 31 Mar expiry job. Optional "points expire on 31 Mar" WhatsApp in March:
   needs a template row in the sheet (their team submits it).

### Step 4: ops tools — BUILT 7 Nov

Done: "Reward points" section on the ops customer page
(`OpsCustomerRewards`): balance, on the way, kg this FY, milestone, full
history with who adjusted. Manual adjust (add / take away, reason ≥ 5 chars,
max 100,000 per go) behind new permission `rewards.adjust`, super admin only.
"Reward points ledger" monthly CSV on Transactions (`payments.view`, so
accounts has it). Routes in `server/routes/opsRewards.ts`.

Original list:
1. Customer page: points balance + history.
2. Manual adjust with a required reason (super admin).
3. Monthly CSV export of the ledger for accounts (ITD won't know the discount).

### Step 5: UI (port from the demo repo) — BUILT 7 Nov (items 1, 3, 4, 5)

Done: `/rewards` page (`client/src/pages/Rewards.tsx`): weight milestone hero
("Unlock special rewards" + kg ring/meter, then "Rewards await you"), points
wallet (meter to 100, "on the way", expiry warning from 1 Mar), activity,
how it works. Home teaser (mobile + desktop), side menu and desktop sidebar
link, all hidden from guests (`useRewardsAccess` in `client/src/lib/rewards.ts`).
Data from `GET /api/rewards`. Item 2 (Review & Pay card) waits on step 2; the
wallet says "Using points at Review & Pay is coming soon".

Original list:
1. Wallet page `/rewards`: balance, pending ("on the way"), history, FY expiry
   countdown from ~1 Mar. Under 100: meter to 100.
2. Review & Pay and Payment due: "Use reward points" card, To pay, earn note.
3. Home / menu teaser. Tier screens replaced by one weight milestone card:
   "Unlock special rewards" + kg meter (e.g. "320 / 700 kg shipped this year")
   before; **"Rewards await you"** after. No ₹ milestone, no ladder.
4. Guests see nothing (`useRewardsAccess`).
5. Drop the demo-only controls and tour.

## 5. Open questions

| # | Question | Who | Blocks |
|---|---|---|---|
| A | Can ITD's docket take a discounted freight amount or a discount field? If not, ITD bills the full price and our ledger export is the only record. Same for the COD amount. | ITD / Bombino | "Discounted amount to ITD" |
| B | Which invoice gets "discounted amount + full GST"? We make no freight tax invoice. Bombino's own billing system? | Bombino | Invoice half of answer 9 |
| C | ~~Can points cover the whole bill?~~ **Answered 7 Nov: no cap**, points can cover the whole bill including GST. | Aditya | Step 2 |
| D | ~~How is RTO recognised?~~ Moot since points land on delivery: an RTO parcel is never delivered, so it never earns. | — | — |
| E | Do earlier orders earn at launch? **Default: no**, `EARN_FROM_BOOKING_DATE = 2026-11-07` in shared/rewards.ts. Change the constant to backfill. | Bombino | — |
| F | Partial refund after landing: take back all earned points, or in proportion? | Aditya | Step 3 |
| G | "Points expire 31 Mar" WhatsApp reminder: wanted? Needs a new template row. | Aditya | Optional |
| H | Weight milestone: 700 kg? Counted per FY? Weight = hub (actual) weight, else booked? | Aditya / Bombino | Milestone numbers only (constant) |

Steps 1 and 4 need none of these. Start with step 1.
