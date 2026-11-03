/**
 * The clock's way in from outside: an external scheduler can trigger the
 * scheduled WhatsApp runs (`staffSchedule.ts`) instead of, or as well as, the
 * in-process timer. It runs whatever is due at the moment it is called, so an
 * hourly job is enough and more often is harmless: every message is deduped.
 *
 * Wire it as a Railway cron job against
 *   POST {PUBLIC_URL}/api/internal/wa/agent-schedule
 * with `Authorization: Bearer {WA_CRON_SECRET}`. The path keeps its old name
 * because a cron job may already point at it; it once ran only the agents'
 * morning digest. `kind` is ignored.
 */

import type { Express, Request, Response } from "express";
import { cronSecretPresented } from "../cronAuth.js";
import { runDueSchedules } from "../staffSchedule.js";

export function registerWhatsappScheduleRoutes(app: Express): void {
  app.post("/api/internal/wa/agent-schedule", async (req: Request, res: Response) => {
    if (!cronSecretPresented(req)) {
      // 404, not 401. An internal endpoint that confirms it exists is an
      // internal endpoint somebody will start guessing at.
      res.status(404).json({ message: "Not found" });
      return;
    }

    try {
      const ran = await runDueSchedules();
      res.json({ ok: true, ran });
    } catch (error) {
      console.error("[whatsappSchedule] run failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      // 500 so a scheduler with retries tries again. Every message is deduped,
      // so a retry after a partial run finishes the job rather than repeating it.
      res.status(500).json({ ok: false });
    }
  });
}
