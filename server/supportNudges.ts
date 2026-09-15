/**
 * BIA's nudges (BIA 3.0, package 5.1): the few times BIA speaks first, as a
 * bell item, when something of the customer's own has stalled. Tapping one
 * opens BIA about it (shared/biaNudges.ts §nudgeSeed).
 *
 * A daily sweep (POST /api/admin/bia/nudges/sweep, server/routes/bia.ts) reads
 * a snapshot, turns it into nudges with pure rules, and sends each one that:
 *   - hasn't been sent before (bia_nudges is unique per owner, kind and
 *     subject, so running the sweep twice sends nothing new),
 *   - isn't a kind the customer switched off (Profile, the guest profile),
 *   - isn't the owner's second today (one nudge per person per day; the more
 *     useful kind goes first).
 *
 * The rules: a document check failed on live Cashfree (a bypassed check on
 * test credentials says nothing); a parcel was weighed at a price other than
 * the estimate and WhatsApp hasn't already said so; a doorstep pickup is
 * tomorrow; a guest's signup has sat untouched for a day; a guest has booked
 * twice or more with no account. None is marketing.
 *
 * Storage is behind NudgeStore and throws until migrations/create_bia_nudges.sql
 * has run, which the sweep reports as "not set up" and sends nothing.
 */

import { insertNotification } from "./appDb.js";
import { supabase } from "./supabaseClient.js";
import { DOC_SLOT_SPECS, isDocSlot, isVerifiedDocSlot } from "../shared/accountSpec.js";
import { NUDGE_KINDS, isNudgeKind, type NudgeKind, type NudgeNotificationData } from "../shared/biaNudges.js";
import { todayInIst } from "../shared/istTime.js";
import { explainDocumentIssue } from "../shared/ocrExplain.js";
import { isAccountReviewEnabled } from "./accountApplications.js";

export type NudgeOwner = { kind: "account"; userId: string } | { kind: "guest"; guestRef: string };

export interface Nudge {
  owner: NudgeOwner;
  kind: NudgeKind;
  /** What it's about, so the same thing is never nudged twice: an order and its date, a document. */
  subject: string;
  title: string;
  body: string;
  orderNo: string | null;
}

export function ownerKey(owner: NudgeOwner): string {
  return owner.kind === "account" ? `a:${owner.userId}` : `g:${owner.guestRef}`;
}

// ─── What the rules read ─────────────────────────────────────────────────────

export interface NudgeOrder {
  id: string;
  order_no: string;
  user_id: string | null;
  guest_ref: string | null;
  guest_phone: string | null;
  status: string;
  pickup_request: number | null;
  pickup_date: string | null;
  quoted_amount: number | string | null;
  final_amount: number | string | null;
  updated_at: string;
}

export interface NudgeDocument {
  id: string;
  owner: NudgeOwner;
  /** An account document's slot; null for a guest's one identity document. */
  slot: string | null;
  /** How the customer knows it: "PAN card", "Aadhaar". */
  label: string;
  ocr_status: string | null;
  created_at: string;
}

export interface NudgeSnapshot {
  /** Today in India, YYYY-MM-DD. */
  today: string;
  nowMs: number;
  /** Doorstep pickups booked for tomorrow that nobody has collected yet. */
  pickupsTomorrow: NudgeOrder[];
  /** Orders at the hub with a final amount (updated in the last week). */
  weighed: NudgeOrder[];
  /** Of those, the ones whose new amount already went out on WhatsApp. */
  repriceSentOnWhatsapp: ReadonlySet<string>;
  /** Documents checked in the last week: the newest per owner and slot. */
  documents: NudgeDocument[];
  /** Guest bookings that aren't cancelled, for counting per guest. */
  guestOrders: NudgeOrder[];
  /** Guest phone numbers that already have an account. */
  phonesWithAccount: ReadonlySet<string>;
  /** Guests with a signup under way, and when they last touched it. */
  signups: { guestRef: string; lastActivityAt: string }[];
  /**
   * Account review: everyone who has filed an application, by ref and phone.
   * Their signup is finished, not stuck, and an account is already on its way,
   * so neither signup_stuck nor guest_account is theirs. Absent with review off.
   */
  applicants?: { refs: ReadonlySet<string>; phones: ReadonlySet<string> };
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Documents and reprices older than this are history, not news. */
const RECENT_MS = 7 * DAY_MS;
/** A signup this quiet is stalled, not paused; before the 14-day retention sweep deletes it. */
const SIGNUP_QUIET_MS = DAY_MS;
const SIGNUP_GIVE_UP_MS = 12 * DAY_MS;
const HUB_STATUSES = ["weighed", "settled", "ready_for_docket"];
/** Verdicts a new photo of the document fixes (shared/ocrExplain.ts §OCR_VERDICTS). */
const REPLACE_VERDICTS = ["mismatch", "wrong_document", "tampered", "unreadable"];

/**
 * Whether a ref's staged rows are an account signup rather than a guest's
 * booking. A guest's one identity document is filed under the same ref (it's
 * mirrored into the signup tables), so one document or number alone says
 * nothing; two documents, a GST number, or both Aadhaar and PAN is a signup.
 */
export function looksLikeSignup(slots: ReadonlySet<string>, numberKinds: ReadonlySet<string>): boolean {
  return slots.size >= 2 || numberKinds.has("gstin") || (numberKinds.has("aadhaar") && numberKinds.has("pan"));
}
const AWAITING_PICKUP = ["pickup_requested", "agent_accepted"];

export function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function orderOwner(o: NudgeOrder): NudgeOwner | null {
  if (o.user_id) return { kind: "account", userId: o.user_id };
  if (o.guest_ref) return { kind: "guest", guestRef: o.guest_ref };
  return null;
}

function num(v: number | string | null): number | null {
  if (v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

const inr = (n: number): string => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const within = (iso: string, ms: number, nowMs: number): boolean => {
  const t = Date.parse(iso);
  return Number.isFinite(t) && nowMs - t <= ms;
};

// ─── The rules (pure) ────────────────────────────────────────────────────────

/** Every nudge the snapshot calls for, most useful kind first. */
export function nudgesFrom(s: NudgeSnapshot): Nudge[] {
  const out: Nudge[] = [];

  // A document check failed in a way a new photo fixes. Only a verdict our
  // checker gave: `bypassed` (test credentials) and `skipped` explain nothing,
  // no verdict is a row from before the checks, and `unavailable` was our
  // checker not answering, which replacing the document wouldn't change.
  for (const d of s.documents) {
    if (!d.ocr_status || !REPLACE_VERDICTS.includes(d.ocr_status) || !within(d.created_at, RECENT_MS, s.nowMs)) continue;
    if (d.slot !== null && !isVerifiedDocSlot(d.slot)) continue;
    const issue = explainDocumentIssue({ verdict: d.ocr_status });
    if (!issue) continue;
    out.push({
      owner: d.owner,
      kind: "document_failed",
      subject: d.id,
      title: `Your ${d.label} needs replacing`,
      body: `${issue.headline.replace(/[.!]?$/, ".")} Tap to see what to do; your shipments carry on meanwhile.`,
      orderNo: null,
    });
  }

  // Weighed at a price other than the estimate, and not already on WhatsApp.
  // Facts only: what's owed either way is for our team to say.
  for (const o of s.weighed) {
    const owner = orderOwner(o);
    const quoted = num(o.quoted_amount);
    const final = num(o.final_amount);
    if (!owner || quoted === null || final === null || Math.abs(final - quoted) < 1) continue;
    if (!HUB_STATUSES.includes(o.status) || !within(o.updated_at, RECENT_MS, s.nowMs)) continue;
    if (s.repriceSentOnWhatsapp.has(o.id)) continue;
    out.push({
      owner,
      kind: "amount_changed",
      subject: `${o.id}:${final}`,
      title: `New amount for ${o.order_no}`,
      body: `After weighing, the final amount is ${inr(final)} (the estimate was ${inr(quoted)}). Our team will be in touch about the difference.`,
      orderNo: o.order_no,
    });
  }

  // A doorstep pickup tomorrow.
  const tomorrow = nextDay(s.today);
  for (const o of s.pickupsTomorrow) {
    const owner = orderOwner(o);
    if (!owner || o.pickup_request !== 1 || o.pickup_date !== tomorrow || !AWAITING_PICKUP.includes(o.status)) continue;
    out.push({
      owner,
      kind: "pickup_tomorrow",
      subject: `${o.id}:${o.pickup_date}`,
      title: `Pickup tomorrow for ${o.order_no}`,
      body:
        owner.kind === "account"
          ? "Keep the parcel packed and ready. Your pickup code is on the order page; read it out when the rider arrives."
          : "Keep the parcel packed and ready. Your pickup code comes on WhatsApp when the rider sets out.",
      orderNo: o.order_no,
    });
  }

  // A guest's signup, untouched for a day and not yet given up on.
  for (const su of s.signups) {
    if (s.applicants?.refs.has(su.guestRef)) continue;
    const t = Date.parse(su.lastActivityAt);
    if (!Number.isFinite(t) || s.nowMs - t < SIGNUP_QUIET_MS || s.nowMs - t > SIGNUP_GIVE_UP_MS) continue;
    out.push({
      owner: { kind: "guest", guestRef: su.guestRef },
      kind: "signup_stuck",
      subject: su.guestRef,
      title: "Your account signup isn't finished",
      body: "What you've entered and uploaded so far is saved. Tap to see what's left.",
      orderNo: null,
    });
  }

  // A guest who has booked twice or more, once ever, and never with an account.
  const byGuest = new Map<string, NudgeOrder[]>();
  for (const o of s.guestOrders) {
    if (o.user_id || !o.guest_ref || o.status === "cancelled") continue;
    byGuest.set(o.guest_ref, [...(byGuest.get(o.guest_ref) ?? []), o]);
  }
  for (const [guestRef, orders] of Array.from(byGuest)) {
    if (orders.length < 2) continue;
    if (orders.some((o) => o.guest_phone && s.phonesWithAccount.has(o.guest_phone))) continue;
    if (s.applicants?.refs.has(guestRef)) continue;
    if (orders.some((o) => o.guest_phone && s.applicants?.phones.has(o.guest_phone))) continue;
    out.push({
      owner: { kind: "guest", guestRef },
      kind: "guest_account",
      subject: "once",
      title: "Your shipments, in one place",
      body: `You've booked ${orders.length} shipments as a guest. An account keeps them together with your details for next time; guest booking stays open too.`,
      orderNo: null,
    });
  }

  const rank = (k: NudgeKind): number => NUDGE_KINDS.indexOf(k);
  return out.sort((a, b) => rank(a.kind) - rank(b.kind));
}

// ─── Storage ─────────────────────────────────────────────────────────────────

export interface NudgeStore {
  /** Every kind someone switched off. */
  optOuts(): Promise<{ owner: NudgeOwner; kind: NudgeKind }[]>;
  /** Owners already nudged on this day (India time). */
  nudgedOn(day: string): Promise<NudgeOwner[]>;
  /** Records it as sent; "duplicate" when it was sent before. Throws when it can't be stored. */
  claim(nudge: Nudge, day: string): Promise<"claimed" | "duplicate">;
  /** Forgets a claim whose notification couldn't be written, so the next sweep tries again. */
  release(nudge: Nudge): Promise<void>;
  /** The kinds this owner switched off. */
  offFor(owner: NudgeOwner): Promise<NudgeKind[]>;
  setOff(owner: NudgeOwner, kind: NudgeKind, off: boolean): Promise<void>;
}

const ownerColumns = (owner: NudgeOwner): { user_id: string | null; guest_ref: string | null } =>
  owner.kind === "account" ? { user_id: owner.userId, guest_ref: null } : { user_id: null, guest_ref: owner.guestRef };

function ownerFromRow(row: { user_id: string | null; guest_ref: string | null }): NudgeOwner | null {
  if (row.user_id) return { kind: "account", userId: row.user_id };
  if (row.guest_ref) return { kind: "guest", guestRef: row.guest_ref };
  return null;
}

function needDb() {
  if (!supabase) throw new Error("no database");
  return supabase;
}

export const databaseNudgeStore: NudgeStore = {
  async optOuts() {
    const { data, error } = await needDb().from("bia_nudge_optouts").select("user_id, guest_ref, kind");
    if (error) throw new Error(error.message);
    return ((data ?? []) as { user_id: string | null; guest_ref: string | null; kind: string }[]).flatMap((r) => {
      const owner = ownerFromRow(r);
      return owner && isNudgeKind(r.kind) ? [{ owner, kind: r.kind }] : [];
    });
  },
  async nudgedOn(day) {
    const { data, error } = await needDb().from("bia_nudges").select("user_id, guest_ref").eq("sent_on", day);
    if (error) throw new Error(error.message);
    return ((data ?? []) as { user_id: string | null; guest_ref: string | null }[]).flatMap((r) => {
      const owner = ownerFromRow(r);
      return owner ? [owner] : [];
    });
  },
  async claim(nudge, day) {
    const { error } = await needDb()
      .from("bia_nudges")
      .insert({ ...ownerColumns(nudge.owner), kind: nudge.kind, subject: nudge.subject, sent_on: day });
    if (!error) return "claimed";
    if (error.code === "23505") return "duplicate";
    throw new Error(error.message);
  },
  async release(nudge) {
    const db = needDb();
    let query = db.from("bia_nudges").delete().eq("kind", nudge.kind).eq("subject", nudge.subject);
    query = nudge.owner.kind === "account" ? query.eq("user_id", nudge.owner.userId) : query.eq("guest_ref", nudge.owner.guestRef);
    await query;
  },
  async offFor(owner) {
    let query = needDb().from("bia_nudge_optouts").select("kind");
    query = owner.kind === "account" ? query.eq("user_id", owner.userId) : query.eq("guest_ref", owner.guestRef);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return ((data ?? []) as { kind: string }[]).map((r) => r.kind).filter(isNudgeKind);
  },
  async setOff(owner, kind, off) {
    const db = needDb();
    if (off) {
      const { error } = await db.from("bia_nudge_optouts").insert({ ...ownerColumns(owner), kind });
      if (error && error.code !== "23505") throw new Error(error.message);
      return;
    }
    let query = db.from("bia_nudge_optouts").delete().eq("kind", kind);
    query = owner.kind === "account" ? query.eq("user_id", owner.userId) : query.eq("guest_ref", owner.guestRef);
    const { error } = await query;
    if (error) throw new Error(error.message);
  },
};

/** Nudges kept in memory: for the unit tests. */
export function memoryNudgeStore(): NudgeStore & {
  sent: { key: string; kind: NudgeKind; subject: string; day: string }[];
  off: Set<string>;
} {
  const sent: { key: string; kind: NudgeKind; subject: string; day: string }[] = [];
  const off = new Set<string>();
  const ownerOfKey = (key: string): NudgeOwner =>
    key.startsWith("a:") ? { kind: "account", userId: key.slice(2) } : { kind: "guest", guestRef: key.slice(2) };
  return {
    sent,
    off,
    async optOuts() {
      return Array.from(off).map((entry) => {
        const [key, kind] = entry.split("|");
        return { owner: ownerOfKey(key), kind: kind as NudgeKind };
      });
    },
    async nudgedOn(day) {
      return sent.filter((s) => s.day === day).map((s) => ownerOfKey(s.key));
    },
    async claim(nudge, day) {
      const key = ownerKey(nudge.owner);
      if (sent.some((s) => s.key === key && s.kind === nudge.kind && s.subject === nudge.subject)) return "duplicate";
      sent.push({ key, kind: nudge.kind, subject: nudge.subject, day });
      return "claimed";
    },
    async release(nudge) {
      const key = ownerKey(nudge.owner);
      const i = sent.findIndex((s) => s.key === key && s.kind === nudge.kind && s.subject === nudge.subject);
      if (i !== -1) sent.splice(i, 1);
    },
    async offFor(owner) {
      const key = ownerKey(owner);
      return Array.from(off)
        .filter((e) => e.startsWith(`${key}|`))
        .map((e) => e.split("|")[1])
        .filter(isNudgeKind);
    },
    async setOff(owner, kind, isOff) {
      const entry = `${ownerKey(owner)}|${kind}`;
      if (isOff) off.add(entry);
      else off.delete(entry);
    },
  };
}

let store: NudgeStore = databaseNudgeStore;

/** Where nudges are recorded. Only tests change it. */
export function replaceNudgeStore(next: NudgeStore | null): void {
  store = next ?? databaseNudgeStore;
}

export function nudgeStore(): NudgeStore {
  return store;
}

// ─── The sweep ───────────────────────────────────────────────────────────────

export interface NudgeSweepReport {
  day: string;
  /** Nudges the rules called for. */
  due: number;
  sent: Partial<Record<NudgeKind, number>>;
  skipped: { optedOut: number; sentBefore: number; oneADay: number; notifyFailed: number };
}

/** Writes the bell row: a type of its own, with order_status to fall back on if the table only takes known types. */
async function notifyNudge(nudge: Nudge): Promise<boolean> {
  const owner = nudge.owner.kind === "account" ? { user_id: nudge.owner.userId } : { guest_ref: nudge.owner.guestRef };
  const data: NudgeNotificationData = { kind: "bia_nudge", nudge: nudge.kind, orderNo: nudge.orderNo };
  const note = { ...owner, title: nudge.title, body: nudge.body, data: data as unknown as Record<string, unknown> };
  return (await insertNotification({ ...note, type: "bia_nudge" })) || (await insertNotification({ ...note, type: "order_status" }));
}

/**
 * Send what's due. Throws only when nudges can't be stored at all (the
 * migration not run), before anything is sent.
 */
export async function runNudgeSweep(
  snapshot: NudgeSnapshot,
  options: { store?: NudgeStore; notify?: (nudge: Nudge) => Promise<boolean> } = {}
): Promise<NudgeSweepReport> {
  const st = options.store ?? store;
  const notify = options.notify ?? notifyNudge;
  const due = nudgesFrom(snapshot);
  const report: NudgeSweepReport = {
    day: snapshot.today,
    due: due.length,
    sent: {},
    skipped: { optedOut: 0, sentBefore: 0, oneADay: 0, notifyFailed: 0 },
  };

  const off = new Set((await st.optOuts()).map((o) => `${ownerKey(o.owner)}|${o.kind}`));
  const nudgedToday = new Set((await st.nudgedOn(snapshot.today)).map(ownerKey));

  for (const nudge of due) {
    const key = ownerKey(nudge.owner);
    if (off.has(`${key}|${nudge.kind}`)) {
      report.skipped.optedOut++;
      continue;
    }
    if (nudgedToday.has(key)) {
      report.skipped.oneADay++;
      continue;
    }
    if ((await st.claim(nudge, snapshot.today)) === "duplicate") {
      report.skipped.sentBefore++;
      continue;
    }
    if (!(await notify(nudge))) {
      await st.release(nudge).catch(() => undefined);
      report.skipped.notifyFailed++;
      continue;
    }
    nudgedToday.add(key);
    report.sent[nudge.kind] = (report.sent[nudge.kind] ?? 0) + 1;
  }
  return report;
}

// ─── The snapshot (database) ─────────────────────────────────────────────────

const ORDER_COLUMNS =
  "id, order_no, user_id, guest_ref, guest_phone, status, pickup_request, pickup_date, quoted_amount, final_amount, updated_at";

/** Rows or nothing: a rule that can't read its table sends nothing, and says so once in the log. */
async function rows<T>(label: string, query: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await query;
  if (error) {
    console.warn(`[nudges] could not read ${label}: ${error.message}`);
    return [];
  }
  return (data ?? []) as T[];
}

/** What the rules need, read from the database. */
export async function loadNudgeSnapshot(now: Date = new Date()): Promise<NudgeSnapshot> {
  const db = needDb();
  const today = todayInIst(now);
  const nowMs = now.getTime();
  const recent = new Date(nowMs - RECENT_MS).toISOString();
  const signupWindow = new Date(nowMs - SIGNUP_GIVE_UP_MS).toISOString();

  const [pickupsTomorrow, weighed, guestOrders, accountDocs, kycDocs, signupDocs, signupNumbers] = await Promise.all([
    rows<NudgeOrder>(
      "tomorrow's pickups",
      db.from("orders").select(ORDER_COLUMNS).eq("pickup_request", 1).eq("pickup_date", nextDay(today)).in("status", AWAITING_PICKUP)
    ),
    rows<NudgeOrder>(
      "weighed orders",
      db.from("orders").select(ORDER_COLUMNS).in("status", HUB_STATUSES).not("final_amount", "is", null).gte("updated_at", recent)
    ),
    rows<NudgeOrder>(
      "guest orders",
      db.from("orders").select(ORDER_COLUMNS).is("user_id", null).not("guest_ref", "is", null).neq("status", "cancelled").limit(5000)
    ),
    rows<{ id: string; user_id: string; doc_slot: string; ocr_status: string | null; created_at: string }>(
      "account documents",
      db.from("account_documents").select("id, user_id, doc_slot, ocr_status, created_at").not("user_id", "is", null).gte("created_at", recent)
    ),
    rows<{ id: string; guest_ref: string; document_type: string | null; ocr_status: string | null; created_at: string; updated_at: string | null }>(
      "guest identity documents",
      db.from("kyc_documents").select("id, guest_ref, document_type, ocr_status, created_at, updated_at").not("guest_ref", "is", null).gte("created_at", recent)
    ),
    rows<{ signup_ref: string; doc_slot: string; created_at: string }>(
      "signup documents",
      db.from("account_documents").select("signup_ref, doc_slot, created_at").not("signup_ref", "is", null).gte("created_at", signupWindow)
    ),
    rows<{ signup_ref: string; kind: string; created_at: string }>(
      "signup numbers",
      db.from("identity_verifications").select("signup_ref, kind, created_at").not("signup_ref", "is", null).gte("created_at", signupWindow)
    ),
  ]);

  // The newest document per owner and slot: a replacement supersedes a failure.
  const newest = new Map<string, NudgeDocument>();
  for (const d of accountDocs) {
    const key = `${d.user_id}|${d.doc_slot}`;
    const prev = newest.get(key);
    if (prev && prev.created_at >= d.created_at) continue;
    newest.set(key, {
      id: d.id,
      owner: { kind: "account", userId: d.user_id },
      slot: d.doc_slot,
      label: isDocSlot(d.doc_slot) ? DOC_SLOT_SPECS[d.doc_slot].label : "document",
      ocr_status: d.ocr_status,
      created_at: d.created_at,
    });
  }
  const documents: NudgeDocument[] = [
    ...Array.from(newest.values()),
    ...kycDocs.map((k) => ({
      id: k.id,
      owner: { kind: "guest" as const, guestRef: k.guest_ref },
      slot: null,
      label: k.document_type?.replace(/ Number$/, "") || "identity document",
      ocr_status: k.ocr_status,
      created_at: k.updated_at ?? k.created_at,
    })),
  ];

  // Whether a weighed order's new amount already went out on WhatsApp.
  const weighedIds = weighed.map((o) => o.id);
  const sentReprices =
    weighedIds.length === 0
      ? []
      : await rows<{ order_id: string; dedupe_key: string }>(
          "reprice messages",
          db.from("whatsapp_messages").select("order_id, dedupe_key").in("order_id", weighedIds).in("status", ["sent", "delivered", "read"])
        );
  const repriceSentOnWhatsapp = new Set(
    sentReprices.filter((m) => /:bombino_(amount|refund)_due(:|$)/.test(m.dedupe_key)).map((m) => m.order_id)
  );

  const guestPhones = Array.from(new Set(guestOrders.map((o) => o.guest_phone).filter((p): p is string => !!p)));
  const accounts =
    guestPhones.length === 0
      ? []
      : await rows<{ phone: string }>("accounts by phone", db.from("itd_users").select("phone").in("phone", guestPhones));

  // Signups: the last time each ref was touched, and only refs that are a
  // guest's (booked, or kept a profile), since only they have a bell.
  const last = new Map<string, string>();
  const slots = new Map<string, Set<string>>();
  const kinds = new Map<string, Set<string>>();
  for (const r of [...signupDocs, ...signupNumbers]) {
    if ((last.get(r.signup_ref) ?? "") < r.created_at) last.set(r.signup_ref, r.created_at);
  }
  for (const r of signupDocs) slots.set(r.signup_ref, (slots.get(r.signup_ref) ?? new Set()).add(r.doc_slot));
  for (const r of signupNumbers) kinds.set(r.signup_ref, (kinds.get(r.signup_ref) ?? new Set()).add(r.kind));
  const refs = Array.from(last.keys()).filter((ref) => looksLikeSignup(slots.get(ref) ?? new Set(), kinds.get(ref) ?? new Set()));
  const [profiles, booked] =
    refs.length === 0
      ? [[], []]
      : await Promise.all([
          rows<{ guest_ref: string }>("guest profiles", db.from("guest_profiles").select("guest_ref").in("guest_ref", refs)),
          rows<{ guest_ref: string }>("guest refs with orders", db.from("orders").select("guest_ref").in("guest_ref", refs)),
        ]);
  const guests = new Set([...profiles, ...booked].map((r) => r.guest_ref));

  const applications = isAccountReviewEnabled()
    ? await rows<{ signup_ref: string; phone: string }>(
        "account applications",
        db.from("account_applications").select("signup_ref, phone")
      )
    : [];

  return {
    today,
    nowMs,
    pickupsTomorrow,
    weighed,
    repriceSentOnWhatsapp,
    documents,
    guestOrders,
    phonesWithAccount: new Set(accounts.map((a) => a.phone)),
    signups: refs.filter((r) => guests.has(r)).map((guestRef) => ({ guestRef, lastActivityAt: last.get(guestRef)! })),
    applicants: {
      refs: new Set(applications.map((a) => a.signup_ref)),
      phones: new Set(applications.map((a) => a.phone)),
    },
  };
}
