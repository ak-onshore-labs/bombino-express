/**
 * Which phones are test phones, and who on the team sees what they make.
 *
 * A test phone's bookings are test orders, and its account, guest profile and
 * account application are test records: hidden from real staff on the
 * Customers, Guests and Applications tabs, and its application does not email
 * the team. Nothing is stored for the account side; the phone decides, so a
 * number added here turns its existing records into test ones too.
 *
 * The rules for a test order itself are in shared/testOrders.ts.
 *
 * The numbers are the fixed-OTP test accounts (`TEST_OTP_NUMBERS`) plus the
 * real phones the team tests with. A real phone here only marks its orders as
 * test: it still logs in with a real code, because it is not in
 * TEST_OTP_NUMBERS.
 */

import type { Request } from "express";

import { TEST_OTP_NUMBERS } from "./otp.js";
import { isTestOrderMetadata } from "../shared/testOrders.js";

/** Real phones whose bookings are test orders. Exact numbers only. */
const TEAM_TEST_PHONES: readonly string[] = [
  "7558372885", // Aditya, added 14 Oct 2026
  "9833207558", // "CUSTOMER MOBILE APP", Bombino's shared ITD login, added 14 Oct 2026
];

/**
 * Fixed-code (121212) logins that are NOT test phones: a tester signs in on
 * one to see the ops console exactly as the real team does, test orders
 * hidden. Never book on one; its orders would be real.
 */
const REAL_VIEW_PHONES: readonly string[] = [
  "9000000099", // Real View Super Admin, added 14 Oct 2026
];

export const TEST_ORDER_PHONES: ReadonlySet<string> = new Set(
  [...TEST_OTP_NUMBERS, ...TEAM_TEST_PHONES].filter((phone) => !REAL_VIEW_PHONES.includes(phone))
);

/**
 * Ops accounts that may mark any order test or real by hand, from the order
 * page. Exact numbers only; each must also be a test phone, so it sees both.
 */
const TEST_ORDER_MARKER_PHONES: readonly string[] = [
  "9000000011", // Test Super Admin, added 14 Oct 2026
];

/** The last ten digits, or null when there are fewer. */
function lastTen(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}

/** Whether bookings by this phone are test orders, and whether staff on it see them. */
export function isTestPhone(phone: string | null | undefined): boolean {
  if (!phone) return false;
  const ten = lastTen(phone);
  return ten !== null && TEST_ORDER_PHONES.has(ten);
}

/** Whether staff signed in on this phone may mark orders test or real. */
export function canMarkTestOrders(phone: string | null | undefined): boolean {
  if (!phone || !isTestPhone(phone)) return false;
  return TEST_ORDER_MARKER_PHONES.includes(lastTen(phone) ?? "");
}

/**
 * Whether this ops caller is on test data: staff signed in on a test phone,
 * unless they switched their console to live data. On test data they see
 * test records only; everyone else sees live records only. No role sees test
 * records otherwise, super admin included.
 */
export function seesTestOrders(req: Request): boolean {
  return req.staff?.test === true && req.staff.liveView !== true;
}

/** The rows this caller may see: test rows on test data, live rows otherwise. */
export function withoutHiddenTestRows<T extends { is_test?: boolean }>(req: Request, rows: T[]): T[] {
  const test = seesTestOrders(req);
  return rows.filter((row) => (row.is_test === true) === test);
}

export { isTestOrderMetadata };
