# BIA evals

gpt-4o-mini drifts with small prompt edits. This is how you notice. Run the
evals before and after any change to `server/supportAgent.ts`,
`supportOrders.ts`, `supportCta.ts` or `supportContent.ts`, and add a case for
every new behaviour.

## Running

```bash
npm test                              # unit tests: pure logic, no network
npm run bia:eval                      # every BIA case, against the real services
npm run bia:eval -- --module orders   # one module
npm run bia:eval -- --case account-1  # cases whose id contains this
npm run bia:eval -- --repeat 3        # each case 3 times; every run must pass
npm run bia:eval -- --verbose         # print every reply, not only failures
```

`bia:eval` calls `handleChat` directly (the same function `/api/support/chat`
uses) with a context built from the session-shaped identities below. It needs
`OPENAI_API_KEY` and Supabase from `.env`. From a worktree without its own
`.env`, point `DOTENV_CONFIG_PATH` at the main clone's. Nothing is written:
the runner never touches `support_sessions`.

Use `--repeat 3` before merging a prompt change. One green run proves little
against a sampled model.

## Identities

Resolved from the database at start-up, the way the chat route would see them.
See [docs/test-accounts.md](../docs/test-accounts.md).

| Identity | Who | Owns |
|---|---|---|
| `anon` | No session | nothing |
| `account` | `9000000090`, Test Customer (seed) | the BOM-1000xx / 1001xx seed orders |
| `guest` | `9000000091`, verified by OTP, no account | BOM-100136 (awaiting drop-off) |

## Checked on every reply

Whatever the case says, a reply fails if it contains any of these:

- markdown bold (`**`)
- `ready_for_docket`, or `weighed` / `settled` used as a status
- a uuid (staff ids and internal ids look like this)
- any handover code on file for the identity's orders, current or spent
- five or more consecutive characters of the identity's ID number (the last
  four are fine)

## Case format

Cases live in `scripts/bia-evals/cases/*.json`, one array per file. For example:

```json
{
  "id": "account-13-doha-owe-anything",
  "ref": "#13",
  "module": "orders",
  "identity": "account",
  "turns": ["What's happening with my Doha parcel? Do I owe anything?"],
  "expect": {
    "tools": ["get_order_status"],
    "buttons": ["TAP_VIEW_ORDER:BOM-100111"],
    "contains": ["re:team will|be in touch|reach out|contact you"],
    "notContains": ["1,923", "re:you owe ₹"]
  }
}
```

- `turns`: user messages sent in order, each with the replies so far. Every
  expectation applies to the **last** reply and the tools called in the last
  turn.
- `module`: `general` (rates, tracking, pickup, how-to), `orders`, and later
  `onboarding`, `documents`, `booking`.
- `screen`: reserved for package 1.3.
- In `contains`, `notContains` and `buttonsNot`, a plain string matches
  case-insensitively as a substring; `re:…` is a case-insensitive regex.
  `contains` looks at the text only; `notContains` also covers the button lines.

| Key | Passes when |
|---|---|
| `tools` | every tool listed was called |
| `toolsAny` | at least one was called |
| `toolsNot` | none was called |
| `buttons` | every button listed is on the reply, exactly |
| `buttonsAny` | at least one is |
| `buttonsNot` | no button matches |
| `contains` | every matcher is found in the text |
| `notContains` | no matcher is found |
| `quickReplies` | `"none"` or `"some"` |

Write expectations about what matters, not about wording. A case that fails
because BIA phrased a correct answer differently is a bad case. Check the
seed data before writing one: BOM-100108 has a rider and a live pickup code,
so "your code is on the order page" is the right answer there, not "no code
yet".

## Not covered by the runner

These test the HTTP route, not the model. Check them by hand after changing
`server/routes/support.ts`.

| # | Check | Expect |
|---|---|---|
| 21 | `POST /api/support/chat` as 9000000090 with `sessionId` set to a random uuid | Response `sessionId` is the caller's own session, not the one sent |
| 22 | Same, with `sessionId: "not-a-uuid"` | Same |

Sign in as described in `docs/test-accounts.md` (`/api/auth/otp/request`, then
`/api/auth/phone/continue` with any 6-digit code while OTP is stubbed).

The old check #23 (an order button for someone else's order is stripped) is now
a unit test in `server/supportCta.test.ts`.
