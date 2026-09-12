/**
 * Where a signup, or an account's documents, stand (BIA 3.0, package 2.2):
 * get_signup_progress while an account is being opened, get_document_status
 * once it exists.
 *
 * Read-only, and owned by the session alone: a signup is the session's own
 * signupRef (bound to the phone it verified, as signupRefForReading in
 * routes.ts), an account is its dbUserId. The model passes nothing.
 *
 * What leaves this file:
 *   - identity numbers as their last four characters, never more
 *   - a document as on file, needing attention, or still to upload. `bypassed`
 *     and `skipped` read as on file with nothing said about checking, since
 *     while Cashfree runs on test credentials nothing was checked and the
 *     customer is never told so. Only `match` may say it matched.
 */

import { getAccountShapeById } from "./appDb.js";
import { listDocumentsBySignupRef, listDocumentsByUserId } from "./accountDocsDb.js";
import { listIdentityVerificationsBySignupRef } from "./identityDb.js";
import { ownerOf } from "./supportOrders.js";
import type { BiaTool, SupportChatContext, ToolOutcome } from "./supportTypes.js";
import { accountChoiceLabel, type AccountChoice } from "../shared/accountMatch.js";
import {
  COMPANY_CATEGORIES,
  COMPANY_CATEGORY_SPECS,
  DOC_SLOT_SPECS,
  DOC_SLOTS,
  isDocSlot,
  isVerifiedDocSlot,
  requiredDocuments,
  type CompanyCategory,
  type DocSlot,
} from "../shared/accountSpec.js";
import type { DocStatusCard } from "../shared/biaCards.js";
import { explainError, ocrErrorCode } from "../shared/errorCatalog.js";

// ─── The summary (pure) ──────────────────────────────────────────────────────

/** An account kind, or "company" when it's a business but the category isn't known. */
export type DocSetShape = AccountChoice | "company";

export interface SlotRecord {
  doc_slot: string;
  ocr_status: string | null;
}

export interface NumberRecord {
  kind: string;
  document_no: string | null;
}

export interface DocItem {
  slot: DocSlot;
  label: string;
  state: "on_file" | "attention" | "missing";
  /** Short, for the card. Null when there is nothing to add. */
  note: string | null;
  /** What to do, for the model. Null unless it needs attention. */
  fix: string | null;
}

export interface DocumentSummary {
  shape: DocSetShape | null;
  items: DocItem[];
  /** Required documents on file (attention ones included: they're uploaded). */
  uploaded: number;
  /** How many are required; null when the category isn't known. */
  total: number | null;
  numbers: { label: string; lastFour: string }[];
}

const NUMBER_LABELS: Record<string, string> = { aadhaar: "Aadhaar", pan: "PAN", gstin: "GST number" };

/** What every company category asks for; the rest depends on which one. */
const COMPANY_COMMON_DOCS: readonly DocSlot[] = DOC_SLOTS.filter((slot) =>
  COMPANY_CATEGORIES.every((c) => COMPANY_CATEGORY_SPECS[c].documents.includes(slot))
);

function lastFour(documentNo: string | null): string | null {
  const s = (documentNo ?? "").replace(/\s+/g, "");
  return s.length >= 4 ? s.slice(-4) : null;
}

/**
 * The kind of account these rows belong to, when the screen didn't say: a GST
 * number or certificate means a business; an Aadhaar means a person. Null when
 * nothing tells them apart yet (a PAN alone could be either).
 */
export function inferShape(numbers: readonly NumberRecord[], documents: readonly SlotRecord[]): DocSetShape | null {
  const kinds = new Set(numbers.map((n) => n.kind));
  const slots = new Set(documents.map((d) => d.doc_slot));
  if (kinds.has("gstin") || slots.has("gst_certificate") || slots.has("iec_certificate")) return "company";
  if (kinds.has("aadhaar") || slots.has("aadhaar_card")) return "personal";
  return null;
}

function requiredFor(shape: DocSetShape | null): readonly DocSlot[] | null {
  if (!shape) return null;
  if (shape === "personal") return requiredDocuments("personal");
  if (shape === "company") return null;
  return requiredDocuments("company", shape as CompanyCategory);
}

function itemFor(slot: DocSlot, row: SlotRecord | undefined): DocItem {
  const label = DOC_SLOT_SPECS[slot].label;
  if (!row) return { slot, label, state: "missing", note: null, fix: null };
  // Bills, letters and the IEC certificate are on file by being there.
  if (!isVerifiedDocSlot(slot)) return { slot, label, state: "on_file", note: null, fix: null };
  if (row.ocr_status === "match") return { slot, label, state: "on_file", note: "Matches the number given", fix: null };
  const problem = explainError(ocrErrorCode(row.ocr_status));
  if (!problem) return { slot, label, state: "on_file", note: null, fix: null };
  return { slot, label, state: "attention", note: problem.title, fix: problem.fix };
}

export function summarizeDocuments(
  shape: DocSetShape | null,
  numbers: readonly NumberRecord[],
  documents: readonly SlotRecord[]
): DocumentSummary {
  const bySlot = new Map<string, SlotRecord>();
  for (const d of documents) if (isDocSlot(d.doc_slot)) bySlot.set(d.doc_slot, d);

  const required = requiredFor(shape);
  // With the list unknown: what every company needs, or nothing, plus
  // whatever has been uploaded — in the order the form shows them.
  const base = required ?? (shape === "company" ? COMPANY_COMMON_DOCS : []);
  const slots = [...base, ...DOC_SLOTS.filter((slot) => !base.includes(slot) && bySlot.has(slot))];
  const items = slots.map((slot) => itemFor(slot, bySlot.get(slot)));

  const countable = required ? items.filter((i) => required.includes(i.slot)) : items;
  return {
    shape,
    items,
    uploaded: countable.filter((i) => i.state !== "missing").length,
    total: required ? required.length : null,
    numbers: numbers.flatMap((n) => {
      const four = lastFour(n.document_no);
      const label = NUMBER_LABELS[n.kind];
      return four && label ? [{ label, lastFour: four }] : [];
    }),
  };
}

/** The summary as text for the model. */
export function describeSummary(summary: DocumentSummary): string {
  const lines: string[] = [];
  if (summary.numbers.length > 0) {
    lines.push(`Numbers recorded: ${summary.numbers.map((n) => `${n.label} ending ${n.lastFour}`).join(", ")}.`);
  }
  lines.push(
    summary.total !== null
      ? `Documents: ${summary.uploaded} of ${summary.total} uploaded.`
      : `Documents uploaded so far: ${summary.uploaded}. The full list depends on the account type, which isn't known yet.`
  );
  for (const item of summary.items) {
    if (item.state === "missing") lines.push(`- ${item.label}: still to upload.`);
    else if (item.state === "attention") lines.push(`- ${item.label}: uploaded, but ${item.note?.toLowerCase()}. What to do: ${item.fix}`);
    else lines.push(`- ${item.label}: on file${item.note ? `; ${item.note.toLowerCase()}` : ""}.`);
  }
  if (summary.shape === "company") {
    lines.push("Corporate and FBB accounts also need an electricity bill and a telephone bill; E-commerce also asks for its LUT and bank details.");
  }
  return lines.join("\n");
}

export function docStatusCard(scope: "signup" | "account", title: string, summary: DocumentSummary): DocStatusCard {
  return {
    kind: "docStatus",
    scope,
    title,
    done: summary.uploaded,
    total: summary.total,
    items: summary.items.map((i) => ({ label: i.label, state: i.state, note: i.note })),
  };
}

const STYLE_NOTE =
  "Say where they stand in one or two sentences: how many are uploaded and what still needs doing. The card under your reply lists every document, so don't list them all. Never say more than the last four characters of any number.";

// ─── get_signup_progress ─────────────────────────────────────────────────────

export interface SignupRecords {
  numbers: NumberRecord[];
  documents: SlotRecord[];
}

type SignupLoader = (signupRef: string) => Promise<SignupRecords>;

const loadFromDatabase: SignupLoader = async (signupRef) => {
  const [numbers, documents] = await Promise.all([
    listIdentityVerificationsBySignupRef(signupRef),
    listDocumentsBySignupRef(signupRef),
  ]);
  return { numbers, documents };
};

let loadSignup: SignupLoader = loadFromDatabase;

/**
 * Where signup records come from. Only the eval runner calls this, to stage a
 * half-finished signup without writing one to the shared database.
 */
export function replaceSignupLoader(loader: SignupLoader | null): void {
  loadSignup = loader ?? loadFromDatabase;
}

export async function executeGetSignupProgress(context: SupportChatContext): Promise<ToolOutcome> {
  if (ownerOf(context)?.kind === "account") {
    return { content: "They already have an account. For its documents, call get_document_status." };
  }
  const signupRef = context.signupRef ?? null;
  if (!signupRef) {
    return {
      content:
        "Nothing has been recorded for a signup in this browser yet: identity numbers and documents are saved from signup's documents step, which comes after their phone is verified there. If they started on another device, it carries on there.",
    };
  }

  try {
    const records = await loadSignup(signupRef);
    const shape: DocSetShape | null = context.screen?.account ?? inferShape(records.numbers, records.documents);
    if (records.numbers.length === 0 && records.documents.length === 0) {
      return {
        content:
          "Their phone is verified, but no number or document has been recorded yet. The next step is entering their identity numbers, then uploading the documents.",
      };
    }
    const summary = summarizeDocuments(shape, records.numbers, records.documents);
    const kindLabel = shape && shape !== "company" ? `${accountChoiceLabel(shape)} ` : shape === "company" ? "company " : "";
    const lines = [`Signup in progress for a ${kindLabel}account.`, describeSummary(summary), STYLE_NOTE];
    // Back to signup, already on the right account — unless they're on it now.
    if (shape && context.screen?.surface !== "signup") lines.push(`TAP_RESUME_SIGNUP:${shape}`);
    const title = shape && shape !== "company" ? `Your ${accountChoiceLabel(shape)} signup` : "Your signup";
    // With the account kind unknown and nothing uploaded there is no list to draw.
    return {
      content: lines.join("\n"),
      ...(summary.items.length > 0 ? { cards: [docStatusCard("signup", title, summary)] } : {}),
    };
  } catch {
    return { content: "Their signup couldn't be looked up just now. Nothing is lost: what they've uploaded stays saved." };
  }
}

// ─── get_document_status ─────────────────────────────────────────────────────

export async function executeGetDocumentStatus(context: SupportChatContext): Promise<ToolOutcome> {
  const owner = ownerOf(context);
  if (!owner) {
    return { content: "They aren't signed in, so their account's documents can't be looked up. For a signup under way, call get_signup_progress." };
  }
  if (owner.kind === "guest") {
    return { content: "They book as a guest: a guest has one identity document, not an account's set. Call get_my_kyc_status for it." };
  }

  try {
    const [shapeRow, documents] = await Promise.all([getAccountShapeById(owner.userId), listDocumentsByUserId(owner.userId)]);
    const raw = shapeRow?.company_category;
    const shape: DocSetShape =
      shapeRow?.account_type === "company"
        ? raw && (COMPANY_CATEGORIES as readonly string[]).includes(raw)
          ? (raw as CompanyCategory)
          : "company"
        : "personal";
    // The account's own numbers are the ones on its identity documents.
    const numbers: NumberRecord[] = documents.flatMap((d) =>
      d.doc_slot === "pan_card" ? [{ kind: "pan", document_no: d.document_no }] : d.doc_slot === "aadhaar_card" ? [{ kind: "aadhaar", document_no: d.document_no }] : []
    );
    const summary = summarizeDocuments(shape, numbers, documents);
    const needsSomething = summary.items.some((i) => i.state !== "on_file");
    const lines = [
      `${shape === "company" ? "Company" : accountChoiceLabel(shape)} account.`,
      describeSummary(summary),
      needsSomething
        ? "They can upload or replace a document on their Profile. Their shipments carry on meanwhile."
        : "Everything the account needs is on file. Nothing more to do.",
      STYLE_NOTE,
    ];
    if (needsSomething && context.screen?.surface !== "documents") lines.push("TAP_ACCOUNT_DOCUMENTS");
    return { content: lines.join("\n"), cards: [docStatusCard("account", "Your account documents", summary)] };
  } catch {
    return { content: "Their documents couldn't be looked up just now. Their shipments aren't affected." };
  }
}

// ─── Registration ────────────────────────────────────────────────────────────

export const DOCUMENT_TOOLS: readonly BiaTool[] = [
  {
    module: "onboarding",
    definition: {
      type: "function",
      function: {
        name: "get_signup_progress",
        description:
          "Where their signup stands, for someone opening an account: the numbers recorded, each document uploaded and what it needs, and what's still missing.",
        parameters: { type: "object", properties: {} },
      },
    },
    run: (_args, context) => executeGetSignupProgress(context),
  },
  {
    module: "documents",
    definition: {
      type: "function",
      function: {
        name: "get_document_status",
        description:
          "Where a signed-in account's documents stand: each one on file, needing attention, or still to upload.",
        parameters: { type: "object", properties: {} },
      },
    },
    run: (_args, context) => executeGetDocumentStatus(context),
  },
];
