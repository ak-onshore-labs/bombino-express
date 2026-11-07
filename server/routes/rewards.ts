/**
 * Reward points for the signed-in account (phase 1, step 1: read only).
 *
 * Accounts only. A guest session has no dbUserId and gets 401, the same answer
 * GET /api/orders gives it: guests never earn points.
 */

import type { Express, Request, Response } from "express";
import { ensureDbUser } from "../routeGuards.js";
import { rewardsSummaryFor } from "../rewardsDb.js";

export function registerRewardsRoutes(app: Express): void {
  app.get("/api/rewards", ensureDbUser, async (req: Request, res: Response) => {
    if (!req.session.dbUserId) {
      res.status(401).json({ message: "Login required" });
      return;
    }

    const summary = await rewardsSummaryFor(req.session.dbUserId);
    if (!summary) {
      res.status(502).json({ message: "Could not load reward points" });
      return;
    }
    res.json(summary);
  });
}
