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

export async function incrementAttempts(id: string, currentAttempts: number): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;

  const { error } = await client
    .from("otp_codes")
    .update({ attempts: currentAttempts + 1 })
    .eq("id", id);

  if (error) {
    logSupabaseError("incrementAttempts", error);
  }
}

export async function markConsumed(id: string): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;

  const { error } = await client
    .from("otp_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    logSupabaseError("markConsumed", error);
  }
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
