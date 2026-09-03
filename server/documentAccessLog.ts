/**
 * Record every fetch of an identity document through a capability URL,
 * and every authenticated ops view of a document or identity number.
 *
 * See migrations/add_document_access_log.sql and
 * migrations/add_document_access_log_actor.sql.
 *
 * Two wrappers share one insert:
 *   logDocumentAccess        — fire-and-forget for capability URLs
 *   logDocumentAccessOrThrow — awaited, retried, throws for ops KYC hits
 *
 * Never stores document bytes or identity numbers.
 */

import type { Request } from "express";
import { supabase } from "./supabaseClient.js";

export type DocumentSource = "kyc" | "account" | "identity";
export type AccessOutcome = "served" | "not_found";
export type AccessAction = "view" | "download";

export interface LogAccessInput {
  source: DocumentSource;
  /** Null for identity-number views, which have no capability URL. */
  capabilityId?: string | null;
  outcome: AccessOutcome;
  /** Null when the lookup matched nothing. */
  documentId?: string | null;
  /** Document owner. */
  userId?: string | null;
  /** Viewing staff user. Null on capability-URL fetches. */
  actorUserId?: string | null;
  /** Ops view/download. Null on capability-URL fetches. */
  action?: AccessAction | null;
}

export class AuditLogUnavailableError extends Error {
  constructor(message = "Audit unavailable.") {
    super(message);
    this.name = "AuditLogUnavailableError";
  }
}

/** Postgres integrity errors that will not recover on retry. */
const NON_RETRYABLE_CODES = new Set(["23502", "23503", "23514"]);

const RETRY_BACKOFF_MS = [100, 300] as const;

/** Headers are attacker-controlled; keep them bounded before they hit a column. */
function trim(value: string | undefined, max: number): string | null {
  if (!value) return null;
  return value.slice(0, max);
}

function buildRow(req: Request, input: LogAccessInput): Record<string, unknown> {
  return {
    source: input.source,
    capability_id: input.capabilityId ? input.capabilityId.slice(0, 128) : null,
    document_id: input.documentId ?? null,
    user_id: input.userId ?? null,
    actor_user_id: input.actorUserId ?? null,
    action: input.action ?? null,
    outcome: input.outcome,
    requester_ip: trim(req.ip, 64),
    user_agent: trim(req.header("user-agent"), 512),
    referer: trim(req.header("referer"), 512),
  };
}

async function insertAccessLog(
  row: Record<string, unknown>
): Promise<{ message?: string; code?: string } | null> {
  if (!supabase) {
    return { message: "supabase client is not configured" };
  }
  const { error } = await supabase.from("document_access_log").insert(row);
  return error ? { message: error.message, code: error.code } : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Record a capability-URL fetch. Never blocks and never throws.
 *
 * A document the customer is entitled to must not fail to serve because the
 * audit insert had a bad minute. Existing callers keep this contract.
 */
export function logDocumentAccess(req: Request, input: LogAccessInput): void {
  if (!supabase) return;

  const row = buildRow(req, input);
  void insertAccessLog(row).then((error) => {
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

/**
 * Record an authenticated ops view. Awaits the insert, retries transient
 * failures, and throws only if every attempt fails — so a hit is served only
 * after a durable audit row.
 */
export async function logDocumentAccessOrThrow(
  req: Request,
  input: LogAccessInput
): Promise<void> {
  const row = buildRow(req, input);
  const attempts = RETRY_BACKOFF_MS.length + 1;
  let lastError: { message?: string; code?: string } | null = null;

  for (let i = 0; i < attempts; i++) {
    lastError = await insertAccessLog(row);
    if (!lastError) return;
    if (lastError.code && NON_RETRYABLE_CODES.has(lastError.code)) break;
    if (i < RETRY_BACKOFF_MS.length) {
      await sleep(RETRY_BACKOFF_MS[i]);
    }
  }

  console.error("[documentAccessLog] insert failed after retries:", {
    message: lastError?.message,
    code: lastError?.code,
    source: input.source,
    outcome: input.outcome,
  });
  throw new AuditLogUnavailableError();
}
