/**
 * Guest box labels, the public parcel page, and staff scans.
 *
 * A guest order has no AWB until ops dockets it at the hub (there is no ITD
 * login to file it under at booking), so the guest prints a Bombino box label
 * instead: the order number and a QR. An account with no ITD login of its own
 * is a guest in every way that matters here, so it gets the same label. The QR opens `/p/<tag>`, a view-only page
 * anyone can read; the tag is signed (`parcelTag.ts`), so holding the label is
 * the only way to the page.
 *
 *   GET /api/orders/:orderNo/box-label   the owner, for their own order
 *   GET /api/p/:token                    anyone; any agent or ops user sees all
 *   GET /api/parcel-tag/resolve          agents and ops, after a scan (tag,
 *                                        order number or AWB)
 *
 * The ops reprint (`/api/ops/orders/:id/box-label`) lives with the other ops
 * routes and builds the same PDF through `boxLabelFor`.
 */

import type { Express, Request, Response } from "express";
import { format, isValid, parseISO } from "date-fns";
import { asyncRoutes, requireUser, ensureDbUser } from "../routeGuards.js";
import { OWNER_PROFILES, ownerFrom } from "../sessionOwner.js";
import {
  findOrderForOwner,
  ensureParcelId,
  getOrderIdByAwb,
  getOrderIdByNumber,
  getOrderIdByParcelId,
  getOrderWithAddressById,
  listOrderEvents,
  type OrderWithAddress,
} from "../ordersDb.js";
import { parcelTagFor, verifyParcelTag } from "../parcelTag.js";
import { formatParcelId, newParcelId, normaliseParcelId } from "../parcelId.js";
import { buildBoxLabelPdf } from "../boxLabelPdf.js";
import { FixedWindowLimiter } from "../supportRateLimit.js";
import { isOpsRole } from "../../shared/staffAccess.js";
import { itdUserHasStoredPassword } from "../appDb.js";
import {
  deriveCustomerStatus,
  isInternalOnlyStatus,
  type Order,
  type OrderStatus,
} from "../../shared/orderContract.js";
import type { ParcelScanResult, ParcelTagEvent, ParcelTagParty, ParcelTagView } from "../../shared/parcelTag.js";
import { itdClient } from "../itd.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function str(obj: unknown, key: string): string | null {
  if (!obj || typeof obj !== "object") return null;
  const v = (obj as Record<string, unknown>)[key];
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number") return String(v);
  return null;
}

function niceDate(value: string): string {
  const d = parseISO(value);
  return isValid(d) ? format(d, "dd MMM yyyy") : "";
}

function destinationOf(order: Order): string {
  return [str(order.consignee, "city"), str(order.consignee, "country_name")].filter(Boolean).join(", ");
}

/**
 * Whether an order gets our QR box label: no AWB yet, still live, and booked
 * without an ITD login, i.e. by a guest or by an account we hold no ITD
 * password for. Accounts with an ITD login always end up with a real AWB and
 * its ITD labels, so they never get this one.
 */
export async function boxLabelEligible(order: Pick<Order, "awb_no" | "status" | "user_id">): Promise<boolean> {
  if (order.awb_no || order.status === "cancelled") return false;
  if (!order.user_id) return true;
  return !(await itdUserHasStoredPassword(order.user_id));
}

/** The order's parcel ID, when its label has been made. */
function parcelIdOf(order: Order): string | null {
  const id = (order.metadata as Record<string, unknown> | null | undefined)?.parcel_id;
  return typeof id === "string" && id ? id : null;
}

/**
 * The order a code on a label names: our 12-character parcel ID (the QR on
 * labels from now on), or the signed tag earlier labels carried. Never
 * anything guessable, so the public page can trust it.
 */
async function orderIdFromCode(code: string): Promise<string | null> {
  const parcelId = normaliseParcelId(code);
  if (parcelId) {
    const id = await getOrderIdByParcelId(parcelId);
    if (id) return id;
  }
  return verifyParcelTag(code);
}

/** The origin the QR should point at. */
function appOrigin(req: Request): string {
  const configured = process.env.PUBLIC_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return `${req.protocol}://${req.get("host")}`;
}

/**
 * The box label PDF for an order, as base64 (same shape as the ITD labels).
 *
 * The QR is `/p/<parcel ID>` and the same ID is printed under it, so the QR
 * and the typed ID are one thing. The ID is made on the first label and kept,
 * so reprints match. Should the ID not be storable (a DB failure) the label
 * still prints, with the signed tag in the QR and the order number under it.
 */
export async function boxLabelFor(req: Request, order: Order): Promise<string> {
  const parcelId = await ensureParcelId(order.id, newParcelId);
  // The shipper block needs the pickup/sender address, which not every
  // caller loaded (the ops reprint reads the bare order).
  const withAddress = await getOrderWithAddressById(order.id);
  const origin = withAddress?.origin_address ?? null;
  const c = order.consignee;
  const bytes = await buildBoxLabelPdf({
    orderNo: order.order_no,
    qrUrl: `${appOrigin(req)}/p/${parcelId ?? parcelTagFor(order.id)}`,
    parcelId: parcelId ? formatParcelId(parcelId) : order.order_no,
    consignee: {
      name: str(c, "name"),
      company: str(c, "company"),
      address: [str(c, "address_line_1"), str(c, "address_line_2")],
      cityLine: [
        str(c, "city"),
        [str(c, "state"), str(c, "pincode")].filter(Boolean).join(" "),
      ]
        .filter(Boolean)
        .join(", "),
      country: str(c, "country_name"),
      phone: str(c, "phone"),
    },
    shipper: {
      name: origin?.full_name ?? order.guest_name ?? null,
      company: origin?.company ?? null,
      address: [origin?.address_line_1, origin?.address_line_2],
      cityLine: [origin?.city, [origin?.state, origin?.pincode].filter(Boolean).join(" ")]
        .filter(Boolean)
        .join(", "),
      country: origin?.country_name ?? "India",
      phone: origin?.phone ?? order.guest_phone ?? null,
    },
    service: str(order.items, "api_service_code"),
    pieces: str(order.items, "pcs"),
    weightKg: order.booked_weight,
    bookedOn: niceDate(order.created_at),
    isPickup: order.pickup_request === 1,
  });
  return Buffer.from(bytes).toString("base64");
}

/** Who the caller is on the staff side, if anyone. */
function staffRole(req: Request): "ops" | "agent" | null {
  const role = req.session.user?.role;
  if (role === "agent") return "agent";
  if (isOpsRole(role)) return "ops";
  return null;
}

function party(
  name: string | null,
  company: string | null,
  phone: string | null,
  lines: (string | null | undefined)[]
): ParcelTagParty {
  return { name, company, phone, address: lines.filter(Boolean).join("\n") };
}

/**
 * The carrier's scans for a dispatched parcel, newest first, with only what
 * bombinoexp.com's tracking shows: event, place, time. Cached five minutes so
 * a label scanned repeatedly does not cost an ITD call each time. Null when
 * ITD has nothing or does not answer; the page then shows Bombino's own steps.
 */
const carrierCache = new Map<string, { at: number; value: { events: ParcelTagEvent[]; forwardingNo: string | null } }>();
const CARRIER_TTL_MS = 5 * 60 * 1000;

async function carrierTracking(
  awb: string
): Promise<{ events: ParcelTagEvent[]; forwardingNo: string | null } | null> {
  const hit = carrierCache.get(awb);
  if (hit && Date.now() - hit.at < CARRIER_TTL_MS) return hit.value;
  try {
    const results = await itdClient.trackShipment(awb);
    const r = results?.[0];
    if (!r || r.errors) return null;
    const events = (r.docket_events ?? [])
      .map((e) => ({
        at: e.event_at,
        label: (e.event_description ?? "").trim(),
        location: (e.event_location ?? "").trim() || null,
      }))
      .filter((e) => e.label)
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    const value = { events, forwardingNo: (r.forwarding_no ?? "").trim() || null };
    carrierCache.set(awb, { at: Date.now(), value });
    return value;
  } catch (err) {
    console.error("[parcel] carrier tracking failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

// The public page needs no login, so it is what a scraper would hit. A label
// is read a handful of times in its life; 60 an hour per address is generous.
const publicLimiter = new FixedWindowLimiter(60 * 60 * 1000);
const PUBLIC_LIMIT = 60;

// ─── Routes ─────────────────────────────────────────────────────────────────

export function registerParcelRoutes(app: Express): void {
  const routes = asyncRoutes(app);

  // The owner's own label. Same ownership boundary as GET /api/orders/:orderNo:
  // the account or the guest_ref is in the WHERE clause.
  routes.get("/api/orders/:orderNo/box-label", ensureDbUser, async (req: Request, res: Response) => {
    const owner = ownerFrom(req, OWNER_PROFILES.payment);
    const order =
      owner?.kind === "account" && owner.userId
        ? await findOrderForOwner({ orderNo: req.params.orderNo }, { kind: "account", userId: owner.userId })
        : owner?.guestRef
          ? await findOrderForOwner({ orderNo: req.params.orderNo }, { kind: "guest", guestRef: owner.guestRef })
          : null;
    if (!order || !(await boxLabelEligible(order))) {
      res.status(404).json({ message: "Box label not available" });
      return;
    }
    res.json({ boxLabel: await boxLabelFor(req, order) });
  });

  // The page behind the QR.
  routes.get("/api/p/:token", async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");

    const role = staffRole(req);
    if (!role) {
      const key = `parcel:${req.ip || req.socket.remoteAddress || "unknown"}`;
      if (publicLimiter.hit(key) > PUBLIC_LIMIT) {
        res.status(429).json({ message: "Too many requests. Try again later." });
        return;
      }
    }

    const orderId = await orderIdFromCode(req.params.token);
    const order: OrderWithAddress | null = orderId ? await getOrderWithAddressById(orderId) : null;
    if (!order) {
      res.status(404).json({ message: "This label is not recognised." });
      return;
    }

    const rawEvents = (await listOrderEvents(order.id)) ?? [];
    const events = rawEvents
      .filter((ev) => !isInternalOnlyStatus(ev.status as OrderStatus))
      // Movement only. Cancellation requests and payments are the owner's
      // business, not whoever is holding the box.
      .filter((ev) => {
        const action = (ev.metadata as Record<string, unknown> | null)?.action;
        return action !== "request_cancellation" && action !== "reject_cancellation" && action !== "collect_payment";
      })
      .map((ev) => ({
        at: ev.created_at,
        label: deriveCustomerStatus({ ...order, status: ev.status as OrderStatus }),
      }));

    const dbUserId = req.session.dbUserId ?? null;
    const assignedToMe = role === "agent" && !!dbUserId && order.agent_id === dbUserId;
    // Any staff scan shows the whole order. A box can reach any agent or any
    // hub hand (a reassignment, a handover between agents, a counter), and the
    // label exists so they can act on it, not to send them looking elsewhere.
    // Client details (names, phones, addresses, contents) for ops only.
    // Everyone else who scans a box, agents included, gets the tracking view.
    const showStaff = role === "ops";
    const origin = order.origin_address;

    const storedParcelId = parcelIdOf(order);
    const carrier = order.awb_no && order.status === "dispatched" ? await carrierTracking(order.awb_no) : null;
    const view: ParcelTagView = {
      orderNo: order.order_no,
      parcelId: storedParcelId ? formatParcelId(storedParcelId) : null,
      awbNo: order.awb_no,
      status: order.status,
      statusLabel: deriveCustomerStatus(order),
      isPickup: order.pickup_request === 1,
      origin: [order.origin_address?.city, order.origin_address?.state].filter(Boolean).join(", "),
      destination: destinationOf(order),
      service: str(order.items, "api_service_code"),
      pieces: str(order.items, "pcs"),
      bookedAt: order.created_at,
      events,
      carrierEvents: carrier?.events ?? [],
      forwardingNo: carrier?.forwardingNo ?? null,
      bookedWeightKg: showStaff ? order.booked_weight : null,
      staff: showStaff && role
        ? {
            orderId: order.id,
            role,
            assignedToMe,
            contents: str(order.items, "shipment_content"),
            sender: party(
              origin?.full_name ?? order.guest_name ?? null,
              origin?.company ?? null,
              origin?.phone ?? order.guest_phone ?? null,
              [
                origin?.address_line_1,
                origin?.address_line_2,
                [origin?.city, origin?.state].filter(Boolean).join(", "),
                origin?.pincode,
              ]
            ),
            recipient: party(
              str(order.consignee, "name"),
              str(order.consignee, "company"),
              str(order.consignee, "phone"),
              [
                str(order.consignee, "address_line_1"),
                [str(order.consignee, "city"), str(order.consignee, "state")].filter(Boolean).join(", "),
                [str(order.consignee, "pincode"), str(order.consignee, "country_name")].filter(Boolean).join(", "),
              ]
            ),
          }
        : null,
    };
    res.json(view);
  });

  // After a scan: which order, and is it this agent's job. Accepts the tag (from
  // a QR) or an order number (typed). Staff only; a customer never needs it.
  routes.get("/api/parcel-tag/resolve", requireUser, ensureDbUser, async (req: Request, res: Response) => {
    const role = staffRole(req);
    if (!role) {
      res.status(403).json({ message: "Staff only" });
      return;
    }

    const raw = typeof req.query.q === "string" ? req.query.q.trim() : "";
    // A scanned QR is a full URL; take the tag off the end of it.
    const tagMatch = raw.match(/\/p\/([^/?#\s]+)/);
    const tag = tagMatch ? decodeURIComponent(tagMatch[1]) : raw;

    let orderId = await orderIdFromCode(tag);
    if (!orderId && /^BOM-?\d+$/i.test(raw)) {
      const normalised = raw.toUpperCase().replace(/^BOM-?/, "BOM-");
      orderId = await getOrderIdByNumber(normalised);
    }
    // An ITD label. The AWB barcode is the AWB; the box label's "PARCEL NO."
    // barcode is the AWB plus a box number, printed "72858924230 / 01" and
    // encoded either with a separator or run together. The AWB is tried as
    // given first, then with a trailing two-digit box number taken off.
    let piece: number | null = null;
    const parcelNo = raw.replace(/\s+/g, "").match(/^(\d{8,14})[\/-](\d{1,3})$/);
    if (!orderId && parcelNo) {
      orderId = await getOrderIdByAwb(parcelNo[1]);
      if (orderId) piece = Number(parcelNo[2]);
    }
    if (!orderId && /^\d{8,16}$/.test(raw)) {
      orderId = await getOrderIdByAwb(raw);
      if (!orderId && raw.length >= 10) {
        orderId = await getOrderIdByAwb(raw.slice(0, -2));
        if (orderId) piece = Number(raw.slice(-2));
      }
    }
    const order = orderId ? await getOrderWithAddressById(orderId) : null;
    if (!order) {
      res.status(404).json({ message: "No order matches that code." });
      return;
    }

    const dbUserId = req.session.dbUserId ?? null;
    const pieces = Number(str(order.items, "pcs"));
    const result: ParcelScanResult = {
      orderId: order.id,
      orderNo: order.order_no,
      assignedToMe: role === "agent" && !!dbUserId && order.agent_id === dbUserId,
      token: parcelIdOf(order) ?? parcelTagFor(order.id),
      piece: piece && piece > 0 ? piece : null,
      pieces: Number.isFinite(pieces) && pieces > 0 ? pieces : null,
    };
    res.json(result);
  });
}
