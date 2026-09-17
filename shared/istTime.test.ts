import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PICKUP_CUTOFF_HOUR,
  dayOfWeekForDate,
  earliestPickupDate,
  nowInIst,
  startOfIstDayIso,
  todayInIst,
} from "./istTime.js";

/** An instant, written the way the bug would be written: in UTC. */
const utc = (iso: string): Date => new Date(iso);

test("the Indian day rolls over at 18:30 UTC, not at midnight UTC", () => {
  // 23:59 IST on the 17th is still the 17th in India and already the 18th
  // nowhere — but it is 18:29 UTC, which is where a naive server gets it wrong.
  assert.equal(todayInIst(utc("2026-09-17T18:29:00Z")), "2026-09-17");
  assert.equal(todayInIst(utc("2026-09-17T18:30:00Z")), "2026-09-18");
  // Just after UTC midnight is the small hours of the *next* Indian day.
  assert.equal(todayInIst(utc("2026-09-17T00:01:00Z")), "2026-09-17");
});

test("the Indian wall clock reads the hour and minute in IST", () => {
  assert.deepEqual(nowInIst(utc("2026-09-17T09:30:00Z")), {
    date: "2026-09-17",
    hour: 15,
    minute: 0,
  });
  assert.deepEqual(nowInIst(utc("2026-09-17T19:00:00Z")), {
    date: "2026-09-18",
    hour: 0,
    minute: 30,
  });
});

test("an Indian calendar day starts at 18:30 UTC the evening before", () => {
  assert.equal(startOfIstDayIso("2026-09-17"), "2026-09-16T18:30:00.000Z");
});

test("a pickup booked before the cutoff is for today, after it for tomorrow", () => {
  const beforeCutoff = utc("2026-09-17T08:00:00Z"); // 13:30 IST
  const atCutoff = utc("2026-09-17T09:30:00Z"); // 15:00 IST
  const afterCutoff = utc("2026-09-17T12:00:00Z"); // 17:30 IST

  assert.equal(earliestPickupDate(PICKUP_CUTOFF_HOUR, beforeCutoff), "2026-09-17");
  assert.equal(earliestPickupDate(PICKUP_CUTOFF_HOUR, atCutoff), "2026-09-18");
  assert.equal(earliestPickupDate(PICKUP_CUTOFF_HOUR, afterCutoff), "2026-09-18");
});

test("a hub with its own cutoff is honoured", () => {
  const noon = utc("2026-09-17T06:30:00Z"); // 12:00 IST
  // A hub that stops collecting at 11:00 has already stopped.
  assert.equal(earliestPickupDate(11, noon), "2026-09-18");
  // One that runs to 18:00 has not.
  assert.equal(earliestPickupDate(18, noon), "2026-09-17");
});

test("rolling over the cutoff crosses a month and a year correctly", () => {
  assert.equal(earliestPickupDate(PICKUP_CUTOFF_HOUR, utc("2026-09-30T12:00:00Z")), "2026-10-01");
  assert.equal(earliestPickupDate(PICKUP_CUTOFF_HOUR, utc("2026-12-31T12:00:00Z")), "2027-01-01");
  // A leap day is a day like any other.
  assert.equal(earliestPickupDate(PICKUP_CUTOFF_HOUR, utc("2028-02-28T12:00:00Z")), "2028-02-29");
});

test("the day of the week is the Indian one", () => {
  // 17 September 2026 is a Thursday in India.
  assert.equal(dayOfWeekForDate("2026-09-17"), 4);
  assert.equal(dayOfWeekForDate("2026-09-20"), 0);
});
