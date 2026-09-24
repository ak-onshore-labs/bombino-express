/**
 * BIA's nudges (BIA 3.0, package 5.1): the daily sweep that sends them, and
 * each customer's switches for them.
 *
 *   POST /api/admin/bia/nudges/sweep   the external scheduler, daily, with the
 *                                      same bearer secret as the retention sweep
 *   GET  /api/bia/nudges/prefs         the kinds this customer can get, on or off
 *   PUT  /api/bia/nudges/prefs         { kind, on } — switch one
 *
 * Self-registering: `registerBiaRoutes(app)` is called from `routes.ts`.
 */

import type { Express, Request, Response } from "express";
import { asyncRoutes, ensureDbUser } from "../routeGuards.js";
import { requireCronSecret } from "../cronAuth.js";
import { OWNER_PROFILES, ownerFrom } from "../sessionOwner.js";
import { loadNudgeSnapshot, nudgeStore, runNudgeSweep, type NudgeOwner } from "../supportNudges.js";
import { NUDGE_SPECS, isNudgeKind, nudgeKindsFor } from "../../shared/biaNudges.js";

const NOT_SET_UP = "Nudges aren't set up yet: migrations/create_bia_nudges.sql hasn't been run.";

/** Whose switches these are: the signed-in account, else the guest this session verified. */
export function nudgeOwnerFor(req: Request): NudgeOwner | null {
  const owner = ownerFrom(req, OWNER_PROFILES.nudges);
  if (!owner) return null;
  return owner.kind === "account"
    ? { kind: "account", userId: owner.userId }
    : { kind: "guest", guestRef: owner.guestRef };
}

export function registerBiaRoutes(app: Express): void {
  // Rejections reach the error middleware instead of hanging the request.
  const routes = asyncRoutes(app);
  /**
   * Daily, from the same external scheduler as the WhatsApp digest and the
   * retention sweep (07:00 IST is a good time: "pickup tomorrow" reads well in
   * the morning). Safe to repeat: a nudge already sent is never sent again,
   * and nobody gets more than one a day.
   */
  routes.post("/api/admin/bia/nudges/sweep", requireCronSecret, async (_req: Request, res: Response) => {
    let snapshot;
    try {
      snapshot = await loadNudgeSnapshot();
    } catch (err) {
      console.error("[nudges] could not read the snapshot:", err);
      res.status(500).json({ message: "Sweep failed." });
      return;
    }
    try {
      const report = await runNudgeSweep(snapshot);
      // A log line every run, the quiet ones included: a sweep that silently
      // stopped looks exactly like one with nothing to do.
      console.log(`[nudges] ${report.day}: ${report.due} due, sent ${JSON.stringify(report.sent)}, skipped ${JSON.stringify(report.skipped)}`);
      res.json({ ok: true, ...report });
    } catch (err) {
      console.warn(`[nudges] sweep stopped before sending: ${(err as Error).message}`);
      res.status(503).json({ message: NOT_SET_UP, code: "NUDGES_NOT_SET_UP" });
    }
  });

  // GET /api/bia/nudges/prefs — { kinds: [{ kind, label, hint, on }], available }
  routes.get("/api/bia/nudges/prefs", ensureDbUser, async (req: Request, res: Response) => {
    const owner = nudgeOwnerFor(req);
    if (!owner) {
      res.status(401).json({ message: "Not authenticated" });
      return;
    }
    let off: string[] = [];
    let available = true;
    try {
      off = await nudgeStore().offFor(owner);
    } catch {
      // Before the migration every kind reads as on, and the switches are shown but can't be saved.
      available = false;
    }
    res.set("Cache-Control", "no-store");
    res.json({
      available,
      kinds: nudgeKindsFor(owner.kind).map((kind) => ({ kind, label: NUDGE_SPECS[kind].label, hint: NUDGE_SPECS[kind].hint, on: !off.includes(kind) })),
    });
  });

  // PUT /api/bia/nudges/prefs — { kind, on }
  routes.put("/api/bia/nudges/prefs", ensureDbUser, async (req: Request, res: Response) => {
    const owner = nudgeOwnerFor(req);
    if (!owner) {
      res.status(401).json({ message: "Not authenticated" });
      return;
    }
    const kind: unknown = req.body?.kind;
    const on: unknown = req.body?.on;
    if (!isNudgeKind(kind) || !nudgeKindsFor(owner.kind).includes(kind) || typeof on !== "boolean") {
      res.status(400).json({ message: "Choose a reminder and whether it's on." });
      return;
    }
    try {
      await nudgeStore().setOff(owner, kind, !on);
      res.json({ ok: true, kind, on });
    } catch {
      res.status(503).json({ message: "Reminders can't be changed just yet. Try again later.", code: "NUDGES_NOT_SET_UP" });
    }
  });
}
