import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request } from "express";

import { canMarkTestOrders, isTestPhone, seesTestOrders, withoutHiddenTestRows } from "./testOrders.js";
import { isTestAwb, isTestOrderMetadata, testAwbFor } from "../shared/testOrders.js";
import { isTestOtpNumber } from "./otp.js";

test("fixed-OTP test numbers and the team's real test phone make test orders", () => {
  assert.equal(isTestPhone("9000000090"), true);
  assert.equal(isTestPhone("+91 90000 00096"), true);
  assert.equal(isTestPhone("7558372885"), true);
  assert.equal(isTestPhone("+917558372885"), true);
  assert.equal(isTestPhone("9833207558"), true);
});

test("the team's real test phone still logs in with a real code", () => {
  assert.equal(isTestOtpNumber("7558372885"), false);
});

test("the real-view login takes 121212 but is not a test phone", () => {
  assert.equal(isTestOtpNumber("9000000099"), true);
  assert.equal(isTestPhone("9000000099"), false);
});

test("other numbers are real", () => {
  assert.equal(isTestPhone("9867603072"), false);
  assert.equal(isTestPhone(null), false);
  assert.equal(isTestPhone("12345"), false);
});

test("only the test super admin's number may mark orders test or real", () => {
  assert.equal(canMarkTestOrders("9000000011"), true);
  assert.equal(canMarkTestOrders("+91 90000 00011"), true);
  assert.equal(canMarkTestOrders("9000000010"), false);
  assert.equal(canMarkTestOrders("7558372885"), false);
  assert.equal(canMarkTestOrders(null), false);
});

test("only metadata.test === true marks a test order", () => {
  assert.equal(isTestOrderMetadata({ test: true, liveView: false, marksTest: false }), true);
  assert.equal(isTestOrderMetadata({ test: "true" }), false);
  assert.equal(isTestOrderMetadata({}), false);
  assert.equal(isTestOrderMetadata(null), false);
});

test("a test AWB is TEST + the order number's digits, and is recognised", () => {
  assert.equal(testAwbFor("BOM-100345"), "TEST100345");
  assert.equal(isTestAwb("TEST100345"), true);
  assert.equal(isTestAwb("test100345"), true);
  assert.equal(isTestAwb("800123456789"), false);
  assert.equal(isTestAwb(null), false);
});

function req(staff: Request["staff"]): Request {
  return { staff, session: {} } as unknown as Request;
}

const rows = [{ id: "a", is_test: false }, { id: "b", is_test: true }];

test("real staff never see test rows", () => {
  const admin = req({ role: "admin", scoped: false, city: null, test: false, liveView: false, marksTest: false });
  assert.equal(seesTestOrders(admin), false);
  assert.deepEqual(withoutHiddenTestRows(admin, rows).map((r) => r.id), ["a"]);
});

test("test staff on test data see only test rows", () => {
  const testBranch = req({ role: "branch_manager", scoped: true, city: "Mumbai", test: true, liveView: false, marksTest: false });
  assert.equal(seesTestOrders(testBranch), true);
  assert.deepEqual(withoutHiddenTestRows(testBranch, rows).map((r) => r.id), ["b"]);
});

test("test staff switched to live data see exactly what real staff see", () => {
  const testAdmin = req({ role: "super_admin", scoped: false, city: null, test: true, liveView: true, marksTest: true });
  assert.equal(seesTestOrders(testAdmin), false);
  assert.deepEqual(withoutHiddenTestRows(testAdmin, rows).map((r) => r.id), ["a"]);
});

test("a super admin does not see them either", () => {
  const superAdmin = req({ role: "super_admin", scoped: false, city: null, test: false, liveView: false, marksTest: false });
  assert.equal(seesTestOrders(superAdmin), false);
  assert.deepEqual(withoutHiddenTestRows(superAdmin, rows).map((r) => r.id), ["a"]);
});
