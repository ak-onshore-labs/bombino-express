# WhatsApp templates — the submission list

Seventeen templates. **Submit all of them in one batch**, before waiting on
anything else: Meta approval runs 1–2 days per template and rejections come back
on wording, so seventeen serial submissions is a fortnight and one batch is a
couple of days.

Until a template is approved its send returns a `failed` row in
`whatsapp_messages` and the customer hears nothing. Everything else carries on —
the in-app notification still lands, the parcel still moves.

**Where**: Tata Omni panel → Settings → Channels → WhatsApp → Templates.
**Language**: English (`en`).
**Names must match `server/whatsappTemplates.ts` exactly** — a typo there is a
message nobody receives and no error anybody sees.

Every body below is one paragraph of plain text. No line breaks, no formatting
marks, no emoji. Paste it as written.

## Category

| Category | Which | Why |
|---|---|---|
| **Utility** | all 16 order/job templates | They follow a transaction the customer started. Cheaper than Marketing, and not subject to Marketing opt-in limits |
| **Authentication** | `bombino_login_otp` only | Gets the copy-code button and the shorter delivery path |

Nothing here is Marketing. If Meta pushes one into Marketing on review, the
wording has strayed into promotion — rewrite it rather than accept the category.

## Rules the variables must obey

Meta rejects the **API call**, not just the message, if a body variable is
empty, contains a newline or tab, or contains four or more consecutive spaces.
`v()` in `server/whatsappTemplates.ts` is what stands between us and that; it
substitutes `-` rather than send nothing.
`scripts/check-whatsapp-templates.ts` asserts all three against every template.

Two more, which shape the wording below: a body may not **begin or end** with a
variable, and two variables may not be **adjacent**. Every draft satisfies both.

---

## Customer templates

Sent to `itd_users.phone` — the OTP-verified account number. Never
`addresses.phone`, which is the person at the door and is unverified.

| # | Template | Fires when | Variables | Body |
|---|---|---|---|---|
| 1 | `bombino_order_booked` | Order created, `POST /api/orders` | 1 name, 2 order no, 3 pickup/drop-off line, 4 quoted amount | Hi {{1}}, your Bombino booking is confirmed. Order ID {{2}}. {{3}}. Estimated amount {{4}}. The final amount is confirmed after we weigh your parcel at our hub. |
| 2 | `bombino_payment_received` | Razorpay verify or webhook credits the order | 1 order no, 2 amount, 3 txn id | Payment of {{2}} received for order {{1}}, transaction {{3}}. Thank you. |
| 3 | `bombino_payment_failed` | Gateway reports a failed attempt | 1 order no, 2 amount | Your payment of {{2}} for order {{1}} did not go through. Your booking is safe. Open the Bombino app to try again. |
| 4 | `bombino_pickup_confirmed` | `agent_accepted` | 1 order no, 2 agent name, 3 date and window | Your pickup for order {{1}} is confirmed. {{2}} will collect it on {{3}}. See you then. |
| 5 | `bombino_agent_on_the_way` | `out_for_pickup` | 1 order no, 2 agent name | Your Bombino agent {{2}} is on the way to collect order {{1}}. Open this order in the Bombino app to see your pickup code, and share it only once the agent has your parcel in hand. |
| 6 | `bombino_parcel_picked_up` | `picked_up` | 1 order no | Order {{1}} has been collected. We will let you know when it reaches our hub. |
| 7 | `bombino_arrived_at_hub` | `received_at_hub` | 1 order no | Order {{1}} has arrived at the Bombino hub. We will weigh it and confirm the final amount before it is dispatched. |
| 8 | `bombino_amount_due` | `weighed` and final > quoted | 1 order no, 2 actual weight, 3 difference | Order {{1}} weighed {{2}}, more than booked. An additional {{3}} is due. Open the Bombino app to pay. Your parcel is dispatched once this is settled. |
| 9 | `bombino_refund_due` | `weighed` and final < quoted | 1 order no, 2 actual weight, 3 refund | Order {{1}} weighed {{2}}, less than booked. A refund of {{3}} is due to you. Our accounts team will process it. Your parcel is not delayed. |
| 10 | `bombino_dispatched` | AWB issued | 1 order no, 2 AWB, 3 tracking URL | Order {{1}} is on its way. Tracking number {{2}}. Track it at {{3}} at any time. |
| 11 | `bombino_cancellation_approved` | `cancelled` | 1 order no | Order {{1}} has been cancelled. If you have paid for it, our accounts team will be in touch about a refund. |
| 12 | `bombino_cancellation_declined` | `reject_cancellation` | 1 order no, 2 ops note | We could not cancel order {{1}}. Reason: {{2}}. Call us on +91 22 6640 0000 if you need to discuss it. |
| 13 | `bombino_login_otp` **(Authentication)** | OTP requested | 1 the code | Meta's preset — see the note below. Do not type a body for this one. |

### Notes on the customer set

| # | Why it reads the way it does |
|---|---|
| 1 | The closing sentence is not padding. The quote is an estimate against a weight the customer guessed; someone never told that reads a later request for ₹340 as a bait-and-switch |
| 5 | **No code in it.** The first version carried the handover code and Meta rejected it as `INCORRECT_CATEGORY`: a Utility template may not deliver a code. The code stays on the order screen (`#handover-code`), which also always shows the current one after a regeneration. "only once the agent has your parcel in hand" is still the entire control. The code goes to the customer and no one else: the agent types it and must never be able to read it (`handoverCodes.ts` §THE ONE RULE) |
| 8 | "dispatched once this is settled" is a fact, not a threat — `settle` is gated on payment, so an unpaid difference genuinely holds the parcel |
| 9 | Promises a person will act, not that money is already moving. Refunds are recorded, never issued by the app (`open-items.md` §2) |
| 10 | `{{3}}` is `{PUBLIC_URL}/shipment/{awb}`. With `PUBLIC_URL` unset the code substitutes a readable fallback rather than sending a broken link |
| 12 | `{{2}}` is ops' note, or a default sentence when they gave none. Ops writes it and the customer reads it, so it is never an id or a code |
| 13 | **Not a free-text template.** Build it with the panel's Authentication flow: pick the preset body, tick the security disclaimer, and set expiry to **5 minutes**. The preset is what produces the copy-code button, which `server/whatsapp.ts` fills as a button parameter — a template without that button makes the send fail. It is also why this is the one body that may open with a variable. 5 minutes is `OTP_TTL_MINUTES`; change one, change both |

---

## Agent templates

Sent to the agent's `itd_users.phone`.

**No agent template carries a handover code, and none ever should.**

| # | Template | Fires when | Variables | Body |
|---|---|---|---|---|
| 14 | `bombino_agent_new_job` | Booking, to agents rostered for that day and window | 1 order no, 2 area, 3 date and window, 4 money line | New pickup available: order {{1}} in {{2}}, {{3}}. {{4}}. Open the Bombino agent app to take it. First to accept gets the job. |
| 15 | `bombino_agent_daily_digest` | Morning of, to agents who have work | 1 agent name, 2 job count, 3 first window | Good morning {{1}}. You have {{2}} pickup(s) booked today, starting {{3}}. Open the Bombino agent app for the full list. |
| 16 | `bombino_agent_slot_reminder` | ~45 min before a claimed job's window opens | 1 order no, 2 window, 3 area | Reminder: pickup {{1}} starts at {{2}} in {{3}}. Please head over. |
| 17 | `bombino_agent_job_cancelled` | `cancel`, or `request_cancellation` on a held job | 1 order no, 2 what happened | Update on job {{1}}. {{2}} Open the Bombino agent app for details. |

### Notes on the agent set

| # | Why it reads the way it does |
|---|---|
| 14 | `{{4}}` is `Collect ₹500 at the door` or `Nothing to collect`. `{{2}}` is city and pincode, **not the street** — this fans out to every rostered agent and the customer's doorstep should not. "First to accept gets the job" is literally true: the claim is settled by a conditional UPDATE (`agentDb.claimPickup`), and saying so is why the loser sees a fair race rather than a bug |
| 15 | Agents with nothing on are not sent this. A digest reading "0 jobs" is a notification whose only purpose is to be dismissed |
| 16 | Only for jobs still at `agent_accepted`. A job at `out_for_pickup` has the agent on the road already, and reminding someone about what they are currently doing is how a channel gets muted |
| 17 | `{{2}}` is either `This job has been cancelled. Do not collect.` or `The customer has asked to cancel. Wait for ops before you travel.` Both are complete sentences with their own full stop, which is why no punctuation follows `{{2}}` in the body. One template, two sentences, because the difference matters: a *request* does not move the order and the agent is still expected to collect until ops decides (`orderContract.ts` §Cancellation). Telling them to stop on a request would strand a parcel every time ops declines one |

---

## After approval

| Step | What |
|---|---|
| 1 | Copy each approved name into `WA_TEMPLATE` in `server/whatsappTemplates.ts` if it differs by so much as an underscore |
| 2 | Check variable **count and order** against the code. The panel numbers them `{{1}}…{{n}}`; the code passes a positional array. A swap between two variables of the same type is silent and produces a message that reads as nonsense |
| 3 | Run `npx tsx scripts/check-whatsapp-templates.ts` — renders all seventeen and asserts Meta's variable rules |
| 4 | Set `WA_DRY_RUN=0` and send one of each to your own number before pointing it at a customer |

## What to watch afterwards

```sql
select template, status, count(*)
from whatsapp_messages
group by 1, 2
order by 1, 2;
```

| Symptom | Means |
|---|---|
| `failed` rising on one template | It was paused or rejected after the fact |
| `failed` rising across all of them | The WABA's quality rating has dropped — which is what the STOP handling and the rostered-only fan-out exist to prevent |
| `skipped` everywhere | `WA_DRY_RUN` is on, or `TATA_WA_TOKEN` is unset. Not a fault |
