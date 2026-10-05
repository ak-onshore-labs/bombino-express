/**
 * The rules around filing an ITD docket, kept pure so they can be tested
 * without ITD or a database. The filing itself is server/docketFiling.ts.
 *
 * Two questions, both about not wasting an irreversible call:
 *
 *   - Is the booking complete enough that ITD can accept it? (`docketProblems`)
 *   - When a filing fails, who acts next? (`classifyDocketFailure`)
 */

import { isUsZip, usStateName } from "./usAddress.js";
import { isDocumentsContent } from "./bookingTerms.js";

/** Who acts next on a failed filing. */
export type DocketRetry =
  /** Nothing reached ITD, or the cause clears by itself: the sweep retries. */
  | "auto"
  /** The booking needs correcting first; ops retries after. */
  | "ops"
  /** ITD may already hold a docket: a person checks ITD's portal before anything is filed again. */
  | "check_itd";

const REQUIRED: ReadonlyArray<[field: string, label: string]> = [
  ["product_code", "Product type"],
  ["destination_code", "Destination country"],
  ["api_service_code", "Service"],
  ["shipper_name", "Sender name"],
  ["shipper_contact_no", "Sender phone"],
  ["shipper_address_line_1", "Sender address"],
  ["shipper_city", "Sender city"],
  ["shipper_zip_code", "Sender PIN code"],
  ["consignee_name", "Receiver name"],
  ["consignee_contact_no", "Receiver phone"],
  ["consignee_address_line_1", "Receiver address"],
  ["consignee_city", "Receiver city"],
  ["consignee_country", "Receiver country"],
  ["shipment_content", "What's inside"],
];

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
}

function isUs(p: Record<string, unknown>): boolean {
  const dest = str(p.destination_code).toUpperCase();
  const country = str(p.consignee_country).toUpperCase();
  return dest === "US" || country === "US" || country === "USA" || country === "UNITED STATES";
}

/**
 * What stops ITD from accepting this booking, in words ops can act on. Empty
 * means nothing we can see from here; ITD's own price check comes after.
 *
 * Every rule is a refusal ITD has actually given (shared/docketError.ts):
 * "Freight amount is 0" from a short US ZIP, a missing state, or goods booked
 * as Documents.
 */
export function docketProblems(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return ["Booking details are missing from the order"];
  const p = payload as Record<string, unknown>;
  const problems: string[] = [];

  for (const [field, label] of REQUIRED) {
    if (!str(p[field])) problems.push(`${label} is missing`);
  }

  const weight = Number(str(p.actual_weight));
  if (!Number.isFinite(weight) || weight <= 0) problems.push("Weight must be more than 0 kg");

  const items = Array.isArray(p.docket_items) ? p.docket_items : [];
  if (items.length === 0) problems.push("Box details are missing");

  if (isUs(p)) {
    // Postal codes are optional for some destinations (Qatar, the UAE), but
    // never for the US.
    const zip = str(p.consignee_zip_code);
    if (!zip) problems.push("US ZIP is missing");
    else if (!isUsZip(zip)) problems.push(`US ZIP "${zip}" must be 5 digits`);
    const state = str(p.consignee_state);
    if (!state) problems.push("US state is missing");
    else if (!usStateName(state)) problems.push(`"${state}" is not a US state`);
  }

  if (str(p.product_code).toUpperCase() === "DOX" && !isDocumentsContent(str(p.shipment_content))) {
    problems.push(`Booked as Documents but contains "${str(p.shipment_content)}": goods must be Package (SPX)`);
  }

  return problems;
}

/**
 * Who acts next, from the error a filing ended in.
 *
 * Conservative where it matters: anything that may have reached ITD and been
 * processed is `check_itd`, because filing it again blind could put the same
 * parcel into ITD twice. Only failures that provably never reached ITD, or
 * that ITD refused outright, are retried or handed back.
 */
export function classifyDocketFailure(message: string): { stage: string; retry: DocketRetry } {
  const m = message || "";
  if (/auth\s+token\s+expired|generate\s+new\s+auth\s+token|session expired/i.test(m)) {
    // ITD refused before filing anything; a fresh login fixes it.
    return { stage: "token", retry: "auto" };
  }
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i.test(m)) {
    // Never connected: nothing was sent.
    return { stage: "network", retry: "auto" };
  }
  if (/timed out/i.test(m)) return { stage: "timeout", retry: "check_itd" };
  if (/ECONNRESET|socket hang up|fetch failed|50[234]\b/i.test(m)) {
    // The request may have been received before the line dropped.
    return { stage: "network", retry: "check_itd" };
  }
  if (/"success"\s*:\s*false|"errors"/i.test(m)) {
    // ITD read it and said no. Same booking, same answer: correct it first.
    return { stage: "create_docket", retry: "ops" };
  }
  return { stage: "create_docket", retry: "check_itd" };
}

/** How many automatic attempts before a person is asked instead. */
export const DOCKET_AUTO_ATTEMPTS = 6;
