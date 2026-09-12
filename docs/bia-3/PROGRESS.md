# BIA 3.0 — build progress

The single place to see where the BIA 3.0 build stands.

- **Product plan:** https://claude.ai/code/artifact/85e67fff-def9-4adf-9fad-6e66dd0195f9
- **Build plan** (session briefs, hotspot rules, review checklist): https://claude.ai/code/artifact/70f68f82-7139-4bcd-8c61-f36311f60dd8
- **Branches:** package `0.1` lands on `aditya/final-phase`. Everything after it branches from `bia-3/main` (cut from `aditya/final-phase` once 0.1 is in). Each package gets `bia-3/wpX-Y` in its own worktree and a PR into `bia-3/main`. A release merges `bia-3/main` back into `aditya/final-phase`. (Git can't have a branch named `bia-3` alongside `bia-3/…` branches, hence `/main`.)
- **Checkouts:** your usual clone stays on `aditya/final-phase`. `../bia-worktrees/main` is the permanent `bia-3/main` checkout where this file is updated. Package worktrees go in `../bia-worktrees/wpX-Y`, with `node_modules` as a junction to the main clone's. Remove the junction (`rmdir`) before deleting a worktree, so the delete can't reach through it.

## How to update this file

- **Package sessions don't edit this file.** Several sessions run at once, and parallel edits to one table conflict. The orchestrating session (or Aditya) updates it on `bia-3/main` after each PR merges.
- Status: ⬜ not started · 🟡 in progress · 🔵 PR open · ✅ merged · ⛔ blocked · ⏭ skipped (dropped from the build; kept here for the record)
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
| [1.4](#14-bia-sheet-and-ask-bia) | BIA sheet and "Ask BIA" | R1 | W4 | L · 1.5 d | 1.3 | ✅ | `bia-3/wp1-4` → merged locally (ee48623) | 2026-09-11 |
| [1.5](#15-module-prompts-and-tool-registry) | Module prompts and tool registry | R1 | W4 | M · 1 d | 1.3 | ✅ | `bia-3/wp1-5` → merged locally (604f328) | 2026-09-11 |
| [1.6](#16-privacy-filter-telemetry-and-feedback) | Privacy filter, telemetry and feedback | R1 | W4 | M · 1 d | 1.3 | ✅ | `bia-3/wp1-6` → merged locally (ea55620); **migration not run** | 2026-09-11 |
| [1.7](#17-guest-chat-history) | Guest chat history | R1 | W5 | S · ½ d | 1.4, 1.6 | ✅ | `bia-3/wp1-7` → merged locally (4437aa4); **migration not run** | 2026-09-11 |
| [2.1](#21-account-matchmaker) | Account Matchmaker | R2 | W5 | M · 1 d | 1.5 | ✅ | `bia-3/wp2-1` → merged locally (5a50de9) | 2026-09-11 |
| [2.2](#22-signup-progress-and-document-status) | Signup progress and document status | R2 | W5 | M · 1 d | 1.5 | ✅ | `bia-3/wp2-2` → merged locally (ad43d6c) | 2026-09-12 |
| [2.3](#23-verdict-explainer-on-the-upload-screens) | Verdict explainer on the upload screens | R2 | W5 | S · ½ d | 1.2 | ✅ | `bia-3/wp2-3` → merged locally (f8e6870) | 2026-09-12 |
| [2.4](#24-photo-check-before-upload) | Photo check before upload | R2 | — | M · 1 d | 2.3 | ⏭ | — | skipped 2026-09-12 |
| [2.5](#25-upload-card-inside-the-chat) | Upload card inside the chat | R2 | W6 | M · 1 d | 2.2, 2.3 | ✅ | `bia-3/wp2-5` → merged locally (b9b235b) | 2026-09-12 |
| [3.1](#31-booking-context-and-error-explainer) | Booking context and error explainer | R3 | W6 | M · 1 d | 1.4, 1.5 | ✅ | `bia-3/wp3-1` → merged locally (1c085e4) | 2026-09-12 |
| [3.2](#32-hsn-helper) | HSN helper (suggests, never fills) | R3 | W7 | M · 1 d | 3.1 | ✅ | `bia-3/wp3-2` → merged locally (8d82361) | 2026-09-12 |
| [3.3](#33-drafts-and-say-it-to-ship) | Drafts and "say it to ship" | R3 | — | L · 2 d | 3.1 | ⏭ | — | skipped 2026-09-12 |
| [3.4](#34-restricted-items-waits-on-content) | Restricted items (waits on content) | R3 | W6 | S · ½ d | 1.5 | ✅ | `bia-3/wp3-4` → merged locally (de6d190); lists wait on Bombino | 2026-09-12 |
| [4.1](#41-support-cases) | Support cases | R4 | — | M · 1 d | 1.3, 1.7 | ⏭ | built (8010748), then removed (ab0c9b5) | dropped 2026-09-12 |
| [4.2](#42-ops-cases-tab) | Ops Cases tab | R4 | — | L · 1.5 d | 4.1 | ⏭ | built (9cbd194), then removed (ab0c9b5) | dropped 2026-09-12 |
| [4.3](#43-customer-side-of-cases-order-page-links) | Order-page links (the case half dropped) | R4 | W8 | M · 1 d | 3.1 | ✅ | `bia-3/wp4-3` → merged locally (9556c0c); case half removed (ab0c9b5) | 2026-09-12 |
| [5.1](#51-nudges) | Nudges | R5 | W8 | L · 1.5 d | 1.4, 2.2 | ✅ | `bia-3/wp5-1` → merged locally (8e690f4); **migration not run**, scheduler not pointed | 2026-09-12 |
| [5.2](#52-voice-notes) | Voice notes | R5 | — | M · 1 d | 1.4, 1.6 | ⏭ | — | skipped 2026-09-12 |
| [5.3](#53-hindi) | Hindi | R5 | — | S · ½ d | 1.5 | ⏭ | — | skipped 2026-09-12 |

**18 packages (6 more skipped) · 16.5 dev-days · 9 waves.** 18 merged. **Build complete**; going live is the nudges migration (done), the scheduler and a merge into `aditya/final-phase`.

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
| W6 | 2.5 · 3.1 · 3.4 · 4.1 | 4 in parallel — **R2 can go live once 2.5 merges** |
| W7 | 3.2 · 4.2 | 2 in parallel — **R3 can go live once 3.2 merges** |
| W8 | 4.3 · 5.1 | 2 in parallel — **R4 and R5 can go live once 4.3 and 5.1 merge** |

2.4, 5.2 and 5.3 were dropped on 2026-09-12. That moved 2.5 up to W6 (it no longer waits on a photo check) and removed W9. Later that day 3.3 went too (BIA helps on the screens and never fills a form), which moved 3.2 up to W7.

## Releases

Modules ship dark and go live by adding them to `BIA_MODULES` in production.

| Release | Name | Exit | Live in prod |
|---|---|---|---|
| R0 | Ship BIA 2.0 | Evals pass; nothing leaks; support routes live in their own file. | ⬜ |
| R1 | Foundations | Any catalogued error opens BIA already explaining it; evals and telemetry run on every change. | 🔵 code complete on `bia-3/main`; needs the two R1 migrations, then a merge into `aditya/final-phase` |
| R2 | Onboarding and documents | Every OCR verdict has a tested explanation; a document can be retaken from chat. | 🔵 code complete on `bia-3/main` (2.1, 2.2, 2.3, 2.5); goes live with `BIA_MODULES=orders,onboarding,documents` after a merge into `aditya/final-phase` |
| R3 | Booking help | BIA explains every step, error and term on the booking form, answers "can I send this?" only from Bombino's lists, and suggests HSN codes. It never fills or submits the form. | 🔵 code complete on `bia-3/main` (3.1, 3.2, 3.4); goes live with `booking` in `BIA_MODULES` after a merge into `aditya/final-phase` |
| R4 | Order-page links | When BIA talks about cancelling, a handover code or paying, its button opens that spot on the order page; the customer presses the real button. (Support cases and the ops Cases tab were dropped.) | 🔵 code complete on `bia-3/main` (4.3); goes live with `orders` after a merge into `aditya/final-phase` |
| R5 | Proactive | Nudges are capped and switchable. (Voice and Hindi were dropped.) | 🔵 code complete on `bia-3/main` (5.1); migration run 2026-09-12; needs the daily scheduler call and a merge into `aditya/final-phase` |

## Migrations

Sessions write them; Aditya runs each in Supabase before its package merges.

| File | WP | Written | Run in Supabase |
|---|---|---|---|
| `migrations/create_bia_turns.sql` | 1.6 | ✅ | ✅ 2026-09-11 |
| `migrations/support_sessions_guest_ref.sql` | 1.7 | ✅ | ✅ 2026-09-11 |
| ~~`migrations/create_bia_drafts.sql`~~ | 3.3 | ⏭ not needed | — |
| ~~`migrations/create_support_cases.sql`~~ | 4.1 | ✅ then removed | ✅ 2026-09-12, before cases were dropped |
| `migrations/drop_support_cases.sql` | cases dropped | ✅ | ⬜ optional: the table is empty and nothing uses it |
| `migrations/create_bia_nudges.sql` | 5.1 | ✅ | ✅ 2026-09-12 |

## Waiting on people

- [ ] **Bombino content:** restricted items per destination (US, UK, UAE, Canada, Australia first), the volumetric weight rule per service, packing charges by box size, the support WhatsApp number and hours, typical time at each order stage. Needed by 3.4 and 4.1.
- [ ] **Test identities for evals:** one account per category (personal, corporate, co-courier, e-commerce, FBB), a guest with orders (`9000000091`), a half-finished signup. Check `docs/test-accounts.md` for free numbers first. Needed by 1.1.
- [x] ~~**Sample document photos**~~ No longer needed: 2.4 was dropped.
- [ ] **Scheduler:** point the external scheduler at `POST /api/admin/bia/nudges/sweep` with the retention-sweep secret. Needed by 5.1.

## Follow-ups

Found along the way; not a package yet. Give one a number and a row above when it's picked up.

- [ ] **Resume signup at the documents step** (from 2.2). "Continue signup" opens the right form on the details step. Signup keeps no form state on the server, so a true resume means saving it (for a guest, the guest profile already covers the details). Touches `Signup.tsx` and the signup routes.
- [x] ~~**`skipped` on Profile** (for 2.3).~~ Not a real case: `skipped` only comes from slots nothing reads or an identity slot with no number, which the number-first rule prevents. See 2.3's notes.
- [ ] **KYC card says "In review" for a document with no verdict.** `KycOnFileCard` treats a missing `ocr_status` as "In review", while BIA's `get_my_kyc_status` calls the same row verified. Legacy rows only, but "in review" is wording the KYC rule says customers never see. One-line fix in `KycOnFileCard.tsx` (outside 2.3's files).
- [x] ~~**Old eval flakes.**~~ `brief-02` fixed in 2.5 (counters' areas only), `anon-07` in 3.1 (tracking needs no sign-in).
- [ ] **Tool buttons can be dropped.** When the model writes a different button, or none, a tool's own button can go missing (seen once in `docs-02`: TAP_RESUME_SIGNUP, 9/10). Error buttons are already kept (1.4); do the same for a tool's primary button.

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

**Status:** ✅ · **After:** 1.3 · **Owns:** `pages/Support.tsx → components/bia/BiaChat.tsx`, `pages/Signup.tsx (error links)`, `pages/CreateShipment.tsx (error links)`

BIA opens over any screen, already knowing the screen and the error, instead of only on /help.

Build
- [x] Extract the chat UI into `components/bia/BiaChat.tsx`; `/help` becomes a thin page around it.
- [x] `components/bia/BiaSheet.tsx` (Radix Sheet) and a small zustand store: `openBia({ screen, seed })`.
- [x] An `askBia(err, screen)` helper built on `parseApiErrorCode`. "Ask BIA" links beside errors on signup, the documents step, guest verification and booking submit (plus document OCR notes and the booking form's identity upload).
- [x] The support button opens the sheet for the current screen; `/help` still works.
- [ ] Thumbs up/down under each reply → **moved to 1.6**, which builds the endpoint; no dead UI in the meantime.
- [ ] "Ask BIA" links only show when that surface's module is on in `BIA_MODULES` → **moved to 1.5**, which creates `BIA_MODULES`. Until then the links always show, and every error is explained through the SCREEN block regardless of modules.

Done when
- [x] From a booking error, BIA's first reply explains that error (evals `ask-01`…`ask-04`, `screen-03/04`; by hand in Chrome)
- [x] The sheet works at 375px and on desktop; focus is trapped and Escape closes it (Chrome at 561px and 1875px; Radix focus trap, Escape verified)
- [x] Account history on `/help` is unchanged (same restore path; the sheet shows the same conversation)

Notes: The Order page's "Ask BIA" and the mobile Home pill also open the sheet; the desktop sidebar still goes to the `/help` page. The browser check found three things, all fixed: the support button drew on top of the sheet and covered Send (now hidden while BIA is open); card borders used `border-white/12`, which this Tailwind build doesn't generate; rate replies repeated the card, so they now give the best value in a sentence. A reply to "Ask BIA" about an error now keeps that error's button even if the model drops it (1 in 3 runs had). Test on `127.0.0.1:5001`, not `localhost`, to keep your `localhost:5000` session cookie. 62 unit tests; 29/29 evals × 3.

#### 1.5 Module prompts and tool registry

**Status:** ✅ · **After:** 1.3 · **Owns:** `server/supportAgent.ts`

Keep gpt-4o-mini accurate as BIA grows: a short base prompt plus one module per surface, each bringing only its own tools.

Build
- [x] `server/supportPrompts.ts`: base rules (guardrails, style, language) plus modules for orders, onboarding, documents and booking.
- [x] A tool registry: each module file exports its tool definitions and executors, and `supportAgent.ts` assembles them per turn from the screen and identity. Later packages add tools without touching `supportAgent.ts`. (`GENERAL_TOOLS` in the new `supportGeneral.ts`, `ORDER_TOOLS` in `supportOrders.ts`, gathered by `supportTools.ts`; the `BiaTool` type is in `supportTypes.ts`.)
- [x] `BIA_MODULES` env switch; modules not listed are never offered, and never run even if the model names them. Documented in `.env.example`.
- [x] The orders module is today's tools. Rates, tracking, pickup and guidance stay available everywhere.

Done when
- [x] Every 2.0 eval still passes (31/31 × 3 with all modules; 31/31 × 2 with `--modules orders`, the production default)
- [x] The system prompt on `/help` is no longer than today's (identical at 6,257 characters with the default modules; the eval header logs it)

Notes: `supportAgent.ts` is 203 lines, down from 890. Four behaviour changes the evals forced: signed-out customers aren't offered order tools (5,146-char prompt, 6 tools); the how-to rule leads WHICH TOOL again; one order is answered in two to four sentences (new `brevity.json` cases with `maxChars`); guests aren't told about cancelling unless they ask. Delivery estimates moved to the general part, since tracking an AWB works for anyone. **Decision (from 1.4):** "Ask BIA" error links are not gated by module. Explaining an error comes from the error catalog and works with any modules on, so gating it would only hide a finished R1 feature. **For you:** locally `BIA_MODULES` is unset, so only orders is on; add `BIA_MODULES=orders,onboarding,documents,booking` to `.env` to try the rest as it lands. Runner: `npm run bia:eval -- --modules orders` tests exactly what production runs.

#### 1.6 Privacy filter, telemetry and feedback

**Status:** ✅ · **After:** 1.3 · **Owns:** `server/routes/support.ts` · **Migration:** `create_bia_turns.sql`

Know how BIA is doing, and keep ID numbers away from OpenAI and out of transcripts.

Build
- [x] `server/supportPrivacy.ts`: masks Aadhaar and PAN, and named bank account numbers, before the model call and before storage. Unit tests. **Changed from the plan:** no blanket "long digit run" rule, because a 12-digit number is as often an AWB. An Aadhaar is recognised by the card's 4-4-4 grouping or the word "Aadhaar" nearby, then masked whatever its check digit says.
- [x] `bia_turns`: owner kind, surface, tools, latency, fallback, prompt and completion tokens, rating. Written after each turn, never delaying the reply. No message text.
- [x] `POST /api/support/feedback { turnId, rating }`; chat responses include `turnId`. Plus the thumbs UI moved here from 1.4.

Done when
- [x] Test: "my aadhaar is 1234 5678 9012" reaches the model as "••••9012" (unit test; and over HTTP, the stored transcript reads "••••9012")
- [ ] Turn rows appear for account, guest and signed-out chats → **waiting on the migration**. The chat still works before the migration runs: verified, and the server logs one clear line (`[bia] could not record a turn: … has migrations/create_bia_turns.sql been run?`).

Notes: **For you:** run `migrations/create_bia_turns.sql` in Supabase, then one chat each as account, guest and signed-out should leave three rows, and a thumb sets `rating`. The repeated evals also caught two ~1-in-8 flakes, both fixed: a flat refusal with no lookup when asked for a pickup code (the rule now says look it up), and `list_my_orders` used for a named Order ID (its description now says not to). The prompt-size guard is now an explicit budget, 6,270; the default prompt is 6,264, 7 over 2.0. 84 unit tests; 31/31 evals ×3 with all modules, ×2 with the production default.

#### 1.7 Guest chat history

**Status:** ✅ · **After:** 1.4, 1.6 · **Owns:** `server/routes/support.ts`, `components/bia/BiaChat.tsx` · **Migration:** `support_sessions_guest_ref.sql`

A guest's conversation follows their verified phone, the way an account's does.

Build
- [x] Read the live `support_sessions` shape first; the repo has no migration for it. Add a nullable `guest_ref`, an owner check and an index. (Live columns recorded in the migration's header.)
- [x] Session helpers and the ownership check accept a guest owner; the chat route stores guest transcripts. `/session` and `/new-session` serve verified guests too.
- [x] `BiaChat` loads guest history from the server, with `sessionStorage` only as a fallback. It waits for the guest check to settle first, so an "Ask BIA" question can't overwrite a saved conversation from the tab's copy.
- [x] When a guest opens an account, their sessions move over with the claim, as notifications do.

Done when
- [ ] Guest history survives a new tab and a second device after OTP → **after the migration**; the code path mirrors the account one and is reviewed, but can't be exercised until the column exists.
- [x] A guest can't load another guest's session (ownership check by `guest_ref`; over HTTP a guest sending an account's session id doesn't get it)

Notes: Before the migration it fails soft: guests chat as before with the tab's history, the server answers "no session", and each guest turn logs a `support_sessions.guest_ref does not exist` line until it runs. Account sessions unchanged (forged ids still ignored). A guest who chatted but never booked has no orders, so their conversation isn't claimed when they open an account. Harmless, but known.

### R2 · Onboarding and documents

#### 2.1 Account Matchmaker

**Status:** ✅ · **After:** 1.5 · **Owns:** `pages/Signup.tsx`

Answer "which account do I need?" from a fixed decision table, with the exact document list.

Build
- [x] `shared/accountMatch.ts`: answers (for a business, sells online under LUT, is a courier, stock held by Bombino) → personal, corporate, co_courier, ecommerce or fbb. Unit tests for every path.
- [x] Onboarding tools: `recommend_account` (a checklist card from `requiredDocuments`, `requiredExtraFields` and `DOC_SLOT_SPECS`) and `explain_term` (GSTIN, IEC, LUT, AD code, IEC branch code, authorization letter, plus PAN).
- [x] Signup reads `?category=` and preselects it; a SIGNUP button kind (`TAP_SIGNUP:<kind>`, for anyone without an account).
- [x] The guest-or-account answer comes from the guidance content (`supportContent`).

Done when
- [x] Every category's checklist equals `requiredDocuments` plus `requiredExtraFields` (test)
- [x] Eval: the Etsy-seller prompt → E-commerce, the right list, and a working button (`onboard-01`; all five onboarding cases 3/3 in the 2.2 session's full run)

Notes: Cards got a shared `biaCardKey` so new kinds dedupe correctly. The eval runner learned `requires` (a case needing a module that's off is skipped, not failed) and retries a turn that hit the rate limit. The status board wasn't updated when it merged; done with 2.2.

#### 2.2 Signup progress and document status

**Status:** ✅ · **After:** 1.5

BIA can say where a signup, or an account's documents, stand without asking.

Build
- [x] `get_signup_progress`: from the session's `signupRef`, via `listIdentityVerificationsBySignupRef` and `listDocumentsBySignupRef`: numbers recorded (last four only), slots uploaded with verdicts, slots still missing. (`server/supportDocuments.ts`; the ref reaches BIA only while `signupPhone` is set, the same binding as `signupRefForReading`.)
- [x] `get_document_status` for accounts. **Changed:** reads `getAccountShapeById` + `listDocumentsByUserId` and summarises with the same code as signup, instead of `getVerificationState`, so both scopes say the same thing.
- [x] docStatus card, `TAP_RESUME_SIGNUP` (an account kind, or `company`) and `TAP_ACCOUNT_DOCUMENTS` (Profile `#documents`). Neither button is offered on the screen it points at.
- [x] `bypassed` and `skipped` read as on file, with no verification talk; only `match` says it matched.

Done when
- [x] Eval: a half-finished E-commerce signup → "3 of 4 uploaded, the GST certificate needs a clearer photo, the authorization letter still to come" (`docs-01`; the plan's "4 of 6" predates the real E-commerce list, which is 4 documents)
- [x] No reply carries more than four digits of an ID number (staged numbers join the eval's forbidden list; unit tests on the summary)

Notes: Signup now tells BIA which account is being opened (screen `account`, signup only, allow-listed) and publishes its step, so the support button opens BIA on the right step. **Known limit:** "Continue signup" opens the right form on the details step, not the documents step: signup keeps no form state on the server, so the details and the phone check come again, and the staged documents are waiting once they're back. Checked in headless Chrome at 390px and 1440px (2026-09-12): card, "My documents" landing on Profile's `#documents` (it now clears the sticky header with `scroll-mt-20`), and "Continue signup" landing on details with the guest's name, email and phone already filled. Verified over HTTP on `127.0.0.1:5001`: an account gets its card and the button only off the documents screen; guest 9000000091 gets its real signup rows (Aadhaar on file, PAN to upload, no digits); a number that has verified but staged nothing yet is told nothing is recorded, not sent to the Ship screen (first wording did that; fixed). `finalizeReply` also drops the ": BOM-…" a token leaves when written with a space after its colon (the 0.1 edge case). **Also fixed:** `supportTelemetry.test.ts` was writing to the shared database when the Supabase keys are in the shell (they are on this machine), and failed once `bia_turns` existed; it clears them now. 107 unit tests; 41 evals ×3 with all modules (two one-off flakes, `anon-07` and `brief-02`, each then 5/5), 31/31 ×2 with `--modules orders`.

#### 2.3 Verdict explainer on the upload screens

**Status:** ✅ · **After:** 1.2 · **Owns:** `AccountDocuments.tsx`, `KycUpload.tsx`

Each OCR verdict shows one explanation and one fix, the same on the upload screen as in BIA.

Build
- [x] `shared/ocrExplain.ts`: verdict (plus a changed GSTIN, number-entered-first, an outdated upload and a row with no verdict) → headline, why, fix, button and the retry control's label, built on the error catalog.
- [x] `AccountDocuments.tsx` and `KycUpload.tsx` show it instead of the raw note, with "Ask BIA" beside it (`components/DocumentIssueNote.tsx`: red when refused, amber when kept but unchecked).
- [x] Documents tool: `explain_document_issue`, for a message the customer quotes or the one on screen, saying where to replace the file.

Done when
- [x] Tests cover all eight `OcrStatus` values (and a test reads `server/cashfreeOcr.ts`, so the shared list can't drift from the union)
- [x] Nothing appears for `match` or `bypassed` (nor `skipped`)

Notes: **Fixed along the way:** the retry control said "Upload a clearer photo" even for an outage, which the explanation itself says isn't a photo problem; it now follows the verdict ("Try again", "Upload the right document", …). Rows loaded from the server had no error code, so "Ask BIA" on them didn't know the problem. Client-side errors (file type, size, a number that wouldn't save) left the previous code in place, which would have shown an earlier refusal's explanation instead of "Only PDF, JPEG, or PNG files are accepted." `get_signup_progress` and `get_document_status` now word problems through `ocrExplain`, and a checked document with no verdict reads as needing attention, as the screen already asks for it again. **`skipped` (the follow-up from 2.2):** only produced for a slot nothing reads (bills, IEC) or an identity slot uploaded without a number, which the number-first rule prevents, so Profile and BIA can't actually disagree over it; nothing changed. Checked in headless Chrome at 390px with mocked upload responses (nothing reached Cashfree or the database): unreadable and no-verdict rows on Profile, a wrong-document refusal and an outage on the identity replacement box, a `.txt` right after a refusal, and "Ask BIA" answering in the screen's words. 118 unit tests; 44 evals ×3 with all modules and 32 ×2 with `--modules orders`: everything new passes; the two old flakes are logged under Follow-ups.

#### 2.4 Photo check before upload

**Status:** ⏭ skipped (2026-09-12, Aditya's call) · **After:** 2.3 · **Owns:** `AccountDocuments.tsx`, `KycUpload.tsx`

Catch blurry, glary or tiny photos on the phone before they cost a Cashfree call. *Dropped: 2.3's explanations already say what a retake needs, and 2.5 uploads without this check. The plan is kept below in case it comes back.*

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

**Status:** ✅ · **After:** 2.2, 2.3 · **Owns:** `components/bia/BiaChat.tsx`

The first chat action: retake and re-upload a document without leaving BIA.

Build
- [x] A docUpload card for one slot, posting to the endpoint that screen uses: `/api/account/documents` for an account, `/api/kyc/upload` for a guest. Each endpoint authorises the caller itself. **Changed:** no `/api/signup/documents` from chat. That endpoint needs the full phone and an OTP under ten minutes old, which a chat can't supply, so for a signup BIA points to signup's documents step instead.
- [x] Shows the verdict explanation from `ocrExplain` after the upload. (No photo check: 2.4 was dropped.)
- [x] Marked as coming from BIA in telemetry: `POST /api/support/upload-outcome` adds `chat_upload:<uploaded|unchecked|refused|failed>` to the offering turn's `tools` (owner-checked, no new column).

Done when
- [x] A re-upload from chat updates the same slot the screen shows (Profile re-reads its list on `bia:documents-changed`, and the KYC and verification queries are invalidated; seen in Chrome, the PAN slot showing the new file with the sheet closed)
- [x] A guest without a verified phone is refused by the endpoint, and the card explains why (real `401` from `/api/kyc/upload` with the session dropped; the card says the phone check is gone and offers Ship)

Notes: The tool is `offer_document_upload` (documents module); it writes nothing, the card is the customer's tap. **No whole ID number passes through BIA:** a card carries at most the last four; for an account the number on file is read from its own document list at upload time, and when there is none (or for a guest) the customer types it on the card, from where it goes straight to the upload. **Fixed along the way:** (1) the app-wide 401 handler took `/api/kyc/upload`'s 401 (a guest with no verified number) for an expired session and sent the guest to the login screen mid-upload. That also happened on the booking form's own identity upload. `/api/kyc/upload` joins `NOT_AN_EXPIRY` in `client/src/lib/session.ts`, with a test. (2) The longer prompt pushed `brief-02` from 8/8 to 5/8, because for a drop-off order the model read out both counter addresses. The order tool now asks for the areas only, since the Locations button has the addresses; it's 8/8 with all modules and 4/4 with orders only. **Touched outside its files:** `server/routes/support.ts` (4.1's in W6) for the telemetry route, plus `session.ts`, `AccountDocuments.tsx` (a refresh listener, account endpoint only) and `supportOrders.ts`. That's harmless while packages are built one at a time. **Known limit:** a restored transcript keeps text, not cards, so an old "use the card below" reply comes back without its card (the 1.3 limit, now more visible). Checked in headless Chrome at 390px with the account's upload POST mocked (nothing written to the shared DB): a refusal explained with the right retry label, then an upload, the Profile slot refreshed, and both outcomes logged against the turn. 124 unit tests; 47 evals ×3 with all modules (one one-off, `anon-03`, then 8/8 here and on main) and 32/32 ×2 with `--modules orders`.

### R3 · Booking Copilot

#### 3.1 Booking context and error explainer

**Status:** ✅ · **After:** 1.4, 1.5 · **Owns:** `pages/CreateShipment.tsx`

BIA inside Create Shipment knows the step and what went wrong.

Build
- [x] `CreateShipment` publishes { surface: create, step (`payment` while the pay sheet is open), destination, productType } with `usePublishBiaScreen`, so the support button and every "Ask BIA" on the form carry it; errors add their code. "Ask BIA about this step" in the mobile and desktop headers; the submit-error links now pass a code (the form's own checks gained `PICKUP_DATE_REQUIRED` and a new catalogued `PRODUCT_TYPE_REQUIRED`).
- [x] Booking module (`server/supportBooking.ts`): `explain_booking_error` (every catalogued booking and payment code) and `explain_booking_term` (the four product types, declared value, currency, unit rate, IGST, plus a `product_types` overview for "which one do I pick"). `PRODUCT_TYPE_INFO` moved to `shared/bookingTerms.ts`; the form's info sheet reads it from there.

Done when
- [x] An eval per booking error code: cause, fix and the right button (`book-01`…`book-06` for the six not already covered; `KYC_REQUIRED`, `PAY_AT_PICKUP_NEEDS_PICKUP` and `PICKUP_PINCODE_NOT_SERVICEABLE` were covered by `ask-*`/`screen-*`). They run without the booking module too, since an error on screen is explained from the catalog.
- [x] No ID number or address in the screen payload (`parseBiaScreen` keeps only `destination` and `productType` on the booking form, a real country other than India and a known type, and drops names, addresses, phones and numbers (tested). In Chrome the chat request's `screen` was `{"surface":"create","step":"sender","destination":"US"}`.)

Notes: **Added:** a per-step guide in the SCREEN block (`BOOKING_STEP_GUIDE`). Asked "what do I do here" on the sender step, BIA had made up a field ("enter the counter's address"). The guide steps aside when an error is on screen: next to an error it made "what does this mean?" read as a question about the step, and `screen-03` dropped to 2/10 (10/10 after). **Prompt budget:** with the new tools, a signed-out "track <AWB>" was told to sign in 3 runs in 3 (`anon-07`, the old flake). `get_tracking_summary` now says it needs no sign-in (8/8), and the default prompt's budget went from 6,270 to 6,300 on purpose for that line. Checked in headless Chrome at 390px and 1440px: the header link opens BIA with a step seed, the reply is about that step, and no errors. 130 unit tests; 58/58 evals ×3 with all modules and 39/39 ×2 with `--modules orders`.

#### 3.2 HSN helper

**Status:** ✅ · **After:** 3.1 · **Owns:** `pages/CreateShipment.tsx (HSN field: an "Ask BIA" link only)`

Suggest HSN codes; the customer types the one they choose. **Changed 2026-09-12:** BIA never fills a form field, so there is no "Use this code" button.

Build
- [x] Move the lookup in `client/src/lib/hsnData.ts` to `shared/hsn.ts` so the server can use it (`git mv`; the form's two importers follow).
- [x] `suggest_hsn(description)` (`server/supportHsn.ts`, booking module): an item typed as an entry is a sure match; anything else goes to gpt-4o-mini with the numbered list, and only real entries come back (word matches stand in if it can't answer). Codes are the ones the form fills (`getHsnCode`).
- [x] An hsn card listing up to three entries and their codes, with "Exact" or "Closest". The customer chooses in "Shipment Content" themselves. Plus "Ask BIA" beside that field and the CSB V HS code.

Done when
- [x] Eval: turmeric powder, cotton kurta, brass idol → sensible candidates; an unknown item → "check with our team" (`hsn-01`…`hsn-05`, 5/5 ×4; turmeric is on the list as TURMERIC POWDER 09103030)
- [x] Nothing BIA sends changes a form field (the card has no button; the links only open BIA)

Notes: **The list's codes are 8 digits** and CSB V's form asks for 10, so on a CSB V booking BIA says the full code comes from the shipping bill or our team (an "Important:" line; the model dropped it 3/3 without). **List quality:** SPICES appears twice with different codes (13019044 and 91099900, the second a clock-parts heading); BIA gives the one the form fills, the first. Worth a look by whoever owns `shared/hsn.ts`. The first pick prompt was too strict ("small brass idol of Ganesha" got "nothing fits"); it now takes the closest reasonable entries and says none only for things like live animals. Checked in Chrome from a mocked reply (the card). 151 unit tests; evals 38/40 ×2 on `--modules orders` (`account-10` a matcher, widened; `guest-18` 7/8 vs 8/8 on main with an identical prompt, so noise) and every other miss with all modules was the rate limit.

#### 3.3 Drafts and "say it to ship"

**Status:** ⏭ skipped (2026-09-12, Aditya's call) · **After:** 3.1 · **Owns:** `pages/CreateShipment.tsx (new hook)`, `server/routes/bia.ts` · **Migration:** `create_bia_drafts.sql` (not needed)

The second chat action: one sentence becomes a pre-filled booking the customer checks and submits. *Dropped: BIA helps on the screens and doesn't ship anything or fill a form for the customer. Re-uploading a document (2.5) is its only chat action. The plan is kept below for the record.*

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

**Status:** ✅ (code; the lists wait on Bombino) · **After:** 1.5

Answer "can I send this?" only from Bombino's own list.

Build
- [x] A loader for `content/bia/restricted/<CC>.md` (plus `ALL.md` for every destination) and `can_i_ship(item, country)` in the booking module (`server/supportRestricted.ts`). The file format is in `content/bia/restricted/README.md`: one table, Item | Also called | Rule.
- [x] Found → the rule as written. Not found, or no file → "our team will confirm before you book" and the contact button. Never a guess.

Done when
- [x] With no content files, every answer is "check with our team" (`rest-01`…`rest-04`, 4/4 ×4; plus a unit test with no folder at all)
- [x] Switches on once Bombino's lists land (unit tests on a fixture folder; end to end with a temporary `US.md`, BIA gave the power-bank rule, then the file was removed). Lists are re-read within a minute; no restart.

Notes: Matching is whole words on the item or its other names, with plurals folded (battery/batteries, mango/mangoes). Several matches show up to three rules; the rule's own wording decides. The country comes from the question (names, codes, "USA", "UK", "Dubai") or the booking form's destination; India gets "we ship from India to other countries", and a list name can't reach outside its folder. **Deploy:** `content/bia/restricted/` is read from the server's working directory, so production must ship that folder next to `dist/`. **For Bombino:** send the lists in the README's table format, one per destination (US, UK, UAE, Canada, Australia first). 137 unit tests; 62 evals ×3 with all modules (one miss, `docs-02`'s resume button, then 9/10; see Follow-ups) and 39/39 ×2 with `--modules orders`.

### R4 · Handoff

*Support cases were dropped on 2026-09-12 (Aditya's call: no cases, and no ops replying to customers), after 4.1 and 4.2 had been built and merged. Commit ab0c9b5 removed them, with 4.3's case half. Escalating shows the WhatsApp and call buttons, as before. The plans below are kept for the record.*

#### 4.1 Support cases

**Status:** ⏭ dropped 2026-09-12 (built, then removed in ab0c9b5) · **After:** 1.3, 1.7 · **Owns:** `server/routes/support.ts` · **Migration:** `create_support_cases.sql` (run, then undone by `drop_support_cases.sql`)

Handoff that actually reaches someone: an escalation becomes a case ops can see.

Build
- [x] `support_cases` (`migrations/create_support_cases.sql`, written, **not run**): case number from a sequence (BIA-1001 onwards), owner (account or guest, never nobody), order, category, summary, transcript snapshot, status (open, answered, closed), ops reply, answered/closed times, the turn that opened it.
- [x] `escalate_support` opens a case (one open case per owner and order in 24 hours; asking again finds it), writes a three-line summary with a strict prompt (a plain fallback when the model can't be reached), and returns a case card plus a WhatsApp button with the case number already in the message (`TAP_CASE_WHATSAPP`, kept only for a case the same turn opened).
- [x] The escalation copy changes to match: with `handoff` on, the hard rule "never say you escalated" becomes "a case our team can see; never promise when they'll reply or what they'll decide".

Done when
- [x] Eval: a damaged-parcel complaint → case opened, the summary names the order, no promised callback time (`case-01`, which checks the in-memory case's order, category and summary)
- [x] Repeating the complaint doesn't open a second case (`case-02`, `{ count: 1 }`; unit test on the store)

Notes: **Dark behind a new module, `handoff`:** `escalate_support` is a general tool that's live today, and "our team can see this conversation" would be false until ops have the Cases tab (4.2), so cases only open with `BIA_MODULES` including `handoff`. Off, escalating is exactly what it was (`case-05` checks). Signed-out visitors get the buttons either way, and a case names an order only after `findOrderForOwner` proves it's theirs. **To switch on (R4):** run the migration, ship 4.2 and 4.3, then add `handoff` to `BIA_MODULES`; until the migration runs, escalating logs `[bia] could not open a support case…` once and falls back to the buttons. **Storage** is behind `CaseStore`: the eval runner gives each case run its own in-memory store (AsyncLocalStorage, since runs go four at a time), and the unit tests clear the DB and OpenAI keys first, so nothing reached the shared database. **Fixed along the way:** asking for a person sometimes got "use the WhatsApp or call buttons" with no buttons (7/8 before, and 0/8 once this package reworded the tool description); a request for a person now always leaves with `TAP_CONTACT_US` when the reply has no other button: 8/8 in all four module configs. Case card and the prefilled WhatsApp link were checked in Chrome from a mocked reply (the real path needs the migration). 145 unit tests; evals 40/40 ×2 with `--modules orders`, and with all modules ±`handoff` every miss was OpenAI's rate limit.

#### 4.2 Ops Cases tab

**Status:** ⏭ dropped 2026-09-12 (built, then removed in ab0c9b5) · **After:** 4.1 · **Owns:** `server/routes/opsCases.ts` (new), `client/src/lib/opsNav.ts`

Ops can read a case and reply in one place.

Build
- [x] `GET /api/ops/cases` (filter by open, answered, closed), `GET /api/ops/cases/:id`, `POST …/reply`, `POST …/close`, behind the same role guard as the other ops routes.
- [x] `pages/ops/OpsCases.tsx` and `OpsCaseDetail.tsx`: summary first, transcript below, order link, reply box.
- [x] An `OPS_NAV` entry (in the More sheet on mobile).
- [x] A reply writes a bell notification for the owner via `insertNotification`, with `data.kind` set to support_case.

Done when
- [x] Customers and riders can't reach `/api/ops/cases` (`server/routes/opsCases.test.ts`: 401 signed out, 403 customer and rider, on all four routes)
- [ ] A reply reaches the customer's bell on the next refresh — written, not seen end to end: needs the migration

Notes: **Additive, to stay out of the ops console's lane:** the routes are a new `server/routes/opsCases.ts` (one `registerOpsCaseRoutes(app)` line in `routes.ts`, after `registerOpsRoutes`), queries in `server/supportCasesOps.ts`, pages and `hooks/useOpsCases.ts` new; `routes.ops.tsx` and `opsNav.ts` gain two routes and one entry. Nothing in `routes/ops.ts` changed. **Before the migration** every route answers 503 `CASES_NOT_SET_UP` (listed in `UNCATALOGUED_CODES`: staff only) and the tab says "Cases aren't set up yet" with what to run. **The reply notification** uses type `support_case` and falls back to `order_status` if the notifications type check rejects it; `data` is `{ kind: "support_case", caseNo, caseId }`, which 4.3's bell item keys on. A closed case refuses replies (409); there's no reopen. The detail page shows the customer's name and phone (account cases, via `itd_users`) and links the order to `/ops/orders/:id` when `order_no` resolves. Checked in Chrome at 1280 and 390 from mocked responses: queue, status filter, detail, empty-reply guard, reply → "Answered" with the sent reply shown. 156 unit tests.

#### 4.3 Customer side of cases, order-page links

**Status:** ✅ order-page links; the case half (bell → BIA with ops' reply, `get_support_case`) removed in ab0c9b5 · **After:** 3.1 · **Owns:** `pages/Notifications.tsx`, `pages/OrderDetails.tsx`, `components/bia/BiaChat.tsx`

Close the loop for the customer, and send the actions that stay off chat to the right spot on the order page.

Build
- [x] A case bell item opens BIA with the case and ops' reply at the top.
- [x] Anchors on the order page: `#cancel`, `#handover-code`, `#pay`. VIEW_ORDER buttons can carry the section.
- [x] BIA's answers about cancelling, a new code or paying link to those anchors.

Done when
- [x] Eval: "cancel my order" → explains and links to `#cancel`; never runs it (`account-17`, plus `account-18` for the code and `account-19`: a plain status question gets the plain button)
- [x] Bell → BIA shows ops' reply (`case-06`/`07`/`08` with staged cases; the bell checked in Chrome from a mocked notification)

Notes: **Order-page links are live with `orders`** (no new module): `TAP_VIEW_ORDER:BOM-…#cancel` (also `#handover-code`, `#pay`), checked on the order number, drawn as the order button with "Request cancellation on the order page" / "See the code on the order page" / "Pay on the order page", and followed by `navigateInApp`, which now waits up to 5 s for the section (the order page waits on its fetch) and outlines it briefly. `get_order_status` offers a section only when the order page shows it (`orderPageLinks`: cancel when the customer may request it or a request is pending; the code while a rider is assigned or it's awaiting drop-off; pay for a pending pay-now order), accounts only. **The model copies the plain order button** even when asked to cancel (0/3 for the code), so the server does it: `sectionsAskedAbout` reads the customer's message, and a plain button goes to the one section they asked about when a tool offered it for that order; several sections for one order collapse to the plain one, and the no-buttons fallback never picks a section. **Found along the way:** a token followed by a full stop in tool text ("…#cancel.") was captured with the full stop; tool lines now end on the token, and parsing drops trailing punctuation. **Case replies** need `handoff`: `get_support_case` (new, handoff module) reads the caller's own cases through `CaseStore.listForOwner` and puts ops' reply in the case card word for word; the bell item (`data.kind` support_case) opens BIA with "What did the team say on my case BIA-…?". The eval runner can now stage cases (`cases` on a case). **Regression caught:** with the new tool, "escalate it again" had the model write "I've opened another case, BIA-1002" without calling anything (3/8); a reply naming a case number no tool gave and not already in the chat is now sent back once to use the tool (8/8 after). Chrome, account 9000000090: "I want to cancel BOM-100107" → the button → order page scrolled with Request cancellation in view, nothing requested; bell → BIA with the reply card. 168 unit tests; evals: `orders` 43/43 ×2; all modules + `handoff` 73/77 ×2, the misses rate limits (3/3 on rerun) and the known `guest-18`.

### R5 · Proactive and reach

#### 5.1 Nudges

**Status:** ✅ (needs `create_bia_nudges.sql` and the scheduler) · **After:** 1.4, 2.2 · **Owns:** `server/routes/bia.ts`, `pages/Profile.tsx` · **Migration:** `create_bia_nudges.sql`

BIA speaks first when something stalls, through the bell.

Build
- [x] `server/supportNudges.ts` rules: signup stuck at documents for 24 hours; a guest with two or more orders and no account; pickup tomorrow; final amount changed after weighing (skipped if `notify.ts` already sent that message); document failed (live Cashfree only).
- [x] `POST /api/admin/bia/nudges/sweep` behind the same bearer secret as the retention sweep; the external scheduler calls it daily.
- [x] `bia_nudges` log (unique per owner, kind and subject; at most one per owner per day), plus per-kind opt-outs on Profile and the guest profile.
- [x] Each bell row carries a BIA seed; tapping it opens the sheet about that thing.

Done when
- [x] Running the sweep twice sends nothing new (`supportNudges.test.ts`, and a day later the same document still isn't news)
- [x] An opt-out stops that kind; no nudge is marketing (tests: the switched-off kind is skipped and the rest go; every nudge's words are checked for offers, discounts, reviews, referrals and exclamation marks)

Notes: **Shape:** pure rules (`nudgesFrom`) over a snapshot the sweep reads (`loadNudgeSnapshot`), storage behind `NudgeStore` like `CaseStore`, and the bell row written with type `bia_nudge`, falling back to `order_status`. The more useful kind goes first when one person is due several (document, amount, pickup, signup, guest account), and a bell row that couldn't be written releases its claim so the next sweep tries again. **The seed isn't stored:** the bell row's `data` is `{ kind: "bia_nudge", nudge, orderNo }` and the client builds BIA's question from the kind (`shared/biaNudges.ts` §nudgeSeed). **Rules, tightened by a read-only dry run on the shared database:** a guest's one identity document is mirrored into the signup tables under their ref, so six guests who had only booked read as stalled signups; a signup now needs two documents, a GST number, or both Aadhaar and PAN (`looksLikeSignup`), which left the one real one. A document nudge needs a verdict a new photo fixes (mismatch, wrong document, tampered, unreadable): `unavailable` is our checker not answering, and saying "needs replacing" for it would be wrong. The amount nudge states the estimate and the final amount and says our team will be in touch, never the difference. "Pickup tomorrow" tells an account the code is on the order page and a guest that it comes on WhatsApp. **Before the migration** the sweep answers 503 `NUDGES_NOT_SET_UP` (uncatalogued: nobody sees it) and sends nothing; the switches card isn't drawn. The sweep logs one line per run, quiet ones included. Chrome, account 9000000090, mocked tables: the switches on Profile (one switched off, sent as `{ kind, on: false }`) and a nudge on the bell opening BIA with "What do I need for tomorrow's pickup of BOM-100107?". 187 unit tests.

#### 5.2 Voice notes

**Status:** ⏭ skipped (2026-09-12, Aditya's call) · **After:** 1.4, 1.6 · **Owns:** `components/bia/BiaChat.tsx`, `server/routes/support.ts`

Hold to talk; BIA gets text the customer has already checked. *Dropped; the plan is kept below in case it comes back.*

Build
- [ ] A mic button (MediaRecorder: webm on Android, mp4 on iOS), 60 seconds at most.
- [ ] `POST /api/support/transcribe` (5 MB max, rate-limited) → OpenAI transcription on the same key.
- [ ] The transcript lands in the input box for the customer to edit and send. It's never sent automatically.

Done when
- [ ] Works on Android Chrome and iOS Safari
- [ ] The privacy filter runs on transcripts

Notes: —

#### 5.3 Hindi

**Status:** ⏭ skipped (2026-09-12, Aditya's call) · **After:** 1.5 · **Owns:** `server/supportPrompts.ts`

BIA answers in Hindi when the customer writes in Hindi. *Dropped: no Hindi-specific rules or evals. The base prompt's existing LANGUAGE block is unchanged.*

Build
- [ ] Language rules in the base prompt: Devanagari in, Devanagari out; Hinglish stays Hinglish; names, addresses and codes stay unchanged.
- [ ] Hindi eval cases across the modules.

Done when
- [ ] Hindi evals pass; English and Hinglish evals are unchanged

Notes: —

## Log

Newest first. One line per merge, decision or surprise.

- 2026-09-12 · **Released to `aditya/final-phase`:** fast-forward to 9e874c2 (local, not pushed); 173 unit tests and the type check pass there. Live once deployed: R1, order-page links, and the nudges (after the scheduler calls the sweep). R2 and R3 go live by adding their modules to `BIA_MODULES`.
- 2026-09-12 · **Decision:** no support cases, and no ops replying to customers. Removed 4.1's cases, 4.2 (ops Cases tab) and 4.3's case half (ab0c9b5); kept the order-page links, the nudges, and 4.1's net that always gives someone asking for a person the WhatsApp and call buttons. `create_support_cases.sql` had been run; `drop_support_cases.sql` undoes it (optional, the table is empty). The case evals went with them; `escalate.json` checks plain escalation. 173 unit tests; evals `orders` 44/44 ×2, all modules 68/72 ×2 with every miss passing 3/3 on rerun.
- 2026-09-12 · 5.1 merged: nudges on the bell (failed document, changed amount, pickup tomorrow, a guest's stalled signup, a guest's second booking), once each, one a day, switchable on Profile and the guest profile. **All 20 packages merged.** Left for Aditya: run `create_support_cases.sql` and `create_bia_nudges.sql`, point the scheduler at the sweep, then merge `bia-3/main` into `aditya/final-phase`.
- 2026-09-12 · 4.3 merged: BIA's order buttons open the cancel button, the handover code or Pay on the order page (live with `orders`); a case reply on the bell opens BIA with ops' words (with `handoff`). **R4 code-complete**; switching it on waits on `create_support_cases.sql`. Left: 5.1.
- 2026-09-12 · 4.2 merged: ops Cases tab (queue, case detail, reply to the customer's bell, close), additive to the ops console; waits on `create_support_cases.sql` like 4.1. **Wave W7 done.** Left: 4.3, 5.1.
- 2026-09-12 · 3.2 merged: `suggest_hsn` names entries and codes from Bombino's contents list; the customer chooses in the form. **R3 code-complete.** Left: 4.2, 4.3, 5.1.
- 2026-09-12 · **Decision:** BIA won't ship anything or fill forms; it helps on the screens. 3.3 (drafts, "say it to ship") dropped with its migration; 3.2 suggests HSN codes without a "Use this code" button and moves to W7; R3 is booking help. Re-uploading a document (2.5) is BIA's only chat action.
- 2026-09-12 · 4.1 merged, dark: escalations become support cases once `BIA_MODULES` includes `handoff`; `create_support_cases.sql` written, **not run**. **Wave W6 done.** W7 next: 4.2 ops Cases tab (and 3.2, once 3.3 was dropped).
- 2026-09-12 · 3.4 merged: `can_i_ship` answers only from `content/bia/restricted/` (format in its README). No lists yet, so every answer is "our team will confirm". W6 left: 4.1.
- 2026-09-12 · 3.1 merged: the booking form tells BIA its step, destination and product type; "Ask BIA about this step"; `explain_booking_error` and `explain_booking_term`; a step guide in the SCREEN block. Fixed along the way: the `anon-07` tracking flake (budget 6,270 → 6,300, on purpose). W6 left: 3.4, 4.1.
- 2026-09-12 · 2.5 merged: upload a document from the chat (`offer_document_upload` + docUpload card) for accounts and guests; signups stay on their own screen. Guests are no longer sent to login when an identity upload is refused. **R2 code-complete.** W6 left: 3.1, 3.4, 4.1.
- 2026-09-12 · **Decision:** 2.4 (photo check), 5.2 (voice notes) and 5.3 (Hindi) dropped. 2.5 now uploads without a photo check and moves to W6; W9 is gone; R5 is nudges only; sample photos are no longer needed. W6 is now 2.5 · 3.1 · 3.4 · 4.1.

- 2026-09-12 · 2.3 merged: one explanation per document verdict on both upload screens and in BIA (`explain_document_issue`). **Wave W5 done.** W6 next: 2.4 photo check (needs your sample photos to tune), 3.1 booking context, 3.4 restricted items (waits on Bombino's lists), 4.1 support cases (writes a migration).
- 2026-09-12 · 2.2 merged: `get_signup_progress` and `get_document_status`, docStatus card, resume-signup and my-documents buttons. The telemetry unit tests had been writing a fixed-id row to the shared `bia_turns`; fixed. 2.3 is the last W5 package.
- 2026-09-11 · 2.1 merged: Account Matchmaker (`recommend_account`, `explain_term`, `TAP_SIGNUP`, `?category=` on signup).

- 2026-09-11 · Both R1 migrations run in Supabase (`create_bia_turns.sql`, `support_sessions_guest_ref.sql`). Left before merging into `aditya/final-phase`: check turn rows for 1.6 and guest history across tabs/devices for 1.7.
- 2026-09-11 · 1.7 merged: guest conversations kept on the server (after `support_sessions_guest_ref.sql`). **R1 code-complete.** Waiting on two migrations before merging into `aditya/final-phase`.
- 2026-09-11 · 1.6 merged: identity numbers masked, turn log + thumbs. `create_bia_turns.sql` written, **not yet run**. Two eval flakes fixed along the way.
- 2026-09-11 · 1.5 merged: modules + tool registry + per-turn prompt; `BIA_MODULES` (default `orders`). Signed-out customers get no order tools. Error links stay ungated.
- 2026-09-11 · 1.4 merged: BIA sheet over any screen, "Ask BIA" beside errors, support button opens the sheet. Thumbs moved to 1.6, module gating to 1.5.
- 2026-09-11 · 1.3 merged: screen context (allow-listed), order/pickup/rate cards, one shared button registry. W4 (1.4, 1.5, 1.6) next.
- 2026-09-11 · 1.2 merged: 48 catalogued error codes (incl. payments), every message unchanged. Wave W2 done; W3 (1.3 screen context and cards) is next.
- 2026-09-11 · 1.1 merged: `npm test` (24 unit tests) and `npm run bia:eval` (20 cases, 20/20 × 3 runs). BIA chat now runs at temperature 0.2. Fixed a false "no pickup code yet" answer introduced in 0.1.
- 2026-09-11 · 0.2 merged into `bia-3/main`: support routes live in `server/routes/support.ts`. Wave W2 (1.1, 1.2) can start.
- 2026-09-11 · Integration branch renamed `bia-3` → `bia-3/main` (git won't allow `bia-3` next to `bia-3/wpX-Y`).
- 2026-09-11 · 0.1 done: BIA 2.0 committed on `aditya/final-phase` (not pushed), `bia-3/main` cut from it. 23/23 evals passing after three fixes.
- 2026-09-11 · Plan agreed. Chat actions limited to drafts and re-uploads; support cases get an ops Cases tab; guest chats kept on the server; built by Aditya plus Claude sessions.
