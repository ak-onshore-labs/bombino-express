/**
 * An account application: signup, held for the Bombino team.
 *
 * With ACCOUNT_REVIEW on, finishing signup no longer opens an account. It files
 * an application that the team reviews in the ops console, and the account is
 * opened only when someone there creates the customer in ITD and enters the
 * login it was given (server/accountApproval.ts). Until then the customer uses
 * the app as a guest on the same number.
 *
 * One vocabulary for the three readers: the customer app, the ops console and
 * BIA. Adding a status means adding it here, and each reader picks it up.
 */

export const APPLICATION_STATUSES = [
  "submitted",
  "in_review",
  "changes_requested",
  "approved",
  "rejected",
  "withdrawn",
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export function isApplicationStatus(value: unknown): value is ApplicationStatus {
  return typeof value === "string" && (APPLICATION_STATUSES as readonly string[]).includes(value);
}

/**
 * Still waiting on somebody. One of these per phone at most — the partial
 * unique index in migrations/add_account_applications.sql holds that.
 */
export const OPEN_APPLICATION_STATUSES = [
  "submitted",
  "in_review",
  "changes_requested",
] as const satisfies readonly ApplicationStatus[];

export function isOpenApplicationStatus(status: ApplicationStatus): boolean {
  return (OPEN_APPLICATION_STATUSES as readonly string[]).includes(status);
}

/**
 * Whether the customer may replace what they sent.
 *
 * `submitted`: nobody has picked it up yet, so a corrected email reaches the
 * reviewer before they read the wrong one. `changes_requested`: the team asked
 * for exactly that. `in_review` is locked: a reviewer is reading it, and the
 * email in particular is where the login will be sent.
 */
export function customerCanEdit(status: ApplicationStatus): boolean {
  return status === "submitted" || status === "changes_requested";
}

/** What an ops reviewer can do to an application, and from where. */
export const OPS_APPLICATION_ACTIONS = [
  "claim",
  "release",
  "request_changes",
  "reject",
  "approve",
  "retry_finalize",
  "resend_email",
] as const;

export type OpsApplicationAction = (typeof OPS_APPLICATION_ACTIONS)[number];

export function isOpsApplicationAction(value: unknown): value is OpsApplicationAction {
  return typeof value === "string" && (OPS_APPLICATION_ACTIONS as readonly string[]).includes(value);
}

/**
 * The statuses each action may start from.
 *
 * `approve` from `submitted` as well as `in_review`: a reviewer who opens an
 * application and approves it in one sitting should not have to press "claim"
 * first. The conditional UPDATE behind it is what stops two people doing it at
 * once, not this table.
 */
export const ACTION_FROM: Record<OpsApplicationAction, readonly ApplicationStatus[]> = {
  claim: ["submitted"],
  release: ["in_review"],
  request_changes: ["submitted", "in_review"],
  reject: ["submitted", "in_review", "changes_requested"],
  approve: ["submitted", "in_review"],
  // Both run on an application that is already approved: the account exists,
  // and something after it (claiming, the email) did not finish or needs
  // sending again.
  retry_finalize: ["approved"],
  resend_email: ["approved"],
};

export function actionAllowed(action: OpsApplicationAction, status: ApplicationStatus): boolean {
  return ACTION_FROM[action].includes(status);
}

/** The customer's words for each status. BIA reads these as well. */
export const APPLICATION_STATUS_COPY: Record<ApplicationStatus, { title: string; body: string }> = {
  submitted: {
    title: "Account being set up",
    body: "The Bombino team is setting up your account. You can book as a guest in the meantime.",
  },
  in_review: {
    title: "Account being set up",
    body: "The Bombino team is reviewing your details. You can book as a guest in the meantime.",
  },
  changes_requested: {
    title: "Your application needs a change",
    body: "The Bombino team asked for a change before they can open your account.",
  },
  approved: {
    title: "Your account is ready",
    body: "Your account is open. Sign in again with your mobile number to use it.",
  },
  rejected: {
    title: "Account not opened",
    body: "The Bombino team could not open this account. You can still book as a guest.",
  },
  withdrawn: {
    title: "Application withdrawn",
    body: "You withdrew this application. You can still book as a guest, or apply again.",
  },
};

/**
 * The form fields a reviewer can ask to be changed, in the customer's words.
 * Keys are the signup request's own field names.
 */
export const APPLICATION_FIELD_LABELS = {
  full_name: "Full name",
  email: "Email",
  company_name: "Company name",
  gstin: "GST number",
  contact_person: "Contact person",
  address: "Registered address",
  pincode: "Pincode",
  city: "City",
  state: "State",
  hub_id: "Servicing hub",
  lut_no: "LUT number",
  iec_branch_code: "IEC branch code",
  bank_account_no: "Bank account number",
  bank_ad_code: "Bank AD code",
  account_type: "Account type",
} as const;

export type ApplicationField = keyof typeof APPLICATION_FIELD_LABELS;

export function isApplicationField(value: unknown): value is ApplicationField {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(APPLICATION_FIELD_LABELS, value);
}

/**
 * What the team asked to be changed: field names and document slots, plus an
 * optional note (empty string when none). At least one of the three is set.
 */
export interface RequestedChanges {
  /** Form fields, by their signup names: `email`, `company_name`, `gstin`, … */
  fields: string[];
  /** Document slots (shared/accountSpec.ts §DocSlot) to upload again. */
  slots: string[];
  note: string;
}

/** The application as the customer sees it. Nothing about the reviewer. */
export interface CustomerApplicationView {
  id: string;
  status: ApplicationStatus;
  account_type: "personal" | "company";
  company_category: string | null;
  submitted_at: string;
  decided_at: string | null;
  requested_changes: RequestedChanges | null;
  /** The team's reason, on a rejection. Shown word for word. */
  decision_note: string | null;
  can_edit: boolean;
}
