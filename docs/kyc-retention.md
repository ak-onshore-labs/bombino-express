# Identity document storage, retention and access

How identity documents are stored, who can read them, and what is deleted when.

Written against the DPDP Act's expectations of a Data Fiduciary. **It does not
make anyone compliant on its own** — notice and consent, data-principal rights,
grievance redressal and the retention period that actually applies to customs
KYC are decisions for counsel, not for this file. What follows is what the code
does.

## Encryption at rest

`document_no` and `file_data` are encrypted with AES-256-GCM before they reach
Postgres, in all three tables that hold them:

| Table | Encrypted columns |
|---|---|
| `account_documents` | `document_no`, `file_data` |
| `identity_verifications` | `document_no` |
| `kyc_documents` | `document_no`, `file_data` |

All three together, deliberately: they hold the same Aadhaar between them, and
encrypting one while the others sit in the clear buys nothing.

- Implementation: `server/fieldCrypto.ts`. Envelope format `enc:v1:<iv>:<ct+tag>`,
  a fresh random IV per value, GCM auth tag so tampering throws rather than
  decrypting to rubbish.
- **Fails closed.** Without `ENCRYPTION_KEY` the write throws and the upload
  fails. This is the opposite of `server/crypto.ts` (ITD passwords), which
  returns empty strings when unkeyed — fine for a password, catastrophic for an
  Aadhaar image. `assertFieldCryptoConfigured()` runs at boot so a misconfigured
  deploy dies immediately instead of at the first upload.
- Encryption and decryption happen at the DB-module boundary, so nothing above
  it handles ciphertext and nothing below it holds a plaintext Aadhaar.
- `file_size_bytes` remains the size of the **original** file, not the
  ciphertext — it is shown to the customer and sent to ITD.

### The key

`ENCRYPTION_KEY`, 64 hex characters (32 bytes) — the same key the password
helper uses.

> **Losing this key means losing every stored identity document, permanently.**
> There is no recovery path. Back it up somewhere that survives the loss of the
> deployment environment, before running the backfill.

Rotation requires re-encrypting every row. The envelope carries a version (`v1`)
so a future second key means `v2` plus a re-encrypt pass, not a guess about
which key wrote a given row.

### Backfilling existing rows

Rows written before this decrypt to themselves — that is what lets the app keep
working during the transition, and it is also why the transition has to finish:
nothing can distinguish a legacy row from one that escaped encryption.

```bash
npx tsx --env-file=.env scripts/encrypt-existing-documents.ts          # report
npx tsx --env-file=.env scripts/encrypt-existing-documents.ts --apply  # write
```

Idempotent and re-runnable. `--apply` verifies afterwards that no unprefixed
values remain and exits non-zero if any do.

## Access, and who can read a document

`GET /api/kyc/documents/{capability_id}/file` and
`GET /api/account/documents/{capability_id}/file`.

**The unguessable id in the URL is the entire authorisation.** No session, no
expiry, and the id is not rotated when a document is replaced. This is a
deliberate trade: ITD stores the URL in a docket and re-fetches it later, so an
expiring or rotating URL would break dockets already issued.

Consequence, stated plainly: **a leaked URL is permanent, silent access to
somebody's identity document.** Closing that needs an ITD-side decision about
re-fetching URLs — see Open below.

What is in place meanwhile:

- **Every fetch is logged** to `document_access_log` — source, capability id,
  outcome, IP, user-agent, referer. Misses are logged too, so probing for valid
  ids shows up as a run of `not_found` from one address. The log holds no
  document bytes and no document numbers.
- Responses carry `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow,
  noarchive`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.
- Bytes are read server-side only, through the service-role client.
- `GET /api/kyc/me` returns metadata only — never the number, never the bytes.

Without an access log, a DPDP breach notification cannot honestly say what was
accessed. That is what it is for.

## Retention

**Abandoned signups.** Documents and identity rows staged against a
`signup_ref` that no account ever claimed are deleted after
`SIGNUP_RETENTION_DAYS` (default 14).

- `server/retention.ts`, exposed as `POST /api/admin/retention/sweep`, bearer
  auth with `WA_CRON_SECRET`, driven by the same external scheduler as the
  WhatsApp digests. Daily is ample.
- The safety rail is `signup_ref IS NOT NULL`, not the date: a claimed row has
  its `signup_ref` cleared when the account takes ownership, so the sweep can
  never reach a real customer's documents however old they are.
- 14 days is well past a signup interrupted overnight — the phone verification
  behind it expires in ten minutes — and far short of "indefinitely".

**Accounts that exist.** Not swept. Those fall under customs KYC retention,
which has a much longer clock and is a question for counsel. Deleting the
`itd_users` row cascades to both tables.

## Open

- **Capability URL expiry or rotation.** The remaining half of the access
  problem. Needs ITD to agree to re-fetch a URL rather than store one forever.
  Recommended: rotate `capability_id` on replace, so an old URL 404s instead of
  silently serving a newer document.
- **Data-principal rights** — access, correction, erasure, withdrawal of
  consent, and a named grievance officer. None of these exist.
- **Notice at collection.** The Privacy page lists what is collected; DPDP wants
  purpose, retention, how to withdraw, and how to complain to the Board.
- **Children's data.** Under-18s need verifiable parental consent. The Aadhaar
  carries a date of birth that is currently not looked at.
- **Aadhaar specifically.** Storing full Aadhaar numbers and card images as a
  private entity is a narrower question than DPDP and needs its own answer:
  whether masked Aadhaar suffices, and whether the other accepted CBIC KYC
  documents should be offered as equal alternatives.
- Migration to Supabase Storage, if the base64-in-Postgres approach is ever
  outgrown.
