# Deploy runbook: `ai-feature` → final phase on Railway

How production moves from `ai-feature` (live since 31 Jul, ITD email/password
login) to the final-phase code, and how to back out. Written 18 Sep 2026.

Companion: [`go-live-checklist.md`](./go-live-checklist.md) (every setting and
service), [`test-report.md`](./test-report.md) (what was tested).

## What makes this cutover low-risk, and what doesn't

- **Same database.** Railway production and development share one Supabase
  project, and every final-phase migration except `agent_pickup_indexes.sql`
  and `drop_support_cases.sql` is already applied. `ai-feature` runs on that
  schema today, so the switch is a code change and rolling back is safe.
- **No Redis.** Sessions live in Postgres (`session` table), and the BIA rate
  limit and postal cache are in-process. `REDIS_URL` is ignored.
- **Everyone is signed out once.** The old sessions are in Redis, the new ones
  in Postgres.
- **Login changes for existing customers.** They sign in with their phone and
  a login code (SMS via MSG91, or WhatsApp), then enter their ITD email and
  password **once** to link.
  So **codes must reach real phones** before the switch (gate 1).

## Gates: all must be true before switching

- [ ] **1. Login codes arrive.** `OTP_FIXED_CODE` (`121212`) is the stopgap
  until **MSG91** is wired for SMS login codes (`server/sms.ts`), alongside the
  WhatsApp `bombino_login_otp` template. Once a real code reaches a real phone,
  production must run **without `OTP_FIXED_CODE`**: with it set, anyone who
  knows a customer's number can sign in as them.
- [ ] **2. Code is green.** On the release commit:
  - `npm run check`, `npm test`, `npm run build` all pass (Railway's build runs
    the first two as well, see `nixpacks.toml`);
  - `npm run test:e2e` shows no new failures against `test-report.md` §6.
- [ ] **3. Same `ENCRYPTION_KEY`.** Railway's value must equal the one that
  encrypted the identity documents and ITD passwords already in the shared
  database, or none of them can be read again. Compare without printing either:
  `node -e "console.log(require('crypto').createHash('sha256').update(process.env.ENCRYPTION_KEY).digest('hex').slice(0,12))"`
  run once locally and once in a Railway shell; the two prints must match.

## Branches

- [ ] Tag the rollback point: `git tag prod-ai-feature-2026-09 origin/ai-feature && git push origin prod-ai-feature-2026-09`
- [ ] Create `production` from the release commit on `aditya/final-phase` and
  push it. Railway will track `production`, and every future release is a
  merge into it.
  **Do not use `main`**: its history is unrelated to this code (no merge base).

## 1. Staging (a day before)

Create a second service in the same Railway project, from `production`, with
the production variables below **except**:

- `WA_DRY_RUN=1`
- no cron services
- `PUBLIC_URL` set to the staging domain

It shares the production database, so everything created there is real data:
use test numbers and delete what you create.

Run with real phones:
- [ ] Sign in with a real login code (MSG91 SMS or WhatsApp), with `OTP_FIXED_CODE` unset
- [ ] An existing ITD customer: sign in by phone, link email and password, see
  their old shipments in history
- [ ] A guest booking with a pickup; an account booking
- [ ] Rider: claim → start → pickup code → hub code. Ops: weigh → settle → docket
- [ ] Book a paid order and weigh it heavier: settle is blocked until ops
  collects the difference
- [ ] A cancellation, requested and approved
- [ ] Ask BIA two questions
- [ ] `GET /api/health` → `{"ok":true,"db":true}`

## 2. Production variables (set before switching the branch)

| Set | Value |
|---|---|
| Required, new | `SESSION_SECRET` (random 32+ bytes; **the server will not start without it**), `WA_CRON_SECRET`, `TATA_WA_TOKEN` (rotated), `TATA_WA_WEBHOOK_SECRET`, `CASHFREE_VRS_CLIENT_ID`, `CASHFREE_VRS_CLIENT_SECRET`, `CASHFREE_VRS_ENV`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `APPLICATION_ALERT_EMAILS` |
| Check | `PUBLIC_URL` = the Railway production domain (the WhatsApp webhook is registered on it); `DATABASE_URL` connects (the server will not start without a working session store) |
| Launch flags | `ACCOUNT_REVIEW=1`; `OCR_BYPASS=1` until Cashfree **Smart OCR** is live for us, and `IDENTITY_BYPASS=gstin` until the Cashfree GSTIN lookup is on production credentials; `WA_DRY_RUN=0`; `BIA_MODULES` as chosen |
| Must be unset | `OTP_FIXED_CODE`, `OTP_DEV_BYPASS`, `PAYMENTS_TEST_MODE`, `ITD_DOCKET_AT_BOOKING`, `KYC_VERIFICATION_BYPASS`, `BOMBINO_UPI_VPA`, `BOMBINO_UPI_NAME` |
| Leave for now | `REDIS_URL`: ignored by the new code, still used by `ai-feature` if you roll back |
| Razorpay | Live keys and `RAZORPAY_WEBHOOK_SECRET` if pay-now launches; otherwise unset (pay-now answers 503, the other three methods work) |

In **Settings → Deploy**, set the healthcheck path to `/api/health`.

## 3. Switch (low-traffic window, IST night)

- [ ] Railway production service → **Settings → Source** → branch `production` → Deploy
- [ ] Build log: `npm run check` and `npm test` pass, then the build
- [ ] Boot log:
  - `[session] using PostgresStore`
  - `serving on port …`
  - boxed warnings **only** for `OCR_BYPASS` and `IDENTITY_BYPASS`
  - no `[boot] failed` line
- [ ] Healthcheck passes, and the deploy goes live
- [ ] Smoke test on production:
  - sign in by phone;
  - link an ITD account;
  - book;
  - see history;
  - `/api/health` answers.

## 4. First 48 hours

- [ ] Cron services (go-live-checklist §5): run each once by hand, read the
  reply, then schedule them
- [ ] Razorpay webhook registered, if pay-now is live
- [ ] Watch:
  - Railway logs for 5xx and `[boot]`, `[session]` and `[payments]` errors;
  - `select template, status, count(*) from whatsapp_messages group by 1, 2`;
  - `bia_turns` thumbs-down.

## Rollback

Any time in the first week: Railway → **Deployments** → redeploy the last
`ai-feature` build, or point the source branch at the
`prod-ai-feature-2026-09` tag.

- The schema is shared and additive, so `ai-feature` runs as it did.
- Users are signed out again.
- Anything booked in between stays in the database. `ai-feature` doesn't read
  orders, so those bookings need handling by hand.
- Keep the Redis service until this window closes: `ai-feature` needs it for
  sessions.

## 5. Cleanup (after about a week, stable)

- [ ] Delete the Railway Redis service and the `REDIS_URL` variable
- [ ] Apply `migrations/agent_pickup_indexes.sql` (tell Arbaaz first).
  `drop_support_cases.sql` is optional
- [ ] Test data in the production database:
  - delete the seeded `BOM-1000xx` orders;
  - set `is_active=false` on the `90000000xx` staff test accounts (`docs/test-accounts.md`)
- [ ] **Stop running `npm run test:e2e` against this database.** It books
  orders, and riders' job lists and the ops board read the same tables. Give
  development its own Supabase project first
- [ ] Tell existing customers how they sign in now: phone + SMS code,
  then their email and password once
