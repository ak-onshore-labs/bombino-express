import { test } from "node:test";
import assert from "node:assert/strict";
import { FixedWindowLimiter } from "./supportRateLimit.js";

const HOUR = 60 * 60 * 1000;

test("counts hits per key inside one window", () => {
  const l = new FixedWindowLimiter(HOUR);
  const t = 1_000_000;
  assert.equal(l.hit("a", t), 1);
  assert.equal(l.hit("a", t + 1), 2);
  assert.equal(l.hit("b", t + 2), 1, "keys are counted separately");
  assert.equal(l.hit("a", t + 3), 3);
});

test("a new window starts from one once the old one ends", () => {
  const l = new FixedWindowLimiter(HOUR);
  const t = 1_000_000;
  for (let i = 0; i < 25; i++) l.hit("a", t);
  assert.equal(l.hit("a", t + HOUR - 1), 26, "still the same window");
  assert.equal(l.hit("a", t + HOUR), 1, "window over, counting restarts");
});

test("expired windows are pruned so idle keys don't accumulate", () => {
  const l = new FixedWindowLimiter(HOUR);
  const t = 1_000_000;
  for (let i = 0; i < 100; i++) l.hit(`ip:${i}`, t);
  assert.equal(l.size(), 100);
  l.hit("late", t + 2 * HOUR);
  assert.equal(l.size(), 1, "only the fresh key survives the sweep");
});
