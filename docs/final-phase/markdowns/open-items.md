# Open Items — A-lane

Running list of what is unresolved, who owns it, and what breaks until it lands.
Kept by Aditya. Last updated **4 Aug 2026**.

Sections: [Needs Arbaaz](#1-needs-arbaaz) · [Needs Bombino / Anas](#2-needs-bombino--anas) ·
[Migrations](#3-migrations) · [Known debt](#4-known-debt-accepted-for-now) ·
[Verified working](#5-verified-working)

---

## 1. Needs Arbaaz

### 1.1 `shared/orderContract.ts` needs review — **blocking his lane, not mine**

M0 item 3 is a **joint** file. I wrote it solo to unblock A5. His M2 drawer and M3
guards compile against it, so he should read it before building on it.

Decisions I made unilaterally that he may want changed:

| Decision | Where | Why |
|---|---|---|
| `weighed`/`settled`/`ready_for_docket` all derive to `"Arrived at Bombino hub"` | `deriveCustomerStatus` | Timeline sits still through the internal phase instead of showing a gap |
| `isPaymentSatisfied()` returns **true for COD**, false for everything else | stub | A flat `false` would make COD unsettleable, and COD must never block a docket |
| `super_admin` inherits `admin`, but `admin` does **not** inherit `agent` | `roleSatisfies()` | Ops must never claim a pickup on an agent's behalf (§1) |
| Ops transitions (`weigh`, `settle`, `generate_docket`, `mark_received_dropoff`) already sit in the table | `server/orderLifecycle.ts` | So `availableActions` is complete for every role now. Vocabulary is shared; the handlers are his |

### 1.2 DDL on his column — announce before applying

`migrations/agent_pickup_indexes.sql` touches `orders.agent_id`, which is a
**fulfilment column** and his under the §4 partition. Adds two indexes and the
missing FK to `itd_users(id)`. Fully idempotent. **Not yet applied.**

### 1.3 M1 `requireRole` — I built an interim

`server/routeGuards.ts` has a stand-in with M1's signature and 403 body shape.
Swapping in the real one should be an import change. Delete mine when his lands.

### 1.4 `role` column has no migration and no constraint

Nothing in `migrations/` creates or constrains `itd_users.role`. It is free-text,
and **no signup path issues anything but `customer`** — all 22 real accounts are
customers. Consequences today:

- Agents can only be minted via `scripts/create-test-agent.mjs`
- `POST /api/shipments` is admin-gated, so **docket creation is impossible for
  everyone** until an admin exists. Intentional lockdown, but M5 needs it solved.

M1 owns the column, the CHECK, and the seeding of internal users.

### 1.5 `routes.ts` split — I started it

M0 item 1 is his. I created `server/routes/agent.ts` (self-registering) and moved
the guards to `server/routeGuards.ts` because A5 needed them without a circular
import. The rest of `routes.ts` (~1500 lines) still needs splitting; `routes/agent.ts`
is the pattern to follow.

### 1.6 Seed script (M0 item 8) missing

Only **8 orders** exist, spread across two statuses (`pickup_requested` x3,
`received_at_hub` x5). DoD wants one order in every one of the 11 statuses.
The settle/docket half of the board is untestable without them.

### 1.7 Ops actions still return 501

`weigh` · `settle` · `generate_docket` · `mark_received_dropoff` are authorised and
legal at `POST /api/orders/:id/actions`, but fall through to 501. His handlers
(M3/M5) drop into the `default:` branch of the switch.

---

## 2. Needs Bombino / Anas

Carried from §8 of the module spec. A-lane items only.

| Item | Needed by | Chase | Status |
|---|---|---|---|
| OTP / SMS provider + credentials | D3 | Aditya → Bombino | **Outstanding.** See [4.1] |
| Razorpay confirmation + keys | D9 | Aditya → Bombino | **A4 built** — gateway order, verify, idempotent webhook. Needs `RAZORPAY_KEY_ID` / `_KEY_SECRET` / `_WEBHOOK_SECRET` in the environment and a webhook registered in the dashboard before it can be tested end to end. Unset keys → pay-now returns 503, other three methods unaffected |
| Refund mechanics — manual flag vs gateway refund | D7 | Aditya → Bombino | **Settled: manual, with a flag** (day-zero-checklist §Refunds). The app never issues a refund. As of 10 Aug the webhook records one issued in the Razorpay dashboard — `refund.processed` marks the `payments` row and flags the order `refund_due` — so a manual refund no longer leaves the order reading `paid`. Execution stays with accounts |
| Docket attribution (§7) | D4 | Arbaaz → Anas | **Outstanding.** Blocks company-signup attribution — see [4.5] |

---

## 3. Migrations

| File | Status |
|---|---|
| `add_itd_users_metadata.sql` | **Applied 3 Aug**, verified live |
| `create_payments.sql` | **Applied 3 Aug** — verified by a real `collect_payment` writing a row |
| `agent_pickup_indexes.sql` | **Not applied.** Nothing functional depends on it — performance and referential integrity only. Touches Arbaaz's column, see [1.2] |
| `create_agent_availability.sql` | Applied, then **superseded**. Table deprecated and unread — see [4.6] |
| `create_agent_weekly_availability.sql` | **Applied 3 Aug** |
| `payments_gateway_reference.sql` | **Applied 10 Aug.** A4 idempotency — partial unique index on `reference WHERE method = 'pay_now'`, so the verify call and a simultaneous webhook cannot both insert and double-credit an order |
| `pickup_slots_two_hour_windows.sql` | **Applied 4 Aug.** Verified: roster holds only 2-hour values; `orders` accepts both, so pre-change bookings keep their 3-hour windows |

---

## 4. Known debt (accepted for now)

### 4.1 OTP verification is a no-op — **live auth bypass**

`server/routes.ts:~327`. Any 6-digit code is accepted; `hashOtp(code)` is stored
but never compared, and `attempts` is never incremented so the rate limiter is
dead code.

**Anyone who knows a registered phone number can log into that account with
`000000`** — including the test agent, and including any real customer.

Commented as blocked on an SMS provider, but **the comparison does not need one**:
`hashOtp(code) !== row.code_hash` works today with a console-logged dev code.
Left in place at explicit instruction. Must not ship.

### 4.2 Service-role key bypasses RLS everywhere

`server/supabaseClient.ts:4`. Every ownership check must live in the SQL WHERE
clause — a JS-side `if (order.agent_id === me)` is not a security boundary. A5's
DB layer is written this way throughout; anything new must follow.

### 4.3 `order_events` writes are not transactional

The action endpoint awaits the event insert and reports failure, but the status
change is already committed and cannot be rolled back (supabase-js has no
multi-statement transaction). A failed log yields a successful action plus a
`warning` field.

**Durable fix:** `AFTER UPDATE` trigger on `orders` — covers every writer, not
just this endpoint. Worth raising with Arbaaz since `order_events` is his table.

Same shape of problem in `recordCollectedPayment()`: payment row then
`payment_status` flip, two statements. Ordered to fail safe — a crash between
them leaves recorded money on a `pending` order, which reconciliation can find.
The reverse would lose it.

### 4.4 `account_type` is `personal` on staff accounts

`itd_users.account_type` is `NOT NULL` with `CHECK IN ('personal','company')`, so
every row must be one or the other — staff included. It is a customer field
(picks Aadhaar vs GST at signup, drives the KYC branch at booking) and is
meaningless for agents and admins.

Inert, not a bug: `role` is the discriminator everywhere that matters. The only
effect is that an agent landing on `/create` would see the Personal KYC branch,
which A1's route guard should prevent anyway.

**Fix, if ever wanted** — deferred deliberately, probably to M7:

```sql
ALTER TABLE public.itd_users DROP CONSTRAINT itd_users_account_type_check;
ALTER TABLE public.itd_users ADD CONSTRAINT itd_users_account_type_check
  CHECK (account_type IN ('personal', 'company', 'internal'));
```

Not additive-only under §4 (drop-and-recreate), and on a table Arbaaz reads.
Announce first.

### 4.5 Company signup stores a synthetic ITD id

`add_customer` fires and succeeds, but returns no customer id — only an echo of
the request (§7). We mint `local-<uuid>` and stash the full response in
`itd_users.metadata` as `{ itd_registered, itd_customer_id, itd_add_customer_response }`.

A2's DoD "Company signup stores `itd_customer_id`" is met only in this interim
sense. Promote to typed columns once docket attribution resolves. **0 company
accounts exist**, so there is no backfill debt yet.

### 4.6 Agent schedules — CLOSED, the whole feature is gone

Was: `agent_weekly_availability` is a recurring pattern with no per-date
exceptions, so a customer can book a window on a day the only rostered agent is
absent. The planned fix was an `agent_availability_exceptions` table resolved as
`pattern MINUS exceptions`.

**Do not build it.** Pickup windows were removed entirely: a customer picks a
date, the agent collects when they reach the address, and every free job is
offered to every agent. `migrations/drop_pickup_slots.sql` drops
`orders.pickup_slot`, `agent_weekly_availability`, and the long-dead per-date
`agent_availability`. `/agent/schedule` and `server/availabilityDb.ts` are
deleted.

### 4.7 Pickup availability is new scope — CLOSED with 4.6

Neither A3 nor A5 specified it. A3 said "four 3-hour slot options" with no
notion of whether anyone was working; A5 said nothing about rosters — and both
are moot now. `/api/pickup/slots` and `/api/pickup/coverage` are gone, so
`GET /api/config/slots` under M1 has nothing to delegate to and no roster
constrains what the ops board sees.

### 4.8 Booking is not literally "zero ITD calls"

Submit is clean — `POST /api/orders` makes no ITD call. But `POST /api/rates`
still hits `itdClient.getRates` during the flow, which is needed for
`quoted_amount`. When checking off A3's DoD, claim "booking creates no docket",
not "booking fires zero ITD calls".

---

## 5. Verified working

Live-tested 3 Aug against the real DB, not just compiled.

**Auth + routing**
- Test agent `9000000001` (`ccda702b-…`) logs in; session carries `role: "agent"`
- All agent/action routes 401 unauthenticated
- Agent lands on `/agent`, not `/home` (`landingPathForRole`)

**Full pickup lifecycle**, BOM-100001, one action at a time:

| Action | Result | `availableActions` after |
|---|---|---|
| `claim` | `agent_accepted` | `["start_pickup"]` |
| `start_pickup` | `out_for_pickup` | `["mark_picked_up"]` |
| `mark_picked_up` | `picked_up` | `["mark_received_at_hub"]` |
| `mark_received_at_hub` | `received_at_hub` | `[]` — **job left the agent's list** |

**Payment collection**, BOM-100002 (`pay_at_pickup`)
- `collect_payment` wrote a `payments` row (₹500, `collected_by` = agent id)
  and left status at `out_for_pickup` — no advance, as specified
- A second `collect_payment` correctly refused with `ACTION_NOT_AVAILABLE`
  (already paid, guard rejects)
- `mark_picked_up` was only permitted after collection

**History** — every action wrote an `order_events` row carrying
`{action, role}` plus `payment_id`/`amount` on the collection.

**Address embed** — both list endpoints return the full pickup address, so the
agent has somewhere to go.

**Not yet tested:** the two-agent concurrent claim race. Needs a second agent —
`node --env-file=.env scripts/create-test-agent.mjs 9000000002 "Test Agent Two"`.

**Test data state:** BOM-100001 is now `received_at_hub`, BOM-100002 `picked_up`
with a payment attached. Two orders remain at `pickup_requested`. Reset before
demoing if a clean board is wanted.
