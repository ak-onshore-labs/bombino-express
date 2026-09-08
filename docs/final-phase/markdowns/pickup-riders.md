# Pickup Riders and Beats

Who collects parcels, where, and by when. Kept by Aditya. Last updated **8 Sep 2026**.

**25 riders named by ops · 15 with accounts · 20 beats across 10 hubs · 674 serviceable pincodes.**

Sections: [What ops send](#1-what-ops-send) · [Riders with accounts](#2-riders-with-accounts) ·
[Riders without accounts](#3-riders-without-accounts) · [Beats](#4-beats) ·
[What a rider can do](#5-what-a-rider-can-do) · [Adding a rider](#6-adding-a-rider) ·
[Where this lives](#7-where-this-lives)

---

## 1. What ops send

Every hand-over from Bombino ops arrives as the same four lines, per rider:

```
Pickup Boy Name :
Pickup Boy Contact Number:
Pickup Serviceable Pincodes
Pickup Cut-off Time
```

That block is the contract. The spreadsheet stapled to it is not — every one has
had a different layout (Kolkata's carries a handling branch and free-text
remarks, Delhi's a region, Andheri's a route, Jaipur's two bare columns), which
is why the system models the block and not the sheet.

A **beat** is one rider's round: a named set of pincodes with its own same-day
cut-off. Beats overlap freely, and a rider can run more than one.

The four lines land in three places:

| Ops line | Where it lives |
|---|---|
| Name, Contact Number | `itd_users` row, `role = 'agent'` |
| Serviceable Pincodes | `pickup_beat_pincodes`, keyed to a beat |
| Cut-off Time | `pickup_beats.cutoff_hour` |
| — which rider runs which round — | `pickup_beat_agents` |

---

## 2. Riders with accounts

All created 8 Sep 2026. Each can sign in with their own number and is WhatsApped
about new jobs in their beat.

| Rider | Number | Hub | Round(s) | Cut-off | Note |
|---|---|---|---|---|---|
| Mohd. Sagir | +91 7506516901 | Fort | Girgaum to Tardeo and Nepean Sea Road | 7 PM | |
| Siddharth Thorat | +91 7506516906 | Fort | Kalbadevi to Mazgaon and Churchgate | 7 PM | |
| Suresh Bhangre | +91 9867603072 | Fort | Fort, Colaba, Nariman Point and Ballard Estate | 7 PM | |
| Wasim Sayyed | +91 8082277826 | Fort | Girgaum to Tardeo and Nepean Sea Road<br>Kalbadevi to Mazgaon and Churchgate<br>Fort, Colaba, Nariman Point and Ballard Estate | 7 PM | Biker — covers anywhere in the Fort hub, not a fixed round |
| Ranjeet Yadav | +91 8506966667 | Delhi | Delhi | 5 PM | |
| Puneet Verma | +91 8506966665 | Delhi | Delhi | 5 PM | |
| Ayan Khan | +91 8506944446 | Delhi | Delhi | 5 PM | **Works to 3 PM** where the other two Delhi riders work to 5 |
| Ganjawala Sajid | +91 7383008007 | Surat | All Surat | 5 PM | |
| Arif Bhai | +91 9898455245 | Surat | All Surat | 5 PM | |
| Sohail Khan | +91 9320599605 | Pune | All Pune | 5 PM | |
| Ayan Shaikh | +91 7821093240 | Pune | All Pune | 5 PM | |
| Saiyed Tahir | +91 7043000674 | Ahmedabad | All Ahmedabad | 5 PM | |
| Javed | +91 8952889845 | Jaipur | All Jaipur | 5 PM | |
| Deva Kumar | +91 8939455570 | Chennai | All Chennai | 5 PM | |
| Mohammed Sohail Khan | +91 7013029604 | Hyderabad | Hyderabad | 3 PM | Second number on file with ops: 8886878604 |

**Two riders share a name-shaped collision** — Sohail Khan (Pune) and Mohammed
Sohail Khan (Hyderabad) are different people on different numbers. Do not merge
them.

**Ayan Khan's 3 PM is deliberately not modelled.** All three Delhi riders cover
the same attached list, so the latest cut-off among them wins for every Delhi
pincode either way; splitting Delhi into three beats with identical rows would
cost 194 duplicated rows for a distinction no customer could observe. The
consequence to be aware of is human, not technical: a Delhi pickup booked at
4 PM is promised same-day, and only two of the three riders are still out.

---

## 3. Riders without accounts

Named by ops, **no phone number ever supplied**. `itd_users.phone` is the unique
key and is what both OTP sign-in and the WhatsApp fan-out resolve, so there is
nothing to create an account from.

| Rider | Number | Hub | Round | Cut-off |
|---|---|---|---|---|
| Shyam Kahar | — | Mumbai (Andheri) | Jogeshwari → Borivali E/W | 7 PM |
| Kishore Shethi | — | Mumbai (Andheri) | Jogeshwari → Kandivali E/W | 7 PM |
| Yogesh Singh | — | Mumbai (Andheri) | Andheri East → Powai | 7 PM |
| Rafiq Shaikh | — | Mumbai (Andheri) | Andheri East → Powai | 7 PM |
| Abrar Farooki | — | Mumbai (Andheri) | Andheri West → Vile Parle E/W + Juhu | 7 PM |
| Sanjay Lawate | — | Mumbai (Andheri) | Vile Parle → Bandra E/W | 7 PM |
| Shahid Khan | — | Mumbai (Andheri) | Andheri West → Bandra E/W | 7 PM |
| Rupesh Yadav | — | Mumbai (Andheri) | Chembur → Ghatkopar / Kurla / Vashi | 7 PM |
| Sameer Khan | — | Mumbai (Andheri) | Ghatkopar → Thane E/W + Kurla/Chembur/Vashi/Airoli | 7 PM |
| Abrar Shaikh | — | Mumbai (Andheri) | Ghatkopar → Thane E/W + Vashi/Airoli | 7 PM |

**What this costs, concretely.** A job in any of the **59 Andheri pincodes** —
Mumbai's western and eastern suburbs, Thane, Navi Mumbai — falls through to
notifying *every* agent in the country, because `listAgentsForPincode` treats "no
rider on this beat" the same as "cannot answer" and pages everyone rather than
risk a job nobody hears about. So Javed in Jaipur is currently WhatsApped about
Goregaon pickups.

**Kolkata** is worse in one respect and better in another: no roster has ever
arrived, so there is not even a name here, and it is also the last hub still
holding the conservative 3 PM default because ops have never named an hour.

Both are chased in [`open-items.md`](./open-items.md) §2.

---

## 4. Beats

Pincode counts are per beat, so they sum to more than the 674 unique serviceable
pincodes — Andheri's rounds overlap heavily by design, and Fort's 400008 sits in
two.

| Hub | Round | Slug | Pincodes | Cut-off | Riders |
|---|---|---|---|---|---|
| Kolkata | Kolkata | `kolkata` | 101 | 3 PM | _nobody_ |
| Delhi | Delhi | `delhi` | 97 | 5 PM | Ranjeet Yadav, Puneet Verma, Ayan Khan |
| Fort | Girgaum to Tardeo and Nepean Sea Road | `mumbai-fort-girgaum-tardeo` | 7 | 7 PM | Mohd. Sagir, Wasim Sayyed |
| Fort | Kalbadevi to Mazgaon and Churchgate | `mumbai-fort-kalbadevi-mazgaon` | 6 | 7 PM | Siddharth Thorat, Wasim Sayyed |
| Fort | Fort, Colaba, Nariman Point and Ballard Estate | `mumbai-fort-colaba-ballard` | 6 | 7 PM | Suresh Bhangre, Wasim Sayyed |
| Hyderabad | Hyderabad | `hyderabad` | 89 | 3 PM | Mohammed Sohail Khan |
| Surat | All Surat | `surat` | 17 | 5 PM | Ganjawala Sajid, Arif Bhai |
| Pune | All Pune | `pune` | 53 | 5 PM | Sohail Khan, Ayan Shaikh |
| Chennai | All Chennai | `chennai` | 120 | 5 PM | Deva Kumar |
| Ahmedabad | All Ahmedabad | `ahmedabad` | 51 | 5 PM | Saiyed Tahir |
| Jaipur | All Jaipur | `jaipur` | 69 | 5 PM | Javed |
| Mumbai (Andheri) | Jogeshwari → Borivali E/W | `andheri-jogeshwari-borivali` | 19 | 7 PM | _Shyam Kahar — no number_ |
| Mumbai (Andheri) | Jogeshwari → Kandivali E/W | `andheri-jogeshwari-kandivali` | 10 | 7 PM | _Kishore Shethi — no number_ |
| Mumbai (Andheri) | Andheri East → Powai | `andheri-east-powai` | 14 | 7 PM | _Yogesh Singh, Rafiq Shaikh — no number_ |
| Mumbai (Andheri) | Andheri West → Vile Parle E/W + Juhu | `andheri-west-vile-parle-juhu` | 6 | 7 PM | _Abrar Farooki — no number_ |
| Mumbai (Andheri) | Vile Parle → Bandra E/W | `andheri-vile-parle-bandra` | 8 | 7 PM | _Sanjay Lawate — no number_ |
| Mumbai (Andheri) | Andheri West → Bandra E/W | `andheri-west-bandra` | 10 | 7 PM | _Shahid Khan — no number_ |
| Mumbai (Andheri) | Chembur → Ghatkopar / Kurla / Vashi | `andheri-chembur-ghatkopar-vashi` | 10 | 7 PM | _Rupesh Yadav — no number_ |
| Mumbai (Andheri) | Ghatkopar → Thane E/W + Kurla/Chembur/Vashi/Airoli | `andheri-ghatkopar-thane-kurla` | 13 | 7 PM | _Sameer Khan — no number_ |
| Mumbai (Andheri) | Ghatkopar → Thane E/W + Vashi/Airoli | `andheri-ghatkopar-thane-vashi` | 7 | 7 PM | _Abrar Shaikh — no number_ |

Retired: `mumbai-fort` (`is_active = false`) — the single 18-pincode union that
the three Fort rounds replaced on 8 Sep. Kept rather than deleted so its rows and
any assignment against it survive.

### Where beats came from

**Given as lists by ops** — Kolkata, Delhi, Fort (per rider), Hyderabad (as the
span 500001–500089), Andheri (round by round), Jaipur.

**Given as a scope and derived** — Surat, Pune, Ahmedabad, Chennai. Ops answered
"All Surat", "All Pune", "All Ahmedabad", "All Chennai";
`scripts/generate-pickup-pincodes.ts` sweeps the city's postal series against
India Post and keeps the codes that answer. A scope names a city, not a district,
so rural talukas stay out — Pune's 412xxx, and Ahmedabad's Dholka, Bavla,
Dhandhuka and Viramgam, which are 40–90 km from the counter.

A derived list is right about which pincodes exist and where the postal city
ends. **It cannot tell us where a rider actually stops** — that is ops' answer to
give.

---

## 5. What a rider can do

Sign in at `/login` with their mobile — an OTP goes over WhatsApp, with SMS
fallback. They land on `/agent`, never the customer app.

They see unclaimed pickups, their own claimed jobs, the handover OTP screens, and
their day's collections. They can claim a job, mark out for pickup, take payment
at the door, mark picked up, and mark received at hub. They cannot weigh, settle,
reprice or generate a docket.

**Beats narrow notification, not the pool.** Every agent still sees and can claim
every unclaimed job in the country. That is deliberate: ops' own note reads *"IF
ANY PICKUP BOY ABSENT AND LEAVE ADJUST ALL PICKUP BOY"*, and a hard filter would
make a job in an absent rider's beat invisible to everyone. So Javed will see
Kolkata pickups in his list — expected, not a bug.

Agents have no ITD token (they have no ITD credential), which is fine because
nothing on the agent surface calls ITD.

---

## 6. Adding a rider

**When a number arrives for someone in §3:** move their entry from
`PENDING_RIDERS` to `PICKUP_RIDERS` in `scripts/pickupRiders.ts`, adding `phone`
and `hub_id`, then either

```bash
npx tsx --env-file=.env scripts/seed-pickup-riders.ts          # dry run
npx tsx --env-file=.env scripts/seed-pickup-riders.ts --apply
```

or `--sql` to print SQL for the Supabase editor instead. Both are idempotent,
both refuse to touch a number already belonging to a non-agent, and beat
membership is added, never replaced.

**For a one-off:** create the account at `/ops/users` and assign the beat at
`/ops/beats`. Nothing needs a deploy.

**When coverage changes:** edit the beat at `/ops/beats` — live immediately. But
`shared/pickupPincodes.ts` is the fallback the app serves when the database is
unreachable, so a lasting change belongs there too: edit `PICKUP_BEATS`, run
`npx tsx scripts/generate-beat-seed.ts`, apply the seed, and commit both.
`GET /api/pickup/coverage` reports `source: "db"` or `"static"` so you can see
which one answered.

---

## 7. Where this lives

| Path | Holds |
|---|---|
| `scripts/pickupRiders.ts` | This roster, in code. **Names and personal numbers — deliberately in `scripts/`, never `shared/`,** which is bundled to every customer's browser |
| `shared/pickupPincodes.ts` | `PICKUP_BEATS` — beats, pincodes, cut-offs. The fallback when the database is unreachable |
| `migrations/create_pickup_beats.sql` | The three tables |
| `migrations/seed_pickup_beats.sql` | Generated from `PICKUP_BEATS`; rider names appear in its comments only |
| `scripts/seed-pickup-riders.ts` | Creates accounts and assignments (`--apply`), or prints SQL (`--sql`) |
| `server/pickupCoverageDb.ts` | Reads coverage, caches 5 min, falls back to the static table |
| `server/whatsappAgents.ts` | `listAgentsForPincode` — the fan-out, and its fall back to everyone |
| `client/src/pages/ops/OpsBeats.tsx` | `/ops/beats` — where ops edit all of this |

**Source of every line above:** Bombino technical support, "Pincode List",
8 Sep 2026, and the roster mail that followed it.
