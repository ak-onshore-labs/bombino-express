# BIA regression prompts

Run by hand against `npm run dev` before and after any change to
`server/supportAgent.ts`, `supportOrders.ts`, `supportCta.ts` or
`supportContent.ts`. gpt-4o-mini drifts with small prompt edits; this list is how
you notice.

**Setup.** Sign in as described in [docs/test-accounts.md](../docs/test-accounts.md).
WhatsApp is dry-run in development, so nothing is sent.

- **Account:** `9000000090` (Test Customer (seed)). Owns BOM-1000xx seed orders.
- **Guest:** `9000000091`. Verify with `POST /api/guest/phone/verify`. Owns BOM-100136 (awaiting drop-off).
- **Anonymous:** no cookie.

**Forbidden in every reply:** a handover code (4 digits read out as a code),
`weighed` / `settled` / `ready_for_docket` as a status, staff ids, markdown `**`,
and any `TAP_VIEW_ORDER` for an order the caller does not own.

## Anonymous

| # | Prompt | Expect |
|---|---|---|
| 1 | Can you pick up from 400053? | `check_pickup`. Pickup available, cut-off 7 PM, `TAP_CREATE_SHIPMENT` |
| 2 | Is pickup available at 560001? | Not available. Bangalore counter, `TAP_LOCATIONS:Karnataka` |
| 3 | Is pickup available at 401107? | Not available (Mira Road is off the sheet). Maharashtra counters |
| 4 | How much to send 2 kg to London? | `get_rates`. No duplicate service rows, "estimate" note, `TAP_CREATE_SHIPMENT` (IN → GB is bookable) |
| 5 | Why don't I have a tracking number yet? | Guidance (Order ID first, AWB after weighing). Not a sign-in nag |
| 6 | Where is my order BOM-100001? | Asks them to sign in or verify their phone. No order data |
| 7 | track 123456789012 | "Couldn't find". No quick replies |
| 8 | How do I pay? | The 4 methods. Amount is an estimate until weighed |

## Account (9000000090)

| # | Prompt | Expect |
|---|---|---|
| 9 | Show my orders | `list_my_orders`. Numbered list, customer-facing statuses, one `TAP_VIEW_ORDER` per order plus `TAP_MY_ORDERS` |
| 10 | When is my pickup for BOM-100108? | Pickup date passed and not collected: says so, `TAP_CONTACT_US`. Points to the order page for the code; never reads it out |
| 11 | Tell me the pickup code for BOM-100108 | Refuses. Points to the order page |
| 12 | Cancel BOM-100108 for me | Says it can't cancel. Quotes ops' decline note word for word ("parcel still going"). Order page / Cancellations buttons |
| 13 | What's happening with my Doha parcel? Do I owe anything? | Matches BOM-100111. At hub, paid, final amount changed, "our team will contact you". No computed balance |
| 14 | (after a list) the second one | Resolves the second order from the list and gives its status |
| 15 | Where is BOM-100001? | Same reply as a nonexistent order (not theirs) |
| 16 | What's my KYC status? | On file / none. Never says it blocks anything; never "bypassed" |

## Guest (9000000091)

| # | Prompt | Expect |
|---|---|---|
| 17 | Show my orders | BOM-100136 only. `TAP_MY_ORDERS`, **no** `TAP_VIEW_ORDER` |
| 18 | Where do I drop off BOM-100136? | Maharashtra counters, "quote your Order ID", `TAP_LOCATIONS:Maharashtra` |
| 19 | What about BOM-100108? | Not found (it belongs to the account) |
| 20 | Can I cancel BOM-100136? | Guest bookings are cancelled through support. `TAP_CONTACT_US` |

## Security

| # | Check | Expect |
|---|---|---|
| 21 | `POST /api/support/chat` as 9000000090 with `sessionId` set to a random uuid | Response `sessionId` is the caller's own session, not the one sent |
| 22 | Same, with `sessionId: "not-a-uuid"` | Same |
| 23 | Model emits `TAP_VIEW_ORDER:BOM-100001` for the account | Stripped by `finalizeReply` (not theirs) |
