/**
 * The ops console's Cases tab (BIA 3.0, package 4.2): support cases BIA opened,
 * for ops to read and answer. Behind the same guard as every /api/ops route —
 * a customer or a rider gets 403.
 *
 * Self-registering: `registerOpsCaseRoutes(app)` is called from `routes.ts`,
 * next to registerOpsRoutes.
 */

import type { Express, Request, Response } from "express";
import { requireRole, requireUser } from "../routeGuards.js";
import { closeCase, getCaseForOps, isCaseStatus, listCasesForOps, replyToCase } from "../supportCasesOps.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_SET_UP = "Cases aren't set up yet: migrations/create_support_cases.sql hasn't been run.";
const MAX_REPLY = 2000;

export function registerOpsCaseRoutes(app: Express): void {
  // GET /api/ops/cases?status=open|answered|closed — the queue, newest first
  app.get("/api/ops/cases", requireUser, requireRole("admin", "super_admin"), async (req: Request, res: Response) => {
    const raw = req.query.status;
    if (raw !== undefined && !isCaseStatus(raw)) {
      res.status(400).json({ message: "status must be open, answered or closed" });
      return;
    }
    const cases = await listCasesForOps(isCaseStatus(raw) ? raw : null);
    if (cases === null) {
      res.status(503).json({ message: NOT_SET_UP, code: "CASES_NOT_SET_UP" });
      return;
    }
    res.set("Cache-Control", "no-store");
    res.json({ cases });
  });

  // GET /api/ops/cases/:id — one case, its summary and the conversation
  app.get("/api/ops/cases/:id", requireUser, requireRole("admin", "super_admin"), async (req: Request, res: Response) => {
    const id = String(req.params.id ?? "");
    if (!UUID_RE.test(id)) {
      res.status(404).json({ message: "Case not found" });
      return;
    }
    const found = await getCaseForOps(id);
    if (found === null) {
      res.status(503).json({ message: NOT_SET_UP, code: "CASES_NOT_SET_UP" });
      return;
    }
    if (found === "missing") {
      res.status(404).json({ message: "Case not found" });
      return;
    }
    res.set("Cache-Control", "no-store");
    res.json({ case: found });
  });

  // POST /api/ops/cases/:id/reply { reply } — answer it; the customer's bell gets the reply
  app.post(
    "/api/ops/cases/:id/reply",
    requireUser,
    requireRole("admin", "super_admin"),
    async (req: Request, res: Response) => {
      const id = String(req.params.id ?? "");
      const reply = typeof req.body?.reply === "string" ? req.body.reply.trim() : "";
      if (!UUID_RE.test(id)) {
        res.status(404).json({ message: "Case not found" });
        return;
      }
      if (!reply || reply.length > MAX_REPLY) {
        res.status(400).json({ message: `Write a reply of up to ${MAX_REPLY} characters.` });
        return;
      }
      const result = await replyToCase(id, reply, req.session.dbUserId ?? null);
      if (result === null) {
        res.status(503).json({ message: "The reply couldn't be saved. Try again in a moment." });
        return;
      }
      if (result === "missing") {
        res.status(404).json({ message: "Case not found" });
        return;
      }
      if (result === "closed") {
        res.status(409).json({ message: "This case is closed. Reopen isn't available; ask the customer to message us." });
        return;
      }
      res.json({ ok: true, caseNo: result.caseNo, notified: result.notified });
    }
  );

  // POST /api/ops/cases/:id/close
  app.post(
    "/api/ops/cases/:id/close",
    requireUser,
    requireRole("admin", "super_admin"),
    async (req: Request, res: Response) => {
      const id = String(req.params.id ?? "");
      if (!UUID_RE.test(id)) {
        res.status(404).json({ message: "Case not found" });
        return;
      }
      const result = await closeCase(id);
      if (result === null) {
        res.status(503).json({ message: "The case couldn't be closed. Try again in a moment." });
        return;
      }
      if (result === "missing") {
        res.status(404).json({ message: "Case not found" });
        return;
      }
      res.json({ ok: true });
    }
  );
}
