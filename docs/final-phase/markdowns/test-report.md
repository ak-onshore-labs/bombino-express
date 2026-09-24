# Final phase — test report

Run on **18 Sep 2026** against `aditya/final-phase` (base `684b89c`), on the
shared Supabase project, by `npm run test:e2e`. Every case asserts what
[`roles-and-flows.md`](./roles-and-flows.md) says **should** happen. A red test
is a confirmed gap, not a broken test.

**Headline:** 55 automated cases: **30 pass, 25 fail**. The failures are real
and reproducible. The full run gave the same result as running each file
on its own.

- The core lifecycle holds: role boundaries, ownership, claim races, docket
  races, handover-code lockout, and cancellation rules.
- **Money reconciliation after weighing does not work.** The booking amount is
  trusted from the browser, and there are several auth weaknesses.

These must be fixed before real customers.

Companion: [`go-live-checklist.md`](./go-live-checklist.md) §8 (known gaps).
The confirmed items below should be added there.

---

## 1. Technical baseline

| ID | Check | Result |
|---|---|---|
| T1 | `npm run check` (tsc, now including `tests/`) | **PASS**: 0 errors |
| T2 | `npm test` (unit) | **PASS**: 282 / 282 |
| T3 | `npm run build` | **PASS**: client and `dist/index.cjs` (2.2 MB) build. Chunk-size warning only |
| T4 | `npm run lint` | 88 warnings, 0 errors (every rule is warn-only, so it cannot fail) |
| T5 | Boot warnings | Boxed warnings print for `OTP_FIXED_CODE`, `PAYMENTS_TEST_MODE`, `OCR_BYPASS`, `IDENTITY_BYPASS`. **A missing `SESSION_SECRET` is silent** and falls back to `"dev-secret"` (`server/app.ts:274,352`) |
| T6 | Test glob | No `*.test.tsx` files exist, so nothing is missed today |
| — | CI | **None.** No workflow runs tsc, tests or build on push. `nixpacks.toml` runs only the build |
| — | Sessions in dev | Redis wasn't ready, so the server fell back to `PostgresStore`. Production needs `REDIS_URL` (checklist §2) |

## 2. Results

✅ pass · ❌ fail (confirmed) · 📖 confirmed by reading code, no test run

### P0: security and money

| ID | Case | Result | Evidence |
|---|---|---|---|
| E-A1a | 5 wrong OTPs lock the code | ✅ | then `OTP_TOO_MANY_ATTEMPTS` |
| E-A1b | 10 **parallel** wrong OTPs lock the code | ❌ | only **2** attempts recorded, and the right code was then accepted |
| E-A1c | Spent code can't be reused | ✅ | |
| E-O1 | Expired code refused | ✅ | `OTP_EXPIRED` |
| E-O2 | OTP request rate limit | ✅ | 21st request → 429 (dev limit 20) |
| E-A2 | `/api/debug/session` not public | ❌ | 200 with `sessionID` and cookie settings, no login |
| E-A3 | Signup doesn't reveal registered numbers | ❌ | registered → 409 `ACCOUNT_EXISTS`; unregistered → 400 `PHONE_UNVERIFIED` |
| E-A4 | Browser A's phone verification doesn't authorise browser B | ❌ | a fresh browser staged a PAN on the victim's number: 200 |
| E-A5 | Session id changes at sign-in | ❌ | same `connect.sid` before and after sign-in (session fixation) |
| E-A7 | Old cookie dead after logout | ✅ | 401 |
| E-P1 | Prepaid, weighed heavier → owes, and settle blocks | ❌ | paid ₹100, now costs ₹1000, `payment_status=paid`, **settle 200** |
| E-P2 | Prepaid, weighed lighter → `refund_due` (Flow D) | ❌ | paid ₹50000, now ₹1250, still `paid` |
| E-P3 | Two parallel `collect_payment` → one row | ✅ | suspected race did **not** reproduce |
| E-P4 | Collecting less than owed ≠ paid | ❌ | ₹1 of ₹900 → `paid` |
| E-P5 | Booking refuses a negative amount or zero weight | ❌ | `quoted_amount:-1` → 200; `booked_weight:0` → 200 |
| E-P6 | Webhook: bad signature 401, duplicate delivery records once | ✅ | |
| E-P7 | Gateway payment on a cancelled order → `refund_due` | ❌ | → `paid` |
| E-P8 | Cancel a paid order → `refund_due` | ❌ | → `paid` |
| E-P9 | Two partials summing to the total → `paid` | ❌ | ₹400 + ₹600 of ₹1000 → `partially_paid` |
| E-X1 | Role matrix across `/api/ops/*`, `/api/agent/*`; admin can't claim | ✅ | 35 checks |
| E-X2 | Customer can't view, cancel, mint codes for or pay another's order | ✅ | all 404 |
| E-X3 | Personal data not in server logs | ❌ | request logger writes whole JSON replies (phones, addresses, amounts) (`server/app.ts:233`) |
| E-X4 | 500 replies don't leak internals | 📖 ❌ | `server/app.ts:416` returns `err.message` |

### P1: lifecycle and booking

| ID | Case | Result | Evidence |
|---|---|---|---|
| E-L1 | Two agents claim at once → one 200, one 409 | ✅ | |
| E-L2 | Parallel `generate_docket` → one AWB | ✅ | |
| E-L3 | `settled` → `ready_for_docket` → `dispatched` | ❌ | `ready_for_docket` never happens: `settled → dispatched` (`server/orderLifecycle.ts:243`). The gate lives in settle's guard instead. Spec decision needed |
| E-L4 | COD weighed heavier still settles and dockets | ✅ | |
| E-L5 | Agent locked out after hub; job leaves their list | ✅ | |
| E-L6 | Agent B can't act on A's job | ✅ | |
| E-L7 | Pickup can't start before its date (IST) | ✅ | |
| E-L8 | Can't mark picked up while pay-at-pickup owed | ✅ | |
| E-L9 | Double-tap → second refused | ✅ | |
| E-L10 | A wrong weight can be corrected before settle | ❌ | 403 `ACTION_NOT_AVAILABLE`; only `settle` offered |
| E-L11 | Ops override to `picked_up` issues a hub code | ❌ | no hub code; the agent is stuck at the hub until ops regenerates one |
| E-L12 | Unknown action 400, illegal 403 | ✅ | |
| E-H1a | 5 wrong handover codes lock it | ✅ | |
| E-H1b | 10 **parallel** wrong handover codes lock it | ✅ | suspected race did **not** reproduce |
| E-C1–3 | Cancellation windows, one open request, decline needs a request | ✅ | |
| E-G1 | A guest can request cancellation | ❌ | the only path (`/api/orders/:id/actions`) requires an account login |
| E-G2 | Account customers can mint the drop-off code | ✅ | Guests: no screen or WhatsApp carries it (📖 `notify.ts`) |
| E-B1 | Pickup with no date / mismatched pay method refused | ✅ | |
| E-B2 | Unserviceable pincode / date before cutoff → 409 | ✅ | |
| E-B3 | Malformed or far-future pickup date refused | ❌ | `"2099-9-1"` → 200 |
| E-B4 | Same booking submitted twice at once → one order | ❌ | 2 orders |
| E-B5 | Junk `items` / `consignee` refused | ❌ | 200 |
| E-B6 | Guest: no KYC / no contract / an account's number | ✅ | 422 / 422 / 401-409 |
| E-R1 | `/api/rates` refuses weight -1, 0, "abc" | ❌ | -1 and "abc" → 200 (ITD answers "No Rate Found") |
| E-K1 | Upload over 4 MB refused; non-document refused | ❌ | 4 MB → 413 ✅; a Windows `.exe` sent as `application/pdf` → **stored** (no file-content check) |

### P2: operations and background jobs

| ID | Case | Result | Evidence |
|---|---|---|---|
| E-W1 | WhatsApp webhook: wrong secret 404; STOP / START | ✅ | |
| E-W2 | Cron endpoints refuse no/wrong bearer, and a signed-in admin | ✅ | |
| E-W3 | Dry-run "skipped" messages are sent once sending is on | ❌ | 176 `skipped` rows in the DB still hold their `dedupe_key`, so a retry never re-sends |
| E-W4 | Deactivated agents excluded from fan-out and digest | 📖 ❌ | `loadAgents` filters on role only (`server/whatsappAgents.ts:42`) |
| E-S1 | BIA rate limit holds without Redis | ❌ | 22 messages, never limited; `Redis unavailable, skipping rate limit` ×22 |

### Flows (roles-and-flows.md §3)

| Flow | Result | Note |
|---|---|---|
| A: personal, pickup, pay now → in transit | ❌ | Every step works. Fails because the customer API reply carries the raw internal status (`"status":"weighed"`). The app maps it to a customer label, so this is a data leak, not a visible one. Spec says the customer "never sees" these words |
| B: drop-off, pay at counter | ✅ | wrong drop-off code refused, settle blocked until paid |
| C: COD | ✅ | settles with no money, reprice recorded |
| D: weighed lighter, refund due | ❌ | = E-P2 |
| Cancellation: request, decline, request, approve | ✅ | cancelled job leaves the agents' list |
| Guest: verify, identity, book, profile | ✅ | |
| Account review (apply, send back, approve) | not run | needs a filed application with documents; see §4 |

## 3. Confirmed bugs, ranked

| # | Sev | Bug | Where | Fix | Effort |
|---|---|---|---|---|---|
| 1 | **Critical** | Booking amount and weight come from the browser unchecked, and pay-now charges that amount. Tamper `quoted_amount` to ₹1, pay ₹1, and (with #2) it settles and ships | `server/routes.ts:3079-3080`, `server/routes/payments.ts:67` | Recompute the quote on the server (ITD rate or formula) at booking; reject ≤0 | M |
| 2 | **Critical** | Weighing never updates `payment_status`: heavier prepaid orders settle short; lighter ones never show `refund_due` | `server/opsDb.ts:443-450` (`repriceOrderAtWeight`) | After reprice, compare collected total with `final_amount` → `partially_paid` / `refund_due` / `paid` | S-M |
| 3 | **Critical** | Phone verification is per number, not per browser: anyone can stage identity, open an account/application, or `link/itd` on a number verified elsewhere in the last 10 min | `server/signupRef.ts:123`, `server/routes.ts:2164` | Bind verification to the session (`req.session.verifiedPhone` + expiry), not only the DB row | M |
| 4 | High | Parallel wrong OTPs are under-counted (10 → 2), so the 5-try limit can be brute-forced | `server/otpDb.ts:73-80` | Atomic `attempts = attempts + 1` (RPC or `update … where attempts = n` retry loop) | S |
| 5 | High | Any collected amount marks the order `paid` | `server/agentDb.ts:331`, `server/paymentsDb.ts:191` | Sum payments vs amount owed; set `partially_paid` below it | S |
| 6 | High | Cancelling a paid order / money landing on a cancelled order doesn't flag `refund_due` | `server/orderActions.ts:516`, `server/routes/payments.ts:746` | Set `refund_due` when cancelling with money collected, and in the webhook when the order is cancelled | S |
| 7 | High | No session regeneration at sign-in (fixation) | `server/routes.ts:2042` onward | `req.session.regenerate()` before setting `user` / `dbUserId`, carrying the needed signup fields | S |
| 8 | Med | `/api/debug/session` is public: it returns the caller's own session id, so an injected script can read an `httpOnly` cookie's value | `server/routes.ts:362` | Delete it, or gate it to dev | XS |
| 9 | High | Request log writes full JSON replies (phones, addresses, decrypted identity for super_admin) | `server/app.ts:233` | Log method, path, status and time only in production | XS |
| 10 | Med | BIA rate limit fails open without Redis (uncapped OpenAI spend) | `server/supportRateLimit.ts:70` | Fall back to an in-memory limiter | S |
| 11 | Med | Two partial payments never add up to `paid` | `server/paymentsDb.ts:191` | Same fix as #5 | — |
| 12 | Med | Ops override to `picked_up` doesn't issue the hub code | `server/orderActions.ts:284-340` | `issueCode(order.id, "hub")` after the override | XS |
| 13 | Med | Weight can't be corrected after weighing | `server/orderLifecycle.ts:217` | Allow `weigh` from `weighed` (admin) | XS |
| 14 | Med | Guests can't cancel, and never see their drop-off code | `server/routes.ts:3513`; `server/notify.ts` | Guest-ref ownership on the action + code endpoints; add the code to the booking WhatsApp | M |
| 15 | Med | Double submit creates two orders | `POST /api/orders` | Client idempotency key (header), unique per user | S |
| 16 | Med | Dry-run / failed WhatsApp rows keep their dedupe key, so they are never sent | `server/whatsapp.ts:151-182` | Release the key on `skipped` / `failed`, or let retries reclaim them | S |
| 17 | Med | Deactivated agents still get WhatsApp jobs and digest | `server/whatsappAgents.ts:42` | Add `.eq("is_active", true)` | XS |
| 18 | Med | 500 replies return raw `err.message` | `server/app.ts:416` | Generic message in production; log the detail | XS |
| 19 | Low | Signup answers "already registered" before the OTP check | `server/routes.ts:1512, 1700` | Move the check after `hasRecentVerification` | XS |
| 20 | Low | Booking accepts malformed / far-future dates and any `items` / `consignee` shape | `server/routes.ts:3077, 3105` | Zod: `YYYY-MM-DD`, ≤ 30 days out; typed item/consignee schemas | S |
| 21 | Low | `/api/rates` accepts non-positive / non-numeric weight | `server/routes.ts:2919` | `z.number().positive()` | XS |
| 22 | Low | Uploads trust the declared MIME type | `server/routes.ts:257` | Magic-byte check (`%PDF`, JPEG, PNG) | S |
| 23 | Low | Customer order reply carries raw internal statuses | `GET /api/orders/:orderNo` | Send the derived customer status only | S |
| 24 | Decide | No `ready_for_docket` state; spec says there is one | `server/orderLifecycle.ts:243` | Either add the state or update the spec (the settle guard already enforces the gate) | — |

## 4. Not covered by this run

**Confirmed by code reading, no black-box test possible:**
- `generate_docket` is a mock (random `BMB…` AWB, no ITD call): `server/opsActions.ts:329`
- `shipment_invoice_no` hard-coded `TESTINV01`: `client/src/pages/CreateShipment.tsx:1755`
- Weight sent in kg to rates but lb to the docket: `CreateShipment.tsx:1097` vs `:1753`
- Booking date taken in UTC, which is wrong between 00:00 and 05:30 IST: `CreateShipment.tsx:1697`
- Missing `SESSION_SECRET` is silent; no CSRF protection while cookies are `sameSite=none`; no security headers (helmet)
- Retention sweep deletes booked guests' documents if its "which refs have orders" query errors (it fails open): `server/retention.ts:~40`
- Beat replacement and signup are not transactional
- ITD reprice fell back to the formula on every weigh (ITD answered "No Rate Found"). Check reprice with real booking parameters before launch

**Not run (need more setup):**
- Account review: approve with unchecked documents, a parallel approval race, `request_changes` by a non-claimer (E-K3), and withdraw during review (E-K4)
- Stage a document before its identity number, or change the number after (E-K2)
- BIA prompt injection through forged assistant turns (E-S2), a non-numeric `SIGNUP_RETENTION_DAYS` (E-S3)
- Running the rider digest twice. **Deliberately skipped**: on the shared DB a dry-run digest would use up today's real digest dedupe keys (see #16)
- Manual UI pass (booking form inputs, live order updates, ops empty/403 states, agent app at phone width)

## 5. How to re-run

```bash
npm run test:e2e          # ~7 min, serial; boots its own server on 127.0.0.1:5001
```

- Needs `.env` with `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `ENCRYPTION_KEY`.
- The harness (`tests/e2e/harness.ts`) forces the rest of the environment:
  - `WA_DRY_RUN=1` and an empty `TATA_WA_TOKEN`: nothing is sent.
  - `ITD_DOCKET_AT_BOOKING=0`: no real dockets.
  - `OTP_FIXED_CODE`: a fixed login code, so wrong codes still fail.
  - `PAYMENTS_TEST_MODE=1`.
  - Local Razorpay and webhook secrets.
- It leaves `:5000` alone and runs no migrations.
- Accounts used: admin `9000000010`, agents `9000000014` / `9000000012`, customers `9000000090` / `9000000095`, guest `9000000096`, OTP probes `9000000097` / `98` (see `docs/test-accounts.md`).
- Every order is tagged `E2E-<run>` and deleted afterwards, along with its notifications, WhatsApp rows and guest documents. After this run: 0 leftover `E2E-%` orders, seeded `BOM-1000xx` untouched.
- Save the server log with `E2E_LOG=<file> npm run test:e2e`.
- Run one area: `npx tsx --test tests/e2e/money.e2e.ts`.

Files: `auth.e2e.ts` (auth and sessions), `money.e2e.ts` (payments and reweigh),
`lifecycle.e2e.ts` (races, roles, handover codes, cancellations, booking validation),
`ops.e2e.ts` (WhatsApp, cron, BIA, logs, guests), `flows.e2e.ts` (journeys A–C, guest, cancellation).

When a bug is fixed, its test turns green. No test needs editing.

---

## 6. Fix pass, 18 Sep 2026 (before the Railway cutover)

Re-run after the fixes below: **55 cases, 41 pass, 13 fail, 1 skipped.**
`npm test`: 293 / 293. Every remaining failure is one of the Med/Low/Decide
items in §3 not yet taken on.

| # | Bug | Fix | Tests now green |
|---|---|---|---|
| 1 | Booking price trusted from the browser | Server asks ITD for the chosen service at booking, **on the same ITD login `/api/rates` used** (the customer's own, if linked; else the company's), and books at that price. Amount and weight must be positive. A quote ITD can't confirm is kept but marked `quote_verified: false`, and can't be paid online | E-P5 |
| 2 | Weighing never touched `payment_status` | One writer, `reconcilePaymentStatus` (`server/paymentsDb.ts`), derives it from collected − refunded vs amount due. Runs after every collection, gateway payment, weigh and cancel. `refund_due` now passes settle (Flow D). Ops can collect the reweigh difference on prepaid orders at the hub | E-P1, E-P2, E-P7, E-P8 |
| 3 | Phone verification per number, not per browser | Spending a code stamps the session (`markPhoneVerified`). Signup, identity staging, guest booking, ITD link and phone change require that stamp (`isPhoneVerifiedHere`, `server/signupRef.ts`) | E-A4 |
| 4 | Parallel OTP guesses under-counted | Each try claims a numbered attempt with a compare-and-swap **before** comparing; consuming a code is conditional | E-A1b |
| 5 | Any amount marked paid | Same `reconcilePaymentStatus` | E-P4, E-P9 |
| — | Parallel handover-code guesses (E-H1b passed by luck on the first run) | Same claim-before-compare pattern in `verifyCode` | E-H1b |
| — | Double-tapped cash collection (E-P3 passed by luck on the first run) | Optimistic lock on the order row before the payment insert | E-P3 |
| 8 | `/api/debug/session` public | Deleted | E-A2 |
| 9 | Response bodies in logs | Production logs method, path, status and time only | E-X3 (checked on a production boot, skipped in the dev-mode suite) |
| 10 | BIA rate limit failed open without Redis | In-process limiter, never fails open | E-S1 |
| 17 | Deactivated riders still messaged | `is_active` filter | — |
| — | Redis | Removed: sessions in Postgres (pruned hourly), in-process postal cache | — |
| — | Boot safety | Production refuses to start without `SESSION_SECRET` or a Postgres session store, and exits 1. `GET /api/health` added | checked by hand |

**Found while fixing:**
- The hub reprice always used the company ITD login, so customers who linked
  their own ITD account were repriced on a different tariff. Replaying 8 real
  orders:
  - company-tariff orders now reprice to the exact booked amount;
  - own-tariff orders price again (within about 2%, from tariff changes since
    they were booked).
- One service ITD no longer offers ("BOMBINO GOFO") can't be confirmed at
  all. Such orders still weigh by the formula fallback, so they can't get
  stuck.
