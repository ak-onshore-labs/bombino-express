# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Bombino Express: India→USA door-to-door courier. One codebase serves **three separate products**, chosen by URL prefix and user role:

- **Customer app** (`/`, `/home`, `/create`, `/orders`, …): book, pay, and track. Signed-in accounts and phone-verified guests.
- **Agent app** (`/agent/*`, `client/src/routes.agent.tsx`): pickup riders on low-end Android in sunlight. It renders outside `AppLayout`, shows no toasts, and uses no GSAP/Framer Motion.
- **Ops console** (`/ops/*`, `client/src/routes.ops.tsx`): hub/office staff running orders through their lifecycle.

Read `PRODUCT.md` (audiences, agent-surface principles) and `DESIGN.md` (navy "Admiralty Dark" + "Dispatch Amber" palette, Poppins) before UI work. The surfaces deliberately do not share a visual personality.

## Commands

```bash
npm run dev          # Express + Vite middleware on :5000 (tsx watch)
npm run check        # tsc (strict, noEmit) over client, server, shared, tests
npm test             # unit tests: node:test via tsx, *.test.ts in server/ shared/ client/src/
npx tsx --test server/sms.test.ts            # run a single test file
npx tsx --test --test-name-pattern="<regex>" server/sms.test.ts   # filter tests by name
npm run test:e2e     # tests/e2e/*.e2e.ts — boots a real server on :5001 against the SHARED Supabase DB
npm run lint         # eslint (all rules are warnings; exits 0)
npm run format       # prettier
npm run build        # script/build.ts: vite → dist/public, esbuild server → dist/index.cjs
npx tsx scripts/apply-migration.ts migrations/<file>.sql   # apply one SQL migration in a transaction
```

The deploy build (`nixpacks.toml`, Railway) runs `check`, then `test`, then `build`, so a type error or failing unit test blocks the deploy. The e2e suite is not run there because it writes to the shared database.

## Architecture

### Server (`server/`)
- `app.ts` builds the Express app (sessions in Postgres via `connect-pg-simple`, boot-time env assertions and warnings). It has two hosts: `index.ts` (long-lived process, used for dev/Railway) and `api/index.ts` (Vercel serverless function, see `vercel.json`). Anything both hosts need goes in `app.ts`, not `index.ts`.
- `routes.ts` (~4.7k lines) plus `routes/*.ts` (agent, ops, payments, support/BIA, whatsapp, …) register every `/api` endpoint.
- **Data access is Supabase JS with the service-role key**, not Drizzle. The `*Db.ts` modules (`ordersDb`, `opsDb`, `agentDb`, `kycDb`, …) call `dbClient()` from `server/db/client.ts`, which returns null rather than throwing when the database is unconfigured. `shared/schema.ts` (Drizzle) covers only a few tables. Treat `migrations/*.sql` as the schema source of truth.
- Server-side relative imports use `.js` extensions (ESM).
- **Order state machine**: `server/orderLifecycle.ts` holds one row per legal `status × action × role`. `availableActions()` drives which buttons the UI shows, and the action endpoint checks the same guards. To add a transition, add a row there; never put lifecycle logic in a route or component. The guards are advisory only: anything that can be raced (e.g. an agent claiming a pickup) must also put its precondition in the SQL `WHERE` of the update.
- Status vocabulary is frozen (see `shared/orderContract.ts` and `docs/final-phase/markdowns/final-phase-modules.md`):
  `pickup_requested → agent_accepted → out_for_pickup → picked_up → received_at_hub`, or `awaiting_dropoff → received_at_hub`; then `weighed → settled → ready_for_docket → dispatched` (plus `cancelled`).
- **Why the docket is deferred**: an ITD docket/AWB cannot be amended once filed, and there is **no ITD sandbox** (`server/itd.ts` always hits production). So a booking creates an internal `BOM-xxxxxx` order (route `/order/:orderNo`), and a real AWB (`/shipment/:awb`) is issued only after hub weighing and settlement. `ITD_DOCKET_AT_BOOKING` changes this for ITD-linked accounts.
- Access control lives in `server/routeGuards.ts` (`requireUser`, `requireRole`, `opsGate`). The client's `lib/surface.ts` and `SurfaceGuard` only route people to their own surface and are not security.
- Integrations: ITD (dockets/rates/tracking), Razorpay (pay-now + webhook), Tata Omni WhatsApp (pre-approved templates only, see `docs/whatsapp-templates.md`), MSG91 (login OTP), Cashfree VRS (GSTIN lookup, document OCR), OpenAI (BIA support assistant, GST-certificate vision fallback), SMTP mail. Unset credentials are mostly a supported state that degrades gracefully. `.env.example` documents each variable.
- Identity document fields are AES-256-GCM encrypted (`server/fieldCrypto.ts`, `ENCRYPTION_KEY`). The server refuses to boot without that key.

### Shared (`shared/`)
Pure logic used by both sides and unit-tested: the order contract and roles, error catalog, Aadhaar/GSTIN validation, BIA modules/cards/chips, IST time helpers, corridor and booking terms.

### Client (`client/src/`)
- Wouter routing: `App.tsx` (customer), `routes.agent.tsx`, `routes.ops.tsx`. Login lands each role on its surface via `landingPathForRole`.
- Server state uses TanStack Query (`lib/queryClient.ts`). `apiRequest`/`readJson` throw `Error("<status>: <body>")`, and callers rely on that shape (`lib/apiError.ts`). Feature hooks live in `hooks/` (`useOps*`, `useAgentPickups`, …).
- Zustand (`lib/store.ts`) persists only `hasSeenOnboarding`, `isLoggedIn`, and `user` to localStorage (`bombino-storage`).
- BIA (the in-app support assistant) is `components/bia/` plus `lib/askBia.ts` on the client, `server/support*.ts` and `routes/bia.ts` on the server, and content in `content/bia/`. Which modules are on is controlled by `BIA_MODULES` (see `shared/biaModules.ts` and `docs/bia-3/PROGRESS.md`). `npm run bia:eval` runs its eval.
- Path aliases: `@/` → `client/src/`, `@shared/` → `shared/`, `@assets/` → `attached_assets/`. shadcn/ui primitives in `components/ui/` are vendored, and lint ignores them.

## Database & environment rules

- There is **one shared Supabase project** for dev, staging, production-like runs, and e2e. Migrations must be additive only (no renames, drops, or type changes). Commit every statement as a file in `migrations/`, and respect the per-table DDL ownership in `final-phase-modules.md` §4. Do not use `npm run db:push` for schema changes.
- Several env flags are honoured **in production builds** and print a boxed warning at boot: `OTP_FIXED_CODE`, `PAYMENTS_TEST_MODE`, `OCR_BYPASS`, `IDENTITY_BYPASS`, `ITD_DOCKET_AT_BOOKING`. `WA_DRY_RUN` defaults on in development.
- Test phone numbers and roles are listed in `docs/test-accounts.md`. The e2e harness (`tests/e2e/harness.ts`) forces WhatsApp dry-run, no docket at booking, and the payments test mode.

## Docs worth knowing
- `docs/final-phase/markdowns/`: module plan, roles-and-flows, schema state, deploy runbook, go-live checklist, and ops-console task list.
- `docs/api-spec.md` holds **ITD's vendor API notes**, not this app's API.
- `docs/account-review.md` (`ACCOUNT_REVIEW` flow), `docs/kyc-retention.md`, `docs/deploy-vercel.md`, and `docs/whatsapp-*.md`.
