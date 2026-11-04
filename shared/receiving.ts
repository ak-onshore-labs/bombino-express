/**
 * Which phone a parcel is going to, for the receiver's own view of it.
 *
 * A receiver signs in with their number and sees the parcels addressed to it
 * (server/receivingDb.ts). That only works if "addressed to it" cannot match
 * the wrong person, and the receiver phone on a booking cannot answer that on
 * its own: the form takes bare digits with no dial code, so a New York number
 * `917 555 0100` and the Indian mobile `9175550100` are the same ten digits.
 * Matching on it would show a stranger's parcel to whoever owns the Indian one.
 *
 * So a booking names the receiver's app number separately, as
 * `consignee.app_phone`: the receiver phone with the country the sender picked
 * for it, in the account form (shared/contact.ts), so it is the same string
 * the receiver signs in with. Bookings from before that field count only when
 * their receiver phone is Indian beyond doubt: written with its +91, or on a
 * parcel going to India.
 *
 * Pure, so the booking form and the server read the same rules.
 */

import { isIndianMobile, isInternationalPhone, toIndianMobile } from "./contact.js";

/** A ten-digit Indian mobile: starts 6 to 9. */
const INDIAN_MOBILE_START = /^[6-9]\d{9}$/;

/**
 * The receiver's app number, as stored: ten bare digits for India, E.164
 * ("+12125550100") abroad, or null when it is blank or not a number one can
 * sign in with.
 */
export function normalizeReceiverAppPhone(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  if (trimmed.startsWith("+") && !trimmed.startsWith("+91")) {
    const e164 = `+${trimmed.replace(/\D/g, "")}`;
    return isInternationalPhone(e164) ? e164 : null;
  }
  const ten = toIndianMobile(value);
  return isIndianMobile(ten) && INDIAN_MOBILE_START.test(ten) ? ten : null;
}

/**
 * The receiver phone, when it is an Indian mobile beyond doubt: written with
 * its 91 in front (12 digits), or ten digits on a parcel going to India.
 * A bare ten digits to anywhere else is never read as Indian.
 */
export function indianReceiverPhone(phone: unknown, countryCode: unknown): string | null {
  if (typeof phone !== "string") return null;
  const digits = phone.replace(/\D/g, "");
  if (/^91[6-9]\d{9}$/.test(digits)) return digits.slice(2);
  if (String(countryCode ?? "").trim().toUpperCase() === "IN" && INDIAN_MOBILE_START.test(digits)) {
    return digits;
  }
  return null;
}

/** The number this parcel's receiver signs in with, or null when there is none. */
export function receiverAppPhoneOf(consignee: unknown): string | null {
  if (!consignee || typeof consignee !== "object") return null;
  const c = consignee as Record<string, unknown>;
  return normalizeReceiverAppPhone(c.app_phone) ?? indianReceiverPhone(c.phone, c.country_code);
}

/**
 * A second WhatsApp number the sender gave for the receiver at booking, and
 * whether the receiver's updates go to it. Not proved (the receiver isn't
 * there to type a code back), exactly like the receiver phone itself.
 * Null when there is none.
 */
export function receiverWhatsappAltOf(
  consignee: unknown,
): { altPhone: string; useForUpdates: boolean } | null {
  if (!consignee || typeof consignee !== "object") return null;
  const c = consignee as Record<string, unknown>;
  const alt = normalizeReceiverAppPhone(c.whatsapp_alt_phone);
  if (!alt) return null;
  return { altPhone: alt, useForUpdates: c.whatsapp_use_alt !== false };
}

/**
 * What the booking form offers as the receiver's app number, from the receiver
 * phone already typed: only when that is Indian beyond doubt.
 */
export function suggestedReceiverAppPhone(phone: string, countryCode: string): string {
  return indianReceiverPhone(phone, countryCode) ?? "";
}

/** One incoming parcel, as the receiver sees it. No money, phones or addresses. */
export interface ReceivingParcel {
  order_no: string;
  awb_no: string | null;
  status: string;
  /** Customer vocabulary, from the server, as on the sender's screens. */
  customer_status: string;
  /** First name only. */
  sender_first_name: string | null;
  sender_city: string | null;
  receiver_city: string | null;
  receiver_country: string | null;
  service: string | null;
  created_at: string;
  updated_at: string;
}

/** One step of an incoming parcel's history: what happened and when. */
export interface ReceivingEvent {
  status: string;
  customer_status: string;
  at: string;
}

export interface ReceivingDetail {
  parcel: ReceivingParcel;
  events: ReceivingEvent[];
}
