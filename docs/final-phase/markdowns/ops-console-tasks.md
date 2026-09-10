# Ops Console — Features to Build

The features the ops console needs so the Bombino team can manage and configure riders,
pickup areas, guests, KYC and app settings themselves. Written for Arbaaz on **10 Sep 2026**.

**Tags:**
- **Must** — needed for day-to-day operation.
- **Should** — needed, but staff can manage without it for a while.
- **Nice** — polish.

---

## Words used in this list

| Word | What it means |
|---|---|
| **Rider** | The pickup boy. Called an "agent" in the code. |
| **Round (beat)** | A rider's area: a set of pincodes, the latest same-day booking time, and the riders who cover it. |
| **Cut-off** | The latest time a customer can book and still get a same-day pickup. |
| **Drop-off counter** | One of Bombino's offices where a customer can hand in a parcel themselves. |
| **Guest** | A customer who booked without making an account. They proved their phone with an OTP and uploaded their ID. |
| **KYC / ID** | The customer's identity documents (Aadhaar, PAN, GST). Customs needs them. |
| **Hub** | ITD's office code, such as "Mumbai" or "Fort Office". It comes from ITD. |

---

## 1. Riders

- [ ] **R1 · Edit a rider's details** — *Must*
  - Change a rider's name, phone number and email.

- [ ] **R2 · Switch a rider on or off** — *Must*
  - An inactive rider can't log in and gets no job alerts. Their past jobs and cash records are kept.

- [ ] **R3 · Choose a rider's pickup areas from their profile** — *Must*
  - When creating or editing a rider, tick the rounds they cover. This decides which new jobs they're alerted about.

- [ ] **R4 · Rider profile page** — *Should*
  - One page per rider showing:
    - their details
    - their rounds and cut-off times
    - the jobs they're on right now
    - the cash they've collected today

- [ ] **R5 · Riders waiting for a phone number** — *Should*
  - Add a rider with just a name and round, marked "waiting for number". Adding the number later turns them into a working rider.

- [ ] **R6 · Clear label on the "Hub" field** — *Nice*
  - Rename it "ITD hub", with a hint that it doesn't set the rider's area.

---

## 2. Serviceable pincodes and cities

- [ ] **C1 · Pincode lookup** — *Must*
  - Type any pincode and see:
    - whether Bombino picks up from it
    - the city and area name the customer sees
    - the round or rounds it belongs to
    - the cut-off time
    - which riders get the alert
    - whether an out-of-city charge applies
    - and, if it isn't covered, the nearest drop-off counter

- [ ] **C2 · Edit each pincode's details** — *Must*
  - Show a round's pincodes as a table where each row's **city**, **area name** and **out-of-city charge** can be edited.

- [ ] **C3 · "No rider" warning** — *Should*
  - A dashboard alert listing the pincodes whose round has no working rider, linked to where it can be fixed.

- [ ] **C4 · Who gets alerted when a round has no rider** — *Nice*
  - A setting with three choices: every rider, only riders in the same city, or only the office.

- [ ] **C5 · Upload pincodes from a spreadsheet** — *Nice*
  - Upload a CSV (pincode, city, area) into a round instead of pasting.

- [ ] **C6 · "Live within 5 minutes" note** — *Nice*
  - After saving coverage changes, tell staff how soon customers will see them.

---

## 3. Drop-off counters

- [ ] **D1 · Manage the counters list** — *Must*
  - Add, edit and hide counters: name, address, pincode, state, and other names the city goes by. This is the list customers see on the booking page and the Locations page.

- [ ] **D2 · Suggested counter on drop-off orders** — *Should*
  - Show which counter each drop-off customer was sent to, and let each counter filter to its own parcels.

---

## 4. Guests

- [ ] **G1 · Guest details on orders** — *Must*
  - Show the guest's name, phone and email on the board, the order page and the export, with a **"Guest"** label.

- [ ] **G2 · Guests section, separate from account holders** — *Must*
  - A **Guests** tab next to Customers, searchable by phone and name. Each guest page shows:
    - their details
    - their personal or company information (GST, company name, address)
    - all their orders

- [ ] **G3 · View a guest's ID documents** — *Must*
  - A document viewer on the guest page. Super-admin only, and every view logged.

- [ ] **G4 · Search orders by the sender's phone or name** — *Must*
  - Works for both guests and account holders.

- [ ] **G5 · Filter orders by guest or account holder** — *Should*
  - A "Guest / Account" filter on the order board.

- [ ] **G6 · Edit a guest's contact details** — *Should*
  - Fix a guest's name and email when the guest asks.

- [ ] **G7 · Guest account-setup progress** — *Should*
  - Show what a guest has filled in, and what's missing, while turning their guest profile into an account.

- [ ] **G8 · "Started as a guest" note** — *Nice*
  - On accounts, and orders, that began as guest bookings.

- [ ] **G9 · Block a phone number from guest booking** — *Nice*
  - A staff-managed list of numbers that can't book as a guest.

---

## 5. KYC

**How KYC works:**
- ID checks are done **only by Cashfree Smart OCR**. Staff never check or approve a document.
- **Until the live Cashfree details are shared,** the check is skipped silently and every document counts as verified. Nothing on screen says it was skipped.
- **Once Cashfree is live,** a customer whose document fails sees a popup explaining why. The ops console shows the same reason.
- **A failed or skipped check never stops an order or the AWB.**

- [ ] **K1 · Show Cashfree's result and reason on each document** — *Should (once Cashfree is live)*
  - Next to each document on the customer or guest page, show **"Verified"**, or **"Could not be verified"** with the reason Cashfree gave. This matches the popup the customer sees.

- [ ] **K2 · List of customers whose KYC failed** — *Should (once Cashfree is live)*
  - One list of customers and guests whose document Cashfree couldn't verify, with the reason, so the team can follow up. It's for information only — nothing is blocked.

---

## 6. Settings (super-admin only)

- [ ] **S1 · Support contact numbers** — *Must*
  - One place to set the office phone and support WhatsApp number shown across the customer app and the rider app.

- [ ] **S2 · On/off switches** — *Must*
  - Each switch shows its state, a plain explanation, and who last changed it and when:

    | Switch | What it controls |
    |---|---|
    | Guest booking | Whether people can book without an account |
    | Cashfree ID check | **Test** (the check is skipped silently while Bombino has test credentials) or **Live** (Cashfree checks every document). Either way, orders and AWBs never stop. |
    | Labels at booking | Whether the ITD label is made as soon as an ITD-linked customer books |
    | Payments test mode | Whether orders go through without a real payment. **Must be off in real use.** |

- [ ] **S3 · Default pickup cut-off** — *Should*
  - The same-day booking time used wherever a round has no time of its own.

- [ ] **S4 · Change history** — *Should*
  - One list of who changed what, and when, across riders, rounds, pincodes, counters, settings and KYC decisions.

- [ ] **S5 · Signup data retention** — *Nice*
  - The number of days before unfinished signups, and guest profiles with no orders, are deleted.

- [ ] **S6 · Hub list** — *Nice*
  - ITD's hub list, shown read-only for reference.

---

## Build order

**Phase 1**
- G1 · Guest details on orders
- G4 · Search by the sender
- R1 · Edit a rider's details
- R2 · Switch a rider on or off
- R3 · Choose a rider's areas from their profile
- S1 · Support contact numbers

**Phase 2**
- G2 · Guests section
- G3 · Guest ID documents
- C1 · Pincode lookup
- C2 · Edit each pincode's details
- D1 · Manage the counters list
- S2 · On/off switches
- S4 · Change history

**Phase 3:** everything else.

| Section | Must | Should | Nice |
|---|---|---|---|
| Riders | R1, R2, R3 | R4, R5 | R6 |
| Pincodes and cities | C1, C2 | C3 | C4, C5, C6 |
| Drop-off counters | D1 | D2 | — |
| Guests | G1, G2, G3, G4 | G5, G6, G7 | G8, G9 |
| KYC | — | K1, K2 | — |
| Settings | S1, S2 | S3, S4 | S5, S6 |
