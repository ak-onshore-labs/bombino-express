/**
 * Settings the Bombino team changes from the ops console
 * (migrations/add_ops_settings.sql).
 *
 * Fails soft: until the table exists, reads fall back to the env var and a
 * write reports `unavailable`, which the console turns into "run the
 * migration". Nothing here throws.
 */

import { z } from "zod";
import { supabase } from "./supabaseClient.js";

const APPLICATION_ALERT_KEY = "application_alert_emails";

/** Upper bound on recipients: a team list, not a mailing list. */
export const MAX_ALERT_RECIPIENTS = 5;

export const alertEmailsSchema = z
  .array(z.string().trim().toLowerCase().email("Enter valid email addresses"))
  .max(MAX_ALERT_RECIPIENTS, `Up to ${MAX_ALERT_RECIPIENTS} addresses`)
  .transform((list) => Array.from(new Set(list)));

export type AlertRecipients = {
  emails: string[];
  /** Where the list came from: the console, the env fallback, or nowhere yet. */
  source: "console" | "env" | "none";
  /** False until migrations/add_ops_settings.sql has run: the console can't save. */
  editable: boolean;
  updated_at: string | null;
};

function fromEnv(): string[] {
  const raw = process.env.APPLICATION_ALERT_EMAILS ?? "";
  const parsed = alertEmailsSchema.safeParse(raw.split(",").map((s) => s.trim()).filter(Boolean));
  return parsed.success ? parsed.data : [];
}

function withFallback(editable: boolean): AlertRecipients {
  const env = fromEnv();
  return { emails: env, source: env.length > 0 ? "env" : "none", editable, updated_at: null };
}

export async function getApplicationAlertRecipients(): Promise<AlertRecipients> {
  if (!supabase) return withFallback(false);
  const { data, error } = await supabase
    .from("ops_settings")
    .select("value, updated_at")
    .eq("key", APPLICATION_ALERT_KEY)
    .maybeSingle();
  if (error) {
    // Most often: the table isn't there yet.
    console.error("[opsSettings] read failed:", { message: error.message, code: error.code });
    return withFallback(false);
  }
  if (!data) return withFallback(true);
  const parsed = alertEmailsSchema.safeParse((data as { value: unknown }).value);
  return {
    emails: parsed.success ? parsed.data : [],
    source: "console",
    editable: true,
    updated_at: (data as { updated_at: string }).updated_at,
  };
}

export async function setApplicationAlertRecipients(
  emails: string[],
  actorId: string
): Promise<{ ok: true; value: AlertRecipients } | { ok: false; reason: "unavailable" }> {
  if (!supabase) return { ok: false, reason: "unavailable" };
  const { data, error } = await supabase
    .from("ops_settings")
    .upsert(
      { key: APPLICATION_ALERT_KEY, value: emails, updated_by: actorId, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    )
    .select("updated_at")
    .single();
  if (error) {
    console.error("[opsSettings] write failed:", { message: error.message, code: error.code });
    return { ok: false, reason: "unavailable" };
  }
  return {
    ok: true,
    value: { emails, source: "console", editable: true, updated_at: (data as { updated_at: string }).updated_at },
  };
}
