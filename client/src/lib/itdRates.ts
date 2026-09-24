/**
 * ITD's rate card: the wire shapes, and the arithmetic that turns them into
 * something a screen can render.
 *
 * The quote screen and the booking flow both ask ITD for rates, and each had
 * its own copy of all of this — the types, the normaliser, the dedupe, the
 * money formatter. Two copies of the maths behind a price is the one kind of
 * duplication a customer can actually see, so it lives here now.
 */

export interface RateParams {
  product_code: string;
  destination_code: string;
  booking_date: string;
  origin_code: string;
  pcs: string;
  actual_weight: string;
  ori_city?: string;
  ori_pincode?: string;
  dest_city?: string;
  dest_pincode?: string;
}

export interface ITDChargeApplyEntry {
  name: string;
  amount: number;
}

export interface ITDRateRow {
  id: string;
  code: string;
  rate: number;
  fsc: number;
  cgst: number;
  sgst: number;
  other_charges: number;
  chrage_apply_data?: Record<string, ITDChargeApplyEntry>;
  sub_total: number;
  total: number;
  per_kg: number;
  weight: string;
  gst_per: string;
  internal_api_service_code?: string;
}

export interface ITDRateResponse {
  success?: boolean;
  data?: ITDRateRow[];
}

export function normalizeRateRow(raw: unknown): ITDRateRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = r.id != null ? String(r.id) : '';
  const code =
    typeof r.code === 'string'
      ? r.code
      : typeof r.internal_api_service_code === 'string'
        ? r.internal_api_service_code
        : '';
  if (!id && !code) return null;
  const num = (v: unknown): number => (typeof v === 'number' && !Number.isNaN(v) ? v : Number(v) || 0);
  const str = (v: unknown): string => (typeof v === 'string' ? v : String(v ?? ''));
  let chrage = r.chrage_apply_data;
  if (chrage && typeof chrage === 'object' && !Array.isArray(chrage)) {
    chrage = chrage as Record<string, ITDChargeApplyEntry>;
  } else {
    chrage = undefined;
  }
  return {
    id: id || code,
    code: code || id,
    rate: num(r.rate),
    fsc: num(r.fsc),
    cgst: num(r.cgst),
    sgst: num(r.sgst),
    other_charges: num(r.other_charges),
    chrage_apply_data: chrage as ITDRateRow['chrage_apply_data'],
    sub_total: num(r.sub_total),
    total: num(r.total),
    per_kg: num(r.per_kg),
    weight: str(r.weight),
    gst_per: str(r.gst_per),
    internal_api_service_code:
      typeof r.internal_api_service_code === 'string' ? r.internal_api_service_code : undefined,
  };
}

export function dedupeAndSort(rows: ITDRateRow[]): ITDRateRow[] {
  const seen = new Set<string>();
  const deduped: ITDRateRow[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    deduped.push(row);
  }
  return [...deduped].sort((a, b) => a.total - b.total);
}

export function itemizedChargesEmpty(service: ITDRateRow): boolean {
  const d = service.chrage_apply_data;
  return !d || Object.keys(d).length === 0;
}

/** Whether a rate row carries an itemised breakdown worth expanding. */
export function hasItemizedCharges(service: ITDRateRow): boolean {
  return !itemizedChargesEmpty(service);
}

/**
 * Rupees as the rate screens show them: no forced paise, but never more than
 * two. `formatInr` in lib/orderDetail.ts is the same idea for an order that
 * has already been placed; this one never returns null, because a rate row
 * always has a number.
 */
export function formatInr(n: number): string {
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}
