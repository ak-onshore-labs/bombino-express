# Ops Console — What `aditya/final-phase` Needs Reflected

The features built on `aditya/final-phase` that the ops console doesn't yet show or handle.
Kept by Aditya. Written **10 Sep 2026**.

**Scope:** the 36 commits on `aditya/final-phase` that `arbaaz/ops-console` doesn't have
(`git log origin/arbaaz/ops-console..aditya/final-phase`), plus uncommitted work. Features
that need nothing on ops are listed at the end.

**Assumed:** the guest migrations — `add_guest_orders.sql`, `create_guest_profiles.sql` and
the two `add_guest_profile_*` files — are applied, since the guest booking flow is live.

---

## 1. Guest bookings — customers can book without an account

`961fae0`, `2bf3d29`, `5bd8323` and the rest of the `guest` commits.

A guest verifies their phone by OTP, uploads full KYC and books with no account. Such an
order has `user_id = NULL` and is owned by `orders.guest_ref`. The sender's details sit on
the order itself, in `guest_name`, `guest_email` and `guest_phone`.

**The merge dropped the ops support for this.** `961fae0` had added guest columns to
`server/opsDb.ts`: `guest_ref`, `guest_name`, `guest_email` and `guest_phone` to
`DETAIL_COLUMNS`, and `is_guest` and `guest_name` to board rows. The merge at `37b309d` took
`opsDb.ts` from `ops-console` wholesale, and those columns were lost. So today, for a guest
order:

- the board's Customer column shows **"—"** (`OpsBoardTable.tsx:103`)
- order detail shows **"—"** as the customer (`OpsOrderDetail.tsx:394`), with no name, phone or email
- nothing marks the order as a guest booking

**Needed:**
- Add the guest columns back to `BOARD_COLUMNS` and `DETAIL_COLUMNS`, and bring back `is_guest` and `guest_name` on the board row.
- Show the guest's name, phone and email wherever the account holder would appear: board table, board card, order detail, CSV export.
- Add a "Guest" tag on the card, row and detail.
- Add a board filter for guest vs account.

## 2. Guest profiles — guests have a profile but ops can't see it

`5bd8323`, plus `add_guest_profile_account_details.sql` and `add_guest_profile_account_type.sql`.

`guest_profiles` holds each guest's details, keyed by `guest_ref`:
- phone, name and email
- `account_type` (personal or company)
- company details: category, name, GSTIN and verified name, contact person
- address, city, state and hub

The ops **Customers** directory and `/ops/customers/:id` only read `itd_users`, so a guest
can't be found or opened at all.

**Needed:**
- List guests in Customers, as a filter or a separate tab, searchable by phone and name.
- Add a guest detail page keyed by `guest_ref` that shows the profile and the guest's orders.
- `/api/ops/customers/:id/orders` only matches on `user_id` (`opsDb.ts:295`), so it needs a `guest_ref` equivalent.

## 3. Guest KYC — guests' identity documents are invisible to ops

`961fae0`, `b14983d`, `72da8c4`.

A guest's documents live in `account_documents`, owned by `signup_ref`, and in
`kyc_documents`, owned by `guest_ref`. The ops KYC viewer and the super_admin document reveal
are keyed by user id, so a guest's KYC can't be viewed. That includes the document customs
will read for their shipment.

**Needed:** the same super_admin, access-logged viewer and reveal, keyed by `guest_ref`, on
the guest detail page from item 2.

## 4. A guest who opens an account keeps their orders

`961fae0`, `b14983d`.

When a guest's phone number opens an account, `claimGuestOrdersForUser` moves their orders,
addresses, payments and KYC document onto the new `user_id`. `guest_ref` stays on each row as
a record of how the order arrived. Nothing breaks on ops: those orders simply appear under the
customer.

**Nice to have:** a "first booked as guest" note on the customer and order, read from
`guest_ref IS NOT NULL` on a claimed row.

## 5–6. KYC — the rule, and what the code does today

**The rule (Aditya, 10 Sep):**
- KYC is decided **only by Cashfree Smart OCR**. There is no manual review or approval anywhere.
- While Bombino is on Cashfree test credentials, the check is **bypassed silently**: a document counts as verified and nothing on screen says it was skipped.
- Once Cashfree is live, a failed check shows the customer a popup with the reason, and the ops console shows the same reason.
- **KYC never stops an order or AWB generation**, whether the check failed or was skipped.

**Done on our side in `9e19399`:**
- The KYC hold is removed from both docket paths.
- `KYC_VERIFICATION_BYPASS`, its module and `isKycHeld` are deleted.
- `KycOnFileCard` shows `bypassed` and `skipped` documents as verified.

**Still on the ops console:** customer detail's `identityStatusLabel` shows "Bypassed", which should read as verified. The dashboard's "Unverified customers" section (`OpsDashboard.tsx:237`) still describes unverified customers as blocked at `generate_docket`, and nobody is blocked any more.

**Ops console work, once Cashfree is live:**
- Show Cashfree's verdict and reason next to each document on `OpsCustomerDetail`. `ocr_status` is already fetched (`useOpsCustomers.ts:25`, `:40`) but never shown.
- Turn "Unverified customers" into an information-only list of failed checks with reasons, guests included. It shouldn't block or chase anything.

## 7. AWB at booking

`192fed0`, `1180f98`, behind `ITD_DOCKET_AT_BOOKING` (off by default).

An ITD-linked customer's order gets a real AWB the moment it is booked. When that fails, the
reason is stored in `metadata.docket_error` and the order falls back to ops. Ops already has
the "AWB failed" badge and banner and the new `mark_dispatched` action. Still to do:

- **The "AWB failed" banner points ops at a fake AWB.** It says to generate the docket once the order is settled, but `generate_docket` still writes a mock AWB (`opsActions.ts:342`). Change the banner's wording until the real docket exists.
- **Tag orders "docketed at booking."** Before dispatch, these AWBs look the same as any other. Ops need to know which ones are real ITD dockets, because the weight is locked at ITD and the way out of Settled is `mark_dispatched`.
- **Reweighing these orders.** `handleWeigh` ignores `awb_no`, and the hub reweigh never reaches ITD. `OpsWeighSheet` should warn when the weight changes on an order that already has an AWB.
- **"AWB failed" filter and dashboard count.** Right now the badge is the only signal.
- **Confirm before `mark_dispatched`.** It runs on one click and releases the customer's dispatch message. `settle` already asks first.

## 8. Pickup beats

`2b62ff5`.

Beats — a rider's round of pincodes, with a same-day cut-off and the riders who run it — were
built on our branch, and so was their ops UI:
- the `/ops/beats` page
- a "Beats" entry under "More" in the nav
- six admin-gated `/api/ops/beats` endpoints
- each agent's beats listed on `OpsUsers`

It all sits in ops files, so **Arbaaz should review it and take it over.** Rider and
coverage background is in [pickup-riders.md](./pickup-riders.md).

**Needed:**
- Creating an agent at `/ops/users` doesn't assign a beat, so a new agent gets no job alerts until someone adds them at `/ops/beats`. Add an optional beat picker to the create form.
- That form's **Hub** field is the ITD hub, not a beat, even where the city names match. Label it that way, or ops will assume it sets coverage.

## 9. Drop-off counters for uncovered pincodes

`5d23d85`.

A customer whose pincode has no pickup coverage is now shown drop-off counters.
`shared/branches.ts` holds the 14 counters, matched by state, and `/locations` lists them
all. The order doesn't record which counter was suggested.

**Needed:** on the Drop-offs board and on a drop-off order's detail, show the counter the
customer was pointed to, using `dropoffBranchesFor(pincode, city, state)`. Also let staff at
each counter filter to their own counter.

## 10. Agent email

`192fed0`.

Agents can now add or clear their own email address from their profile. `OpsUsers` doesn't
show it. **Needed:** display the email on the staff list.

## 11. Found in audit

- **Search can't find the sender** (guest commits). `matchesSearch` in `shared/opsBoardQuery.ts:209` only matches `order_no`, the consignee's name and city, and `awb_no`. Add the sender's name and phone — `guest_name` and `guest_phone` for guests, the account holder's details otherwise — so a guest who phones in can be found.
- **The board doesn't refresh itself** (`c78da96`). The agent app polls every 10 seconds; no `useOps*` hook sets `refetchInterval`. Add a 15–30 second poll while the tab is in the foreground.

---

## Needs nothing on the ops console

| Feature | Commits | Why |
|---|---|---|
| Drop-off OTP is exactly 4 digits | `5d23d85` | Already changed in `OpsDropoffOtpSheet` |
| Aadhaar formatting in customer detail | uncommitted | Already done in `OpsCustomerDetail` |
| Guest notifications (in-app bell) | uncommitted | Customer side only |
| Agent job list — New jobs, Later band | `c78da96`, `7860ec6`, `329cbfd` | Agent app only |
| Agent motion system | `5d23d85` | Agent app only |
| Unmatched `/api` paths return a JSON 404 | `1180f98` | Server-wide; ops fetches now get a real 404 instead of an HTML page |
| Sessions in Postgres, Vercel deploy | `9fd1d23`, `4e7212b`, `e424ee3` and others | Infrastructure — ops sign-in behaves the same |
| Postal pincode lookup fallback | `e103199` | Booking only |
| Optional KYC | `33d627a` … `20df7c5` | Reverted; nothing left |
