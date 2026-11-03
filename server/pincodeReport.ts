/**
 * Ops pincode report — the uncollapsed lookup behind GET /api/ops/pincodes/:pincode.
 *
 * Booking reads `getCoverage()`, which reconciles overlapping beats into one
 * city, one remark and the latest cutoff. This report uses that same map for
 * `serviceable` / `source` / `resolved` so ops see what the customer would, and
 * then attaches the per-beat rounds and the honest rider fan-out the collapsed
 * map cannot show.
 *
 * Always returns a report. An unreachable database is `source: "static"` and
 * `riders.reason: "unreachable"`, never a 502 — the same floor booking uses.
 */

import { listBeatsForPincode, type PincodeBeatRow } from "./beatsDb.js";
import { getCoverage } from "./pickupCoverageDb.js";
import {
  describeFanoutForPincode,
  type FanoutMode,
  type FanoutReason,
} from "./whatsappAgents.js";
import {
  getPickupServiceability,
  pickupCutoffHour,
  type PickupRemark,
} from "../shared/pickupPincodes.js";

export interface PincodeReportRound {
  beat_id: string;
  name: string;
  hub: string;
  cutoff_hour: number;
  city: string;
  area: string;
  remark: PickupRemark;
}

export interface PincodeReportResolved {
  city: string;
  area: string;
  remark: PickupRemark;
  cutoff_hour: number;
}

export interface PincodeReportRider {
  name: string | null;
  phone: string | null;
}

export interface PincodeReport {
  pincode: string;
  serviceable: boolean;
  source: "db" | "static";
  rounds: PincodeReportRound[];
  resolved: PincodeReportResolved | null;
  riders: {
    mode: FanoutMode;
    reason: FanoutReason | null;
    agents: PincodeReportRider[];
  };
}

function fanoutReason(
  mode: FanoutMode,
  existing: FanoutReason | null,
  rounds: PincodeBeatRow[] | null,
  source: "db" | "static"
): FanoutReason | null {
  if (mode !== "all") return null;

  if (rounds === null || (source === "static" && (rounds?.length ?? 0) === 0)) {
    return "unreachable";
  }
  if (rounds.length === 0) return "uncovered";
  return existing ?? "unstaffed";
}

export async function buildPincodeReport(pincode: string): Promise<PincodeReport> {
  const [{ areas, source }, rounds, fanout] = await Promise.all([
    getCoverage(),
    listBeatsForPincode(pincode),
    describeFanoutForPincode(pincode),
  ]);

  const coverage = getPickupServiceability(pincode, areas);
  const resolved: PincodeReportResolved | null = coverage.serviceable
    ? {
        city: coverage.city,
        area: coverage.area,
        remark: coverage.remark,
        cutoff_hour: pickupCutoffHour(pincode, areas),
      }
    : null;

  return {
    pincode,
    serviceable: coverage.serviceable,
    source,
    rounds: (rounds ?? []).map((row) => ({
      beat_id: row.beat_id,
      name: row.name,
      hub: row.hub,
      cutoff_hour: row.cutoff_hour,
      city: row.city,
      area: row.area,
      remark: row.remark,
    })),
    resolved,
    riders: {
      mode: fanout.mode,
      reason: fanoutReason(fanout.mode, fanout.reason, rounds, source),
      agents: fanout.agents.map((agent) => ({
        name: agent.full_name,
        phone: agent.phone,
      })),
    },
  };
}
