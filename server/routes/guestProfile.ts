/**
 * The guest's own profile endpoints.
 *
 * A guest — someone who proved a phone number by OTP and booked without an
 * account — has no `/api/user/profile` and no `/api/orders`: both answer only
 * to a session user. This module is their equivalent, and it is deliberately
 * narrow: read what we hold about them, and correct the two fields they are
 * allowed to correct.
 *
 * ── Who is asking ──────────────────────────────────────────────────────────
 *
 * The `guest_ref` in the session, and nothing else. That uuid is minted only
 * by `signupRefForPhone`, which only ever runs after an OTP on the number, so
 * holding one is itself the proof of the phone. No route here reads a phone
 * out of a request body, and none should start — that would let a caller name
 * someone else's number and be answered with their orders.
 *
 * Two session fields can carry it, and both are accepted:
 *   `guestRef`  — promoted at order creation, and stable afterwards.
 *   `signupRef` — held while documents are staged, before any order exists.
 * They are the same uuid; the second is simply the earlier name for it.
 */

import type { Express, Request, Response } from "express";
import { z } from "zod";
import {
  COMPANY_CATEGORIES,
  EXTRA_FIELDS,
  EXTRA_FIELD_SPECS,
  requiredDocuments,
  verificationState,
  type CompanyCategory,
  type ExtraField,
} from "../../shared/accountSpec.js";
import { listDocumentsBySignupRef } from "../accountDocsDb.js";
import { seedSignupDocumentFromGuestKyc } from "../guestKycMirror.js";
import { INDIA_HUBS } from "../../shared/hubs.js";
import {
  getGuestKycSummary,
  getGuestProfile,
  listGuestOrders,
  updateGuestContactOnOrders,
  upsertGuestProfile,
} from "../guestProfileDb.js";

/** The guest this session is, or null. */
function guestFrom(req: Request): { ref: string; phone: string } | null {
  if (req.session.guestRef && req.session.guestPhone) {
    return { ref: req.session.guestRef, phone: req.session.guestPhone };
  }
  if (req.session.signupRef && req.session.signupPhone) {
    return { ref: req.session.signupRef, phone: req.session.signupPhone };
  }
  return null;
}

/**
 * OCR's word on the identity document, in the two terms the customer screen
 * uses.
 *
 * `match` is the only status where the number on the document was read and
 * agreed with the number typed. The other four — unreadable, unavailable,
 * skipped, bypassed — are the ops queue: the document is on file and there is
 * nothing further for the customer to do, but nobody has confirmed it yet.
 * Calling that "verified" would promise an outcome that has not happened.
 */
function kycStatusFrom(ocrStatus: unknown): "verified" | "in_review" {
  return ocrStatus === "match" ? "verified" : "in_review";
}

type GuestProfileResponse = {
  phone: string;
  full_name: string | null;
  email: string | null;
  /** What shape of account they say they want. Null until chosen. */
  account_type: "personal" | "company" | null;
  /** Company shape only. Null on a personal profile, and until chosen. */
  company_category: string | null;
  company_name: string | null;
  gstin: string | null;
  gstin_verified_name: string | null;
  contact_person: string | null;
  address_line_1: string | null;
  pincode: string | null;
  city: string | null;
  state: string | null;
  hub_id: string | null;
  extras: Record<string, string>;
  /**
   * The document matrix the account they intend to open will owe, and how far
   * through it they are.
   *
   * Not the same question as "is there an identity document on file". One
   * document is enough to book; an account owes a set decided by its shape
   * (shared/accountSpec.ts §requiredDocuments), and a guest who has given us
   * an Aadhaar is one of two rather than done.
   */
  documents: {
    required: string[];
    provided: string[];
    missing: string[];
    unverified: string[];
  };
  kyc: { status: "verified" | "in_review"; summary: string } | null;
  orders: Awaited<ReturnType<typeof listGuestOrders>>;
};

async function buildProfile(guest: { ref: string; phone: string }): Promise<GuestProfileResponse> {
  // Seeded first so a document given for booking counts towards the account's
  // matrix — see server/guestKycMirror.ts.
  await seedSignupDocumentFromGuestKyc(guest.ref);

  const [profile, kyc, orders, staged] = await Promise.all([
    getGuestProfile(guest.ref),
    getGuestKycSummary(guest.ref),
    listGuestOrders(guest.ref),
    listDocumentsBySignupRef(guest.ref),
  ]);

  // The stored profile wins, then whatever the newest booking declared. A
  // guest who booked before `guest_profiles` existed still gets their name
  // back, rather than being asked for something they already gave.
  const newest = orders[0];

  return {
    phone: profile?.phone ?? guest.phone,
    full_name: profile?.full_name ?? newest?.guest_name ?? null,
    email: profile?.email ?? newest?.guest_email ?? null,
    account_type:
      profile?.account_type === "personal" || profile?.account_type === "company"
        ? profile.account_type
        : null,
    company_category: profile?.company_category ?? null,
    company_name: profile?.company_name ?? null,
    gstin: profile?.gstin ?? null,
    gstin_verified_name: profile?.gstin_verified_name ?? null,
    contact_person: profile?.contact_person ?? null,
    address_line_1: profile?.address_line_1 ?? null,
    pincode: profile?.pincode ?? null,
    city: profile?.city ?? null,
    state: profile?.state ?? null,
    hub_id: profile?.hub_id ?? null,
    extras: profile?.extras ?? {},
    documents: (() => {
      // Before they have chosen a shape there is no matrix to be measured
      // against, so nothing is claimed either way.
      const accountType = profile?.account_type === "company" ? "company" : "personal";
      if (!profile?.account_type) {
        return { required: [], provided: [], missing: [], unverified: [] };
      }
      const category = (profile.company_category ?? null) as CompanyCategory | null;
      const required = requiredDocuments(accountType, category);
      const { missing, unverified } = verificationState(accountType, category, staged);
      const providedSlots = new Set(staged.map((row) => row.doc_slot));
      return {
        required: [...required],
        provided: required.filter((slot) => providedSlots.has(slot)),
        missing,
        unverified,
      };
    })(),
    kyc: kyc
      ? {
          status: kycStatusFrom(kyc.ocr_status),
          // The last four only — what every other customer surface shows, and
          // this endpoint has no business being the one place a full Aadhaar
          // number leaves the server.
          summary: `${kyc.document_type} ••${kyc.last_four}`,
        }
      : null,
    orders,
  };
}

/**
 * Every field a guest may answer, validated exactly as signup validates it.
 *
 * The rules are not re-invented here: the extras carry their own patterns in
 * shared/accountSpec.ts §EXTRA_FIELD_SPECS, the categories come from
 * §COMPANY_CATEGORIES, and the hub must be one the company actually operates.
 * Two screens asking for the same value under different rules is how a profile
 * ends up holding something signup will later refuse.
 *
 * All optional, because the profile is answered one row at a time. Not all
 * absent, because an empty patch is a caller bug and a 200 would hide it.
 */
const extrasSchema = z.object(
  Object.fromEntries(
    EXTRA_FIELDS.map((field) => {
      const spec = EXTRA_FIELD_SPECS[field as ExtraField];
      return [
        field,
        z
          .string()
          .trim()
          .max(spec.maxLength)
          .refine((v) => spec.pattern.test(spec.uppercase ? v.toUpperCase() : v), {
            message: spec.error,
          })
          .optional(),
      ];
    })
  ) as unknown as Record<ExtraField, z.ZodOptional<z.ZodString>>
);

const HUB_IDS: string[] = INDIA_HUBS.map((hub) => String(hub.id));

const patchSchema = z
  .object({
    full_name: z.string().trim().min(2, "Enter your full name").max(80).optional(),
    email: z.string().trim().email("Enter a valid email address").max(254).optional(),
    // The customer's stated intent, not the account itself. Signup can still
    // open a different shape if they change the toggle on the way.
    account_type: z.enum(["personal", "company"]).optional(),
    company_category: z.enum(COMPANY_CATEGORIES).optional(),
    company_name: z.string().trim().min(2, "Enter the company name").max(120).optional(),
    contact_person: z.string().trim().min(2, "Enter a contact person").max(80).optional(),
    address_line_1: z.string().trim().min(4, "Enter the street address").max(200).optional(),
    pincode: z
      .string()
      .trim()
      .regex(/^\d{6}$/, "Enter a valid 6-digit pincode")
      .optional(),
    city: z.string().trim().min(2, "Enter the city").max(80).optional(),
    state: z.string().trim().min(2, "Enter the state").max(80).optional(),
    hub_id: z
      .string()
      .trim()
      .refine((v) => HUB_IDS.includes(v), { message: "Choose one of our hubs" })
      .optional(),
    extras: extrasSchema.optional(),
  })
  // NOT here: `gstin`. It is only ever written by the identity check, which
  // has to reach the GST registry first — see the note on the PATCH route.
  .refine((v) => Object.values(v).some((value) => value !== undefined), {
    message: "Send a detail to save",
  });

export function registerGuestProfileRoutes(app: Express): void {
  // ── GET /api/guest/profile ──────────────────────────────────────────────
  //
  // Everything this guest is: the verified number, the details they have
  // given, the identity document on file, and their bookings.
  app.get("/api/guest/profile", async (req: Request, res: Response) => {
    // An account is not a guest. Answering this for a signed-in customer would
    // hand them a second, emptier identity beside their real one.
    if (req.session.user) {
      res.status(409).json({
        message: "This session is signed in. Use /api/user/profile.",
        code: "ACCOUNT_SESSION",
      });
      return;
    }

    const guest = guestFrom(req);
    if (!guest) {
      // 401 means "nobody has verified a number in this browser" — a normal
      // state for a visitor, not an expired session. lib/session.ts lists this
      // path in NOT_AN_EXPIRY for exactly that reason.
      res.status(401).json({ message: "No verified number in this session." });
      return;
    }

    res.json(await buildProfile(guest));
  });

  // ── PATCH /api/guest/profile ────────────────────────────────────────────
  //
  // The two fields a guest may give us after the fact. Not the phone: that is
  // what identifies them, and changing it means proving a new one through the
  // OTP flow, which mints a different ref by design.
  app.patch("/api/guest/profile", async (req: Request, res: Response) => {
    if (req.session.user) {
      res.status(409).json({
        message: "This session is signed in. Use /api/user/profile.",
        code: "ACCOUNT_SESSION",
      });
      return;
    }

    const guest = guestFrom(req);
    if (!guest) {
      res.status(401).json({ message: "No verified number in this session." });
      return;
    }

    const parsed = patchSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        message: parsed.error.issues[0]?.message ?? "Invalid request",
        code: "INVALID_REQUEST",
      });
      return;
    }

    const saved = await upsertGuestProfile({
      guest_ref: guest.ref,
      phone: guest.phone,
      ...parsed.data,
    });

    if (!saved) {
      res.status(502).json({ message: "Could not save your details. Please try again." });
      return;
    }

    // The docket prints what the ORDER carries, so the correction has to reach
    // the bookings that have not been docketed yet. Best-effort and after the
    // profile write: the customer's details are saved either way.
    // Only the contact details belong on an order. `account_type` is about the
    // account they intend to open, and an order has no opinion about that.
    await updateGuestContactOnOrders(guest.ref, {
      full_name: parsed.data.full_name,
      email: parsed.data.email,
    });

    // The whole profile back, not just the patch — the screen that called this
    // renders progress across four fields and would otherwise need a second
    // round trip to redraw them.
    res.json(await buildProfile(guest));
  });
}
