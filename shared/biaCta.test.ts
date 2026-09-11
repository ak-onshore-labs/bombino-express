import { test } from "node:test";
import assert from "node:assert/strict";
import {
  biaButtonAllowedFor,
  biaButtonNeedsOwnership,
  biaButtonToken,
  parseBiaButton,
} from "./biaCta.js";

test("plain buttons parse as themselves", () => {
  for (const name of ["TAP_CREATE_SHIPMENT", "TAP_CONTACT_US", "TAP_MY_ORDERS", "TAP_CANCELLATIONS", "TAP_GUEST_PROFILE"]) {
    assert.deepEqual(parseBiaButton(name), { name, arg: "" });
  }
});

test("unknown names are not buttons", () => {
  assert.equal(parseBiaButton("TAP_BOGUS"), null);
  assert.equal(parseBiaButton("TAP_DELETE_ACCOUNT:me"), null);
});

test("arguments come out in one canonical form", () => {
  assert.deepEqual(parseBiaButton("TAP_VIEW_ORDER:bom100231"), { name: "TAP_VIEW_ORDER", arg: "BOM-100231" });
  assert.deepEqual(parseBiaButton("TAP_TRACK:ab12cd34"), { name: "TAP_TRACK", arg: "AB12CD34" });
  assert.deepEqual(parseBiaButton("TAP_LOCATIONS:Tamil%20Nadu"), { name: "TAP_LOCATIONS", arg: "Tamil%20Nadu" });
});

test("a bad required argument drops the button; a bad optional one drops the argument", () => {
  assert.equal(parseBiaButton("TAP_VIEW_ORDER:not-an-order"), null);
  assert.equal(parseBiaButton("TAP_VIEW_ORDER"), null);
  assert.equal(parseBiaButton("TAP_TRACK:a"), null);
  assert.deepEqual(parseBiaButton("TAP_LOCATIONS:%3Cscript%3E"), { name: "TAP_LOCATIONS", arg: "" });
  assert.deepEqual(parseBiaButton("TAP_LOCATIONS:%E0%A4"), { name: "TAP_LOCATIONS", arg: "" });
});

test("a token round-trips", () => {
  for (const token of ["TAP_MY_ORDERS", "TAP_VIEW_ORDER:BOM-100231", "TAP_LOCATIONS:Karnataka"]) {
    const button = parseBiaButton(token);
    assert.ok(button);
    assert.equal(biaButtonToken(button), token);
  }
});

test("who may see what", () => {
  assert.equal(biaButtonAllowedFor("TAP_CONTACT_US", null), true);
  assert.equal(biaButtonAllowedFor("TAP_CANCELLATIONS", "account"), true);
  assert.equal(biaButtonAllowedFor("TAP_CANCELLATIONS", "guest"), false);
  assert.equal(biaButtonAllowedFor("TAP_GUEST_PROFILE", "guest"), true);
  assert.equal(biaButtonAllowedFor("TAP_VIEW_ORDER", "guest"), false);
  assert.equal(biaButtonAllowedFor("TAP_VIEW_ORDER", null), false);
  assert.equal(biaButtonNeedsOwnership("TAP_VIEW_ORDER"), true);
  assert.equal(biaButtonNeedsOwnership("TAP_TRACK"), false);
});
