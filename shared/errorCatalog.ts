/**
 * Every error a customer can hit while signing up, proving who they are,
 * booking or paying — one stable code each, and one explanation.
 *
 * The server sends the code next to its message (`{ message, code }`); the
 * client reads it with `parseApiErrorCode`. The message the customer sees is
 * still the server's own and is not replaced by anything here. What this file
 * adds is the part a one-line message leaves out — why it happened and what to
 * do — so that an upload screen, a booking form and BIA all explain the same
 * error the same way.
 *
 * Adding a code: add the entry here, send it from the route, and run
 * `npm test`. `shared/errorCatalog.test.ts` scans the routes and fails on any
 * code that is neither explained here nor listed in UNCATALOGUED_CODES.
 *
 * Copy rules: plain words, from the customer's side of the screen, never
 * blaming them. `fix` says what to do, not what went wrong again.
 */

/** Where in the app an error is raised. */
export type ErrorArea = "auth" | "signup" | "documents" | "booking" | "payment";

/**
 * A BIA button that takes the customer to the fix, when the fix is somewhere
 * other than the screen they're on. Same vocabulary as server/supportCta.ts.
 */
export type ErrorButton = "TAP_CONTACT_US" | "TAP_LOCATIONS" | "TAP_CREATE_SHIPMENT";

export interface ErrorExplanation {
  area: ErrorArea;
  /** What went wrong, in a few words. */
  title: string;
  /** Why it happens. */
  why: string;
  /** What to do about it. */
  fix: string;
  button?: ErrorButton;
}

export const ERROR_CATALOG = {
  // ── Phone and one-time codes ──────────────────────────────────────────────
  phone_unverified: {
    area: "auth",
    title: "Your phone number needs verifying",
    why: "A one-time code proves the number is yours. That proof only lasts a few minutes, so it can run out if a step takes a while.",
    fix: "Request a new code, enter it, and carry on.",
  },
  OTP_RATE_LIMITED: {
    area: "auth",
    title: "Too many codes requested",
    why: "To protect your number, only a few codes can be sent to it in an hour.",
    fix: "Wait a little and try again. The limit resets within the hour.",
  },
  OTP_SEND_FAILED: {
    area: "auth",
    title: "The code couldn't be sent",
    why: "Something failed on our side while sending it.",
    fix: "Try again in a moment. If it keeps failing, contact support.",
    button: "TAP_CONTACT_US",
  },
  OTP_NOT_REQUESTED: {
    area: "auth",
    title: "No code is waiting for this number",
    why: "Either no code was sent to this number, or it has already been used.",
    fix: "Request a new code.",
  },
  OTP_EXPIRED: {
    area: "auth",
    title: "That code has expired",
    why: "Each code only works for a few minutes.",
    fix: "Request a new code and enter it straight away.",
  },
  OTP_TOO_MANY_ATTEMPTS: {
    area: "auth",
    title: "Too many wrong codes",
    why: "After several wrong tries a code is locked, to keep your number safe.",
    fix: "Request a new code.",
  },
  OTP_WRONG: {
    area: "auth",
    title: "That code isn't right",
    why: "It doesn't match the code we sent. If you asked for more than one, only the newest works.",
    fix: "Enter the 6 digits from the latest message.",
  },
  ACCOUNT_EXISTS: {
    area: "auth",
    title: "This number already has an account",
    why: "Each phone number can hold one Bombino account.",
    fix: "Sign in with this number instead.",
  },
  PHONE_LINKED_ELSEWHERE: {
    area: "auth",
    title: "This number belongs to another account",
    why: "The mobile number is already linked to a different Bombino account.",
    fix: "Sign in with that number, or contact support to move it.",
    button: "TAP_CONTACT_US",
  },

  // ── Identity numbers (the step before documents) ─────────────────────────
  AADHAAR_INVALID: {
    area: "signup",
    title: "That Aadhaar number isn't valid",
    why: "An Aadhaar number is 12 digits and the last one is a check digit, so a single wrong digit makes the whole number invalid.",
    fix: "Copy it again from your Aadhaar card or letter.",
  },
  PAN_INVALID: {
    area: "signup",
    title: "That PAN isn't valid",
    why: "A PAN is 10 characters: five letters, four digits and one letter, like ABCDE1234F.",
    fix: "Copy it again from your PAN card.",
  },
  GSTIN_INVALID: {
    area: "signup",
    title: "That GST number isn't valid",
    why: "A GSTIN is 15 characters and ends in a check character, so a single wrong character makes it invalid.",
    fix: "Copy it again from your GST certificate.",
  },
  COMPANY_NAME_REQUIRED: {
    area: "signup",
    title: "Add the company name",
    why: "The GST number is checked against the name of the business it belongs to.",
    fix: "Enter the company name as it appears on the GST certificate.",
  },
  IDENTITY_REJECTED: {
    area: "signup",
    title: "The GST portal didn't confirm this number",
    why: "The GST portal didn't confirm this GST number as active for this business.",
    fix: "Check the number and the company name. If both are right, contact support.",
    button: "TAP_CONTACT_US",
  },
  IDENTITY_EXPIRED: {
    area: "signup",
    title: "The check timed out",
    why: "The verification took too long to finish.",
    fix: "Start the check again.",
  },
  IDENTITY_UNAVAILABLE: {
    area: "signup",
    title: "The number couldn't be checked just now",
    why: "The checking service didn't respond. This isn't a problem with your number.",
    fix: "Try again in a few minutes.",
  },
  IDENTITY_MISSING: {
    area: "signup",
    title: "A required number hasn't been entered",
    why: "Your Aadhaar, PAN or GST number is taken before the documents, so each document can be matched to it.",
    fix: "Go back to the identity step and enter it.",
  },
  IDENTITY_NAME_MISMATCH: {
    area: "signup",
    title: "The number was checked under a different name",
    why: "Your PAN or GST number was verified for one name, and the account is being opened under another.",
    fix: "Verify it again under the name you're using now, or change the name back.",
  },
  GSTIN_CHANGED: {
    area: "signup",
    title: "The GST number changed after it was verified",
    why: "The form now has a different GST number from the one that was checked.",
    fix: "Verify the new GST number, or change it back to the one already verified.",
  },
  IDENTITY_NUMBER_FIRST: {
    area: "documents",
    title: "Enter the number before uploading",
    why: "Each document is matched against its number, so the number comes first.",
    fix: "Enter the number on the identity step, then upload the document.",
  },
  EXTRA_FIELD_INVALID: {
    area: "signup",
    title: "A business detail isn't in the right format",
    why: "The LUT number, IEC branch code, bank account number and AD code each have a set format.",
    fix: "Check the field named in the message against your paperwork.",
  },

  // ── Documents ─────────────────────────────────────────────────────────────
  DOCUMENT_NUMBER_INVALID: {
    area: "documents",
    title: "The document number isn't in the right format",
    why: "Each kind of document has its own number format.",
    fix: "Check the number against the document and enter it again.",
  },
  FILE_MISSING: {
    area: "documents",
    title: "No file was attached",
    why: "The upload arrived without a file.",
    fix: "Choose the photo or PDF again and upload it.",
  },
  OCR_MISMATCH: {
    area: "documents",
    title: "The number on the document doesn't match",
    why: "The number read from the document is different from the one you entered.",
    fix: "If you mistyped the number, reset it on the identity step. If it's the wrong card, upload the right one.",
  },
  OCR_WRONG_DOCUMENT: {
    area: "documents",
    title: "That's a different kind of document",
    why: "The file looks like another document from the one this slot asks for, such as a PAN card where Aadhaar is needed.",
    fix: "Upload the document this slot asks for.",
  },
  OCR_TAMPERED: {
    area: "documents",
    title: "This file can't be accepted",
    why: "It looks like a screenshot or an edited image. Only a photo or scan of the original passes.",
    fix: "Take a photo of the original document and upload that.",
  },
  OCR_UNREADABLE: {
    area: "documents",
    title: "The document couldn't be read",
    why: "Blur, glare or a cut-off edge can hide the number.",
    fix: "Retake the photo in daylight, flat, without flash, with all four corners in the frame.",
  },
  OCR_UNAVAILABLE: {
    area: "documents",
    title: "The document couldn't be checked just now",
    why: "Our document checker didn't respond. Your file is saved, and this isn't a problem with the document.",
    fix: "Try uploading it again in a few minutes.",
  },
  DOCUMENTS_MISSING: {
    area: "documents",
    title: "Some documents are still needed",
    why: "Your account type needs each of the documents listed before it can open.",
    fix: "Upload the documents named in the message.",
  },
  DOCUMENTS_UNVERIFIED: {
    area: "documents",
    title: "A document couldn't be verified",
    why: "The number on it couldn't be confirmed, usually because the photo isn't clear enough.",
    fix: "Upload a clear photo of the original, and check the number you entered.",
  },
  DOCUMENTS_OUTDATED: {
    area: "documents",
    title: "A document was uploaded for an old number",
    why: "It was uploaded before you changed the number it belongs to.",
    fix: "Upload the document again so it matches the number now on file.",
  },
  GSTIN_NOT_ON_FILE: {
    area: "documents",
    title: "This account has no GST number",
    why: "A GST certificate is checked against the account's GST number, and there isn't one on this account.",
    fix: "Contact support to add it.",
    button: "TAP_CONTACT_US",
  },

  // ── Account applications (account review) ────────────────────────────────
  APPLICATION_IN_REVIEW: {
    area: "signup",
    title: "Your application is being reviewed",
    why: "Someone on the Bombino team is reading it right now, so it can't be changed while they do.",
    fix: "Wait for their decision. If they need a change, they'll say what, and you can make it then.",
  },
  APPLICATION_OPEN: {
    area: "signup",
    title: "You already have an application open",
    why: "Each mobile number can have one account application at a time.",
    fix: "Refresh to see it on My Profile.",
  },
  APPLICATION_UNAVAILABLE: {
    area: "signup",
    title: "Your application couldn't be sent",
    why: "Something failed on our side while saving it. Everything you entered and uploaded is still saved.",
    fix: "Try again in a moment. If it keeps failing, contact support.",
    button: "TAP_CONTACT_US",
  },
  NO_OPEN_APPLICATION: {
    area: "signup",
    title: "There's no open application",
    why: "It has already been decided or withdrawn.",
    fix: "Check My Profile for where it stands.",
  },
  APPLICATION_STATE_CHANGED: {
    area: "signup",
    title: "Your application just changed",
    why: "The Bombino team acted on it while you were on this screen.",
    fix: "Refresh to see where it stands now.",
  },

  // ── Booking ───────────────────────────────────────────────────────────────
  KYC_REQUIRED: {
    area: "booking",
    title: "Add your identity document first",
    why: "One identity document has to be on file before your first booking. You only give it once.",
    fix: "Add it in the identity section of the booking form, then book.",
  },
  CONTRACT_REQUIRED: {
    area: "booking",
    title: "Accept the shipping terms",
    why: "Every booking needs the shipping terms accepted and signed with your full name.",
    fix: "Tick the terms and type your full name to sign.",
  },
  PICKUP_DATE_REQUIRED: {
    area: "booking",
    title: "Choose a pickup date",
    why: "A doorstep pickup needs a date for the rider.",
    fix: "Pick a date on the sender step.",
  },
  // Raised by the booking form itself (CreateShipment §handleSubmit), not the server.
  PRODUCT_TYPE_REQUIRED: {
    area: "booking",
    title: "Choose what you're sending",
    why: "The product type decides the customs paperwork for the parcel.",
    fix: "Choose one on the package step: Documents (DOX) for paper only, Package (SPX) for other goods, or Commercial for goods you're selling.",
  },
  PAY_AT_PICKUP_NEEDS_PICKUP: {
    area: "booking",
    title: "Pay at pickup needs a doorstep pickup",
    why: "The rider takes the payment at your door, so there's no one to pay on a drop-off.",
    fix: "Switch to doorstep pickup, or choose another way to pay.",
  },
  PAY_AT_DROPOFF_NEEDS_DROPOFF: {
    area: "booking",
    title: "Pay at drop-off needs a counter drop-off",
    why: "The payment is taken at our counter, so it doesn't work with a doorstep pickup.",
    fix: "Switch to drop-off, or choose another way to pay.",
  },
  PICKUP_PINCODE_NOT_SERVICEABLE: {
    area: "booking",
    title: "No doorstep pickup at this pincode yet",
    why: "Our riders don't cover this area yet.",
    fix: "Drop the parcel at a Bombino counter instead.",
    button: "TAP_LOCATIONS",
  },
  PICKUP_DATE_TOO_EARLY: {
    area: "booking",
    title: "Today's pickup cut-off has passed",
    why: "Each city has a same-day cut-off. Bookings after it are picked up from the next day.",
    fix: "Choose the next available date.",
  },
  ORDER_CREATE_FAILED: {
    area: "booking",
    title: "The booking didn't go through",
    why: "Something failed on our side while saving it. Nothing was booked.",
    fix: "Try again. If it fails twice, contact support.",
    button: "TAP_CONTACT_US",
  },

  // ── Paying online (server/routes/payments.ts) ─────────────────────────────
  ALREADY_PAID: {
    area: "payment",
    title: "This order is already paid",
    why: "A payment for it has already gone through.",
    fix: "There's nothing more to pay on this order.",
  },
  NO_AMOUNT_DUE: {
    area: "payment",
    title: "Nothing to pay on this order yet",
    why: "The order doesn't have an amount to pay at the moment.",
    fix: "Check the order again later. If you think something is due, contact support.",
    button: "TAP_CONTACT_US",
  },
  ORDER_CANCELLED: {
    area: "payment",
    title: "This order is cancelled",
    why: "A cancelled order can't be paid for.",
    fix: "There's nothing to pay. Book again if you still want to send the parcel.",
    button: "TAP_CREATE_SHIPMENT",
  },
  GATEWAY_UNCONFIGURED: {
    area: "payment",
    title: "Online payment is unavailable right now",
    why: "Paying in the app is switched off at the moment.",
    fix: "Choose another way to pay for this booking.",
  },
  GATEWAY_ERROR: {
    area: "payment",
    title: "The payment couldn't be started",
    why: "The payment provider didn't respond before checkout opened, so no money was taken.",
    fix: "Try again in a moment.",
  },
  PAYMENT_FAILED: {
    area: "payment",
    title: "The payment didn't go through",
    why: "The bank or the payment provider declined it.",
    fix: "Try again or use another payment method. If money was taken for a failed payment, contact support with your Order ID.",
    button: "TAP_CONTACT_US",
  },
  SIGNATURE_MISMATCH: {
    area: "payment",
    title: "The payment couldn't be confirmed",
    why: "The confirmation that came back from the payment provider couldn't be verified.",
    fix: "If money left your account, contact support with your Order ID.",
    button: "TAP_CONTACT_US",
  },
  CONFIRMATION_PENDING: {
    area: "payment",
    title: "The payment is being confirmed",
    why: "The payment was received and is waiting for the provider's confirmation.",
    fix: "Give it a minute. The order shows as paid once it's confirmed.",
  },
} as const satisfies Record<string, ErrorExplanation>;

export type ErrorCode = keyof typeof ERROR_CATALOG;

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ERROR_CATALOG, value);
}

/** The explanation for a code, or null when the code isn't a catalogued one. */
export function explainError(code: string | null | undefined): ErrorExplanation | null {
  return isErrorCode(code) ? ERROR_CATALOG[code] : null;
}

/**
 * The code for a document reader's verdict (server/cashfreeOcr.ts, and the
 * GST certificate reader, which shares the same statuses). Null for a verdict
 * that needs no explaining: `match`, `bypassed`, `skipped`.
 *
 * `unreadable` and `unavailable` don't refuse the upload — the file is kept —
 * but the customer still needs to hear what they mean, so they are here too.
 */
export function ocrErrorCode(status: string | null | undefined): ErrorCode | null {
  switch (status) {
    case "mismatch":
      return "OCR_MISMATCH";
    case "wrong_document":
      return "OCR_WRONG_DOCUMENT";
    case "tampered":
      return "OCR_TAMPERED";
    case "unreadable":
      return "OCR_UNREADABLE";
    case "unavailable":
      return "OCR_UNAVAILABLE";
    default:
      return null;
  }
}

/** The code for an identity check that failed (server/cashfreeIdentity.ts). */
export function identityFailureCode(failure: string): ErrorCode {
  switch (failure) {
    case "rejected":
      return "IDENTITY_REJECTED";
    case "expired":
      return "IDENTITY_EXPIRED";
    default:
      return "IDENTITY_UNAVAILABLE";
  }
}

/**
 * Codes the server sends that deliberately have no customer explanation yet:
 * rider and ops actions, and a few order-page errors. Listed so the catalog
 * test can tell "not for customers" from "forgotten". Move a code into
 * ERROR_CATALOG when a screen or BIA needs to explain it.
 */
export const UNCATALOGUED_CODES = [
  "ACCOUNT_SESSION",
  "ACTION_NOT_AVAILABLE",
  "BAD_TRANSITION",
  "CODE_ISSUE_FAILED",
  "FORBIDDEN",
  "INVALID_AGENT",
  // Ops console: marking an application's document verified by hand.
  "ALREADY_VERIFIED",
  "DOCUMENT_NOT_UPLOADED",
  "VERIFY_UNAVAILABLE",
  // Ops console: reviewing an application, and opening the account after it.
  "ITD_LOGIN_LINKED_ELSEWHERE",
  "NOTE_TOO_LONG",
  "NOTHING_REQUESTED",
  "UNKNOWN_DOCUMENT",
  "UNKNOWN_FIELD",
  // Ops console: who is emailed about new applications.
  "INVALID_EMAILS",
  "MAIL_FAILED",
  "NO_RECIPIENTS",
  "SETTINGS_UNAVAILABLE",
  "INVALID_PAYLOAD",
  "INVALID_REQUEST",
  "NO_HANDOVER_DUE",
  "NO_OPEN_REQUEST",
  "NO_ORDER",
  "NOT_IMPLEMENTED",
  "NUDGES_NOT_SET_UP",
  "ORDER_MISMATCH",
  "ORDER_NOT_FOUND",
  "ORDER_STATE_CHANGED",
  "OTP_REQUIRED",
  "PASSWORD_REQUIRED",
  "PAYMENT_METHOD_MISMATCH",
  "PAYMENT_WRITE_FAILED",
  "PICKUP_ALREADY_CLAIMED",
  "REASON_REQUIRED",
  "RETRY_REPRICE",
  "TEST_MODE_DISABLED",
  "UNKNOWN_ACTION",
] as const;
