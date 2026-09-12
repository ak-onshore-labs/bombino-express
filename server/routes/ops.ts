/**
 * Phase 3A/3B — Ops read endpoints (board + order detail + availableActions).
 *
 * Self-registering: `registerOpsRoutes(app)` is called from `routes.ts`.
 * Every route is gated requireUser + requireRole("admin","super_admin") so
 * super_admin is never rejected by an exact single-arg "admin" match.
 */

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { isIndiaHubId } from "../../shared/hubs.js";
import {
  beatIdsForAgent,
  beatNamesByAgent,
  getBeat,
  insertBeat,
  listBeats,
  replaceBeatAgents,
  replaceBeatPincodes,
  setAgentBeats,
  updateBeat,
  type BeatPincode,
} from "../beatsDb.js";
import {
  ORDER_STATUSES,
  isOrderStatus,
  isRole,
  type Order,
  type PaymentMethod,
  type PaymentStatus,
} from "../../shared/orderContract.js";
import {
  DEFAULT_OPS_BOARD_FILTERS,
  type OpsBoardSection,
} from "../../shared/opsBoardQuery.js";
import {
  accountDocSlotsForUserIds,
  getAccountDocumentByUserIdAndSlot,
  listAccountDocOpsMetaByUserId,
  listDocumentVerdictsForUserIds,
} from "../accountDocsDb.js";
import {
  findActiveAgentById,
  findItdUserIdByPhone,
  getCustomerForOps,
  getStaffUserById,
  insertStaffUser,
  listCustomerAccounts,
  listCustomersForOps,
  listStaffUsers,
  updateStaffUser,
} from "../appDb.js";
import { getCodeForOwner, issueCode } from "../handoverCodes.js";
import {
  getIdentityVerificationByUserIdAndKind,
  identityKindsForUserIds,
  listIdentityOpsMetaByUserId,
  type IdentityKind,
} from "../identityDb.js";
import { getKycFileByUserId, getKycOpsMetaByUserId, kycExistsForUserIds } from "../kycDb.js";
import { notifyOrderTransition } from "../notify.js";
import { availableActions } from "../orderLifecycle.js";
import { insertOrderEvent } from "../ordersDb.js";
import {
  assignPickup,
  countOrdersForOpsCustomers,
  getOrderByIdForOps,
  listAllOrdersForOps,
  listOpsOrdersByCustomer,
  listOpsOrdersForExport,
  listOpsPayments,
  listOrderEventsForOps,
  listPendingCancellationsForOps,
  type OpsOrderDetail,
  type OpsPaymentRange,
} from "../opsDb.js";
import { requireRole, requireUser, ensureDbUser } from "../routeGuards.js";
import {
  AuditLogUnavailableError,
  logDocumentAccess,
  logDocumentAccessOrThrow,
} from "../documentAccessLog.js";
import {
  COMPANY_CATEGORIES,
  isDocSlot,
  verificationState,
  type CompanyCategory,
} from "../../shared/accountSpec.js";

const createStaffSchema = z.object({
  full_name: z.string().trim().min(1, "Full name is required"),
  phone: z.string().trim().regex(/^\d{10}$/, "Enter a valid 10-digit phone number"),
  role: z.enum(["agent", "admin"]),
  hub_id: z.coerce.number().int().refine(isIndiaHubId, "Select a valid hub"),
});

const staffUserIdSchema = z.string().uuid();

const patchStaffSchema = z
  .object({
    full_name: z.string().trim().min(1, "Full name is required").optional(),
    phone: z
      .string()
      .trim()
      .regex(/^\d{10}$/, "Enter a valid 10-digit phone number")
      .optional(),
    email: z
      .string()
      .trim()
      .refine(
        (value) => value === "" || z.string().email().safeParse(value).success,
        "Enter a valid email"
      )
      .optional(),
  })
  .refine(
    (patch) =>
      patch.full_name !== undefined ||
      patch.phone !== undefined ||
      patch.email !== undefined,
    "Nothing to change"
  );

const setAgentBeatsSchema = z.object({
  beat_ids: z.array(z.string().uuid()).max(200),
});

/**
 * A beat, as ops describe one. `slug` is the id the seed migration keys on, so
 * it is write-once: creating a beat sets it and nothing can change it after.
 */
const createBeatSchema = z.object({
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase words joined by hyphens"),
  name: z.string().trim().min(1, "Name the round as ops describe it"),
  hub: z.string().trim().min(1, "Name the office the riders run out of"),
  cutoff_hour: z.coerce.number().int().min(0).max(23),
});

const patchBeatSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    hub: z.string().trim().min(1).optional(),
    cutoff_hour: z.coerce.number().int().min(0).max(23).optional(),
    is_active: z.boolean().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, "Nothing to change");

/**
 * A pincode row. `city` and `area` default to blank rather than being required:
 * ops paste a bare list far more often than an annotated one, and the client
 * fills the city in from the beat before posting. `remark` is the surcharge
 * flag, which only Kolkata's sheet has ever set.
 */
const beatPincodeSchema = z.object({
  pincode: z.string().trim().regex(/^\d{6}$/, "Pincodes are six digits"),
  city: z.string().trim().min(1, "Every pincode needs the city the customer would name"),
  area: z.string().trim().default(""),
  remark: z.enum(["ok", "out_of_city"]).default("ok"),
});

const replacePincodesSchema = z.object({
  pincodes: z.array(beatPincodeSchema).max(5000),
});

const replaceAgentsSchema = z.object({
  agent_ids: z.array(z.string().uuid()).max(200),
});

const beatIdSchema = z.string().uuid();

const customersListQuerySchema = z.object({
  q: z.string().max(80).optional(),
  account_type: z.enum(["personal", "company"]).optional(),
  kyc: z.enum(["on_file", "none"]).optional(),
});

const customerIdSchema = z.string().uuid();

const identityKindSchema = z.enum(["aadhaar", "pan", "gstin"]);

function sanitizeContentFilename(name: string): string {
  return name.replace(/"/g, "");
}

function sendOpsDocumentFile(
  res: Response,
  doc: { mime_type: string; file_data: string; original_filename: string }
): void {
  const buffer = Buffer.from(doc.file_data, "base64");
  res.set({
    "Content-Type": doc.mime_type,
    "Content-Length": String(buffer.length),
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Disposition": `inline; filename="${sanitizeContentFilename(doc.original_filename)}"`,
  });
  res.send(buffer);
}

async function requireOpsKycActorAndCustomer(
  req: Request,
  res: Response
): Promise<{ customerId: string; actorId: string } | null> {
  const actorId = req.session.dbUserId;
  if (!actorId) {
    res.status(401).json({ message: "Not authenticated" });
    return null;
  }
  const parsedId = customerIdSchema.safeParse(req.params.id);
  if (!parsedId.success) {
    res.status(404).json({ message: "Customer not found" });
    return null;
  }
  const customer = await getCustomerForOps(parsedId.data);
  if (!customer) {
    res.status(404).json({ message: "Customer not found" });
    return null;
  }
  return { customerId: customer.id, actorId };
}

const assignPickupSchema = z.object({
  agent_id: z.string().uuid("agent_id must be a uuid"),
});

const ordersExportQuerySchema = z.object({
  section: z.enum(["pickups", "dropoffs", "dispatched"]),
  assignment: z.enum(["all", "assigned", "unassigned"]).optional(),
  stage: z.enum(["all", "inbound", "hub", "settled"]).optional(),
  dateField: z.enum(["booking", "pickup"]).optional(),
  dateRange: z
    .enum(["all", "today", "7d", "30d", "tomorrow", "week"])
    .optional(),
  paymentMethod: z
    .enum(["all", "pay_now", "pay_at_pickup", "pay_at_dropoff", "cod"])
    .optional(),
  q: z.string().optional(),
  sort: z.enum(["newest", "oldest"]).optional(),
});

function parsePaymentRange(raw: unknown): OpsPaymentRange | null {
  if (raw === undefined) return "today";
  if (raw === "today" || raw === "7d") return raw;
  return null;
}

/** Narrow ops detail row to the shared Order contract for availableActions. */
function asOrder(row: OpsOrderDetail): Order {
  return {
    id: row.id,
    order_no: row.order_no,
    user_id: row.user_id ?? "",
    status: row.status as Order["status"],
    pickup_request: row.pickup_request === 2 ? 2 : 1,
    pickup_date: row.pickup_date,
    origin_address_id: row.origin_address_id,
    consignee: row.consignee,
    items: row.items,
    booked_weight: row.booked_weight,
    quoted_amount: row.quoted_amount,
    packaging_required: row.packaging_required === true,
    payment_method: row.payment_method as PaymentMethod,
    payment_status: row.payment_status as PaymentStatus,
    is_cod: row.is_cod,
    agent_id: row.agent_id,
    actual_weight: row.actual_weight,
    final_amount: row.final_amount,
    awb_no: row.awb_no,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function registerOpsRoutes(app: Express): void {
  // GET /api/ops/orders — all orders, newest first (cap 200)
  app.get(
    "/api/ops/orders",
    requireUser,
    requireRole("admin", "super_admin"),
    async (req: Request, res: Response) => {
      const rawStatus = req.query.status;
      let status: string | undefined;

      if (rawStatus !== undefined) {
        if (typeof rawStatus !== "string" || !isOrderStatus(rawStatus)) {
          res.status(400).json({
            message: `status must be one of: ${ORDER_STATUSES.join(", ")}`,
          });
          return;
        }
        status = rawStatus;
      }

      const orders = await listAllOrdersForOps({ status, limit: 200 });
      if (orders === null) {
        res.status(502).json({ message: "Could not load orders" });
        return;
      }

      res.json({ orders });
    }
  );

  // GET /api/ops/orders/export — uncapped board export (section + filters)
  // Registered before /orders/:id so "export" is not parsed as an id.
  app.get(
    "/api/ops/orders/export",
    requireUser,
    requireRole("admin", "super_admin"),
    async (req: Request, res: Response) => {
      const parsed = ordersExportQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({
          message: parsed.error.issues[0]?.message ?? "Invalid export query",
        });
        return;
      }

      const q = parsed.data;
      const section = q.section as OpsBoardSection;
      const orders = await listOpsOrdersForExport({
        section,
        filters: {
          assignment: q.assignment ?? DEFAULT_OPS_BOARD_FILTERS.assignment,
          stage: q.stage ?? DEFAULT_OPS_BOARD_FILTERS.stage,
          dateField: q.dateField ?? DEFAULT_OPS_BOARD_FILTERS.dateField,
          dateRange: q.dateRange ?? DEFAULT_OPS_BOARD_FILTERS.dateRange,
          paymentMethod: q.paymentMethod ?? DEFAULT_OPS_BOARD_FILTERS.paymentMethod,
        },
        query: q.q ?? "",
        sort: q.sort ?? "newest",
      });
      if (orders === null) {
        res.status(502).json({ message: "Could not export orders" });
        return;
      }

      res.json({ orders });
    }
  );

  // GET /api/ops/payments — ops-wide ledger (IST today | last 7 days)
  app.get(
    "/api/ops/payments",
    requireUser,
    requireRole("admin", "super_admin"),
    async (req: Request, res: Response) => {
      const range = parsePaymentRange(req.query.range);
      if (range === null) {
        res.status(400).json({ message: "range must be today or 7d" });
        return;
      }

      const result = await listOpsPayments(range);
      if (result === null) {
        res.status(502).json({ message: "Could not load payments" });
        return;
      }

      res.json(result);
    }
  );

  // GET /api/ops/payments/export — uncapped ledger rows (same IST window)
  app.get(
    "/api/ops/payments/export",
    requireUser,
    requireRole("admin", "super_admin"),
    async (req: Request, res: Response) => {
      const range = parsePaymentRange(req.query.range);
      if (range === null) {
        res.status(400).json({ message: "range must be today or 7d" });
        return;
      }

      const result = await listOpsPayments(range, { limit: null });
      if (result === null) {
        res.status(502).json({ message: "Could not export payments" });
        return;
      }

      res.json({ payments: result.payments });
    }
  );

  // GET /api/ops/cancellations — pending cancellation requests
  app.get(
    "/api/ops/cancellations",
    requireUser,
    requireRole("admin", "super_admin"),
    async (_req: Request, res: Response) => {
      const result = await listPendingCancellationsForOps();
      if (result === null) {
        res.status(502).json({ message: "Could not load cancellations" });
        return;
      }

      res.json(result);
    }
  );

  // GET /api/ops/orders/:id — any order by id + events + availableActions
  app.get(
    "/api/ops/orders/:id",
    requireUser,
    requireRole("admin", "super_admin"),
    async (req: Request, res: Response) => {
      const order = await getOrderByIdForOps(req.params.id);
      if (!order) {
        res.status(404).json({ message: "Order not found", code: "ORDER_NOT_FOUND" });
        return;
      }

      const events = await listOrderEventsForOps(order.id);
      if (events === null) {
        res.status(502).json({ message: "Could not load order events" });
        return;
      }

      const role = isRole(req.session.user?.role) ? req.session.user!.role : null;
      const callerId = req.session.dbUserId;
      const actions =
        role && callerId
          ? availableActions(asOrder(order), role, { userId: callerId })
          : [];

      // Hub code is owned by ops and typed by the agent. Read only — never
      // issueCode here, or a page load would rotate the number the agent was told.
      let handover: { kind: "hub"; code: string | null; locked: boolean } | null = null;
      if (order.status === "picked_up") {
        const hub = await getCodeForOwner(order.id, "hub");
        handover = {
          kind: "hub",
          code: hub?.code ?? null,
          locked: hub?.locked ?? false,
        };
      }

      res.json({ order, events, availableActions: actions, handover });
    }
  );

  // POST /api/ops/orders/:id/assign — admin-directed pickup assign (auto-advance)
  app.post(
    "/api/ops/orders/:id/assign",
    requireUser,
    requireRole("admin", "super_admin"),
    async (req: Request, res: Response) => {
      const callerId = req.session.dbUserId;
      if (!callerId) {
        res.status(401).json({ message: "Login required" });
        return;
      }

      const parsed = assignPickupSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        });
        return;
      }
      const { agent_id: agentId } = parsed.data;

      const agent = await findActiveAgentById(agentId);
      if (!agent) {
        res.status(400).json({
          message: "target is not an active agent",
          code: "INVALID_AGENT",
        });
        return;
      }

      const updated = await assignPickup(req.params.id, agentId);
      if (!updated) {
        const existing = await getOrderByIdForOps(req.params.id);
        if (!existing) {
          res.status(404).json({ message: "Order not found", code: "ORDER_NOT_FOUND" });
          return;
        }
        res.status(409).json({
          message: "This pickup was just taken or assigned.",
          code: "PICKUP_ALREADY_CLAIMED",
        });
        return;
      }

      // Same side-effects as self-claim. The row is already committed; a failed
      // code write must not undo the assignment (customer can regenerate).
      await issueCode(updated.id, "pickup");

      const role = isRole(req.session.user?.role) ? req.session.user!.role : "admin";
      const eventLogged = await insertOrderEvent({
        order_id: updated.id,
        status: updated.status,
        note: `Assigned to ${agent.full_name} by ops`,
        actor_user_id: callerId,
        metadata: { action: "assign", role, assigned_agent_id: agentId },
      });
      if (!eventLogged) {
        console.error("[POST /api/ops/orders/:id/assign] order_events insert failed", {
          order_id: updated.id,
          actor_user_id: callerId,
        });
      }

      void notifyOrderTransition({
        order: updated,
        moved: true,
        actorUserId: callerId,
      });

      res.json({ order: updated });
    }
  );

  // GET /api/ops/customers — customer directory (meta + KYC-on-file, no numbers)
  app.get(
    "/api/ops/customers",
    requireUser,
    requireRole("admin", "super_admin"),
    async (req: Request, res: Response) => {
      const parsed = customersListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({
          message: parsed.error.issues[0]?.message ?? "Invalid query",
        });
        return;
      }

      const rows = await listCustomersForOps({
        q: parsed.data.q,
        account_type: parsed.data.account_type,
        kyc: parsed.data.kyc,
      });
      if (rows === null) {
        res.status(502).json({ message: "Could not load customers" });
        return;
      }

      const pageIds = rows.map((row) => row.id);
      const [slotsByUser, shipmentByUser, kindsByUser, orderCounts] =
        await Promise.all([
          accountDocSlotsForUserIds(pageIds),
          kycExistsForUserIds(pageIds),
          identityKindsForUserIds(pageIds),
          countOrdersForOpsCustomers(pageIds),
        ]);
      if (
        slotsByUser === null ||
        shipmentByUser === null ||
        kindsByUser === null ||
        orderCounts === null
      ) {
        res.status(502).json({ message: "Could not load customers" });
        return;
      }

      res.json({
        customers: rows.map((row) => {
          const doc_slots = slotsByUser.get(row.id) ?? [];
          const identity_kinds = kindsByUser.get(row.id) ?? [];
          const shipment_kyc = shipmentByUser.has(row.id);
          return {
            id: row.id,
            full_name: row.full_name,
            phone: row.phone,
            account_type: row.account_type,
            created_at: row.created_at,
            kyc_on_file:
              doc_slots.length > 0 || shipment_kyc || identity_kinds.length > 0,
            order_count: orderCounts.get(row.id) ?? 0,
            doc_slots,
            shipment_kyc,
            identity_kinds,
          };
        }),
      });
    }
  );

  // GET /api/ops/customers/:id — one customer + KYC meta (no numbers / bytes)
  app.get(
    "/api/ops/customers/:id",
    requireUser,
    requireRole("admin", "super_admin"),
    async (req: Request, res: Response) => {
      const parsedId = customerIdSchema.safeParse(req.params.id);
      if (!parsedId.success) {
        res.status(404).json({ message: "Customer not found" });
        return;
      }

      const customer = await getCustomerForOps(parsedId.data);
      if (!customer) {
        res.status(404).json({ message: "Customer not found" });
        return;
      }

      const [shipmentKyc, identity, documents] = await Promise.all([
        getKycOpsMetaByUserId(customer.id),
        listIdentityOpsMetaByUserId(customer.id),
        listAccountDocOpsMetaByUserId(customer.id),
      ]);

      const onFile =
        shipmentKyc !== null || identity.length > 0 || documents.length > 0;

      res.json({
        customer: {
          id: customer.id,
          full_name: customer.full_name,
          phone: customer.phone,
          account_type: customer.account_type,
          company_name: customer.company_name,
          company_category: customer.company_category,
          gstin: customer.account_type === "company" ? customer.gstin : null,
          created_at: customer.created_at,
        },
        kyc: {
          on_file: onFile,
          shipment_kyc: shipmentKyc,
          identity,
          documents,
        },
      });
    }
  );

  // GET /api/ops/customers/:id/orders — this customer's bookings (registered only)
  app.get(
    "/api/ops/customers/:id/orders",
    requireUser,
    requireRole("admin", "super_admin"),
    async (req: Request, res: Response) => {
      const parsedId = customerIdSchema.safeParse(req.params.id);
      if (!parsedId.success) {
        res.status(404).json({ message: "Customer not found" });
        return;
      }

      const customer = await getCustomerForOps(parsedId.data);
      if (!customer) {
        res.status(404).json({ message: "Customer not found" });
        return;
      }

      const orders = await listOpsOrdersByCustomer(customer.id);
      if (orders === null) {
        res.status(502).json({ message: "Could not load orders" });
        return;
      }

      res.json({ orders });
    }
  );

  const opsKycGate = [
    requireUser,
    ensureDbUser,
    requireRole("super_admin"),
  ] as const;

  // GET /api/ops/customers/:id/kyc/file — shipment KYC image (super_admin, logged)
  app.get(
    "/api/ops/customers/:id/kyc/file",
    ...opsKycGate,
    async (req: Request, res: Response) => {
      const ctx = await requireOpsKycActorAndCustomer(req, res);
      if (!ctx) return;

      try {
        const doc = await getKycFileByUserId(ctx.customerId);
        if (!doc) {
          logDocumentAccess(req, {
            source: "kyc",
            outcome: "not_found",
            userId: ctx.customerId,
            actorUserId: ctx.actorId,
            action: "view",
          });
          res.status(404).json({ message: "Document not found." });
          return;
        }

        await logDocumentAccessOrThrow(req, {
          source: "kyc",
          outcome: "served",
          documentId: doc.id,
          userId: ctx.customerId,
          actorUserId: ctx.actorId,
          action: "view",
          capabilityId: doc.capability_id,
        });
        sendOpsDocumentFile(res, doc);
      } catch (err) {
        if (err instanceof AuditLogUnavailableError) {
          res.status(500).json({ message: "Audit unavailable." });
          return;
        }
        console.error("[GET /api/ops/customers/:id/kyc/file] failed:", err);
        res.status(500).json({ message: "Failed to retrieve document." });
      }
    }
  );

  // GET /api/ops/customers/:id/documents/:slot/file — onboarding slot (super_admin)
  app.get(
    "/api/ops/customers/:id/documents/:slot/file",
    ...opsKycGate,
    async (req: Request, res: Response) => {
      const ctx = await requireOpsKycActorAndCustomer(req, res);
      if (!ctx) return;

      if (!isDocSlot(req.params.slot)) {
        res.status(404).json({ message: "Document not found." });
        return;
      }

      try {
        const doc = await getAccountDocumentByUserIdAndSlot(ctx.customerId, req.params.slot);
        if (!doc) {
          logDocumentAccess(req, {
            source: "account",
            outcome: "not_found",
            userId: ctx.customerId,
            actorUserId: ctx.actorId,
            action: "view",
          });
          res.status(404).json({ message: "Document not found." });
          return;
        }

        await logDocumentAccessOrThrow(req, {
          source: "account",
          outcome: "served",
          documentId: doc.id,
          userId: ctx.customerId,
          actorUserId: ctx.actorId,
          action: "view",
          capabilityId: doc.capability_id,
        });
        sendOpsDocumentFile(res, doc);
      } catch (err) {
        if (err instanceof AuditLogUnavailableError) {
          res.status(500).json({ message: "Audit unavailable." });
          return;
        }
        console.error("[GET /api/ops/customers/:id/documents/:slot/file] failed:", err);
        res.status(500).json({ message: "Failed to retrieve document." });
      }
    }
  );

  // GET /api/ops/customers/:id/identity/:kind — one decrypted number (super_admin)
  app.get(
    "/api/ops/customers/:id/identity/:kind",
    ...opsKycGate,
    async (req: Request, res: Response) => {
      const ctx = await requireOpsKycActorAndCustomer(req, res);
      if (!ctx) return;

      const parsedKind = identityKindSchema.safeParse(req.params.kind);
      if (!parsedKind.success) {
        res.status(404).json({ message: "Document not found." });
        return;
      }
      const kind: IdentityKind = parsedKind.data;

      try {
        const row = await getIdentityVerificationByUserIdAndKind(ctx.customerId, kind);
        if (!row) {
          logDocumentAccess(req, {
            source: "identity",
            outcome: "not_found",
            userId: ctx.customerId,
            actorUserId: ctx.actorId,
            action: "view",
            capabilityId: null,
          });
          res.status(404).json({ message: "Document not found." });
          return;
        }

        await logDocumentAccessOrThrow(req, {
          source: "identity",
          outcome: "served",
          documentId: row.id,
          userId: ctx.customerId,
          actorUserId: ctx.actorId,
          action: "view",
          capabilityId: null,
        });
        res.set("Cache-Control", "no-store");
        res.json({
          kind: row.kind,
          document_no: row.document_no,
          status: row.status,
        });
      } catch (err) {
        if (err instanceof AuditLogUnavailableError) {
          res.status(500).json({ message: "Audit unavailable." });
          return;
        }
        console.error("[GET /api/ops/customers/:id/identity/:kind] failed:", err);
        res.status(500).json({ message: "Failed to retrieve document." });
      }
    }
  );

  type VerificationRow = {
    id: string;
    full_name: string;
    phone: string | null;
    email: string | null;
    account_type: string;
    company_name: string | null;
    company_category: string | null;
    created_at: string | null;
    missing: string[];
    unverified: string[];
  };

  // GET /api/ops/verifications — customers who still owe documents
  app.get(
    "/api/ops/verifications",
    requireUser,
    requireRole("admin", "super_admin"),
    async (_req: Request, res: Response) => {
      const accounts = await listCustomerAccounts();
      if (accounts === null) {
        res.status(502).json({ message: "Could not load accounts" });
        return;
      }

      const verdicts = await listDocumentVerdictsForUserIds(accounts.map((a) => a.id));

      const outstanding: VerificationRow[] = [];
      for (const account of accounts) {
        const accountType = account.account_type === "company" ? "company" : "personal";
        const category =
          accountType === "company" &&
          account.company_category &&
          (COMPANY_CATEGORIES as readonly string[]).includes(account.company_category)
            ? (account.company_category as CompanyCategory)
            : null;

        const state = verificationState(
          accountType,
          category,
          verdicts.get(account.id) ?? []
        );
        if (state.verified) continue;

        outstanding.push({
          ...account,
          missing: state.missing,
          unverified: state.unverified,
        });
      }

      res.set("Cache-Control", "no-store");
      res.json({ accounts: outstanding, count: outstanding.length });
    }
  );

  // GET /api/ops/users — staff accounts (agent / admin / super_admin)
  app.get(
    "/api/ops/users",
    requireUser,
    requireRole("admin", "super_admin"),
    async (_req: Request, res: Response) => {
      const users = await listStaffUsers();
      if (users === null) {
        res.status(502).json({ message: "Could not load users" });
        return;
      }

      // Which rounds each agent runs, so the staff list can show coverage
      // without a trip to the beats screen. Membership is edited there, where
      // the many-to-many actually lives; this is read-only.
      //
      // A failure here is not a failure of the list. The beats tables may not
      // even be applied yet, and a staff roster that will not render because a
      // decorative column could not load is worse than one without the column.
      const beats = await beatNamesByAgent(users.map((u) => u.id));

      res.json({
        users: users.map((user) => ({
          ...user,
          beats: beats?.get(user.id) ?? [],
        })),
      });
    }
  );

  // GET /api/ops/users/:id — one staff row + this agent's beat ids
  app.get(
    "/api/ops/users/:id",
    requireUser,
    requireRole("admin", "super_admin"),
    async (req: Request, res: Response) => {
      const id = staffUserIdSchema.safeParse(req.params.id);
      if (!id.success) {
        res.status(400).json({ message: "Invalid user id" });
        return;
      }

      const user = await getStaffUserById(id.data);
      if (!user) {
        res.status(404).json({ message: "User not found" });
        return;
      }

      const beatIds =
        user.role === "agent" ? await beatIdsForAgent(user.id) : [];
      res.json({
        user,
        beat_ids: beatIds ?? [],
      });
    }
  );

  // PUT /api/ops/users/:id/beats — replace THIS agent's rounds.
  // Registered before PATCH /users/:id so "beats" is never parsed as an id.
  app.put(
    "/api/ops/users/:id/beats",
    requireUser,
    requireRole("admin", "super_admin"),
    async (req: Request, res: Response) => {
      const id = staffUserIdSchema.safeParse(req.params.id);
      if (!id.success) {
        res.status(400).json({ message: "Invalid user id" });
        return;
      }

      const parsed = setAgentBeatsSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        });
        return;
      }

      const staff = await getStaffUserById(id.data);
      if (!staff) {
        res.status(404).json({ message: "User not found" });
        return;
      }
      if (staff.role !== "agent") {
        res.status(400).json({ message: "Only pickup agents have beats" });
        return;
      }

      const agent = await findActiveAgentById(id.data);
      if (!agent) {
        res.status(400).json({ message: "That agent is not active" });
        return;
      }

      const written = await setAgentBeats(id.data, parsed.data.beat_ids);
      if (written === "missing") {
        res.status(400).json({ message: "One of those beats does not exist" });
        return;
      }
      if (written === null) {
        res.status(502).json({ message: "Could not save beats" });
        return;
      }

      res.json({ beat_ids: parsed.data.beat_ids });
    }
  );

  // PATCH /api/ops/users/:id — name / phone / email. Not role, not is_active.
  app.patch(
    "/api/ops/users/:id",
    requireUser,
    requireRole("admin", "super_admin"),
    async (req: Request, res: Response) => {
      const id = staffUserIdSchema.safeParse(req.params.id);
      if (!id.success) {
        res.status(400).json({ message: "Invalid user id" });
        return;
      }

      const parsed = patchStaffSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        });
        return;
      }

      const updated = await updateStaffUser(id.data, parsed.data);
      if (updated === "taken") {
        res.status(409).json({
          message: "This phone number is already registered.",
        });
        return;
      }
      if (updated === "missing") {
        res.status(404).json({ message: "User not found" });
        return;
      }
      if (!updated) {
        res.status(502).json({ message: "Could not save user" });
        return;
      }

      res.json({ user: updated });
    }
  );


  // ── Pickup beats ──────────────────────────────────────────────────────────
  //
  // The rider config ops have always sent us in four lines — name, number,
  // serviceable pincodes, cut-off — finally editable without a deploy.
  //
  // Admin-gated throughout. A beat decides what a customer is offered at
  // booking and who gets WhatsApped about a new job; neither is an agent's to
  // change, and `requireRole` stays exact rather than becoming a list.

  // GET /api/ops/beats — every beat, retired ones included
  app.get(
    "/api/ops/beats",
    requireUser,
    requireRole("admin", "super_admin"),
    async (_req: Request, res: Response) => {
      const beats = await listBeats();
      if (beats === null) {
        res.status(502).json({ message: "Could not load beats" });
        return;
      }
      res.json({ beats });
    }
  );

  // GET /api/ops/beats/:id — one beat with its full pincode list
  app.get(
    "/api/ops/beats/:id",
    requireUser,
    requireRole("admin", "super_admin"),
    async (req: Request, res: Response) => {
      const id = beatIdSchema.safeParse(req.params.id);
      if (!id.success) {
        res.status(400).json({ message: "Invalid beat id" });
        return;
      }

      const beat = await getBeat(id.data);
      if (beat === "missing") {
        res.status(404).json({ message: "No such beat" });
        return;
      }
      if (beat === null) {
        res.status(502).json({ message: "Could not load beat" });
        return;
      }
      res.json({ beat });
    }
  );

  // POST /api/ops/beats — create one
  app.post(
    "/api/ops/beats",
    requireUser,
    requireRole("admin", "super_admin"),
    async (req: Request, res: Response) => {
      const parsed = createBeatSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        });
        return;
      }

      const created = await insertBeat(parsed.data);
      if (created === "taken") {
        res.status(409).json({ message: "A beat with that slug already exists" });
        return;
      }
      if (!created) {
        res.status(502).json({ message: "Could not create beat. Please try again." });
        return;
      }
      res.json({ beat: created });
    }
  );

  // PATCH /api/ops/beats/:id — name, hub, cut-off, or retire it
  app.patch(
    "/api/ops/beats/:id",
    requireUser,
    requireRole("admin", "super_admin"),
    async (req: Request, res: Response) => {
      const id = beatIdSchema.safeParse(req.params.id);
      if (!id.success) {
        res.status(400).json({ message: "Invalid beat id" });
        return;
      }

      const parsed = patchBeatSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        });
        return;
      }

      const updated = await updateBeat(id.data, parsed.data);
      if (updated === "missing") {
        res.status(404).json({ message: "No such beat" });
        return;
      }
      if (updated === null) {
        res.status(502).json({ message: "Could not update beat. Please try again." });
        return;
      }
      res.json({ beat: updated });
    }
  );

  /**
   * PUT /api/ops/beats/:id/pincodes — replace the whole set.
   *
   * A replace, not a patch, because that is the shape of the hand-over: ops are
   * sent a list and paste a list. It is also the only way to say "this code
   * came off the round" without hunting for it.
   *
   * Duplicates are collapsed here rather than rejected. A pasted list often
   * repeats a code — the Jaipur sheet named 143 post offices across 69
   * pincodes — and refusing the paste over that would be pedantry. The first
   * occurrence wins, matching how the static tables read.
   */
  app.put(
    "/api/ops/beats/:id/pincodes",
    requireUser,
    requireRole("admin", "super_admin"),
    async (req: Request, res: Response) => {
      const id = beatIdSchema.safeParse(req.params.id);
      if (!id.success) {
        res.status(400).json({ message: "Invalid beat id" });
        return;
      }

      const parsed = replacePincodesSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        });
        return;
      }

      const seen: Record<string, true> = {};
      const pincodes: BeatPincode[] = [];
      for (const row of parsed.data.pincodes) {
        if (seen[row.pincode]) continue;
        seen[row.pincode] = true;
        pincodes.push(row);
      }

      const written = await replaceBeatPincodes(id.data, pincodes);
      if (written === "missing") {
        res.status(404).json({ message: "No such beat" });
        return;
      }
      if (written === null) {
        res.status(502).json({ message: "Could not save the pincodes. Please try again." });
        return;
      }
      res.json({ pincode_count: written });
    }
  );

  /**
   * PUT /api/ops/beats/:id/agents — replace the riders on this round.
   *
   * Every id is checked to be an active agent first. The table's foreign key
   * only proves the user exists, and putting an admin or a customer on a beat
   * would quietly add them to the new-job WhatsApp fan-out.
   */
  app.put(
    "/api/ops/beats/:id/agents",
    requireUser,
    requireRole("admin", "super_admin"),
    async (req: Request, res: Response) => {
      const id = beatIdSchema.safeParse(req.params.id);
      if (!id.success) {
        res.status(400).json({ message: "Invalid beat id" });
        return;
      }

      const parsed = replaceAgentsSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        });
        return;
      }

      for (const agentId of parsed.data.agent_ids) {
        const agent = await findActiveAgentById(agentId);
        if (!agent) {
          res.status(400).json({ message: "One of those is not an active agent" });
          return;
        }
      }

      const written = await replaceBeatAgents(id.data, parsed.data.agent_ids);
      if (written === "missing") {
        res.status(404).json({ message: "No such beat" });
        return;
      }
      if (written === null) {
        res.status(502).json({ message: "Could not save the riders. Please try again." });
        return;
      }
      res.json({ agent_count: written });
    }
  );

  // POST /api/ops/users — mint a real itd_users staff row (seed-script shape)
  app.post(
    "/api/ops/users",
    requireUser,
    requireRole("admin", "super_admin"),
    async (req: Request, res: Response) => {
      const parsed = createStaffSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        });
        return;
      }
      const { full_name, phone, role, hub_id } = parsed.data;

      const existing = await findItdUserIdByPhone(phone);
      if (existing) {
        res.status(409).json({
          message: "This phone number is already registered. Please sign in instead.",
        });
        return;
      }

      const created = await insertStaffUser({ full_name, phone, role, hub_id });
      if (created === "taken") {
        res.status(409).json({
          message: "This phone number is already registered. Please sign in instead.",
        });
        return;
      }
      if (!created) {
        res.status(502).json({ message: "Could not create user. Please try again." });
        return;
      }

      res.json({
        id: created.id,
        phone: created.phone,
        full_name: created.full_name,
        role: created.role,
      });
    }
  );
}
