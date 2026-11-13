# Bombino Express — build log

Every deploy of the app, newest first. The app shows its build at the bottom of
**My Profile** and the side menu, e.g. `Bombino Express V1 (Build 81.261013.10)`.
Match the build in a screenshot to a row here to know exactly what a user had.

## How the build is named

`V1 (Build 81.261013.10)`

| Part | Meaning |
|---|---|
| `V1` | Major version. Changed by hand for a big release. |
| `81` | Total deploys ever. Never repeats — quote this one ("build 81"). |
| `261013` | Deploy date, yymmdd (India time). |
| `10` | Which deploy that day. Back to 1 on a new day. |

The total was counted from Railway's history of `bombino-staging`: 80 good
deploys from 18 Sep to 13 Oct 2026 (1 failed deploy on 1 Oct not counted).
Deploys of the app-domain project (other Railway workspace) are not in it.

It lives in `build.json` at the repo root, which always holds the **upcoming**
build — the one the next push will deploy.

- Every commit message starts with it: `[81.261013.10] feat(app): ...`. A local
  `prepare-commit-msg` hook (`.git/hooks/`, not versioned) adds it from
  `build.json`; it skips messages that already start with `[`.
- Right after each deploy, start the next build and log the one just shipped:

```bash
npm run build:next   # bumps build.json to the next build, prints its label
# add the row below for the build just deployed; build.json goes in with the next commit
```

If the push lands on a later day than the bump, update `date`/`number` in
`build.json` (and the unpushed commit prefixes) before pushing.

The git commit is not in the label but is on the element (`title` /
`data-commit`) and in the log below.

Inside the iOS/Android shell a second line shows the store version, e.g.
`App iOS 1.2 (5)`, if the shell includes Capacitor's App plugin. The shells load
the live site (`server.url`), so a web deploy updates every phone without a
store release; a store release only changes that second line.

## Targets

| Target | Where | Deploys from |
|---|---|---|
| Web (Railway) | `bombino-staging` service, project zucchini-gratitude, env production | `production` branch, auto on push |
| Web (app domain) | `bombino.onshorelabs.co.in`, other Railway project (not in Aditya's workspace) | ask its owner |
| iOS | App Store, Capacitor shell (separate repo) | — |
| Android | Play Store, Capacitor shell (separate repo) | — |

## Log

| Total | Build | Date | Target | Commit | Notes |
|---|---|---|---|---|---|
| 96 | V1 (Build 96.261113.2) | 13 Nov 2026 | Web (app domain, auto-deploy on push) | 13456a5 | App keyboard: one keyboard-open flag that hides the bottom navs and support button, focused field scrolled clear of the top bar and the bar on the keyboard (did not work in the iOS shell, fixed in 97); bottom sheets capped above the keyboard; Create Shipment steps open at the top; Review & Pay full-width sheet on phones; Razorpay webview_intent and status-bar inset in the edge-to-edge shell; BIA orb no longer covers the sheet title. No migration. |
| 95 | V1 (Build 95.261113.1) | 13 Nov 2026 | Web (app domain, auto-deploy on push) | 7cd518e | App edge-to-edge: one set of safe-area inset tokens (--sat/--sab/--sal/--sar) for every screen, sheet and overlay; ui/sheet adds each side's insets; BombinoShell/2 gets dark status bar icons by default and light ones over dark screens; iOS scanner camera on; PDF, CSV and ops document downloads go through the native share sheet. No migration. |
| 94 | V1 (Build 94.261111.2) | 11 Nov 2026 | Web (app domain, auto-deploy on push) | ca01a28 | BIA knows reward points and links to the wallet. No migration. Logged late, on 13 Nov. |
| 93 | V1 (Build 93.261111.1) | 11 Nov 2026 | Web (app domain, auto-deploy on push) | 1603416 | Rewards: every list screen (ops board, ops card, cancellations, customer shipment list, Home pay reminder) and BIA order lookup show the amount after points; ops orders CSV gets points_used; no reward points on Cash on Delivery (UI + server); points expire as 31 Mar begins (year runs 31 Mar to 30 Mar, balance counts only this year's ledger rows, no job). No migration. |
| 92 | V1 (Build 92.261107.1) | 7 Nov 2026 | Web (app domain, auto-deploy on push) | 7423f61 | Reward points phase 1: points earned on delivery (₹100 billed before GST = 1 pt, ITD tracking + 6-hourly check, orders booked from 7 Nov), /rewards page + Home card with the 700 kg "Unlock special rewards" milestone, use points at Review & Pay (no cap, from 100 pts), points net off every amount due, ops customer points + super-admin adjust + monthly points CSV. Needs migrations/create_reward_ledger.sql (applied 7 Nov). |
| 91 | V1 (Build 91.261106.1) | 6 Nov 2026 | Web (app domain, auto-deploy on push) | 74c3604 | Receiver gets WhatsApp when the parcel reaches the hub (bombino_receiver_at_hub) and when it is cancelled (bombino_receiver_cancelled); 9833207558 (CUSTOMER MOBILE APP) is no longer a test phone: its new bookings are real, old ones stay test. |
| 90 | V1 (Build 90.261104.2) | 4 Nov 2026 | Web (app domain, auto-deploy on push) | 7397637 | Build label only: corrects 89's, which showed 88.261104.1. No app changes. |
| 89 | V1 (Build 88.261104.1, shown) | 4 Nov 2026 | Web (app domain, auto-deploy on push) | 2ef3b51 | Sign in from any country (searchable country picker); a second WhatsApp number for any customer, any country, asked right after the OTP at signup and sign-in when the number is not on WhatsApp, with a choice of which number gets updates (Profile, Review & Pay line); receiver phone takes a country, receiver gets WhatsApp updates, optional second WhatsApp number for the receiver; signup stops early on a registered number; test number +1 202-555-0123. Label says 88 by mistake: build 88 was the unlogged 27 Oct push. Needs whatsapp_alt_numbers migrations on the production database. |
| 88 | V1 (Build 88.261026.2) | 27 Oct 2026 | Web (app domain, auto-deploy on push) | f00eb9e | Agent home: new job card, shortcut tiles, new-job count on My jobs; booked and pickup dates on order details; customers and agents can act on test orders again. Logged late, on 4 Nov. |
| 87 | V1 (Build 87.261026.1) | 26 Oct 2026 | Web (app domain, auto-deploy on push) | e0c621a | WhatsApp after Tata's fix: agents get job assigned / pickup cancelled / 8 am morning list; 12 staff alerts plus 9 am, 6 pm, 8 pm reminders and daily summary; customers get account decision, pickup reassigning, extra charge due, cancellation declined v2. NEW_TEMPLATES_LIVE fallback switch. |
| 86 | V1 (Build 86.261015.2) | 17 Oct 2026 | Web (app domain, auto-deploy on push) | d8b31fb | Test staff get a Test data / Live data switch on every ops screen, replacing the All/Real/Test board filter. Pushed 17 Oct; label still carries 15 Oct because the bump was made then. |
| 85 | V1 (Build 85.261015.1) | 15 Oct 2026 | Web (Railway bombino-staging + app domain) | 290781f | Receivers track parcels sent to their Indian mobile (new optional field at booking), signing in as guests; Orders split Sending / Receiving; Home's My parcels card with Needs your attention on top; Orders tab badge; one design for account and guest profiles; identity document Replace flow; guest progress counts full onboarding. |
| 84 | V1 (Build 84.261014.3) | 14 Oct 2026 | Web (Railway bombino-staging + app domain) | 1fa633e | Real-view login 9000000099 (121212, super admin) sees ops as real staff: test orders hidden. |
| 83 | V1 (Build 83.261014.2) | 14 Oct 2026 | Web (Railway bombino-staging + app domain) | ed28734 | 9833207558 (CUSTOMER MOBILE APP) is a test phone. 51 more old orders marked test by hand; only BOM-100326 and BOM-100319 stay real. |
| 82 | V1 (Build 82.261014.1) | 14 Oct 2026 | Web (Railway bombino-staging + app domain) | ec09a41 | Test orders and test accounts hidden from all real staff (super admin too); TEST AWBs, never ITD; test staff get an All/Real/Test filter; 9000000011 can mark orders test or real. 25 old test orders backfilled. |
| 81 | V1 (Build 81.261013.10) | 13 Oct 2026 | Web (Railway bombino-staging) | f5aa1ad | First build with the label: build shown on customer/guest/agent Profile, ops Settings and side menu; handover code sheet opens from the top; commits prefixed with the build. |
| 80 | V1 (Build 80.261013.9) | 13 Oct 2026 | Web (Railway bombino-staging) | 3d0ac14 | Handover code sheet above the iOS keyboard; no SMS-code autofill. Before the label existed. |
| 1–79 | — | 18 Sep – 13 Oct 2026 | Web (Railway bombino-staging) | — | Earlier deploys, counted from Railway history, not logged one by one. |
