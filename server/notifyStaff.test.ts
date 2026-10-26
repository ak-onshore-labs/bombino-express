import { test } from "node:test";
import assert from "node:assert/strict";

import { pickStaff, type StaffMember } from "./notifyStaff.js";

const STAFF: StaffMember[] = [
  { id: "bm-mum", phone: "9800000001", role: "branch_manager", city: "Mumbai", test: false },
  { id: "bm-del", phone: "9800000002", role: "branch_manager", city: "Delhi", test: false },
  { id: "admin", phone: "9800000003", role: "admin", city: null, test: false },
  { id: "support", phone: "9800000004", role: "customer_support", city: null, test: false },
  { id: "accounts", phone: "9800000005", role: "accounts", city: null, test: false },
  { id: "bm-mum-test", phone: "9800000006", role: "branch_manager", city: "Mumbai", test: true },
  { id: "admin-test", phone: "9800000007", role: "admin", city: null, test: true },
];

const ids = (people: StaffMember[]) => people.map((p) => p.id).sort();

test("the branch is the order city's branch managers only", () => {
  assert.deepEqual(ids(pickStaff(STAFF, { roles: [], branch: true }, "Mumbai", false)), ["bm-mum"]);
});

test("a city with no branch manager goes to the admins", () => {
  assert.deepEqual(ids(pickStaff(STAFF, { roles: [], branch: true }, "Pune", false)), ["admin"]);
  assert.deepEqual(ids(pickStaff(STAFF, { roles: [], branch: true }, null, false)), ["admin"]);
});

test("roles reach every city, and nobody is told twice", () => {
  assert.deepEqual(
    ids(pickStaff(STAFF, { roles: ["admin", "customer_support"], branch: true }, "Pune", false)),
    ["admin", "support"]
  );
  assert.deepEqual(
    ids(pickStaff(STAFF, { roles: ["customer_support", "accounts"], branch: true }, "Delhi", false)),
    ["accounts", "bm-del", "support"]
  );
});

test("test orders reach test staff only, real orders real staff only", () => {
  assert.deepEqual(
    ids(pickStaff(STAFF, { roles: ["admin"], branch: true }, "Mumbai", true)),
    ["admin-test", "bm-mum-test"]
  );
  assert.deepEqual(ids(pickStaff(STAFF, { roles: ["accounts"] }, null, true)), ["admin-test"]);
});

test("nobody in the roles: admins, then super admins", () => {
  assert.deepEqual(ids(pickStaff(STAFF, { roles: ["kyc_reviewer"] }, null, false)), ["admin"]);
  const noAdmins = [
    ...STAFF.filter((s) => s.role !== "admin"),
    { id: "super", phone: "9800000008", role: "super_admin" as const, city: null, test: false },
  ];
  assert.deepEqual(ids(pickStaff(noAdmins, { roles: ["kyc_reviewer"] }, null, false)), ["super"]);
  assert.deepEqual(ids(pickStaff(noAdmins, { roles: [], branch: true }, "Pune", false)), ["super"]);
});
