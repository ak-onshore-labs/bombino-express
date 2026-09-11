# BIA 3.0 — build progress

The single place to see where the BIA 3.0 build stands.

- **Product plan:** https://claude.ai/code/artifact/85e67fff-def9-4adf-9fad-6e66dd0195f9
- **Build plan** (session briefs, hotspot rules, review checklist): https://claude.ai/code/artifact/70f68f82-7139-4bcd-8c61-f36311f60dd8
- **Branches:** package `0.1` lands on `aditya/final-phase`. Everything after it branches from `bia-3/main` (cut from `aditya/final-phase` once 0.1 is in). Each package gets `bia-3/wpX-Y` in its own worktree and a PR into `bia-3/main`. A release merges `bia-3/main` back into `aditya/final-phase`. (Git can't have a branch named `bia-3` alongside `bia-3/…` branches, hence `/main`.)
- **Checkouts:** your usual clone stays on `aditya/final-phase`. `../bia-worktrees/main` is the permanent `bia-3/main` checkout where this file is updated. Package worktrees go in `../bia-worktrees/wpX-Y`, with `node_modules` as a junction to the main clone's. Remove the junction (`rmdir`) before deleting a worktree, so the delete can't reach through it.

## How to update this file

- **Package sessions don't edit this file.** Several sessions run at once, and parallel edits to one table conflict. The orchestrating session (or Aditya) updates it on `bia-3/main` after each PR merges.
- Status: ⬜ not started · 🟡 in progress · 🔵 PR open · ✅ merged · ⛔ blocked
- On merge: set ✅, fill in the PR and date, tick the package's checklist below, and write anything surprising under its **Notes**.
- Change a package's scope here and in the build plan together, or the two drift.

## Status board

| WP | Package | Rel | Wave | Size | After | Status | Branch / PR | Merged |
|---|---|---|---|---|---|---|---|---|
| [0.1](#01-ship-bia-20) | Ship BIA 2.0 | R0 | W0 | S · ½ d | — | ✅ | `aditya/final-phase` (direct, not pushed) | 2026-09-11 |
| [0.2](#02-move-the-support-routes-out-of-routests) | Move the support routes out of routes.ts | R0 | W1 | S · ½ d | 0.1 | ✅ | `bia-3/wp0-2` → merged locally (28cd36f) | 2026-09-11 |
| [1.1](#11-test-runner-and-eval-harness) | Test runner and eval harness | R1 | W2 | M · 1 d | 0.2 | ✅ | `bia-3/wp1-1` → merged locally (9a5cbfb) | 2026-09-11 |
| [1.2](#12-error-catalog) | Error catalog | R1 | W2 | M · 1 d | 0.2 | ✅ | `bia-3/wp1-2` → merged locally (c869115) | 2026-09-11 |
| [1.3](#13-screen-context-and-cards) | Screen context and cards | R1 | W3 | M · 1 d | 1.1 | ✅ | `bia-3/wp1-3` → merged locally (cbcc9af) | 2026-09-11 |
| [1.4](#14-bia-sheet-and-ask-bia) | BIA sheet and "Ask BIA" | R1 | W4 | L · 1.5 d | 1.3 | ⬜ | `bia-3/wp1-4` | |
| [1.5](#15-module-prompts-and-tool-registry) | Module prompts and tool registry | R1 | W4 | M · 1 d | 1.3 | ⬜ | `bia-3/wp1-5` | |
| [1.6](#16-privacy-filter-telemetry-and-feedback) | Privacy filter, telemetry and feedback | R1 | W4 | M · 1 d | 1.3 | ⬜ | `bia-3/wp1-6` | |
| [1.7](#17-guest-chat-history) | Guest chat history | R1 | W5 | S · ½ d | 1.4, 1.6 | ⬜ | `bia-3/wp1-7` | |
| [2.1](#21-account-matchmaker) | Account Matchmaker | R2 | W5 | M · 1 d | 1.5 | ⬜ | `bia-3/wp2-1` | |
| [2.2](#22-signup-progress-and-document-status) | Signup progress and document status | R2 | W5 | M · 1 d | 1.5 | ⬜ | `bia-3/wp2-2` | |
| [2.3](#23-verdict-explainer-on-the-upload-screens) | Verdict explainer on the upload screens | R2 | W5 | S · ½ d | 1.2 | ⬜ | `bia-3/wp2-3` | |
| [2.4](#24-photo-check-before-upload) | Photo check before upload | R2 | W6 | M · 1 d | 2.3 | ⬜ | `bia-3/wp2-4` | |
| [2.5](#25-upload-card-inside-the-chat) | Upload card inside the chat | R2 | W7 | M · 1 d | 2.2, 2.4 | ⬜ | `bia-3/wp2-5` | |
| [3.1](#31-booking-context-and-error-explainer) | Booking context and error explainer | R3 | W6 | M · 1 d | 1.4, 1.5 | ⬜ | `bia-3/wp3-1` | |
| [3.2](#32-hsn-helper) | HSN helper | R3 | W8 | M · 1 d | 3.3 | ⬜ | `bia-3/wp3-2` | |
| [3.3](#33-drafts-and-say-it-to-ship) | Drafts and "say it to ship" | R3 | W7 | L · 2 d | 3.1 | ⬜ | `bia-3/wp3-3` | |
| [3.4](#34-restricted-items-waits-on-content) | Restricted items (waits on content) | R3 | W6 | S · ½ d | 1.5 | ⬜ | `bia-3/wp3-4` | |
| [4.1](#41-support-cases) | Support cases | R4 | W6 | M · 1 d | 1.3, 1.7 | ⬜ | `bia-3/wp4-1` | |
| [4.2](#42-ops-cases-tab) | Ops Cases tab | R4 | W7 | L · 1.5 d | 4.1 | ⬜ | `bia-3/wp4-2` | |
| [4.3](#43-customer-side-of-cases-order-page-links) | Customer side of cases, order-page links | R4 | W8 | M · 1 d | 4.1 | ⬜ | `bia-3/wp4-3` | |
| [5.1](#51-nudges) | Nudges | R5 | W8 | L · 1.5 d | 1.4, 2.2 | ⬜ | `bia-3/wp5-1` | |
| [5.2](#52-voice-notes) | Voice notes | R5 | W9 | M · 1 d | 1.4, 1.6 | ⬜ | `bia-3/wp5-2` | |
| [5.3](#53-hindi) | Hindi | R5 | W7 | S · ½ d | 1.5 | ⬜ | `bia-3/wp5-3` | |

**24 packages · 23.5 dev-days · 10 waves.**

## Waves

Packages in the same wave run in parallel. A package starts only once everything it depends on has merged into `bia-3/main`.

| Wave | Packages | Note |
|---|---|---|
| W0 | 0.1 | serial |
| W1 | 0.2 | serial |
| W2 | 1.1 · 1.2 | 2 in parallel |
| W3 | 1.3 | 1.2 may still be running |
| W4 | 1.4 · 1.5 · 1.6 | 3 in parallel |
| W5 | 1.7 · 2.1 · 2.2 · 2.3 | 4 in parallel — **R1 can go live once 1.7 merges** |
| W6 | 2.4 · 3.1 · 3.4 · 4.1 | 4 in parallel |
| W7 | 2.5 · 3.3 · 4.2 · 5.3 | 4 in parallel — **R2 can go live once 2.5 merges** |
| W8 | 3.2 · 4.3 · 5.1 | 3 in parallel — **R3 and R4 can go live once 3.2 and 4.3 merge** |
| W9 | 5.2 | owns BiaChat after 4.3 — **R5 goes live** |

## Releases

Modules ship dark and go live by adding them to `BIA_MODULES` in production.

| Release | Name | Exit | Live in prod |
|---|---|---|---|
| R0 | Ship BIA 2.0 | Evals pass; nothing leaks; support routes live in their own file. | ⬜ |
| R1 | Foundations | Any catalogued error opens BIA already explaining it; evals and telemetry run on every change. | ⬜ |
| R2 | Onboarding and documents | Every OCR verdict has a tested explanation; a document can be retaken from chat. | ⬜ |
| R3 | Booking Copilot | A one-sentence request becomes a correct pre-filled draft across the eval set. | ⬜ |
| R4 | Handoff | Every escalation is a case ops can see and answer; risky actions link to the order page. | ⬜ |
| R5 | Proactive and reach | Nudges are capped and switchable; voice and Hindi pass their evals. | ⬜ |

## Migrations

Sessions write them; Aditya runs each in Supabase before its package merges.

| File | WP | Written | Run in Supabase |
|---|---|---|---|
| `migrations/create_bia_turns.sql` | 1.6 | ⬜ | ⬜ |
| `migrations/support_sessions_guest_ref.sql` | 1.7 | ⬜ | ⬜ |
| `migrations/create_bia_drafts.sql` | 3.3 | ⬜ | ⬜ |
| `migrations/create_support_cases.sql` | 4.1 | ⬜ | ⬜ |
| `migrations/create_bia_nudges.sql` | 5.1 | ⬜ | ⬜ |

## Waiting on people

- [ ] **Bombino content:** restricted items per destination (US, UK, UAE, Canada, Australia first), the volumetric weight rule per service, packing charges by box size, the support WhatsApp number and hours, typical time at each order stage. Needed by 3.4 and 4.1.
- [ ] **Test identities for evals:** one account per category (personal, corporate, co-courier, e-commerce, FBB), a guest with orders (`9000000091`), a half-finished signup. Check `docs/test-accounts.md` for free numbers first. Needed by 1.1.
- [ ] **Sample document photos** (20–30, sharp, blurred, glare, cropped; own or team documents, kept out of the repo). Needed by 2.4.
- [ ] **Scheduler:** point the external scheduler at `POST /api/admin/bia/nudges/sweep` with the retention-sweep secret. Needed by 5.1.

## Package checklists

### R0 · Ship BIA 2.0

#### 0.1 Ship BIA 2.0

**Status:** ✅ · **After:** — · **Owns:** `server/supportAgent.ts`, `server/routes.ts`, `pages/Support.tsx`

Get the uncommitted BIA 2.0 work type-clean, checked and merged.

Build
- [x] Run `npm run check` and fix what it reports in the BIA files.
- [x] Walk `scripts/bia-evals.md` by hand against `npm run dev` with the seeded orders (BOM-100001, BOM-100002 and the pickup_requested pair). Fix failures.
- [x] Commit in logical pieces (server, client, docs) on `aditya/final-phase`. No PR: it's the working branch, and 0.1 was already sitting in its working tree.
- [x] Create the `bia-3/main` integration branch from the result.

Done when
- [x] `npm run check` is clean
- [x] Every eval prompt passes; no handover code, internal status or staff id in any transcript
- [x] A stranger's BOM number reads like one that doesn't exist, for accounts and guests

Notes: Type check was clean first time. Eval run (23 prompts, against the dev server with OTP-stubbed test logins): 20 passed first time. Fixed: #4 asked the customer to confirm a weight they had just given (prompt now says to quote as soon as destination and weight are known); #20 told a guest to contact support without the contact button (the order tool now offers `TAP_CONTACT_US` and an "Important:" line for guest orders still open); #11 now says no pickup code has been issued yet when none exists. All three re-passed twice. Security #21–#23 passed (a foreign `sessionId` is ignored; a foreign `TAP_VIEW_ORDER` is stripped). Style drift noted for 1.5: on a single order BIA sometimes lists every field instead of two to four sentences. Edge case for 1.3: a button token containing a space (`TAP_TRACK:not valid`) is cut at the space and leaves the rest in the text.

#### 0.2 Move the support routes out of routes.ts

**Status:** ✅ · **After:** 0.1 · **Owns:** `server/routes.ts`, `server/routes/support.ts`

Move `/api/support/*` and `supportContextFor` into `server/routes/support.ts` with `registerSupportRoutes(app)`, so later packages don't collide in a 5,393-line file.

Build
- [x] A pure move: same middleware order (`ensureDbUser`, `refreshItdTokenIfNeeded`, `supportChatRateLimit`) and the same responses.
- [x] Register it where the block used to be (not next to `registerGuestProfileRoutes`), so Express matches routes in exactly the old order.

Done when
- [x] The diff shows moved lines only (checked: the 207 moved lines are identical to the ones removed)
- [x] `/help` chat works for an account, a guest and a signed-out visitor

Notes: Smoke-tested on a second dev server from the worktree (port 5001): suggestions, chat, session and new-session for signed-out, account (9000000090) and guest (9000000091). 9/9 passed, including 401 on `/api/support/session` without a login and a 400 on a malformed body. `routes.ts` is 222 lines shorter. Merged by fast-forward locally; nothing pushed.

### R1 · Foundations

#### 1.1 Test runner and eval harness

**Status:** ✅ · **After:** 0.2 · **Owns:** `server/supportAgent.ts (trace hook only)`

Give every later package a way to prove itself: unit tests for pure logic, and an eval runner for BIA's behaviour.

Build
- [x] `npm test`: `tsx --test` over `**/*.test.ts` with `node:test` and `node:assert`. No new dependency.
- [x] First tests: `finalizeReply`, `normalizeOrderNo`, `isBookableCorridor` (plus `nextStepFor` and `handoverCodeLine`: 24 tests).
- [x] `handleChat` takes an optional trace collector that records tool names and arguments. Nothing else changes.
- [x] `scripts/bia-eval.ts` and `npm run bia:eval`: JSON cases in `scripts/bia-evals/cases/` (identity, screen, turns, expected tools, required and forbidden text, expected buttons), with `--module`, `--case`, `--repeat` and `--verbose`; exits 1 on failure.
- [x] Convert `scripts/bia-evals.md` into cases. The runner impersonates the seeded identities by building `SupportChatContext` directly. (20 cases; #21–#22 stay manual because they test the HTTP route; #23 became a unit test.)
- [x] A global forbidden pattern: any run of more than four digits from a seeded ID number. Also on every reply: the identity's real handover codes, uuids, internal statuses, markdown bold.

Done when
- [x] `npm test` passes; every converted 2.0 case passes (20/20 on each of 3 runs, `--repeat 3`)
- [x] A deliberately broken case fails with a readable diff (the real failures along the way printed each reason plus the full reply)

Notes: The harness caught a mistake of mine from 0.1. BOM-100108 has a rider and a live pickup code, so "no pickup code has been issued" was a false answer that the looser manual check had accepted. Fixed with `handoverCodeLine` (the order tool now says where the code is, never what it is) and a corrected prompt line. Chat temperature went from the default 1 to 0.2: at 1, three repeated runs showed skipped tools and "please confirm the weight" on a prompt that already gave it. **Heads-up:** `aditya/final-phase` still has the bad 0.1 prompt line until R1 merges back. Noise: `npm test` prints Redis connection errors because `postalLookup.ts` connects at import; harmless, but a lazy connect would quiet it. Scripts other than the runner stay out of `tsconfig` because several don't compile today. Run from a worktree with `DOTENV_CONFIG_PATH` pointing at the main clone's `.env`.

#### 1.2 Error catalog

**Status:** ✅ · **After:** 0.2 · **Owns:** `server/routes.ts`

Give every customer-facing signup, identity, KYC and booking error a stable code and one shared explanation, so screens and BIA say the same thing.

Build
- [x] `shared/errorCatalog.ts`: code → { title, why, fix, button }. About 40 codes to start: phone and OTP; identity (`AADHAAR_INVALID`, `PAN_INVALID`, `GSTIN_CHANGED`, `IDENTITY_NUMBER_FIRST`); documents (`DOCUMENTS_MISSING`, `DOCUMENTS_OUTDATED`, `OCR_MISMATCH`, `OCR_WRONG_DOCUMENT`, `OCR_TAMPERED`, `OCR_UNREADABLE`, `OCR_UNAVAILABLE`); booking (`KYC_REQUIRED`, `CONTRACT_REQUIRED`, `PICKUP_DATE_REQUIRED`, `PAY_AT_PICKUP_NEEDS_PICKUP`, `PAY_AT_DROPOFF_NEEDS_DROPOFF`, `PICKUP_PINCODE_NOT_SERVICEABLE`, `PICKUP_DATE_TOO_EARLY`, `ACCOUNT_EXISTS`).
- [x] Add `code` to those responses in `routes.ts`. Every message stays word for word; codes that already exist are reused.
- [x] A test that scans the routes for `code:` values and fails if one is missing from the catalog.

Done when
- [x] The catalog test passes; no customer-visible message changed (all 211 `message:` values in `routes.ts` compare equal)
- [x] `parseApiErrorCode` returns the new codes on the client (`client/src/lib/apiError.test.ts`, plus 8 codes checked over HTTP)

Notes: 48 codes, not ~40. The scan test found ten payment codes (`server/routes/payments.ts`) the first inventory missed; the customer-facing ones joined the catalog under a new `payment` area (already paid, gateway down, declined, pending confirmation, cancelled order). Rider, ops and test-mode codes are listed in `UNCATALOGUED_CODES` so the test can tell "not for customers" from "forgotten". `phone_unverified` keeps its lowercase name because `Signup.tsx` matches on it. OTP failures get their code in `otpVerify.ts`; identity failures in `sendIdentityFailure`; refused documents via `ocrErrorCode()`; booking refinements via zod `params`. Not coded: developer-only errors (unknown document type, missing `document_type`) and the signup contract checkbox (zod `errorMap` carries no params). `npm test`: 34 passing.

#### 1.3 Screen context and cards

**Status:** ✅ · **After:** 1.1 · **Owns:** `server/routes/support.ts`, `server/supportAgent.ts`, `pages/Support.tsx`

Define the contract the rest of the build uses: what the app tells BIA about the screen, and the structured reply BIA sends back.

Build
- [x] `shared/biaScreen.ts`: { surface, step, orderNo, errorCode } with an allow-list validator. Surfaces: home, help, signup, documents, create, order, orders, guest_profile, track, rates. (Steps are listed per surface: signup's five, and create's sender/receiver/package/invoice/payment.)
- [x] The chat route accepts `screen`; `SupportChatContext.screen`; the system prompt gets a SCREEN block (with the error catalog's explanation and button when there's an error code).
- [x] `shared/biaCards.ts`: a discriminated union. Built now: order, pickup, rate. The other kinds (checklist, docStatus, docUpload, hsn, draft, case) are added by their own packages, with a note in the file. The response is { message, suggestions, cards }; `ToolOutcome` carries cards.
- [x] `shared/biaCta.ts`: one registry of button kinds (validation and route) that both `supportCta.ts` and `supportMessage.ts` read. `TAP_` tokens keep working.
- [x] Render order and pickup cards (and rate cards, since `get_rates` already had the data); the rest arrive with their packages.

Done when
- [x] An invalid screen value is dropped and never reaches the model (unit tests on `parseBiaScreen` and `screenBlock`, including injection attempts; eval `screen-05`)
- [x] Eval: "where is it?" on an order screen calls `get_order_status` without asking which order (`screen-01`; `screen-02` proves a guest can't use it to see an account's order)
- [x] Old transcripts with `TAP_` tokens still render (`client/src/lib/supportMessage.test.ts`)

Notes: Cards come from the last round of tool calls that produced any, so "list, then open one" shows the one; none when the lookup found nothing. A card replaces its order's "Open order" button in the chat. The client validates every card with `isBiaCard`, and a card can only link inside the app (`/order/…`, `/shipment/…`, `/orders`). The chat UI's status colours are dark-tuned copies of the badge tones. **Not stored:** cards live for the conversation in the tab; an account's restored transcript keeps text and buttons, not cards (revisit with 1.7 if wanted). **Not visually checked in a browser yet:** logging in on a second localhost port would replace the :5000 app's session cookie in your browser; verified over HTTP instead (cards, tones, overdue = orange, junk screen ignored). 58 unit tests; 25/25 evals × 3.

#### 1.4 BIA sheet and "Ask BIA"

**Status:** ⬜ · **After:** 1.3 · **Owns:** `pages/Support.tsx → components/bia/BiaChat.tsx`, `pages/Signup.tsx (error links)`, `pages/CreateShipment.tsx (error links)`

BIA opens over any screen, already knowing the screen and the error, instead of only on /help.

Build
- [ ] Extract the chat UI into `components/bia/BiaChat.tsx`; `/help` becomes a thin page around it.
- [ ] `components/bia/BiaSheet.tsx` (Radix Sheet) and a small zustand store: `openBia({ screen, seed })`.
- [ ] An `askBia(err, screen)` helper built on `parseApiErrorCode`. "Ask BIA" links beside errors on signup, the documents step, guest verification and booking submit.
- [ ] The support button opens the sheet for the current screen; `/help` still works.
- [ ] Thumbs up/down under each reply, posting to the 1.6 endpoint (hidden until it exists).
- [ ] "Ask BIA" links only show when that surface's module is on in `BIA_MODULES`.

Done when
- [ ] From a booking error, BIA's first reply explains that error (eval and by hand)
- [ ] The sheet works at 375px and on desktop; focus is trapped and Escape closes it
- [ ] Account history on `/help` is unchanged

Notes: —

#### 1.5 Module prompts and tool registry

**Status:** ⬜ · **After:** 1.3 · **Owns:** `server/supportAgent.ts`

Keep gpt-4o-mini accurate as BIA grows: a short base prompt plus one module per surface, each bringing only its own tools.

Build
- [ ] `server/supportPrompts.ts`: base rules (guardrails, style, language) plus modules for orders, onboarding, documents and booking.
- [ ] A tool registry: each module file exports its tool definitions and executors, and `supportAgent.ts` assembles them per turn from the screen and identity. Later packages add tools without touching `supportAgent.ts`.
- [ ] `BIA_MODULES` env switch; modules not listed are never offered.
- [ ] The orders module is today's tools. Rates, tracking, pickup and guidance stay available everywhere.

Done when
- [ ] Every 2.0 eval still passes
- [ ] The system prompt on `/help` is no longer than today's (the eval output logs its size)

Notes: —

#### 1.6 Privacy filter, telemetry and feedback

**Status:** ⬜ · **After:** 1.3 · **Owns:** `server/routes/support.ts` · **Migration:** `create_bia_turns.sql`

Know how BIA is doing, and keep ID numbers away from OpenAI and out of transcripts.

Build
- [ ] `server/supportPrivacy.ts`: masks Aadhaar-shaped (12 digits, with or without spaces) and PAN-shaped text, and long digit runs, in user messages before the model call and before storage. Unit tests.
- [ ] `bia_turns`: owner kind, surface, tools, latency, fallback, prompt and completion tokens, rating. Written after each turn, never delaying the reply.
- [ ] `POST /api/support/feedback { turnId, rating }`; chat responses include `turnId`.

Done when
- [ ] Test: "my aadhaar is 1234 5678 9012" reaches the model as "••••9012"
- [ ] Turn rows appear for account, guest and signed-out chats; the chat still works before the migration runs

Notes: —

#### 1.7 Guest chat history

**Status:** ⬜ · **After:** 1.4, 1.6 · **Owns:** `server/routes/support.ts`, `components/bia/BiaChat.tsx` · **Migration:** `support_sessions_guest_ref.sql`

A guest's conversation follows their verified phone, the way an account's does.

Build
- [ ] Read the live `support_sessions` shape first; the repo has no migration for it. Add a nullable `guest_ref`, an owner check and an index.
- [ ] Session helpers and the ownership check accept a guest owner; the chat route stores guest transcripts.
- [ ] `BiaChat` loads guest history from the server, with `sessionStorage` only as a fallback.
- [ ] When a guest opens an account, their sessions move over with the claim, as notifications do.

Done when
- [ ] Guest history survives a new tab and a second device after OTP
- [ ] A guest can't load another guest's session

Notes: —

### R2 · Onboarding and documents

#### 2.1 Account Matchmaker

**Status:** ⬜ · **After:** 1.5 · **Owns:** `pages/Signup.tsx`

Answer "which account do I need?" from a fixed decision table, with the exact document list.

Build
- [ ] `shared/accountMatch.ts`: answers (for a business, sells online under LUT, is a courier, stock held by Bombino) → personal, corporate, co_courier, ecommerce or fbb. Unit tests for every path.
- [ ] Onboarding tools: `recommend_account` (a checklist card from `requiredDocuments`, `requiredExtraFields` and `DOC_SLOT_SPECS`) and `explain_term` (GSTIN, IEC, LUT, AD code, IEC branch code, authorization letter).
- [ ] Signup reads `?category=` and preselects it; a SIGNUP button kind (type and category).
- [ ] The guest-or-account answer comes from the guidance content.

Done when
- [ ] Every category's checklist equals `requiredDocuments` plus `requiredExtraFields` (test)
- [ ] Eval: the Etsy-seller prompt → E-commerce, the right list, and a working button

Notes: —

#### 2.2 Signup progress and document status

**Status:** ⬜ · **After:** 1.5

BIA can say where a signup, or an account's documents, stand without asking.

Build
- [ ] `get_signup_progress`: from the session's `signupRef`, via `listIdentityVerificationsBySignupRef` and `listDocumentsBySignupRef`: numbers recorded (last four only), slots uploaded with verdicts, slots still missing (`missingDocuments`).
- [ ] `get_document_status` for accounts, via `getVerificationState`.
- [ ] docStatus card, and a RESUME_SIGNUP button to the right step.
- [ ] `bypassed` and `skipped` read as on file, with no verification talk.

Done when
- [ ] Eval: a half-finished E-commerce signup → "4 of 6 uploaded, PAN matched, Aadhaar needs a clearer photo"
- [ ] No reply carries more than four digits of an ID number

Notes: —

#### 2.3 Verdict explainer on the upload screens

**Status:** ⬜ · **After:** 1.2 · **Owns:** `AccountDocuments.tsx`, `KycUpload.tsx`

Each OCR verdict shows one explanation and one fix, the same on the upload screen as in BIA.

Build
- [ ] `shared/ocrExplain.ts`: verdict (plus a changed GSTIN and number-entered-first) → headline, why, fix, button, built on the error catalog.
- [ ] `AccountDocuments.tsx` and `KycUpload.tsx` show it instead of the raw note, with "Ask BIA" beside it.
- [ ] Documents tool: `explain_document_issue`.

Done when
- [ ] Tests cover all eight `OcrStatus` values
- [ ] Nothing appears for `match` or `bypassed`

Notes: —

#### 2.4 Photo check before upload

**Status:** ⬜ · **After:** 2.3 · **Owns:** `AccountDocuments.tsx`, `KycUpload.tsx`

Catch blurry, glary or tiny photos on the phone before they cost a Cashfree call.

Build
- [ ] `client/src/lib/photoCheck.ts`: downscale on a canvas; blur from the variance of the Laplacian; glare from the share of clipped highlights; size from the shorter side. PDFs skip it.
- [ ] A soft warning with Retake and Use anyway. It never blocks.
- [ ] Thresholds in one block of constants; the outcome is logged for tuning.

Done when
- [ ] Unit tests on synthetic images (sharp, blurred, blown out)
- [ ] Tuned on your sample photos, with no warning on a good phone photo
- [ ] An upload is never prevented

Notes: —

#### 2.5 Upload card inside the chat

**Status:** ⬜ · **After:** 2.2, 2.4 · **Owns:** `components/bia/BiaChat.tsx`

The first chat action: retake and re-upload a document without leaving BIA.

Build
- [ ] A docUpload card for one slot, posting to the endpoint that screen uses (`/api/signup/documents`, `/api/account/documents`, or `/api/kyc/upload` for guests). Each endpoint authorises the caller itself.
- [ ] Runs the photo check, then shows the verdict explanation from `ocrExplain`.
- [ ] Marked as coming from BIA in telemetry.

Done when
- [ ] A re-upload from chat updates the same slot the screen shows
- [ ] A guest without a verified phone is refused by the endpoint, and the card explains why

Notes: —

### R3 · Booking Copilot

#### 3.1 Booking context and error explainer

**Status:** ⬜ · **After:** 1.4, 1.5 · **Owns:** `pages/CreateShipment.tsx`

BIA inside Create Shipment knows the step and what went wrong.

Build
- [ ] `CreateShipment` passes { surface: create, step: `currentStep`, errorCode }, plus destination and product type, to `openBia`. "Ask BIA" on the step header and next to submit errors.
- [ ] Booking module: `explain_booking_error` (from the catalog) and a glossary for DOX, SPX, Commercial, CSB V, declared value, currency, unit rate and IGST, reusing `PRODUCT_TYPE_INFO` wording.

Done when
- [ ] An eval per booking error code: cause, fix and the right button
- [ ] No ID number or address in the screen payload

Notes: —

#### 3.2 HSN helper

**Status:** ⬜ · **After:** 3.3 · **Owns:** `pages/CreateShipment.tsx (HSN field)`

Suggest an HSN code the customer can apply with one tap.

Build
- [ ] Move the lookup in `client/src/lib/hsnData.ts` to `shared/hsn.ts` so the server can use it.
- [ ] `suggest_hsn(description)`: exact lookup first, then up to three model candidates checked against the known list, with how sure it is.
- [ ] An hsn card with "Use this code": the sheet emits it and `CreateShipment` sets the field through its own handler.

Done when
- [ ] Eval: turmeric powder, cotton kurta, brass idol → sensible candidates; an unknown item → "check with our team"
- [ ] The field only changes on a tap

Notes: —

#### 3.3 Drafts and "say it to ship"

**Status:** ⬜ · **After:** 3.1 · **Owns:** `pages/CreateShipment.tsx (new hook)`, `server/routes/bia.ts` · **Migration:** `create_bia_drafts.sql`

The second chat action: one sentence becomes a pre-filled booking the customer checks and submits.

Build
- [ ] `bia_drafts`: owner (`user_id` or `guest_ref`), payload, `expires_at` 24 hours out.
- [ ] `draft_shipment`: the model extracts destination, weight, contents, pickup pincode and date, receiver name and city. The server checks `isBookableCorridor`, pickup coverage and a live rate, saves the draft, and returns a draft card with a CONTINUE_DRAFT button.
- [ ] `GET /api/bia/drafts/:id` in a new `server/routes/bia.ts`, owner-checked.
- [ ] `useBookingDraft()` in `CreateShipment`: reads `?draft=`, applies fields through the existing change handlers so currency and product-type effects still fire, and shows "Filled in by BIA. Check each step."

Done when
- [ ] Manual matrix: pickup vs drop-off, envelope vs parcel, guest vs account, a route that can't be booked
- [ ] Someone else's draft id → not found
- [ ] No code path lets BIA submit a booking

Notes: —

#### 3.4 Restricted items (waits on content)

**Status:** ⬜ · **After:** 1.5

Answer "can I send this?" only from Bombino's own list.

Build
- [ ] A loader for `content/bia/restricted/<country>.md` and `can_i_ship(item, country)`.
- [ ] Found → the rule as written. Not found, or no file → "check with our team" and the contact button. Never a guess.

Done when
- [ ] With no content files, every answer is "check with our team" (eval)
- [ ] Switches on once Bombino's lists land

Notes: —

### R4 · Handoff

#### 4.1 Support cases

**Status:** ⬜ · **After:** 1.3, 1.7 · **Owns:** `server/routes/support.ts` · **Migration:** `create_support_cases.sql`

Handoff that actually reaches someone: an escalation becomes a case ops can see.

Build
- [ ] `support_cases`: case number (BIA-1001 onwards), owner, order, category, summary, transcript snapshot, status (open, answered, closed), ops reply, timestamps.
- [ ] `escalate_support` opens a case (one open case per owner and order in 24 hours), writes a three-line summary with a strict prompt, and returns a case card plus a WhatsApp button with the case number already in the message.
- [ ] The escalation copy changes to match: our team can see this conversation.

Done when
- [ ] Eval: a damaged-parcel complaint → case opened, the summary names the order, no promised callback time
- [ ] Repeating the complaint doesn't open a second case

Notes: —

#### 4.2 Ops Cases tab

**Status:** ⬜ · **After:** 4.1 · **Owns:** `server/routes/ops.ts`, `client/src/lib/opsNav.ts`

Ops can read a case and reply in one place.

Build
- [ ] `GET /api/ops/cases` (filter by open, answered, closed), `GET /api/ops/cases/:id`, `POST …/reply`, `POST …/close`, behind the same role guard as the other ops routes.
- [ ] `pages/ops/OpsCases.tsx` and `OpsCaseDetail.tsx`: summary first, transcript below, order link, reply box.
- [ ] An `OPS_NAV` entry (in the More sheet on mobile).
- [ ] A reply writes a bell notification for the owner via `insertNotification`, with `data.kind` set to support_case.

Done when
- [ ] Customers and riders can't reach `/api/ops/cases`
- [ ] A reply reaches the customer's bell on the next refresh

Notes: —

#### 4.3 Customer side of cases, order-page links

**Status:** ⬜ · **After:** 4.1 · **Owns:** `pages/Notifications.tsx`, `pages/OrderDetails.tsx`, `components/bia/BiaChat.tsx`

Close the loop for the customer, and send the actions that stay off chat to the right spot on the order page.

Build
- [ ] A case bell item opens BIA with the case and ops' reply at the top.
- [ ] Anchors on the order page: `#cancel`, `#handover-code`, `#pay`. VIEW_ORDER buttons can carry the section.
- [ ] BIA's answers about cancelling, a new code or paying link to those anchors.

Done when
- [ ] Eval: "cancel my order" → explains and links to `#cancel`; never runs it
- [ ] Bell → BIA shows ops' reply

Notes: —

### R5 · Proactive and reach

#### 5.1 Nudges

**Status:** ⬜ · **After:** 1.4, 2.2 · **Owns:** `server/routes/bia.ts`, `pages/Profile.tsx` · **Migration:** `create_bia_nudges.sql`

BIA speaks first when something stalls, through the bell.

Build
- [ ] `server/supportNudges.ts` rules: signup stuck at documents for 24 hours; a guest with two or more orders and no account; pickup tomorrow; final amount changed after weighing (skipped if `notify.ts` already sent that message); document failed (live Cashfree only).
- [ ] `POST /api/admin/bia/nudges/sweep` behind the same bearer secret as the retention sweep; the external scheduler calls it daily.
- [ ] `bia_nudges` log (unique per owner, kind and subject; at most one per owner per day), plus per-kind opt-outs on Profile and the guest profile.
- [ ] Each bell row carries a BIA seed; tapping it opens the sheet about that thing.

Done when
- [ ] Running the sweep twice sends nothing new
- [ ] An opt-out stops that kind; no nudge is marketing

Notes: —

#### 5.2 Voice notes

**Status:** ⬜ · **After:** 1.4, 1.6 · **Owns:** `components/bia/BiaChat.tsx`, `server/routes/support.ts`

Hold to talk; BIA gets text the customer has already checked.

Build
- [ ] A mic button (MediaRecorder: webm on Android, mp4 on iOS), 60 seconds at most.
- [ ] `POST /api/support/transcribe` (5 MB max, rate-limited) → OpenAI transcription on the same key.
- [ ] The transcript lands in the input box for the customer to edit and send. It's never sent automatically.

Done when
- [ ] Works on Android Chrome and iOS Safari
- [ ] The privacy filter runs on transcripts

Notes: —

#### 5.3 Hindi

**Status:** ⬜ · **After:** 1.5 · **Owns:** `server/supportPrompts.ts`

BIA answers in Hindi when the customer writes in Hindi.

Build
- [ ] Language rules in the base prompt: Devanagari in, Devanagari out; Hinglish stays Hinglish; names, addresses and codes stay unchanged.
- [ ] Hindi eval cases across the modules.

Done when
- [ ] Hindi evals pass; English and Hinglish evals are unchanged

Notes: —

## Log

Newest first. One line per merge, decision or surprise.

- 2026-09-11 · 1.3 merged: screen context (allow-listed), order/pickup/rate cards, one shared button registry. W4 (1.4, 1.5, 1.6) next.
- 2026-09-11 · 1.2 merged: 48 catalogued error codes (incl. payments), every message unchanged. Wave W2 done; W3 (1.3 screen context and cards) is next.
- 2026-09-11 · 1.1 merged: `npm test` (24 unit tests) and `npm run bia:eval` (20 cases, 20/20 × 3 runs). BIA chat now runs at temperature 0.2. Fixed a false "no pickup code yet" answer introduced in 0.1.
- 2026-09-11 · 0.2 merged into `bia-3/main`: support routes live in `server/routes/support.ts`. Wave W2 (1.1, 1.2) can start.
- 2026-09-11 · Integration branch renamed `bia-3` → `bia-3/main` (git won't allow `bia-3` next to `bia-3/wpX-Y`).
- 2026-09-11 · 0.1 done: BIA 2.0 committed on `aditya/final-phase` (not pushed), `bia-3/main` cut from it. 23/23 evals passing after three fixes.
- 2026-09-11 · Plan agreed. Chat actions limited to drafts and re-uploads; support cases get an ops Cases tab; guest chats kept on the server; built by Aditya plus Claude sessions.
