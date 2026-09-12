import { test } from "node:test";
import assert from "node:assert/strict";
import { screenChips, screenWantsOrderChips } from "./biaChips.js";
import { BIA_SCREEN_STEPS, BIA_SURFACES, type BiaScreen } from "./biaScreen.js";
import { BIA_MODULES } from "./biaModules.js";

const all = [...BIA_MODULES];

test("every screen, and every booking step, has chips of its own", () => {
  for (const surface of BIA_SURFACES) {
    const screen: BiaScreen = surface === "order" ? { surface, orderNo: "BOM-100107" } : { surface };
    assert.ok(screenChips(screen, all).length >= 3, surface);
  }
  for (const step of BIA_SCREEN_STEPS.create ?? []) {
    assert.ok(screenChips({ surface: "create", step }, all).length >= 3, step);
  }
});

test("chips change with the screen", () => {
  const order = screenChips({ surface: "order", orderNo: "BOM-100107" }, all);
  assert.ok(order.every((c) => !c.includes("BOM-") || c.includes("BOM-100107")));
  assert.ok(order.some((c) => c.includes("BOM-100107")));
  assert.notDeepEqual(screenChips({ surface: "create", step: "invoice" }, all), screenChips({ surface: "create", step: "sender" }, all));
  assert.ok(screenChips({ surface: "create", step: "invoice" }, all).includes("What HS code should I use?"));
  assert.ok(screenChips({ surface: "track" }, all).includes("Where can I download my shipping label?"));
});

test("a chip needing a part of BIA that's switched off is left out", () => {
  const invoiceOff = screenChips({ surface: "create", step: "invoice" }, ["orders"]);
  assert.ok(!invoiceOff.includes("What HS code should I use?"));
  assert.ok(!screenChips({ surface: "signup" }, ["orders"]).includes("Which account do I need?"));
  assert.ok(screenChips({ surface: "signup" }, ["orders", "onboarding"]).includes("Which account do I need?"));
});

test("the customer's own orders lead only on Home, Help and Orders", () => {
  assert.equal(screenWantsOrderChips({ surface: "home" }), true);
  assert.equal(screenWantsOrderChips({ surface: "orders" }), true);
  assert.equal(screenWantsOrderChips(null), true);
  assert.equal(screenWantsOrderChips({ surface: "create", step: "package" }), false);
  assert.equal(screenWantsOrderChips({ surface: "order", orderNo: "BOM-100107" }), false);
});
