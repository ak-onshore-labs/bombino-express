/**
 * Record every fetch of an identity document through a capability URL.
 *
 * See migrations/add_document_access_log.sql for why this exists: those URLs
 * are permanent bearer tokens, so a leak is silent unless something is
 * watching. This is the something.
 *
 * Never blocks and never throws. A document the customer is entitled to must
 * not fail to serve because the audit insert had a bad minute — the log is
 * best-effort evidence, not part of the request's correctness. A failure to
 * write is logged loudly instead, because a quietly broken audit trail is
 * worse than an obviously broken one.
 */

import type { Request } from "express";
import { supabase } from "./supabaseClient.js";

export type DocumentSource = "kyc" | "account";
export type AccessOutcome = "served" | "not_found";

export interface LogAccessInput {
  source: DocumentSource;
  capabilityId: string;
  outcome: AccessOutcome;
  /** Null when the capability id matched nothing. */
  documentId?: string | null;
  userId?: string | null;
}

/** Headers are attacker-controlled; keep them bounded before they hit a column. */
function trim(value: string | undefined, max: number): string | null {
  if (!value) return null;
  return value.slice(0, max);
}

export function logDocumentAccess(req: Request, input: LogAccessInput): void {
  if (!supabase) return;

  const row = {
    source: input.source,
    capability_id: input.capabilityId.slice(0, 128),
    document_id: input.documentId ?? null,
    user_id: input.userId ?? null,
    outcome: input.outcome,
    requester_ip: trim(req.ip, 64),
    user_agent: trim(req.header("user-agent"), 512),
    // Where the URL was followed from. A referer on one of these is itself
    // interesting: it means the link is embedded somewhere it should not be.
    referer: trim(req.header("referer"), 512),
  };

  // Deliberately not awaited. The response should not wait on the audit write,
  // and the caller is streaming a file.
  void supabase
    .from("document_access_log")
    .insert(row)
    .then(({ error }) => {
      if (error) {
        console.error("[documentAccessLog] insert failed:", {
          message: error.message,
          code: error.code,
          source: input.source,
          outcome: input.outcome,
        });
      }
    });
}
