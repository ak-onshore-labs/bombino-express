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
| Points land | When the order is **paid and dispatched**. Until then they show as pending ("on the way"). Not spendable while pending. |
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

### Step 2: using points (needs question C)
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
3. RTO → `clawback`, once question D gives the ITD event.
4. 31 Mar expiry job. Optional "points expire on 31 Mar" WhatsApp in March:
   needs a template row in the sheet (their team submits it).

### Step 4: ops tools
1. Customer page: points balance + history.
2. Manual adjust with a required reason (super admin).
3. Monthly CSV export of the ledger for accounts (ITD won't know the discount).

### Step 5: UI (port from the demo repo)
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
| C | Can points cover the whole bill? Recommended: cap at the price before GST, so GST is always paid in cash. | Aditya / Bombino | Step 2 |
| D | How is RTO recognised? No order status for it; needs ITD tracking event codes. | ITD | RTO clawback |
| E | Do orders paid and dispatched earlier this FY earn points at launch, or only from launch? | Bombino | Step 1 (backfill) |
| F | Partial refund after landing: take back all earned points, or in proportion? | Aditya | Step 3 |
| G | "Points expire 31 Mar" WhatsApp reminder: wanted? Needs a new template row. | Aditya | Optional |
| H | Weight milestone: 700 kg? Counted per FY? Weight = hub (actual) weight, else booked? | Aditya / Bombino | Milestone numbers only (constant) |

Steps 1 and 4 need none of these. Start with step 1.
