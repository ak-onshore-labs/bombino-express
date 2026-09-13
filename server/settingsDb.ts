/**
 * App settings — general key/value store.
 *
 * Visibility lives in SETTINGS, not in the table. GET /api/settings iterates
 * the public keys and queries only those rows. A `select('*')` that is later
 * stripped would leak S2 flags (payments_test_mode, …) the moment someone
 * forgets the filter.
 *
 * S2 keys are registered now so the public endpoint cannot grow them later.
 * Nothing here reads those flags at runtime — env modules stay in charge
 * until S2 wires them.
 */

import { z, type ZodType } from "zod";
import { supabase } from "./supabaseClient.js";

export const SUPPORT_OFFICE_PHONE_FALLBACK = "2266400000";
export const SUPPORT_WHATSAPP_FALLBACK = "917045999553";

const digitString = z.string().regex(/^\d{10,15}$/, "Enter a valid phone number");

type SettingVisibility = "public" | "ops";

type SettingDef = {
  visibility: SettingVisibility;
  schema: ZodType;
};

export const SETTINGS = {
  support_whatsapp: { visibility: "public" as const, schema: digitString },
  support_office_phone: { visibility: "public" as const, schema: digitString },
  guest_booking: { visibility: "ops" as const, schema: z.boolean() },
  cashfree_id_check: {
    visibility: "ops" as const,
    schema: z.enum(["test", "live"]),
  },
  labels_at_booking: { visibility: "ops" as const, schema: z.boolean() },
  payments_test_mode: { visibility: "ops" as const, schema: z.boolean() },
} satisfies Record<string, SettingDef>;

export type SettingKey = keyof typeof SETTINGS;

export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

export const PUBLIC_SETTING_KEYS = SETTING_KEYS.filter(
  (key) => SETTINGS[key].visibility === "public"
);

export function isSettingKey(value: string): value is SettingKey {
  return value in SETTINGS;
}

function logSupabaseError(
  operation: string,
  error: { message?: string; code?: string } | null
): void {
  console.error("[settingsDb] supabase operation failed (non-fatal):", {
    operation,
    message: error?.message,
    code: error?.code,
  });
}

function getSupabaseClient() {
  if (!supabase) {
    console.error("[settingsDb] supabase client is not configured");
    return null;
  }
  return supabase;
}

export type SettingRow = {
  key: SettingKey;
  value: unknown;
  updated_at: string | null;
  updated_by: string | null;
};

type StoredRow = {
  key: string;
  value: unknown;
  updated_at: string | null;
  updated_by: string | null;
};

async function loadRows(keys: readonly SettingKey[]): Promise<StoredRow[]> {
  if (keys.length === 0) return [];

  const client = getSupabaseClient();
  if (!client) return [];

  const { data, error } = await client
    .from("app_settings")
    .select("key, value, updated_at, updated_by")
    .in("key", [...keys]);

  if (error) {
    logSupabaseError("loadRows", error);
    return [];
  }
  return (data ?? []) as StoredRow[];
}

export async function getSetting(key: SettingKey): Promise<SettingRow | null> {
  const rows = await loadRows([key]);
  const row = rows[0];
  if (!row) return null;
  return {
    key,
    value: row.value,
    updated_at: row.updated_at,
    updated_by: row.updated_by,
  };
}

export async function getSettings(
  keys: readonly SettingKey[]
): Promise<SettingRow[]> {
  const byKey = new Map(
    (await loadRows(keys)).map((row) => [row.key, row] as const)
  );
  return keys.map((key) => {
    const row = byKey.get(key);
    return {
      key,
      value: row?.value ?? null,
      updated_at: row?.updated_at ?? null,
      updated_by: row?.updated_by ?? null,
    };
  });
}

export async function setSetting(
  key: SettingKey,
  value: unknown,
  actorId: string
): Promise<SettingRow | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const now = new Date().toISOString();
  const { data, error } = await client
    .from("app_settings")
    .upsert(
      {
        key,
        value,
        updated_at: now,
        updated_by: actorId,
      },
      { onConflict: "key" }
    )
    .select("key, value, updated_at, updated_by")
    .maybeSingle();

  if (error) {
    logSupabaseError("setSetting", error);
    return null;
  }
  if (!data) return null;
  return {
    key,
    value: data.value,
    updated_at: data.updated_at,
    updated_by: data.updated_by,
  };
}

function asDigitString(value: unknown, fallback: string): string {
  return typeof value === "string" && /^\d{10,15}$/.test(value) ? value : fallback;
}

/** Public bag — only registry keys with visibility public, plus compiled fallback. */
export async function listPublicSettings(): Promise<{
  support_office_phone: string;
  support_whatsapp: string;
}> {
  const contacts = await getSupportContacts();
  return {
    support_office_phone: contacts.officePhone,
    support_whatsapp: contacts.whatsapp,
  };
}

/** Every registry key. Missing rows stay null — S2 keys are not seeded. */
export async function listAllSettings(): Promise<SettingRow[]> {
  return getSettings(SETTING_KEYS);
}

export async function getSupportContacts(): Promise<{
  officePhone: string;
  whatsapp: string;
}> {
  const rows = await loadRows(PUBLIC_SETTING_KEYS);
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  return {
    officePhone: asDigitString(
      byKey.get("support_office_phone"),
      SUPPORT_OFFICE_PHONE_FALLBACK
    ),
    whatsapp: asDigitString(
      byKey.get("support_whatsapp"),
      SUPPORT_WHATSAPP_FALLBACK
    ),
  };
}
