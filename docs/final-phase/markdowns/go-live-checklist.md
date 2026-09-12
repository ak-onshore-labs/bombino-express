# Final phase — go-live checklist

Everything built in the final phase, and everything that has to be true before
real customers use it. Tick each box as it's done.

Written **12 Sep 2026** against `aditya/final-phase`. Facts marked *(checked)*
were read from the code or the live Supabase database that day; the rest come
from the phase docs and should be confirmed.

**Companion documents:** `day-zero-checklist.md` (the plan's start),
`open-items.md` (running list, older), `schema-state.md` (schema as of 10 Aug),
`../../whatsapp-bombino-checklist.md` (WhatsApp, in detail),
`../../deploy-vercel.md` (if it ever moves to Vercel),
`../../kyc-retention.md`, `../../bia-3/PROGRESS.md` (BIA 3.0).

**Where it runs:** Railway. The WhatsApp webhook is already registered on
`bombino-express-production-9e11.up.railway.app`, so the production domain and
`PUBLIC_URL` must stay that host, or Tata's registration has to change with it.

---

## 1. Must be switched off before real customers

Each of these makes something unsafe or fake. Every one is honoured in a
production build, so "it's production" does not protect you. *(checked)*

| | Setting | What it does while set | Set to |
|---|---|---|---|
| [ ] | `OTP_DEV_BYPASS` | Accepts any login code (development builds only) | unset |
| [ ] | `OTP_FIXED_CODE` | Every login code is this value: **anyone who knows a phone number can sign in as its owner** | unset |
| [ ] | `PAYMENTS_TEST_MODE` | A customer can mark their own pay-now order **paid with no money moving** | unset, then delete the test-mode code (see §8) |
| [ ] | `IDENTITY_BYPASS` | Skips the GST portal check, the only authority-backed check in signup | unset |
| [ ] | `OCR_BYPASS` | Stores identity documents without reading them; an Aadhaar is then backed by nothing | unset (needs Cashfree production keys first) |
| [ ] | `WA_DRY_RUN` | Logs WhatsApp messages instead of sending them | `0` |
| [ ] | `ITD_DOCKET_AT_BOOKING` | Files a **real, unamendable ITD docket** at booking for ITD-linked accounts, with `shipment_invoice_no` still hard-coded to `TESTINV01` *(checked)* | unset, until the invoice number is fixed |

The server prints a boxed warning at boot for each of the test switches that is
on. **Check the boot log after the production deploy: it should print none.**

## 2. Environment variables (production)

| | Variable | Required | Note |
|---|---|---|---|
| [ ] | `SESSION_SECRET` | yes | Random, 32+ bytes. Unset falls back to a literal in this repo: every session forgeable |
| [ ] | `ENCRYPTION_KEY` | yes | 64 hex characters. Server refuses to boot without it. **Back it up outside Railway: losing it loses every stored identity document** |
| [ ] | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | yes | Production project |
| [ ] | `DATABASE_URL` | yes | Supabase pooler URI. The one in `.env` failed pooler auth on 10 Aug (`schema-state.md` §5); confirm the production one connects |
| [ ] | `REDIS_URL` | recommended | Session store. Without it, sessions live in one process's memory and a restart signs everyone out |
| [ ] | `PUBLIC_URL` | yes | The deployed origin. ITD fetches KYC documents from it; must be internet-reachable |
| [ ] | `ITD_COMPANY_ID`, `ITD_EMAIL`, `ITD_PASSWORD`, `ITD_CUSTOMER_CODE`, `ITD_API_COMPANY_ID` | yes | Production ITD credentials. There is no ITD sandbox: every docket is real |
| [ ] | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | for pay-now | Live keys. Unset: pay-now answers 503, the other three methods still work |
| [ ] | `RAZORPAY_WEBHOOK_SECRET` | for pay-now | Separate from the API secret, set when creating the webhook (§4) |
| [ ] | `CASHFREE_VRS_CLIENT_ID`, `CASHFREE_VRS_CLIENT_SECRET` | yes | **Required for signup**: nobody can register without them |
| [ ] | `CASHFREE_VRS_ENV` | yes | `production` (default is `sandbox`) |
| [ ] | `TATA_WA_TOKEN`, `TATA_WA_WEBHOOK_SECRET` | yes | See §4; rotate the token first |
| [ ] | `WA_CRON_SECRET` | yes | Bearer secret for the three scheduled jobs (§5). Unset: all three refuse to run |
| [ ] | `OPENAI_API_KEY` | yes | BIA, and reading GST certificates uploaded as photos |
| [ ] | `BIA_MODULES` | optional | Unset = `orders` (what customers had before BIA 3.0). See §7 |
| [ ] | `SMS_API_KEY`, `SMS_SENDER_ID` | later | No SMS vendor is wired yet (§8) |
| [ ] | `SIGNUP_RETENTION_DAYS` | optional | Default 14 |
| [ ] | Remove `KYC_VERIFICATION_BYPASS`, `BOMBINO_UPI_VPA`, `BOMBINO_UPI_NAME` if present | — | Nothing reads them any more |

## 3. Database migrations

Probed against the live database on 12 Sep *(checked)*: every migration in
`migrations/` has been applied, except the two below.

| | Migration | State | Action |
|---|---|---|---|
| [ ] | `agent_pickup_indexes.sql` | Not applied (index and FK only; nothing depends on it) | Apply for performance and integrity; it touches `orders.agent_id`, so tell Arbaaz first |
| [ ] | `drop_support_cases.sql` | Not run. `support_cases` exists, empty, unused (support cases were dropped from BIA) | Optional: run to remove the table |
| [x] | Everything else, including `create_bia_turns`, `support_sessions_guest_ref`, `create_bia_nudges` | Applied | — |

If production is a **different** Supabase project from the one used in
development, every migration has to be run there, in dependency order (see
`schema-state.md` §3 for the early ones).

## 4. External services

**Razorpay** (pay online)
- [ ] Live keys in Railway (§2)
- [ ] Webhook `{PUBLIC_URL}/api/payments/razorpay/webhook`, events `payment.captured`, `payment.failed`, `refund.processed`, `refund.failed`; its secret in `RAZORPAY_WEBHOOK_SECRET`
- [ ] One real ₹1 payment end to end, then refund it from the dashboard and see the order flagged

**Cashfree VRS** (GST check and document reading)
- [ ] Production credentials, `CASHFREE_VRS_ENV=production`
- [ ] **Both** products provisioned on the account (GSTIN lookup and Smart OCR). An unprovisioned one answers 200 with "not enabled"
- [ ] `scripts/check-gst.ts` and `scripts/check-cashfree-ocr.ts` pass against production

**WhatsApp (Tata Omni)** — full detail in `whatsapp-bombino-checklist.md`
- [ ] All 17 templates in `whatsapp-templates.md` approved, names matching `WA_TEMPLATE` exactly
- [ ] `bombino_login_otp` built with the Authentication flow (copy-code button), 5-minute expiry
- [ ] Display name verified ("Bombino Express", not a raw number)
- [ ] Token rotated in the Omni panel, new value straight into Railway
- [ ] Webhook URL still `{PUBLIC_URL}/api/whatsapp/webhook/{TATA_WA_WEBHOOK_SECRET}`
- [ ] Opt-in wording at signup approved and added
- [ ] Someone owns the Omni inbox (customers who reply to our messages reach nobody today)

**ITD**
- [ ] Production credentials in Railway
- [ ] Docket attribution answered by Anas (how ITD knows which customer a shipment belongs to; `open-items.md` §2)

**SMS fallback for the login code**
- [ ] Provider chosen, TRAI DLT registration, sender ID, OTP template registered, then wire the one marked gap in `server/sms.ts` *(checked: still unwired)*. Until then a customer whose WhatsApp is on another number cannot sign in

**Redis**
- [ ] A Redis instance for sessions (`REDIS_URL`)

## 5. Scheduled jobs (Railway cron)

All three are `POST` with `Authorization: Bearer {WA_CRON_SECRET}`. Railway cron
runs in UTC; 01:30 UTC is 07:00 IST. Each is safe to run twice.

| | Job | Endpoint | When | What it does |
|---|---|---|---|---|
| [ ] | Rider digest | `/api/internal/wa/agent-schedule` | daily 01:30 UTC | Each rider's jobs for the day, on WhatsApp |
| [ ] | Retention sweep | `/api/admin/retention/sweep` | daily | Deletes documents from signups abandoned for 14 days |
| [ ] | BIA reminders | `/api/admin/bia/nudges/sweep` | daily 01:30 UTC | Bell reminders: a changed amount, a pickup tomorrow, a stalled guest signup, a guest's second booking. **Sends to real customers** |
| [ ] | Delete the old `?kind=reminders` cron if it exists | — | — | Pickup windows are gone; it only re-runs the digest *(checked)* |

A starting point for each cron service: Docker image `curlimages/curl`, start
command `sh -c 'curl -fsS -X POST "https://YOUR-DOMAIN/<endpoint>" -H "Authorization: Bearer $WA_CRON_SECRET"'`.
Run each once by hand first and read the reply.

## 6. People, accounts and data

- [ ] Ops/admin accounts created for each staff member with the right role (`scripts/create-test-admin.mjs` is for tests; production accounts need a proper path)
- [ ] Riders: 15 named riders and 17 beat assignments exist (8 Sep). **Outstanding: the ten Andheri riders' phone numbers**, a Kolkata rider and cut-off, and whether Bhayandar / Mira Road / Vasai are covered (`open-items.md` §2)
- [ ] Decide what happens to test data: the seeded `BOM-1000xx/1001xx` orders and test identities (`9000000090`, `9000000091`, `9000000001`, see `docs/test-accounts.md`) if production shares this database
- [ ] Restricted-items lists from Bombino, as files in `content/bia/restricted/` (format in its README). Until then BIA answers every "can I send this?" with "our team will confirm"

## 7. BIA (the in-app assistant)

What it does, from the customer's side: explains any screen, step, error or
term; tells them where their order is and what happens next; checks pickup,
finds counters, quotes rates, tracks an AWB, suggests HSN codes; gives buttons
that open the right screen; and writes a daily reminder to the bell when
something of theirs has stalled. **It never does anything for them:** no
booking, cancelling, paying, uploading or changing details. It guides.

- [ ] Choose `BIA_MODULES` for launch. `orders` (default) covers orders, tracking, rates, pickup, how-to and the app guide. Add `onboarding,documents,booking` to switch on help with choosing an account, signup and documents, and the booking form
- [ ] The deploy ships the `content/` folder (the app guide and restricted lists are read from it)
- [ ] `content/bia/app-guide.md` reviewed by someone who knows the app; **every future customer-facing feature adds or updates its section**
- [ ] Ask BIA a handful of questions on the deployed app (the "BIA Test Drive" guide has them)
- [ ] After launch, read `bia_turns` weekly: thumbs-down answers and fallbacks

## 8. Known gaps — decide, fix, or accept

| | Gap | Where | Note |
|---|---|---|---|
| [ ] | Pay-now test switch still in the code | `server/paymentsTestMode.ts`, `POST /api/payments/test/settle`, `client/src/lib/paymentsTestMode.ts`, `PaymentTestModeSwitch.tsx` | Delete once Razorpay works |
| [ ] | `shipment_invoice_no` hard-coded `TESTINV01` | `client/src/pages/CreateShipment.tsx` *(checked)* | Goes to Indian customs on a docket |
| [ ] | `POST /api/shipments` reads the **signed-in staff member's** KYC, not the customer's | `server/routes.ts` *(checked: still `getKycByUserId(req.session.dbUserId)`)* | Harmless while nothing calls it; fix before anything does. `kycForOrder()` is the right shape |
| [ ] | Order status and its event log are two writes, not one transaction | `open-items.md` §4.3 | A failed log leaves the change done with a warning |
| [ ] | Service-role key bypasses row-level security | `server/supabaseClient.ts` | Every ownership check lives in the query; keep it that way |
| [ ] | Customers can't delete their account in the app | — | Privacy requests go through support |
| [ ] | SMS fallback not wired | §4 | Dual-SIM customers can't sign in |

## 9. Launch-day smoke test (on production, with real money and real phones)

- [ ] Sign in with a real number: the code arrives on WhatsApp
- [ ] Open a personal account: identity numbers, documents read by Cashfree, contract signed
- [ ] Book as a guest with a pickup; the booking WhatsApp arrives; the order shows on the guest profile
- [ ] Book with an account, pay online (₹ small amount); the order reads paid
- [ ] A rider claims it, starts, collects with the pickup code, marks it at the hub
- [ ] Ops weighs and settles it; if the amount changed, the customer is told
- [ ] Ops generates the docket: a real AWB; tracking and labels appear for the customer
- [ ] Request a cancellation on another order; ops approves or rejects; the customer sees it
- [ ] Ask BIA: "where is my order", "how do I change my number", "can you cancel it for me" (it should say it can't and show the button)
- [ ] Each cron endpoint called once by hand; replies look right
- [ ] Boot log shows no bypass warnings

## 10. After launch — what to watch

- WhatsApp: `select template, status, count(*) from whatsapp_messages group by 1, 2` (see `whatsapp-bombino-checklist.md` §6)
- BIA: `bia_turns` ratings and `fallback = true` rows; `bia_nudges` per day
- Logs: `[retention]` and `[nudges]` print a line every run, quiet ones included; a missing line means the cron stopped
- Razorpay dashboard vs `payments` rows, weekly
