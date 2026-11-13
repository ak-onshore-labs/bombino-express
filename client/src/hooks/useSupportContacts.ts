/**
 * Office phone + support WhatsApp for customer and rider surfaces.
 *
 * Raw fetch — not apiRequest — so a blip here cannot trip the 401→logout
 * path. Numbers are public (guest Home pills), and a missing/failed response
 * falls back to the literals that used to be hardcoded.
 *
 * `/api/settings` is shared with useAppUpdate via SETTINGS_PUBLIC_KEY. Both
 * hooks must cache the same raw PublicSettings shape — a mapped contacts
 * object here used to collide with UpdateGate's fetch and crash Home after
 * splash (formatOfficeLabel on undefined).
 */

import { useQuery } from '@tanstack/react-query';

export const SETTINGS_PUBLIC_KEY = ['/api/settings'] as const;
export const OPS_SETTINGS_KEY = ['/api/ops/settings'] as const;

export const SUPPORT_OFFICE_PHONE_FALLBACK = '2266400000';
export const SUPPORT_WHATSAPP_FALLBACK = '917045999553';

/** Raw GET /api/settings body. Shared cache shape for all SETTINGS_PUBLIC_KEY readers. */
export type PublicSettings = {
  support_office_phone?: unknown;
  support_whatsapp?: unknown;
  app_update_ios?: unknown;
  app_update_android?: unknown;
};

export type SupportContacts = {
  officePhone: string;
  whatsapp: string;
  telHref: string;
  waHref: string;
  officeLabel: string;
  whatsappLabel: string;
};

export async function fetchPublicSettings(): Promise<PublicSettings> {
  const res = await fetch('/api/settings');
  if (!res.ok) {
    throw new Error(`${res.status}: ${res.statusText}`);
  }
  return (await res.json()) as PublicSettings;
}

function digits(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^\d{10,15}$/.test(value) ? value : fallback;
}

/** `2266400000` → `+91 22 6640 0000`. Other 10-digit numbers get grouped 5+5. */
export function formatOfficeLabel(officePhone: string): string {
  if (officePhone.length === 10 && officePhone.startsWith('22')) {
    return `+91 ${officePhone.slice(0, 2)} ${officePhone.slice(2, 6)} ${officePhone.slice(6)}`;
  }
  if (officePhone.length === 10) {
    return `+91 ${officePhone.slice(0, 5)} ${officePhone.slice(5)}`;
  }
  return `+${officePhone}`;
}

/** `917045999553` → `+91 70459 99553`. */
export function formatWhatsappLabel(whatsapp: string): string {
  const national =
    whatsapp.startsWith('91') && whatsapp.length === 12
      ? whatsapp.slice(2)
      : whatsapp;
  if (national.length === 10) {
    return `+91 ${national.slice(0, 5)} ${national.slice(5)}`;
  }
  return `+${whatsapp}`;
}

export function deriveSupportContacts(
  officePhone: string,
  whatsapp: string,
): SupportContacts {
  return {
    officePhone,
    whatsapp,
    telHref: `tel:+91${officePhone}`,
    waHref: `https://api.whatsapp.com/send?phone=${whatsapp}`,
    officeLabel: formatOfficeLabel(officePhone),
    whatsappLabel: formatWhatsappLabel(whatsapp),
  };
}

const FALLBACK = deriveSupportContacts(
  SUPPORT_OFFICE_PHONE_FALLBACK,
  SUPPORT_WHATSAPP_FALLBACK,
);

export function useSupportContacts(): SupportContacts {
  const query = useQuery({
    queryKey: SETTINGS_PUBLIC_KEY,
    queryFn: fetchPublicSettings,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  if (!query.data) return FALLBACK;
  return deriveSupportContacts(
    digits(query.data.support_office_phone, SUPPORT_OFFICE_PHONE_FALLBACK),
    digits(query.data.support_whatsapp, SUPPORT_WHATSAPP_FALLBACK),
  );
}
