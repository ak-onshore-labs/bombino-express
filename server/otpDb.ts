import { supabase } from "./supabaseClient.js";
import { dbClient, logDbError, type DbError } from "./db/client.js";

export type OtpPurpose = "signup_personal" | "signup_company" | "login" | "auth";

const logSupabaseError = (operation: string, error: DbError): void =>
  logDbError("otpDb", operation, error);

const getSupabaseClient = () => dbClient("otpDb");

export async function countRecentRequests(phone: string, windowMinutes: number): Promise<number | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const { count, error } = await client
    .from("otp_codes")
    .select("*", { count: "exact", head: true })
    .eq("phone", phone)
    .gte("created_at", since);

  if (error) {
    logSupabaseError("countRecentRequests", error);
    return null;
  }
  return count ?? 0;
}

export async function insertOtpCode(input: {
  phone: string;
  code_hash: string;
  purpose: OtpPurpose;
  expires_at: string;
}): Promise<{ id: string } | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("otp_codes")
    .insert(input)
    .select("id")
    .single();

  if (error) {
    logSupabaseError("insertOtpCode", error);
    return null;
  }
  return data;
}

export type OtpCodeRow = {
  id: string;
  code_hash: string;
  attempts: number;
  consumed_at: string | null;
  expires_at: string;
};

export async function getLatestOtpForVerify(
  phone: string,
  purpose: OtpPurpose
): Promise<OtpCodeRow | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("otp_codes")
    .select("id, code_hash, attempts, consumed_at, expires_at")
    .eq("phone", phone)
    .eq("purpose", purpose)
    .is("consumed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    logSupabaseError("getLatestOtpForVerify", error);
    return null;
  }
  return data;
}

/**
 * Claims the next attempt on a code and returns its number (1 for the first
 * try), or null if the database could not be reached.
 *
 * A compare-and-swap, because supabase-js has no atomic increment: the update
 * only lands if `attempts` still holds the value just read, and a loser re-reads
 * and tries again. Ten guesses sent at once therefore get ten distinct numbers.
 * The old read-then-write let every one of them write the same `n + 1`, so a
 * burst of guesses was counted as one or two and the 5-try ceiling could be
 * outrun.
 */
export async function claimAttempt(id: string): Promise<number | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  for (let tries = 0; tries < 50; tries++) {
    const { data: row, error: readError } = await client
      .from("otp_codes")
      .select("attempts")
      .eq("id", id)
      .single();
    if (readError || !row) {
      if (readError) logSupabaseError("claimAttempt:read", readError);
      return null;
    }

    const current = row.attempts as number;
    const { data: won, error: writeError } = await client
      .from("otp_codes")
      .update({ attempts: current + 1 })
      .eq("id", id)
      .eq("attempts", current)
      .select("id");
    if (writeError) {
      logSupabaseError("claimAttempt:write", writeError);
      return null;
    }
    if (won && won.length === 1) return current + 1;
  }
  console.error("[otpDb] claimAttempt: gave up after 50 contended tries", { id });
  return null;
}

/**
 * Spends a code. Returns false if it was already spent — by a parallel request
 * presenting the same right code — so only one of them signs in.
 */
export async function markConsumed(id: string): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;

  const { data, error } = await client
    .from("otp_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", id)
    .is("consumed_at", null)
    .select("id");

  if (error) {
    logSupabaseError("markConsumed", error);
    return false;
  }
  return (data ?? []).length === 1;
}

export async function hasRecentVerification(
  phone: string,
  purpose: OtpPurpose,
  windowMinutes: number
): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;

  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const { data, error } = await client
    .from("otp_codes")
    .select("id")
    .eq("phone", phone)
    .eq("purpose", purpose)
    .not("consumed_at", "is", null)
    .gte("consumed_at", since)
    .order("consumed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    logSupabaseError("hasRecentVerification", error);
    return false;
  }
  return !!data;
}
