/**
 * Phase 3A/3B — Ops read endpoints (board + order detail + availableActions).
 *
 * Self-registering: `registerOpsRoutes(app)` is called from `routes.ts`.
 * Every route is gated requireUser + requireRole("admin","super_admin") so
 * super_admin is never rejected by an exact single-arg "admin" match.
 */

import type { Express, Request, Response } from "express";
import { z } from "zod";
import {
  COMPANY_CATEGORIES,
  verificationState,
  type CompanyCategory,
} from "../../shared/accountSpec.js";
import { isIndiaHubId } from "../../shared/hubs.js";
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
  findActiveAgentById,
  findItdUserIdByPhone,
  insertStaffUser,
  listCustomerAccounts,
  listStaffUsers,
} from "../appDb.js";
import {
  listDocumentVerdictsForUserIds,
  listDocumentsByUserId,
} from "../accountDocsDb.js";
import { getCodeForOwner, issueCode } from "../handoverCodes.js";
import { notifyOrderTransition } from "../notify.js";
import { availableActions } from "../orderLifecycle.js";
import { insertOrderEvent } from "../ordersDb.js";
import {
  assignPickup,
  getOrderByIdForOps,
  listAllOrdersForOps,
  listOpsOrdersForExport,
  listOpsPayments,
  listOrderEventsForOps,
  listPendingCancellationsForOps,
  type OpsOrderDetail,
  type OpsPaymentRange,
} from "../opsDb.js";
import { requireRole, requireUser } from "../routeGuards.js";

const createStaffSchema = z.object({
  full_name: z.string().trim().min(1, "Full name is required"),
  phone: z.string().trim().regex(/^\d{10}$/, "Enter a valid 10-digit phone number"),
  role: z.enum(["agent", "admin"]),
  hub_id: z.coerce.number().int().refine(isIndiaHubId, "Select a valid hub"),
});

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
    user_id: row.user_id,
    status: row.status as Order["status"],
    pickup_request: row.pickup_request === 2 ? 2 : 1,
    pickup_date: row.pickup_date,
    origin_address_id: row.origin_address_id,
    consignee: row.consignee,
    items: row.items,
    booked_weight: row.booked_weight,
    quoted_amount: row.quoted_amount,
    packaging_required: row.packaging_required,
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

  // ── Verification queue ───────────────────────────────────────────────────
  //
  // The other half of "skip for now". A customer can open an account without
  // documents and be told to either finish online or call us — and the second
  // of those is meaningless unless somebody at Bombino can see who is
  // outstanding and what they are missing. Nothing else in ops is
  // customer-shaped, so this is that surface.

  /** One outstanding account, as the queue lists it. */
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

  // GET /api/ops/verifications/:userId/documents — what this customer has sent.
  //
  // Metadata plus the capability ids, never the bytes: the file itself is
  // served by GET /api/account/documents/:id/file, which is deliberately
  // unauthenticated so ITD can fetch it. That endpoint being open is exactly
  // why *this* one has to be role-gated — it is what hands the ids out.
  app.get(
    "/api/ops/verifications/:userId/documents",
    requireUser,
    requireRole("admin", "super_admin"),
    async (req: Request, res: Response) => {
      const rows = await listDocumentsByUserId(req.params.userId);
      res.set("Cache-Control", "no-store");
      res.json({
        documents: rows.map((row) => ({
          doc_slot: row.doc_slot,
          capability_id: row.capability_id,
          document_no: row.document_no,
          original_filename: row.original_filename,
          mime_type: row.mime_type,
          file_size_bytes: row.file_size_bytes,
          updated_at: row.updated_at,
          ocr_status: row.ocr_status,
        })),
      });
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
      res.json({ users });
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
