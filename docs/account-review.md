# Account review

Signup no longer opens an account by itself. The customer's finished signup
becomes an **application**; the Bombino team reviews it in the ops console,
creates the customer and its login in ITD by hand, and enters that login to
approve. Only then does the account exist. Until it does, the customer uses the
app as a guest on the same number.

Behind `ACCOUNT_REVIEW=1`. Off by default, and signup works exactly as before.

## The flow

1. **Customer** finishes signup (any account type). Every existing gate runs as
   before: identity numbers, the OCR-checked documents, the GSTIN, the signed
   contract. Then, instead of writing `itd_users`, the server files an
   application (`account_applications`), fills the guest profile from the form,
   makes the browser a guest on that number, and copies the Aadhaar into guest
   KYC so they can book without uploading it again. No ITD `add_customer` call:
   the team creates the customer in ITD itself.
2. **Customer** sees *Application sent*, then an "Account being set up" card on
   Home and My Profile. They can book as a guest, edit and resend the
   application while nobody has picked it up, or withdraw it.
3. **Ops** picks it up from the queue (`claim`), reads the details, documents,
   Cashfree results, and any other account or application with the same GSTIN
   or email. Then one of:
   - **Request changes**: a note plus the fields and documents to fix. The
     customer gets a notification and email; *Make the change* reopens signup
     filled in; resending runs every gate again.
   - **Reject**: a reason, shown to the customer word for word. They stay a
     guest and can apply again.
   - **Approve**: create the customer and login in ITD first, set the contract
     head / group code the console shows, then enter the ITD email and password.
4. **Approve** checks the login against ITD (a typo fails here), refuses a
   number or login already linked to someone else, writes the account with the
   password encrypted, moves the documents, identity numbers and guest orders
   onto it, copies the Aadhaar for customs, and sends the email.
5. **Email** (Bombino SMTP): the ITD login email and password, account type,
   customer code, documents on file (last four digits only, no attachments),
   and the signed contract PDF. The customer signs in to the app with their
   mobile number as before.

If anything after the account is written fails (moving documents, the email),
the application stays **approved** with `finalize_error` / `email_error` set, and
*Retry* / *Resend email* re-run the rest. Nothing runs twice.

## The ops console screens

**Applications** in the ops side menu (`client/src/lib/opsNav.ts`; in the More
sheet on a phone):

- `/ops/applications` (`pages/ops/OpsApplications.tsx`): the queue. Filter by
  Open / New / In review / Waiting on customer / Approved / Rejected / All.
  Oldest first; the wait reads "5 min", "3 hrs", "2 days"; anything open for
  more than two days shows its wait in red, and an approved one that didn't
  fully finish is flagged. The side menu's Applications item carries a pill
  counting applications waiting to be picked up that are new since you last
  opened it (sent, edited, resent, or put back); Pickups and Drop-offs carry the
  same for new orders (`hooks/useOpsNavBadges.ts`).
- `/ops/applications/:id` (`pages/ops/OpsApplicationDetail.tsx`): details,
  documents with Cashfree's result (View, for any ops reviewer), same GSTIN/email
  elsewhere, and history (newest first: who did it, when, and what was asked,
  said or emailed). On the right, the actions this status allows: Pick up,
  Approve (the ITD setup steps, contract head and group code, then the login),
  Request changes (tick fields and documents, write the note), Reject (reason).
  On an approved one: Retry and Send the email.

## API for the ops console

All `admin` / `super_admin`, the document view included: reviewers are usually
plain admins. Every view is logged in `document_access_log`. (A customer's
documents, once the account is open, stay `super_admin`.)

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/api/ops/applications?status=open` | | `open` (default), `all`, or one status. Oldest first. |
| GET | `/api/ops/applications/:id` | | `application`, `documents` (slot, label, provided, last-four number, `ocr_status`), `duplicates`, `events`, `itd_setup` (`contract_head`, `group_code`), `allowed_actions` |
| GET | `/api/ops/applications/:id/documents/:slot/file` | | The file. Logged. |
| POST | `/api/ops/applications/:id/documents/:slot/verify` | | A reviewer verifies a document by hand: sets `ocr_verified_by/at`; Cashfree's `ocr_status` is left as the first-layer verdict. **Required on every document before approve** (`409 DOCUMENTS_NOT_VERIFIED`). Cleared when the customer uploads a new file. History keeps who, with Cashfree's verdict. Needs `migrations/add_manual_document_verification.sql`. |
| POST | `/api/ops/applications/:id/actions` | `{ action: "claim" }` | → `in_review`, reviewer = you |
| | | `{ action: "release" }` | back to `submitted` (reviewer or super_admin) |
| | | `{ action: "request_changes", fields: [...], slots: [...], note }` | fields from `APPLICATION_FIELD_LABELS`, slots from `DocSlot`; `note` optional (max 1000), but at least one field, slot or note (`NOTHING_REQUESTED`) |
| | | `{ action: "reject", reason }` | |
| | | `{ action: "approve", itd_email, itd_password }` | the whole of step 4 |
| | | `{ action: "retry_finalize" }` / `{ action: "resend_email" }` | on an approved one |
| PUT | `/api/ops/customers/:id/itd-credentials` | `{ itd_email, itd_password }` | a new ITD login for an account (password changed in ITD, or an account opened before review) |

Every status change is a conditional UPDATE, so two people pressing the same
button get one success and one `409 APPLICATION_STATE_CHANGED`. Refresh on 409.

Errors from approve worth showing as they come: `ITD_LOGIN_FAILED`,
`PHONE_LINKED_ELSEWHERE`, `ITD_LOGIN_LINKED_ELSEWHERE`, `ENCRYPTION_UNAVAILABLE`,
`ACCOUNT_WRITE_FAILED`.

## Customer API

| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/signup/personal` · `/company` | Unchanged request. With review on: `202 { status: "application_submitted", application }` |
| GET | `/api/signup/application` | `{ enabled, application }` for the guest on this session |
| POST | `/api/signup/application/withdraw` | |
| GET | `/api/guest/profile` | now also `application` |
| POST | `/api/auth/phone/continue` | `status: "guest"` now also carries `application` |

## Switching it on

1. Run `migrations/add_account_applications.sql`.
2. Merge with Arbaaz's ops console branch. Only `opsNav.ts` and `routes.ops.tsx`
   are touched on both sides.
3. Mail. For now a Google account sends everything: `SMTP_USER` (the account)
   and `GOOGLE_APP_PASS` (its app password). Later, `SMTP_*` and `MAIL_FROM`
   from Bombino, with SPF/DKIM/DMARC on their domain. Without mail, approval
   still works and the email can be resent later.
4. Run `migrations/add_ops_settings.sql`, then set who hears about new
   applications on the Applications page ("New-application emails", with a
   "Send a test" button). Until then `APPLICATION_ALERT_EMAILS` is the fallback.
   The team is emailed on a new application and when a customer sends back
   requested changes, not on an edit before anyone has picked it up. At the
   same moments the customer gets a "we've received your application" (or
   "…your changes") email; it shows in the application's history.
5. `ACCOUNT_REVIEW=1`.

## Decisions taken, and what's left open

- **All account types** are reviewed.
- **The email carries the ITD password in plain text.** Bombino's choice. It is
  never logged or stored unencrypted (`email_error` is scrubbed); Bombino should
  set a password the customer changes on first portal sign-in.
- **Open:** WhatsApp messages for "account ready" / "changes needed" need a new
  Meta-approved template. Not sent yet; in-app and email only.
- **Any ops reviewer (admin or super_admin) can open an application's
  documents.** Each view is logged. Customer documents after opening keep
  G3's `super_admin` rule.
- **Open:** guest booking switched off in ops settings (S2) would lock waiting
  applicants out of booking too. Decide whether they are exempt.
- A company applicant booking as a guest still needs a personal identity
  document; the company PAN doesn't count for guest KYC.
- Accounts opened before review keep their `local-…` id and no ITD login; the
  credentials endpoint can attach one.
