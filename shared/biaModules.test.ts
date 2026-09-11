import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_BIA_MODULES, modulesForScreen, parseBiaModules } from "./biaModules.js";

test("unset or empty BIA_MODULES means today's default", () => {
  assert.deepEqual(parseBiaModules(undefined), [...DEFAULT_BIA_MODULES]);
  assert.deepEqual(parseBiaModules(""), [...DEFAULT_BIA_MODULES]);
  assert.deepEqual(parseBiaModules("   "), [...DEFAULT_BIA_MODULES]);
});

test("BIA_MODULES is read loosely and returned in a fixed order", () => {
  assert.deepEqual(parseBiaModules("booking, ORDERS ,onboarding"), ["orders", "onboarding", "booking"]);
  assert.deepEqual(parseBiaModules("orders,marketing,admin"), ["orders"]);
});

test("naming only unknown modules turns everything off, not back to the default", () => {
  assert.deepEqual(parseBiaModules("none"), []);
});

const ALL = ["orders", "onboarding", "documents", "booking"] as const;

test("a general screen gets every enabled module", () => {
  assert.deepEqual(modulesForScreen("help", ALL), [...ALL]);
  assert.deepEqual(modulesForScreen(null, ALL), [...ALL]);
  assert.deepEqual(modulesForScreen("rates", ["orders"]), ["orders"]);
});

test("a specific screen gets its own modules, and orders", () => {
  assert.deepEqual(modulesForScreen("create", ALL), ["orders", "booking"]);
  assert.deepEqual(modulesForScreen("signup", ALL), ["orders", "onboarding", "documents"]);
  assert.deepEqual(modulesForScreen("create", ["orders"]), ["orders"], "a dark module stays dark on its own screen");
});
