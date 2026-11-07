/**
 * Reward points in the ops console (rewards plan, step 4).
 *
 *   GET  /api/ops/customers/:id/rewards         balance, pending, milestone,
 *                                               history (customers.view)
 *   POST /api/ops/customers/:id/rewards/adjust  add or take away points with a
 *                                               reason (rewards.adjust: super
 *                                               admin only)
 *   GET  /api/ops/rewards/ledger?month=YYYY-MM  every ledger row in an IST
 *                                               month, for accounts' CSV
 *                                               (payments.view)
 *
 * ITD prices the docket itself and never hears about points, so the monthly
 * export is the only record accounts has of what points were worth.
 */

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { opsGateFor } from "../routeGuards.js";
import { getCustomerForOps } from "../appDb.js";
import { getUserContactsByIds } from "../ordersDb.js";
import { dbClient, logDbError } from "../db/client.js";
import { RUPEES_PER_POINT } from "../../shared/rewards.js";
import {
  MAX_ADJUST_POINTS,
  addAdjustment,
  listLedgerForMonth,
  rewardsSummaryFor,
} from "../rewardsDb.js";

const customerIdSchema = z.string().uuid();

export const adjustBodySchema = z.object({
  points: z
    .number()
    .int("Whole points only")
    .refine((n) => n !== 0, "Enter points to add or take away")
    .refine((n) => Math.abs(n) <= MAX_ADJUST_POINTS, `At most ${MAX_ADJUST_POINTS} points at a time`),
  note: z
    .string()
    .trim()
    .min(5, "Say why, in a few words")
    .max(300, "Keep the reason under 300 characters"),
});

export const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Month must be YYYY-MM");

export function registerOpsRewardsRoutes(app: Express): void {
  app.get(
    "/api/ops/customers/:id/rewards",
    ...opsGateFor("customers.view"),
    async (req: Request, res: Response) => {
      const id = customerIdSchema.safeParse(req.params.id);
      const customer = id.success ? await getCustomerForOps(id.data) : null;
      if (!customer) {
        res.status(404).json({ message: "Customer not found" });
        return;
      }
      const summary = await rewardsSummaryFor(customer.id, { forStaff: true });
      if (!summary) {
        res.status(502).json({ message: "Could not load reward points" });
        return;
      }
      res.json(summary);
    }
  );

  app.post(
    "/api/ops/customers/:id/rewards/adjust",
    ...opsGateFor("rewards.adjust"),
    async (req: Request, res: Response) => {
      const id = customerIdSchema.safeParse(req.params.id);
      const customer = id.success ? await getCustomerForOps(id.data) : null;
      if (!customer) {
        res.status(404).json({ message: "Customer not found" });
        return;
      }
      const body = adjustBodySchema.safeParse(req.body);
      if (!body.success) {
        res.status(400).json({ message: body.error.issues[0]?.message ?? "Invalid adjustment" });
        return;
      }
      const staffUserId = req.session.dbUserId;
      if (!staffUserId) {
        res.status(401).json({ message: "Login required" });
        return;
      }

      const ok = await addAdjustment({
        userId: customer.id,
        points: body.data.points,
        note: body.data.note,
        staffUserId,
      });
      if (!ok) {
        res.status(502).json({ message: "Could not save the adjustment. Try again." });
        return;
      }

      const summary = await rewardsSummaryFor(customer.id, { forStaff: true });
      res.status(201).json(summary ?? {});
    }
  );

  app.get(
    "/api/ops/rewards/ledger",
    ...opsGateFor("payments.view"),
    async (req: Request, res: Response) => {
      const month = monthSchema.safeParse(req.query.month);
      if (!month.success) {
        res.status(400).json({ message: month.error.issues[0]?.message ?? "Invalid month" });
        return;
      }
      const rows = await listLedgerForMonth(month.data);
      if (!rows) {
        res.status(502).json({ message: "Could not load the points ledger" });
        return;
      }

      // Names and order numbers, so the sheet reads without lookups.
      const people = await getUserContactsByIds([
        ...rows.map((r) => r.user_id),
        ...rows.map((r) => r.created_by).filter((id): id is string => !!id),
      ]);
      const orderIds = Array.from(new Set(rows.map((r) => r.order_id).filter((id): id is string => !!id)));
      const orderNos = new Map<string, string>();
      const client = dbClient("opsRewards");
      for (let i = 0; client && i < orderIds.length; i += 200) {
        const { data, error } = await client
          .from("orders")
          .select("id, order_no")
          .in("id", orderIds.slice(i, i + 200));
        if (error) logDbError("opsRewards", "ledger:orderNos", error);
        for (const o of data ?? []) orderNos.set(o.id as string, o.order_no as string);
      }

      res.json({
        month: month.data,
        rows: rows.map((r) => {
          const meta = r.metadata ?? {};
          const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
          return {
            id: r.id,
            created_at: r.created_at,
            customer_name: people.get(r.user_id)?.full_name ?? null,
            customer_phone: people.get(r.user_id)?.phone ?? null,
            kind: r.kind,
            points: r.points,
            rupee_value: r.points * RUPEES_PER_POINT,
            order_no: r.order_id ? (orderNos.get(r.order_id) ?? null) : null,
            billed_incl_gst: num(meta.billed_incl_gst),
            gst_per: num(meta.gst_per),
            weight_kg: r.weight_kg,
            fy: r.fy,
            note: r.note,
            adjusted_by: r.created_by ? (people.get(r.created_by)?.full_name ?? null) : null,
          };
        }),
      });
    }
  );
}
