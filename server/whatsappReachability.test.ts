import { test } from "node:test";
import assert from "node:assert/strict";
import { decideReachability, isNotOnWhatsappError } from "./whatsappDb.js";

const notOnWa = { errors: [{ code: 131026, title: "Message undeliverable" }] };
const otherFailure = { errors: [{ code: 132001, title: "Template does not exist" }] };

test("isNotOnWhatsappError", async (t) => {
  await t.test("131026 counts", () => {
    assert.equal(isNotOnWhatsappError(notOnWa), true);
  });
  await t.test("131026 as a string counts", () => {
    assert.equal(isNotOnWhatsappError({ errors: [{ code: "131026" }] }), true);
  });
  await t.test("any other failure does not", () => {
    assert.equal(isNotOnWhatsappError(otherFailure), false);
    assert.equal(isNotOnWhatsappError({ status: 500, body: "oops" }), false);
    assert.equal(isNotOnWhatsappError(null), false);
  });
});

test("decideReachability", async (t) => {
  await t.test("no rows is unknown", () => {
    assert.equal(decideReachability([], null), "unknown");
  });

  await t.test("delivered or read is on WhatsApp", () => {
    assert.equal(
      decideReachability([{ status: "delivered", error: null, updated_at: "2026-09-30T10:00:00Z" }], null),
      "on_whatsapp"
    );
    assert.equal(
      decideReachability([{ status: "read", error: null, updated_at: "2026-09-30T10:00:00Z" }], null),
      "on_whatsapp"
    );
  });

  await t.test("131026 failure is not on WhatsApp", () => {
    assert.equal(
      decideReachability([{ status: "failed", error: notOnWa, updated_at: "2026-09-30T10:00:00Z" }], null),
      "not_on_whatsapp"
    );
  });

  await t.test("other failures are passed over for the next decisive row", () => {
    assert.equal(
      decideReachability(
        [
          { status: "failed", error: otherFailure, updated_at: "2026-09-30T11:00:00Z" },
          { status: "delivered", error: null, updated_at: "2026-09-30T10:00:00Z" },
        ],
        null
      ),
      "on_whatsapp"
    );
    assert.equal(
      decideReachability([{ status: "failed", error: otherFailure, updated_at: "2026-09-30T11:00:00Z" }], null),
      "unknown"
    );
  });

  await t.test("newest decisive row wins", () => {
    assert.equal(
      decideReachability(
        [
          { status: "delivered", error: null, updated_at: "2026-09-30T11:00:00Z" },
          { status: "failed", error: notOnWa, updated_at: "2026-09-30T10:00:00Z" },
        ],
        null
      ),
      "on_whatsapp"
    );
  });

  await t.test("a verification newer than the 131026 failure outranks it", () => {
    const rows = [{ status: "failed", error: notOnWa, updated_at: "2026-09-30T10:00:00Z" }];
    assert.equal(decideReachability(rows, "2026-09-30T12:00:00Z"), "on_whatsapp");
    assert.equal(decideReachability(rows, "2026-09-29T12:00:00Z"), "not_on_whatsapp");
  });
});
