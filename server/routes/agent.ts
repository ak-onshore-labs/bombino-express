/**
 * A5 — Pickup Agent read endpoints.
 *
 * Self-registering: `registerAgentRoutes(app)` is called from `routes.ts`.
 * First module of the M0 item-1 split — the rest of `routes.ts` follows the
 * same shape when Arbaaz breaks it up.
 *
 * Both routes are agent-only. Ops must not appear here at all: there is no
 * dispatcher and no assignment screen anywhere in this build (§1), so an admin
 * has no reason to read an agent's queue and `requireRole('agent')` stays
 * exact rather than becoming a list.
 *
 * Transitions do NOT live here. They go through the uniform endpoint,
 * POST /api/orders/:id/actions, so the agent UI renders buttons from
 * `availableActions` and holds no copy of the state machine.
 */

import type { Express, Request, Response } from "express";
import {
  getAvailablePickups,
  getCollectionsToday,
  getMyPickups,
  type AgentPickup,
} from "../agentDb.js";
import { availableActions } from "../orderLifecycle.js";
import { ensureDbUser, requireRole, requireUser } from "../routeGuards.js";

/**
 * Attach the actions the agent may take on each row, so the list screen can
 * render its buttons without a follow-up request per order.
 */
function withActions(orders: AgentPickup[], agentId: string) {
  return orders.map((order) => ({
    order,
    availableActions: availableActions(order, "agent", { userId: agentId }),
  }));
}

export function registerAgentRoutes(app: Express): void {
  // GET /api/agent/pickups/available — unclaimed jobs, oldest first
  app.get(
    "/api/agent/pickups/available",
    requireUser,
    requireRole("agent"),
    ensureDbUser,
    async (req: Request, res: Response) => {
      const agentId = req.session.dbUserId;
      if (!agentId) {
        res.status(401).json({ message: "Login required" });
        return;
      }

      const pickups = await getAvailablePickups();
      if (pickups === null) {
        res.status(502).json({ message: "Could not load available pickups" });
        return;
      }

      res.json({ pickups: withActions(pickups, agentId) });
    }
  );

  // GET /api/agent/pickups/mine — the caller's own live jobs
  app.get(
    "/api/agent/pickups/mine",
    requireUser,
    requireRole("agent"),
    ensureDbUser,
    async (req: Request, res: Response) => {
      const agentId = req.session.dbUserId;
      if (!agentId) {
        res.status(401).json({ message: "Login required" });
        return;
      }

      const pickups = await getMyPickups(agentId);
      if (pickups === null) {
        res.status(502).json({ message: "Could not load your pickups" });
        return;
      }

      /**
       * No handover code travels with this payload, in either direction.
       *
       * The agent types both codes they touch — the customer's at the door, the
       * hub's at the counter — and a verifier who can read the code is not being
       * tested by it (`handoverCodes.ts`). This endpoint used to carry the `hub`
       * code back when ops was the one entering it; that handover has since been
       * flipped, and the entitlement moved with it. Ops reads the hub code off
       * their own console now.
       */
      res.json({ pickups: withActions(pickups, agentId) });
    }
  );

  // GET /api/agent/collections — money this agent has taken today (IST),
  // so they can reconcile their pouch against the transaction ids at the end
  // of a shift.
  app.get(
    "/api/agent/collections",
    requireUser,
    requireRole("agent"),
    ensureDbUser,
    async (req: Request, res: Response) => {
      const agentId = req.session.dbUserId;
      if (!agentId) {
        res.status(401).json({ message: "Login required" });
        return;
      }

      const collections = await getCollectionsToday(agentId);
      if (collections === null) {
        res.status(502).json({ message: "Could not load your collections" });
        return;
      }

      const total = collections.reduce((sum, c) => sum + c.amount, 0);
      const cash = collections
        .filter((c) => c.collection_mode === "cash")
        .reduce((sum, c) => sum + c.amount, 0);

      res.json({
        collections,
        // Cash is called out separately because it is the only part the agent
        // is physically carrying and has to hand over.
        totals: { all: total, cash, upi: total - cash, count: collections.length },
      });
    }
  );
}
