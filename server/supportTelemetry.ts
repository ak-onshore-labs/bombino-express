/**
 * BIA's turn log (migrations/create_bia_turns.sql): one row per answer, and
 * the customer's thumbs up or down on it.
 *
 * Both writes fail soft. A turn that can't be recorded is logged once and
 * forgotten; the customer's reply never waits on it, and a missing table
 * (the migration not run yet) reads exactly like an unreachable database.
 */

import { supabase } from "./supabaseClient.js";

export type TurnOwnerKind = "account" | "guest" | "anon";

export interface TurnRecord {
  id: string;
  sessionId: string | null;
  ownerKind: TurnOwnerKind;
  userId: string | null;
  guestRef: string | null;
  surface: string | null;
  step: string | null;
  errorCode: string | null;
  modules: readonly string[];
  tools: readonly string[];
  cardKinds: readonly string[];
  latencyMs: number;
  fallback: boolean;
  promptTokens: number;
  completionTokens: number;
}

let warned = false;

function warnOnce(what: string, message: string): void {
  if (warned) return;
  warned = true;
  console.warn(`[bia] ${what}: ${message} (has migrations/create_bia_turns.sql been run?)`);
}

/** Record one answer. Never throws, never delays the reply it is called after. */
export async function recordTurn(turn: TurnRecord): Promise<void> {
  if (!supabase) return;
  try {
    const { error } = await supabase.from("bia_turns").insert({
      id: turn.id,
      session_id: turn.sessionId,
      owner_kind: turn.ownerKind,
      user_id: turn.userId,
      guest_ref: turn.guestRef,
      surface: turn.surface,
      step: turn.step,
      error_code: turn.errorCode,
      modules: turn.modules,
      tools: turn.tools,
      card_kinds: turn.cardKinds,
      latency_ms: Math.round(turn.latencyMs),
      fallback: turn.fallback,
      prompt_tokens: turn.promptTokens,
      completion_tokens: turn.completionTokens,
    });
    if (error) warnOnce("could not record a turn", error.message);
  } catch (err) {
    warnOnce("could not record a turn", (err as Error).message);
  }
}

/** Who is rating: only the owner of a turn may rate it. */
export type RatingOwner =
  | { kind: "account"; userId: string }
  | { kind: "guest"; guestRef: string }
  | { kind: "anon" };

/**
 * A thumbs up (1) or down (-1) on one of the caller's own turns. "not_found"
 * covers a turn that isn't theirs, one that doesn't exist, and a table that
 * isn't there yet — the caller can't tell them apart, on purpose.
 *
 * An anonymous turn has no owner to check. Its id is a random uuid only its
 * reply ever carried, which is the whole of the proof, and all it unlocks is
 * a thumb.
 */
export async function rateTurn(turnId: string, rating: 1 | -1, owner: RatingOwner): Promise<"ok" | "not_found"> {
  if (!supabase) return "not_found";
  try {
    let query = supabase
      .from("bia_turns")
      .update({ rating, rated_at: new Date().toISOString() })
      .eq("id", turnId);
    query =
      owner.kind === "account"
        ? query.eq("user_id", owner.userId)
        : owner.kind === "guest"
          ? query.eq("guest_ref", owner.guestRef)
          : query.eq("owner_kind", "anon");
    const { data, error } = await query.select("id");
    if (error) {
      warnOnce("could not rate a turn", error.message);
      return "not_found";
    }
    return data && data.length > 0 ? "ok" : "not_found";
  } catch (err) {
    warnOnce("could not rate a turn", (err as Error).message);
    return "not_found";
  }
}
