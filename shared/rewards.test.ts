import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_GST_PER,
  MILESTONE_KG,
  canRedeem,
  exGst,
  fyExpiresAtIso,
  fyLastDay,
  fyOf,
  gstPerOf,
  milestoneProgress,
  pointsEarned,
} from "./rewards.js";

const utc = (iso: string): Date => new Date(iso);

test("the financial year turns at 00:00 IST on 1 April, not at UTC midnight", () => {
  // 23:59 IST on 31 Mar 2027 is 18:29 UTC — still FY 2026-27.
  assert.equal(fyOf(utc("2027-03-31T18:29:00Z")), "2026-27");
  // 00:00 IST on 1 Apr 2027 is 18:30 UTC on 31 Mar.
  assert.equal(fyOf(utc("2027-03-31T18:30:00Z")), "2027-28");
  assert.equal(fyOf(utc("2026-11-07T10:00:00Z")), "2026-27");
  assert.equal(fyOf(utc("2027-01-15T10:00:00Z")), "2026-27");
  assert.equal(fyOf(utc("2099-06-01T00:00:00Z")), "2099-00");
});

test("an FY's points last through 31 March and expire at midnight IST", () => {
  assert.equal(fyLastDay("2026-27"), "2027-03-31");
  assert.equal(fyExpiresAtIso("2026-27"), "2027-03-31T18:30:00.000Z");
  assert.throws(() => fyLastDay("2026"));
});

test("GST comes out of the inclusive price", () => {
  assert.equal(exGst(11800, 18), 10000);
  assert.equal(exGst(1180, 18), 1000);
  assert.equal(exGst(1000, 0), 1000);
  // A nonsense rate falls back to the default rather than inventing money.
  assert.equal(exGst(1180, Number.NaN), exGst(1180, DEFAULT_GST_PER));
});

test("gst_per is read off the order, else 18", () => {
  assert.equal(gstPerOf({ gst_per: 18 }), 18);
  assert.equal(gstPerOf({ gst_per: "5" }), 5);
  assert.equal(gstPerOf({ gst_per: "" }), DEFAULT_GST_PER);
  assert.equal(gstPerOf({}), DEFAULT_GST_PER);
  assert.equal(gstPerOf(null), DEFAULT_GST_PER);
  assert.equal(gstPerOf({ gst_per: 900 }), DEFAULT_GST_PER);
});

test("₹100 billed before GST is one point, rounded down", () => {
  // ₹11,800 with GST = ₹10,000 before GST = 100 points.
  assert.equal(pointsEarned({ billedInclGst: 11800, gstPer: 18 }), 100);
  // ₹10,099 before GST still 100.
  assert.equal(pointsEarned({ billedInclGst: 10099 * 1.18, gstPer: 18 }), 100);
  // Under ₹100 before GST earns nothing.
  assert.equal(pointsEarned({ billedInclGst: 117, gstPer: 18 }), 0);
  assert.equal(pointsEarned({ billedInclGst: 118, gstPer: 18 }), 1);
});

test("points used come off the price before GST, then earn on what is left", () => {
  // ₹10,000 before GST, 150 points used → ₹9,850 billed → 98 points.
  assert.equal(pointsEarned({ billedInclGst: 11800, gstPer: 18, pointsUsed: 150 }), 98);
  // Points covering the whole base earn nothing, never negative.
  assert.equal(pointsEarned({ billedInclGst: 1180, gstPer: 18, pointsUsed: 5000 }), 0);
});

test("no price, no points", () => {
  assert.equal(pointsEarned({ billedInclGst: null, gstPer: 18 }), 0);
  assert.equal(pointsEarned({ billedInclGst: 0, gstPer: 18 }), 0);
  assert.equal(pointsEarned({ billedInclGst: -500, gstPer: 18 }), 0);
});

test("points can be used from 100", () => {
  assert.equal(canRedeem(99), false);
  assert.equal(canRedeem(100), true);
  assert.equal(canRedeem(-20), false);
});

test("the weight milestone is reached at 700 kg", () => {
  assert.equal(MILESTONE_KG, 700);
  const start = milestoneProgress(0);
  assert.deepEqual(start, { shippedKg: 0, targetKg: 700, remainingKg: 700, reached: false, progress: 0 });

  const midway = milestoneProgress(320.5);
  assert.equal(midway.reached, false);
  assert.equal(midway.remainingKg, 379.5);

  const done = milestoneProgress(712);
  assert.equal(done.reached, true);
  assert.equal(done.remainingKg, 0);
  assert.equal(done.progress, 1);

  // A clawback can take the sum below zero for a moment; show zero.
  assert.equal(milestoneProgress(-5).shippedKg, 0);
});
