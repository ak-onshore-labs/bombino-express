# Test accounts

Every fake account on the shared Supabase project, as of 14 Aug 2026. All of
them sit in the `90000000xx` block — obviously fake, never a real Indian
subscriber. **Check this file before adding a new one**; a collision quietly
takes over somebody else's account, which has happened once already.

Verified against `itd_users` rather than written from memory.

## Pickup agents

| Phone | Name | Roster | Seeded by |
|---|---|---|---|
| `9000000014` | Ravi Deshmukh | Mon–Sat · 09:00-11:00, 11:00-13:00, 13:00-15:00 | `scripts/seed-dummy-agents.mjs` |
| `9000000012` | Imran Shaikh | Mon–Fri · 13:00-15:00, 15:00-17:00, 17:00-19:00, 19:00-21:00 | `scripts/seed-dummy-agents.mjs` |
| `9000000013` | Sunita Pawar | Sun, Wed, Thu, Sat · 11:00-13:00, 13:00-15:00, 15:00-17:00 | `scripts/seed-dummy-agents.mjs` |
| `9000000001` | Test Agent One | none — no availability rows | `scripts/create-test-agent.mjs` |

Ravi, Imran and Sunita carry pickups across the agent-visible lifecycle plus
collected payments. Re-seed them with:

```bash
node --env-file=.env scripts/seed-dummy-agents.mjs --reset
```

`Test Agent One` predates that script and has no work and no roster attached.
It is the account to use when you want an agent whose queue is genuinely empty.

## Ops / admin

| Phone | Name | Role |
|---|---|---|
| `9000000010` | Test Admin | `admin` |
| `9000000011` | Test Super Admin | `admin` |

Both were created by `scripts/create-test-admin.mjs`, which is not in this
branch. Despite the name, `9000000011` holds the `admin` role, not
`super_admin` — it was briefly turned into an agent by an earlier revision of
the seed script and has been restored.

Ops is the other half of two handovers, in opposite directions: it **shows** the
`hub` code that the agent types into the agent app, and it **types** the
customer's `dropoff` code. It also decides cancellation requests. None of those
screens is in this branch — they live on `origin/arbaaz/ops-console`.

Until the ops console catches up, the hub code can be minted (and read) through
the API as an admin, which is exactly what their screen will call:

```
POST /api/orders/<order-id>/handover-code     # as 9000000010, on a picked_up order
→ { "handover": { "kind": "hub", "code": "218876", "locked": false } }
```

Seeded orders carry no handover codes — `scripts/seed-dummy-agents.mjs` writes
them straight into mid-lifecycle states. Mint one with the call above, or drive
an order through `mark_picked_up`, which issues the hub code as a side effect.

## Customers

| Phone | Name | Notes |
|---|---|---|
| `9000000090` | Test Customer (seed) | Owns every seeded order and address. Recreated by the seed script. |
| `9000000005` | aditya kamarouthu | Personal test login, not seeded — leave it alone. |

## Signing in

Any 6-digit code is accepted while the OTP comparison is stubbed
(`server/otp.ts` logs the real one server-side).

```
POST /api/auth/otp/request     { "phone": "<phone>", "purpose": "auth" }
POST /api/auth/phone/continue  { "phone": "<phone>", "code": "000000" }
```

Each role lands on its own surface: agents at `/agent`, admins at `/ops`,
customers at `/home` (see `client/src/lib/surface.ts`).

## No ITD-credentialled account here

Every account in this file signs in by phone, which means every one of them is a
`local-<uuid>` row with no ITD password stored. **None of them can exercise
docket-at-booking** (`ITD_DOCKET_AT_BOOKING`, see `.env.example`): that path is
gated on `itdUserHasStoredPassword`, and these accounts have none.

To test it you need real ITD credentials and must link them to a phone through
`POST /api/auth/link/itd` — the only endpoint that accepts an ITD email and
password, and the only way one is ever stored. It refuses to link at all unless
`ENCRYPTION_KEY` is set (503), because the encrypted password *is* the link.

Add the number to the table above when you take one.

## Free numbers

`9000000002`–`9000000004`, `9000000006`–`9000000009`, `9000000015` onward.
Add the account to the table above when you take one.
