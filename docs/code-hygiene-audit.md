# Code hygiene & modularity audit

_17 September 2026 · branch `aditya/final-phase` · `npm run check` clean, `npm test` 202/202 green._

The app grew fast through Phase 1 and the final phase (account review, BIA, the ops console).
Nothing here says it is broken. This is the step back nobody had taken yet: does the codebase still
obey its own conventions?

Short answer — the newer code does, and the older code quietly forked away from it. Most of what
follows is a screen re-implementing a helper that already exists three directories away, which
makes the fixes mechanical rather than architectural. Two findings are not style questions at all:
a secrets file sitting one `git add -A` from a commit, and route handlers that can take the
container down.

Every number below was measured on the date above; the commands are in
[Reproducing the numbers](#reproducing-the-numbers).

> **Waves 1–3 are done, same day** — the five P0 findings, the dead-weight and
> tooling items, the mechanical de-duplication, the safety net (tests for the
> pure modules, type-checked tests, ESLint + Prettier), and the structural
> extractions, and the 779-line actions handler. See the **Status** lines on
> each finding. What is left of wave 4: `CreateShipment`, the colour codemod,
> and the repo-wide Prettier pass. Rotating the
> credentials exposed in `docs/api-spec.md` and `.env.bak.*` is the one part
> nobody can do in code: git history still holds the old values.
>
> One correction to this report: `pdfjs-dist` is **not** unused. It is imported
> by deep subpath (`pdfjs-dist/legacy/build/pdf.mjs`) from
> `client/src/components/PdfCanvasViewer.tsx` and `server/gstCertificate.ts`,
> which the dependency sweep below missed. Removing it broke the build and it
> was put back; the sweep command is corrected.

---

## 1. Scorecard

| Area | State | Evidence |
|---|---|---|
| Type discipline | **Good** | 5 `any` in server, ~8 in client, across ~70k lines; 3 `@ts-ignore` |
| Input validation | **Good** | 51 `safeParse`, zero throwing `.parse()` |
| Shared contracts | **Good** | `shared/accountSpec.ts` — 10 client + 16 server importers |
| Route modularity | **Half done** | 9 `registerXRoutes` modules (54 handlers) + a 5,763-line monolith (53) |
| DB layering | **Good** | `supabase` imported only by `*Db.ts` modules — one exception |
| Async error safety | **Poor** | 36 `try` blocks for 107 handlers; 0 `unhandledRejection` listeners |
| Duplication | **Poor** | 22 copies of one Supabase helper pair; `Rates.tsx` forks `CreateShipment.tsx` |
| File size | **Poor** | 33 files over 500 lines; worst are 5,763 and 4,350 |
| Dead weight | **Poor** | 35 of 57 UI primitives unused; 6 dependencies with zero imports |
| Automated gate | **Missing** | no ESLint, no Prettier, no hooks, no CI; `tsc` run by hand |
| Test coverage | **Uneven** | 33 test files, almost all BIA/support; 0 component tests |
| Docs | **Stale** | `CLAUDE.md` describes an app with no routes and a mock data layer |

---

## 2. Findings

Effort: **S** = under a day · **M** = a few days · **L** = weeks, but incremental.

### P0 — correctness, security, secrets

#### P0-1 · Async handlers can crash the container · S

Express 4.21 does **not** forward a rejected promise from an `async` handler to error middleware.
The repo has no `express-async-errors` and no `asyncHandler` wrapper (zero matches), and neither
`server/index.ts` nor `api/index.ts` installs an `unhandledRejection` listener.

| Handler | Lines | `try` blocks |
|---|---|---|
| `POST /api/orders` — `server/routes.ts:4007` | 333 | **0** |
| `POST /api/orders/:id/actions` — `server/routes.ts:4389` | 708 | **0** |
| `GET /api/orders/:orderNo` — `server/routes.ts:5304` | 152 | **0** |
| `GET /api/shipments/download-csv` — `server/routes.ts:3451` | 76 | **0** |
| all of `server/routes/payments.ts` (5 routes, Razorpay + money) | 829 | **0** |
| all of `server/routes/agent.ts` (4 routes) | — | **0** |
| all of `server/routes/guestProfile.ts` (2 routes) | — | **0** |

These call ITD, Razorpay, nodemailer and `decryptPassword` — all of which throw. On Vercel one
rejection takes every in-flight request in that container with it.

**Fix shape:** a twelve-line `asyncRoute(fn)` in `server/routeGuards.ts` doing
`Promise.resolve(fn(req, res, next)).catch(next)`, plus a process-level `unhandledRejection` logger
in both entrypoints. Then wrap handlers file by file — `routes/agent.ts` and `routes/bia.ts` first
as canaries. No handler body changes.

**Status — fixed.** `asyncRoute` and `asyncRoutes(app)` now live in `server/routeGuards.ts`, and
`server/processGuards.ts` installs the process-level listeners from `createApp()`, so both
entrypoints get them. The four zero-`try` modules — `agent.ts`, `bia.ts`, `payments.ts`,
`guestProfile.ts`, 14 routes — mount through `asyncRoutes`, so a route added later cannot forget
the wrapper. `server/routeGuards.test.ts` covers it. `routes.ts` and the remaining modules are
still unwrapped; that is wave 2.

#### P0-2 · Secrets in the working tree · S

- `.env.bak.1789567575` is untracked **and unignored** — `.gitignore` matches `.env` exactly, not
  `.env*`. It contains `ITD_PASSWORD`, `OPENAI_API_KEY` and `DATABASE_URL`.
- `docs/api-spec.md` **is tracked** and holds vendor UAT credentials and a bearer token. It is not
  an API spec — it is pasted ITD vendor notes, last touched April 2026. Its siblings with the same
  kind of content (`CUSTOMER CREATION API DETAILS.txt`, `third-party-integrations/`) are correctly
  ignored, so this is an inconsistency rather than a policy.

**Fix:** widen the ignore to `.env*`, move or redact the doc, rotate anything that was exposed.
Treat the rotation as the real work; the ignore line is the easy half.

**Status — fixed.** `.gitignore` now matches `.env*` (with `!.env.example`) and `client/.env*`, so the
backup is ignored. `docs/api-spec.md` keeps the request and response shapes but every credential
is a placeholder, under a header saying where the real ones live and that this file is vendor
notes rather than our API surface. **Still open: rotation.** `ITD_PASSWORD`, the ITD auth token
and the `ci_sessions` cookie are in git history and must be changed at the vendor.

#### P0-3 · One document route serves identity files unhardened · S

`GET /api/kyc/me/file` (`server/routes.ts:5489`) sets only `Content-Type`, `Content-Length`,
`Cache-Control` and `Content-Disposition`. Its sibling `sendOpsDocumentFile`
(`server/routes/ops.ts:168`) also sets `X-Content-Type-Options: nosniff`, `X-Robots-Tag` and
`Referrer-Policy`, and sanitises the filename through `sanitizeContentFilename`
(`server/routes/ops.ts:149`) — which strips control characters. The `/api/kyc/me/file` copy strips
only `"`, so a crafted `original_filename` can still split the header.

There are four copies of this send-a-file block — `server/routes.ts:2047`, `:5489`, `:5719`, and
`server/routes/ops.ts:168` — and they have drifted apart.

**Fix:** move `sanitizeContentFilename` + `sendOpsDocumentFile` + `wantsDownload` into a new
`server/documentResponse.ts` and point all four at it. This also removes the cross-module import at
`server/routes/accountApplications.ts:51`, where a route file imports HTTP helpers from another
route file.

**Status — fixed.** `server/documentResponse.ts` holds `sendDocumentFile`, `sanitizeContentFilename` and
`wantsDownload`; all six call sites (three in `routes.ts`, two in `routes/ops.ts`, one in
`routes/accountApplications.ts`) go through it, so every document — including
`GET /api/kyc/me/file` — is served with the full header set and a sanitised filename. The
cross-module import is gone. `server/documentResponse.test.ts` covers the headers and the
header-splitting case.

#### P0-4 · Five disagreeing answers to "who is the caller" · M

| Resolver | Location |
|---|---|
| `resolveKycOwner` | `server/routes.ts:1726` |
| `sessionGuestRef` | `server/routes.ts:3593` |
| `guestFrom` | `server/routes/guestProfile.ts:50` |
| `nudgeOwnerFor` | `server/routes/bia.ts:31` |
| `paymentCallerFrom` | `server/routes/payments.ts:86` |
| `sessionOwnerFor` | `server/routes/support.ts:74` |

They disagree on whether `signupRef` counts as a verified guest (bia and guestProfile say yes;
payments and support say no) and on whether `session.user` must be present alongside `dbUserId`
(bia and support require it; payments does not). This is an authorisation surface, not a style
question: a fix applied to one will not reach the others.

**Fix:** `server/sessionOwner.ts` exporting one `Owner` union and
`ownerFrom(req, { allowSignupRef, requireUserObject })`. Migrate call sites one at a time keeping
each module's current flags — so behaviour is provably unchanged — then reconcile the flags in a
separate, reviewable commit.

**Status — fixed, behaviour deliberately unchanged.** `server/sessionOwner.ts` holds one
`ownerFrom(req, options)` plus the five profiles that were implicit before — `payment`,
`supportSession`, `nudges`, `guestProfile`, `guestNotifications` — differing only in named options
(`onAccount`, `requireUserObject`, `requireGuestPhone`, `allowSignupRef`). Each of the five
resolvers is now a two-line adapter over it, so the call sites did not move.

The disagreements are still there **on purpose**: this commit makes them visible and reviewable,
it does not decide them. `server/sessionOwner.test.ts` runs each profile against 11 session
shapes — including a half-cleared login, a guest ref with no phone, and a browser holding both a
guest ref and a signup ref — and asserts the answer matches the old implementation exactly, which
is also what pins the differences for whoever reconciles them next.

`resolveKycOwner` (`server/routes.ts`) is deliberately **not** folded in: it verifies an OTP,
refuses numbers that already have an account, and mints a signup ref as a side effect. It is a
write path, not a session read.

#### P0-5 · CSV export dates are in the server's timezone · S

`server/routes.ts:3496–3500` and `:3513` call `toLocaleDateString("en-IN")` with no `timeZone`.
The server runs UTC; every other date path goes through `shared/istTime.ts`, whose header
(`shared/istTime.ts:6`) warns against exactly this. Bookings made after 18:30 IST export on the
wrong day.

**Status — fixed.** one `istDate()` helper formats in `Asia/Kolkata`, and the export filename now comes
from `todayInIst()` rather than a UTC `toISOString()`.

### P1 — duplication with one obvious home

#### P1-1 · 22 copies of the same two Supabase helpers · S

`logSupabaseError` and `getSupabaseClient` are defined in **11** modules — `agentDb.ts:63,74`,
`appDb.ts:68,76`, `beatsDb.ts:54,65`, `handoverCodes.ts:72,80`, `opsDb.ts:33,37`,
`ordersDb.ts:6,14`, `otpDb.ts:5,13`, `paymentsDb.ts:27,38`, `pickupCoverageDb.ts:45,56`,
`whatsappAgents.ts:28,39`, `whatsappDb.ts:29,40`. The bodies differ only in the `"[xxxDb]"` prefix.
Adding structured logging or Sentry today means eleven edits.

**Fix:** `server/db/client.ts` exporting `dbClient(moduleName)` and `logDbError(moduleName, op, err)`.

#### P1-2 · `Rates.tsx` is a fork of the rating half of `CreateShipment.tsx` · M

Roughly 450 duplicated lines, including the money maths:

| Symbol | `pages/Rates.tsx` | `pages/CreateShipment.tsx` |
|---|---|---|
| `RateParams`, `ITDChargeApplyEntry`, `ITDRateRow`, `ITDRateResponse` | `:20`–`:54` | `:210`–`:245` |
| `formatInr`, brand colour constants, `ratesResultsShellStyle` | `:67`–`:74` | `:261`–`:254` |
| `normalizeRateRow`, `dedupeAndSort`, `itemizedChargesEmpty` | `:81`, `:119`, `:130` | `:265`, `:303`, `:314` |
| `CountryCombobox` | `:145` | `:334` |
| charge-breakdown JSX | `:436–514` | `:4019–4110` |

Quote and booking can drift apart in the one place a customer would notice. `Rates.tsx:135` also
re-implements `formatCountryDisplay`, which exists at `lib/itdCountryData.ts:254`; and
`lib/countryData.ts` (243 lines) now has exactly one consumer left, `Rates.tsx:15`.

**Fix:** `lib/itdRates.ts` + `components/RateCard.tsx` + `components/CountryCombobox.tsx`; delete
`lib/countryData.ts`. Highest-value single extraction in the repo.

#### P1-3 · Helpers re-implemented beside a "do not copy" comment · S each

- **Money and IST.** `lib/orderDetail.ts:231` says in as many words: *"Ops board, dashboard, and
  ledger share this — do not copy."* Copies exist at `pages/ops/OpsOrderDetail.tsx:46,51` (an ops
  page — the exact case named), `pages/CreateShipment.tsx:261`, `pages/Rates.tsx:67`,
  `lib/shipmentRows.ts:73`, `components/bia/BiaCards.tsx:12`, `components/agent/PickupCard.tsx:115`,
  `components/ShipmentCard.tsx:56`.
- **`en-IN` date.** Five hand-rolled copies — `OpsCustomers.tsx:20`, `OpsCustomerDetail.tsx:56`,
  `KycOnFileCard.tsx:46`, `lib/shadowProfile.ts:514`, `components/agent/AgentShell.tsx:63`.
  `pages/OrderDetails.tsx:81–91` uses date-fns instead, so there are two date stacks for one job.
- **`readJson<T>`** defined identically three times — `hooks/useOpsApplications.ts:81`,
  `hooks/useOpsCustomers.ts:72`, `hooks/useOpsOrders.ts:152` — and re-inlined in `OpsBeats.tsx` and
  `OpsUsers.tsx`. `lib/queryClient.ts` already produces the same `${status}: ${text}` format.
- **Sign-out.** The fetch-then-clear-then-redirect sequence appears in 8 files besides its owner
  `lib/session.ts` — `OpsShell.tsx`, `OpsDesktopSidebar.tsx`, `OpsSectionBoard.tsx`,
  `OpsOrderDetail.tsx`, `AgentShell.tsx`, `AccountSignOutDialog.tsx`, `GuestSignOutDialog.tsx`,
  `ApplicationStatusCard.tsx`. Session teardown is security-relevant; it should have one caller path.
- **Server-side:** the `WA_CRON_SECRET` bearer check verbatim ×3 (`routes.ts:1368`,
  `routes/bia.ts:22`, `routes/whatsappSchedule.ts:45`); `requireRole("admin","super_admin")` typed
  out 19× in `routes/ops.ts` while `opsGate` already exists at `routes/accountApplications.ts:77`;
  `agentDb.ts:377` hand-rolls IST midnight that `shared/istTime.ts:48` owns, under a comment saying
  it must match the ops window — which uses the shared helper.
- **Across the tiers, with no `shared/` module:** the 10-digit phone regex (2 server + 5 client
  sites), the upload MIME allowlist and 4 MB limit (`routes.ts:245,248` mirrored by hand in
  `KycUpload.tsx:101` and `AccountDocuments.tsx:32`), CSV escaping (`routes.ts:3481` vs
  `lib/csv.ts:19`). `PaymentMethod` and `IdentityKind` are each declared twice server-side.

#### P1-4 · Dead weight · S

- **35 of 57** `client/src/components/ui/*` primitives are imported by nothing — accordion,
  carousel, chart, drawer, form, table, tabs, sidebar and 27 others — dragging Radix, recharts,
  cmdk, embla, vaul, sonner and next-themes along with them.
- **Six runtime dependencies with zero imports:** `passport`, `passport-local`,
  `connect-pg-simple`, `memorystore`, `ws`, `pdfjs-dist`.
- **Drizzle is vestigial.** `drizzle-orm`/`drizzle-zod` are used only by `shared/schema.ts`
  (47 lines), which nothing imports. The real data layer is `supabase-js` in `*Db.ts` modules plus
  43 hand-written SQL migrations — so `npm run db:push` would push a `users` table nothing reads.
**Status — fixed.** 35 unreferenced primitives deleted (22 remain), `ShipmentCard.tsx` with them,
and 32 dependencies dropped once nothing imported them: the unused six minus `pdfjs-dist` (see the
correction above), plus the 19 Radix packages, `recharts`, `sonner`, `vaul`, `next-themes`,
`embla-carousel-react`, `react-resizable-panels`, `react-hook-form`, `@hookform/resolvers`,
`tailwindcss-animate`, `@jridgewell/trace-mapping` and `zod-validation-error` that only those
primitives used. `mockData.ts` is gone: the unit conversions moved to `client/src/lib/units.ts`,
`TrackingEvent` to `client/src/lib/trackingTypes.ts`, the fixtures deleted. `lib/store.ts` no
longer seeds itself — `shipments`, `notifications`, `addShipment`, `addNotification` and
`markNotificationRead` are removed — and `pages/Receive.tsx` reads the real merged list through
`useOrderHistory`. **Drizzle stays for now**: it is vestigial, but whether `shared/schema.ts` and
`db:push` are meant to come back is a team decision, not a code fact.

The client bundle barely moved (1,943 kB → 1,939 kB): Vite was already tree-shaking the unused
primitives. The win is a smaller install and a smaller tree to read, plus no mock data left in a
production path.

- **Mock data still ships to production.** `lib/store.ts:42–43` seeds Zustand from
  `lib/mockData.ts`; `addShipment`, `addNotification` and `markNotificationRead` have **zero** call
  sites; `state.notifications` has zero readers; `state.shipments` has one — `pages/Receive.tsx:18`,
  which renders the mock shipments. Production types also live there: `ShipmentCard.tsx`,
  `TrackingTimeline.tsx` and `ShipmentDetails.tsx` import `Shipment`/`TrackingEvent` from the mock file.

#### P1-5 · Ops console state rendering disagrees with itself · M

Every ops list page repeats the same four-branch loading/error/empty/list block — roughly 14 copies
across `OpsApplications.tsx:109`, `OpsCustomers.tsx:354`, `OpsCustomerDetail.tsx:190,413`,
`OpsTransactions.tsx:139`, `OpsDashboard.tsx:122,177,206,258`, `OpsBeats.tsx:400` — and they do not
agree: `OpsDashboard` and `OpsBeats` have no loading or error testids at all, `OpsCustomerDetail`
renders its error in `text-muted-foreground` where the others use `text-red-600`, and padding is
`py-16` on some pages and `py-10` on others.

Worse, a 403 is only handled on two screens: `OpsSectionBoard.tsx:236` and `OpsOrderDetail.tsx:217`
show an "Access required" panel (and only the first carries the `ops-forbidden` testid). The other
nine ops pages render a forbidden response as *"Could not load … Try refreshing."* — so an admin
without permission is told to refresh forever.

Role strings are also compared raw — `role === 'super_admin'` at `OpsCustomers.tsx:234` and
`OpsCustomerDetail.tsx:141`, `role === 'admin' || role === 'super_admin'` at
`OpsApplicationDetail.tsx:701` and `lib/surface.ts:41` — while `shared/orderContract.ts:71` exports
`roleSatisfies()`, which the client never uses.

**Fix:** one `<OpsQueryState>` component and one shared 403/404 derivation; switch role checks to
`roleSatisfies`.

### P2 — files nobody can hold in their head

#### P2-1 · `server/routes.ts`, 5,763 lines · L, but ~5 independent commits

53 handlers, 30+ helpers, 10 zod schemas and 8 lookup tables — all nested **inside**
`registerRoutes` (`:259`), so none of it can be imported or unit-tested. The file has only three
top-level declarations.

About 750 of those lines touch no HTTP at all: `:456–645` (signup-ref and phone-verification
helpers), `:1490–1919` (`kycForOrder`, `docketAtBooking`, `resolveKycOwner`,
`assertDocumentsStaged`), `:1920–2046` (contract schema, claim helpers). They sit in the closure
for historical reasons only.

**Fix, in order:** `signupRef.ts` → `identityChecks.ts` → `kycPolicy.ts` → move `docketAtBooking`
next to the existing `server/docketAtBooking.ts` → `signupClaim.ts`. Each is a cut-paste plus an
import; the compiler catches anything that actually used the closure. Then lift the lookup tables
(`:679`, `:684`, `:3919`, `:4354`, `:4366`, `:4373`, `:5290`) and `orderCreateSchema` (`:3930`,
~77 lines — the booking contract, currently untestable and unreusable).

**Status — done. `routes.ts` is 5,763 → 4,886 lines.** The five modules hold what they were named
for: `signupRef.ts` (137 lines), `identityChecks.ts` (214), `kycPolicy.ts` (251),
`signupClaim.ts` (144), and `docketAtBooking.ts` (282 — the function now sits beside the flag that
turns it on). The domain tables trapped in the closure, `IDENTITY_KIND_BY_SLOT` and
`IDENTITY_KIND_FOR_KYC_TYPE`, are exported from `identityChecks.ts`, and the 26 imports the
extractions orphaned are gone. Behaviour unchanged; 272 tests still pass. Still inside the closure:
the 779-line actions handler (P2-2), the ITD rate ladder, and `orderCreateSchema`.

The ITD calls should move too: 8 direct `itdClient.*` call sites sit in handlers, and `POST /api/rates`
(`:3780–3822`) does credential lookup, decryption and a three-level fallback ladder inline with a
bare `catch {}` at `:3815`. `persistShipment.ts` and `itdTokenRefresh.ts` are the precedent.

#### P2-2 · `POST /api/orders/:id/actions`, 779 lines · L, one arm per commit

`server/routes.ts:4336–5114` is a single `switch` doing transition validation, handover-code
burning, payment recording, notification dispatch and cancellation bookkeeping. It is the
highest-risk code in the repo and the only place the order state machine lives.

`server/opsActions.ts` already holds `handleWeigh`, `handleSettle`, `handleGenerateDocket` and
`handleMarkDispatched` with a `(order, actor, body) => Result` signature. Move `claim`,
`start_pickup`, `collect_payment`, `override_handover`, `request_cancellation`, `cancel` and
`reject_cancellation` into `server/orderActions.ts` the same way — each move independently
reviewable and testable.

**Status — done. Every arm is out; the handler is the endpoint, not the state machine.**
`server/orderActions.ts` (626 lines) holds `handleClaim`, `handleStartPickup`, `handleHandover`
(the three OTP-gated steps, which were always one shape), `handleOverrideHandover`,
`handleCollectPayment`, `handleRequestCancellation`, `handleCancel` and
`handleRejectCancellation`, on the same result contract as `opsActions.ts`. `routes.ts` is
**5,763 → 4,513 lines**.

Two things fell out of the move. The ops `default:` branch had its own copy of the result-to-HTTP
mapper; there is now one `applyResult` for every arm. And the four `let`s the arms wrote into
became a single `outcome` object — TypeScript cannot follow an assignment made inside a closure,
so plain locals narrowed to `never` the moment every arm stopped writing them directly.

`server/orderActions.test.ts` covers what the handlers refuse before they reach a database: a
customer collecting their own payment (403), each collection point rejecting the other's method,
`collection_mode` being required, a four-digit code, an override without a reason, and a
cancellation declined when none is open. 282 tests pass.

#### P2-3 · `client/src/pages/CreateShipment.tsx`, 4,350 lines · L

One component runs from line 550 to the end of the file, with **79 `useState` calls**. It holds the
ITD rate parsing, the coverage and cutoff logic, a history-based step machine (`:951–1012`),
checkout, four steps of JSX, two full-page early returns (the guest gate `:1236–1385` and the
success screen `:1386–1612`), and a desktop right rail that duplicates the summary again.

**Order matters:** extract `lib/itdRates.ts` (P1-2), then the two full-page returns, then
`hooks/useBookingSteps.ts`. Split the steps **last**, after the ~79 state variables are grouped
into reducer objects — otherwise the split just converts one long file into 40-prop drilling.

#### P2-4 · The rest of the long tail · M

33 files exceed 500 lines. `pages/Signup.tsx` (1,331 lines, 3 top-level declarations) has the same
shape as `CreateShipment`. `components/AccountDocuments.tsx` (1,051) holds a per-slot state
machine, five raw `fetch` calls and a 310-line slot card. `components/bia/BiaChat.tsx` (1,011)
holds session restore, localStorage history and the composer in one component.

The counter-example is `pages/ops/OpsApplicationDetail.tsx`: 1,584 lines but **35 top-level
declarations**, so it splits into `components/ops/application/*` by pure file moves. It also
imports `StatusPill` from another *page* (`:45`) — that belongs in `lib/opsApplications.ts`
alongside the status label and tone maps.

**Status — done. The page is 1,584 → 162 lines** and is now only the page: layout, the query, and
the picked-for-change state the sheet and the panel share. Its pieces live in
`components/ops/application/` — `blocks.tsx` (headings, the copy button, the two tags, the Ask
toggle), `ApplicationSummary.tsx` (the facts and the pre-flight checks), `ApplicationDetails.tsx`,
`ApplicationDocuments.tsx`, `ApplicationHistory.tsx`, and `ApplicationActions.tsx` (the decision
panel and its four forms). Moves only — the compiler found every cross-section reference.

`AccountDocuments.tsx` went 1,050 → 696 the same way: the ~300-line per-slot card is now
`components/documents/DocumentSlotCard.tsx`, taking the slot, its state and five handlers, with
`SlotState` shared through `components/documents/accountDocumentSlot.ts`. The five raw `fetch`
calls stay in the parent — they are entangled with its upload state, so moving them would be a
behaviour change rather than a file move. `StatusPill` importing across pages is still open.

### P3 — the gate, the tests, the docs

#### P3-1 · No automated gate · S to start

No ESLint, no Prettier, no `.editorconfig`, no pre-commit hook, no CI (`.github/` does not exist).
`tsc` is the only gate and it runs when someone remembers.

**Recommended shape — warnings first:** add ESLint + Prettier config, format on touch only (no
repo-wide reformat), start every rule as a warning so nothing blocks mid-feature, and defer the CI
gate to a later wave once the warning count is down. A repo-wide format pass now would collide with
every extraction in P1 and P2.

**Status — done, in that shape.** `eslint.config.js` (flat config: `@eslint/js`,
`typescript-eslint`, `eslint-plugin-react-hooks`, `eslint-config-prettier` last) plus
`.prettierrc.json` and `.prettierignore`. Scripts: `lint`, `lint:fix`, `format`, `format:check`.
`npm run lint` reports **0 errors, 94 warnings** and exits 0 — 44 unused vars, 34 non-null
assertions, 10 `any` (mostly tests and the Vite plugin), 6 `react-hooks/exhaustive-deps`.

The two genuine errors it found were fixed, not silenced: a redundant escape in the account-number
masking regex (`server/supportPrivacy.ts`), and `no-control-regex` in `server/documentResponse.ts`,
which is deliberate and now carries a one-line disable saying why. `client/src/components/ui/**` is
ignored as vendored code.

Prettier would reformat 401 files, so **no repo-wide pass was run** — that belongs in its own
commit, after wave 4, or it collides with every extraction. Promote a rule to `error` once its
count reaches zero; add `--max-warnings` to CI when the total is small enough to hold.


Also missing: a `.gitattributes` (LF and CRLF files sit side by side today) and an `engines` pin,
while two deploy paths build differently — `nixpacks.toml` runs `npm run build` (client + server
bundle) and `vercel.json` runs `vite build` with the API as `api/index.ts`.

**Status — partly fixed.** `.gitattributes` now sets `* text=auto eol=lf` plus the binary types,
and `package.json` pins `"engines": { "node": ">=20 <23" }`. New and edited files land as LF from
here; the existing mixed endings are only rewritten when someone runs `git add --renormalize .`,
which deserves its own commit so it cannot hide a real change. ESLint and Prettier are still
wave 3.

#### P3-2 · Tests are not typechecked, and the UI has none · S / M

- `tsconfig.json` excludes `**/*.test.ts`, so `npm run check` never validates a test file — and
  `tsx` strips types without checking them. Nothing catches a test that no longer compiles.

  **Status — fixed.** The exclusion is gone. The only fallout: `tsconfig.json` never set a
  `target`, so `tsc` assumed ES3 and rejected top-level `await` and `Set` iteration the moment it
  saw a test file. It is now `ES2022`, which Node 20 and Vite already compile to, and no test
  needed changing.
- `npm test` globs `client/src/**/*.test.ts`, so a `.test.tsx` would silently never run. There is
  no jsdom or testing-library setup: **zero component tests** in a codebase that is mostly UI.
- 33 test files exist; on the server 14 of 16 are BIA/support. `server/routes/bia.test.ts` is the
  only HTTP-level test, and it is a good template — it boots a bare `express()`, stubs the session
  through a header and registers one route module.

**Status — first half done. 272 tests, up from 202.** New: `shared/istTime.test.ts` (the 18:30 UTC
day boundary and the pickup cutoff, with month, year and leap-day rollover),
`shared/accountSpec.test.ts` (missing vs unverified, a reviewer outranking the reader, `bypassed`,
and the corporate GST certificate that presence alone must not satisfy),
`server/orderLifecycle.test.ts` (ownership, the pickup-date gate, cash-before-doorstep, the single
way out of `settled`, and that a refusal never says which precondition failed), plus
`client/src/lib/shipmentRows.test.ts`, `surface.test.ts` and `orderStatus.test.ts`.

Still untested: `shadowProfile.ts` (663 lines), `shared/opsBoardQuery.ts`, `handoverCodes.ts`,
`razorpay.ts` signature verification, and `orderDetail.ts`'s jsonb parsing.

**Untested, pure, and load-bearing** — the cheapest coverage in the repo, and the safety net the
P2 extractions need:

| Module | Lines | Why it matters |
|---|---|---|
| `server/orderLifecycle.ts` + `shared/orderContract.ts` | 414 + 414 | transition table and status derivation, used by both tiers |
| `server/routes/payments.ts` + `paymentsDb.ts` + `razorpay.ts` | 829 + 498 + 250 | signature verification, webhook idempotency, money |
| `server/handoverCodes.ts` | 310 | issue/verify/burn with `timingSafeEqual` |
| `shared/opsBoardQuery.ts`, `shared/istTime.ts`, `shared/accountSpec.ts` | 327 + — + 426 | filters, the booking cutoff, the approval gate |
| `client/src/lib/shadowProfile.ts` | 663 | guest→account field carry-over; a wrong answer blocks booking |
| `client/src/lib/orderDetail.ts` | 267 | parses free-form jsonb; its own header says assume nothing is present |
| `client/src/lib/shipmentRows.ts` | 203 | merges two endpoints into the most-viewed screen |
| `client/src/lib/surface.ts` | 59 | role → surface routing, security-adjacent |
| `client/src/lib/orderStatus.ts` | 48 | the customer/internal label split it exists to protect |

#### P3-3 · `CLAUDE.md` describes a different app · S

Last updated April 2026; `server/routes.ts` kept moving until September. It currently claims no
routes are implemented, that storage is `MemStorage` with the DB not wired, that all data comes
from `mockData.ts` ("8,200+ lines"), and that forms use React Hook Form + Zod.

In fact: 107 route handlers, Supabase throughout, `mockData.ts` is 276 lines, and the client
imports **neither** `react-hook-form` nor `zod` anywhere outside the unused `ui/form.tsx` — every
form is hand-rolled `useState`. `docs/api-spec.md` is vendor notes, so nothing documents the 107
endpoints.

Rewrite it **after** this audit, using §3 below as the source.

#### P3-4 · Smaller things worth a line each

- 19 bare `console.log` calls in non-test server code; everything else uses the `[module]` prefix
  convention. One unprefixed error log at `server/routes.ts:5712`.
- Two response shapes: 238 of 240 error responses are `{ message }`; `routes.ts:3457` and `:3461`
  return `{ error }`.
- `server/routes/whatsappSchedule.ts:29,64–67` is the only route module importing `supabase`
  directly — it already imports `ordersDb.ts` in the same file, so the query belongs there.
- `script/` (one build file) and `scripts/` (21 one-off tools, mixed `.ts` and `.mjs`) are two
  directories one letter apart.
- Migrations have no ordering prefix and no applied-migrations table; correctness rests on
  "additive, IF NOT EXISTS" plus `scripts/check-migrations.ts`, which duplicates the pooler-fallback
  connect logic from `scripts/apply-migration.ts` — as its own comment admits.
- Query keys are invalidated by literal in `pages/OrderDetails.tsx:307,374,390` while the same file
  imports `orderDetailKey`. `:307` works only because it is a prefix.
- ~20 components subscribe to the whole Zustand store (`const { isLoggedIn, user } = useAppStore()`)
  instead of using a selector, so any `set` re-renders them all. Newer code (`BiaChat.tsx:146`,
  `useOpsNavBadges.ts:72`) already uses selectors.
- Design tokens are bypassed: `#F2A123` appears **204** times as an arbitrary Tailwind value and
  `lab(34.0831 …)` **137** times, though both are tokens in `index.css` and `.doc-btn-cta` (`index.css:959`) exists
  specifically — per its own comment — to replace "four spellings of the same button".

---

## 3. Conventions worth writing down

These are already followed by the newer code. Stating them makes them reviewable instead of tribal.

**Server**
1. One route module per domain: `export function register<Domain>Routes(app: Express): void`, named
   after the file, registered from `server/routes.ts`.
2. Gates come from `routeGuards.ts` and are passed positionally before the handler. Never an inline
   role check. Reuse the `opsGate` tuple.
3. Input is validated with `schema.safeParse(...)`. Never a throwing `.parse()`.
4. Responses are `res.status(n).json({ message, code? })` followed by a bare `return`.
5. `supabase` is imported only by `*Db.ts` modules. Handlers call those; they never query.
6. Third-party APIs go through a wrapper module (`itd.ts`, `razorpay.ts`, `persistShipment.ts`),
   never straight from a handler.
7. Errors are logged as `console.error("[module] …", err)`.
8. Anything touching dates uses `shared/istTime.ts`. Never a bare `toLocaleDateString`.

**Client**
1. Server data is fetched in a `hooks/use*.ts` React Query hook that owns its query key. Components
   do not call `fetch` directly.
2. Formatting, status maps and parsing live in `lib/`. If a helper exists there, import it — several
   of those files say "do not copy" and mean it.
3. Types shared with the server come from `@shared/*`. Response envelopes that are still hand-typed
   are technical debt, not a pattern to copy.
4. Zustand holds session identity only. Server data belongs in the React Query cache, derived values
   are computed, not stored. Subscribe with a selector.
5. Empty, loading and error states come from the shared components, not a fresh block per screen.
6. Colours come from the tokens in `index.css`, not hex or `lab()` literals.

---

## 4. Sequenced backlog

Each item is independently landable. Nothing in waves 1 and 2 changes behaviour.

**Wave 1 — safety and deletions (days)**
1. P0-2 secrets: widen `.gitignore` to `.env*`, redact `docs/api-spec.md`, rotate the exposed keys.
2. P0-1 `asyncRoute` + `unhandledRejection` listeners; wrap `routes/agent.ts` and `routes/bia.ts`.
3. P0-3 `server/documentResponse.ts`; converge the four file-serving copies.
4. P0-5 CSV timezone.
5. Delete the dead store state and move `pages/Receive.tsx` onto `useCustomerOrders`.
6. Drop the 6 unused dependencies and the 35 unused UI primitives; decide Drizzle's fate.
7. Add `.gitattributes` and an `engines` pin.

**Wave 2 — mechanical de-duplication** — done. `server/db/client.ts`,
`server/cronAuth.ts`, `opsGate`/`opsDbGate` in `routeGuards.ts`,
`shared/contact.ts`, `shared/upload.ts`, `client/src/lib/itdRates.ts`,
`readJson` in `queryClient.ts`, `signOutAndRedirect` in `session.ts`,
`formatIstDate` in `orderDetail.ts`, `OpsAccessRequired` +
`isForbiddenError`/`isNotFoundError`, and `hooks/useUserProfile.ts`.
8. `server/db/client.ts` (P1-1), `cronAuth.ts`, `opsGate`, `shared/phone.ts`, `shared/upload.ts`.
9. `lib/itdRates.ts` + `RateCard` + `CountryCombobox`; delete `lib/countryData.ts` (P1-2).
10. Money/date helpers converged on `lib/orderDetail.ts`; `readJson` into `lib/queryClient.ts`;
    `signOutAndRedirect()` into `lib/session.ts`.
11. `<OpsQueryState>` and shared 403/404 handling with `roleSatisfies` (P1-5).
12. Route `pages/Profile.tsx` and `pages/agent/Profile.tsx` through a typed hook — this alone
    removes most of the client's `any`.

**Wave 3 — the safety net, then structure**
13. Tests for the pure modules in P3-2, starting with `orderLifecycle`, `orderContract`,
    `opsBoardQuery`, `shadowProfile`, `orderDetail`, `shipmentRows`.
14. Typecheck the tests (drop the `tsconfig` exclusion) and fix the fallout on a branch.
15. ESLint + Prettier, warnings first.
16. Lift the 750 closure-scoped lines out of `routes.ts` (P2-1); split `OpsApplicationDetail.tsx`
    and `AccountDocuments.tsx` by file moves.

**Wave 4 — the big two, incrementally**
17. One `switch` arm per commit out of `POST /api/orders/:id/actions` (P2-2).
18. `CreateShipment` state grouping, then step extraction (P2-3).
19. The colour-literal codemod — last, and alone, because it conflicts with everything.

**Suggested first PR:** items 1–4. Small, reviewable, and it closes the two findings that are not
about tidiness.

---

## Reproducing the numbers

```bash
# file size census
find server client/src -name "*.ts" -o -name "*.tsx" | grep -v components/ui | xargs wc -l | sort -rn | head -30

# handlers vs try blocks, per route module
for f in server/routes/*.ts; do echo "$(basename $f): routes=$(grep -cE 'app\.(get|post|patch|put|delete)\(' $f) try=$(grep -c 'try {' $f)"; done
grep -cE 'app\.(get|post|patch|put|delete)\(' server/routes.ts   # 53
grep -c 'try {' server/routes.ts                                  # 25
grep -rn "unhandledRejection" server api | wc -l                  # 0

# unused UI primitives
for f in client/src/components/ui/*.tsx; do b=$(basename "$f" .tsx); \
  n=$(grep -rlE "components/ui/$b['\"]" client/src --include=*.tsx --include=*.ts | grep -v "components/ui/" | wc -l); \
  [ "$n" -eq 0 ] && echo "$b"; done | wc -l                       # 35

# unused dependencies — match subpaths and dynamic imports, or the answer is wrong:
#   connect-pg-simple is loaded by await import(), pdfjs-dist by deep subpath.
for d in passport memorystore ws; do echo "$d: $(grep -rE "(from|import|require)\(?[\"']$d(/[^\"']*)?[\"']" server client/src shared api scripts | wc -l)"; done

# duplication spot checks
grep -rln "function logSupabaseError" server | wc -l              # 11
grep -rn "function normalizeRateRow" client/src                   # 2 files
grep -rln "api/auth/logout" client/src                            # 9 files (1 is lib/session.ts)

# design token bypass
grep -ro "#F2A123" client/src --include=*.tsx --include=*.ts --include=*.css | wc -l   # 204
grep -ro "lab(34.0831" client/src --include=*.tsx --include=*.ts --include=*.css | wc -l # 137

# validation discipline
grep -rho "safeParse(" server --include=*.ts | wc -l              # 51
grep -rnoE "[A-Za-z]Schema\.parse\(" server --include=*.ts | wc -l # 0
```
