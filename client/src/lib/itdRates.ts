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
  igst: number;
  /** CGST + SGST + IGST: ITD charges one pair or the other, never says which. */
  gst_total: number;
  other_charges: number;
  chrage_apply_data?: Record<string, ITDChargeApplyEntry>;
  sub_total: number;
  total: number;
  per_kg: number;
  /** ITD's chargeable weight in kg; empty when it didn't work one out (it sends 0). */
  weight: string;
  /** The GST rate, from ITD or worked out from the amounts (ITD usually omits it). */
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
  const cgst = num(r.cgst);
  const sgst = num(r.sgst);
  const igst = num(r.igst);
  const gstTotal = cgst + sgst + igst;
  const total = num(r.total);
  const subTotal = num(r.sub_total);
  // ITD sends the tax as amounts and no rate, so "GST (0%)" sat beside a real
  // ₹66.24. The rate is the tax over what it was charged on.
  const taxable = subTotal > 0 ? subTotal : total - gstTotal;
  const givenPer = str(r.gst_per).trim();
  const gstPer =
    givenPer && Number(givenPer) > 0
      ? givenPer
      : gstTotal > 0 && taxable > 0
        ? String(Math.round((gstTotal / taxable) * 100))
        : '';
  // ITD answers weight 0 on the rate card: it has not worked a chargeable
  // weight out, and "0 kg chargeable" was showing as though it had.
  const weight = num(r.weight) > 0 ? str(r.weight).trim() : '';
  return {
    id: id || code,
    code: code || id,
    rate: num(r.rate),
    fsc: num(r.fsc),
    cgst,
    sgst,
    igst,
    gst_total: gstTotal,
    other_charges: num(r.other_charges),
    chrage_apply_data: chrage as ITDRateRow['chrage_apply_data'],
    sub_total: subTotal,
    total,
    per_kg: num(r.per_kg),
    weight,
    gst_per: gstPer,
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
