import { test } from "node:test";
import assert from "node:assert/strict";

import { parseItdJson } from "./itdJson.js";

test("a normal JSON reply parses as-is", () => {
  const reply = parseItdJson<{ success: boolean }>('{"success":true}', "createShipment");
  assert.equal(reply.success, true);
});

test("text printed ahead of the JSON is skipped and the AWB kept", () => {
  const body = 'COMPANY NO 12\n{"success":true,"data":{"awb_no":"BOM123"}}';
  const reply = parseItdJson<{ data: { awb_no: string } }>(body, "createShipment");
  assert.equal(reply.data.awb_no, "BOM123");
});

test("a reply with no JSON throws with ITD's own text in the message", () => {
  assert.throws(
    () => parseItdJson("COMPANY NO not found for this customer", "createShipment"),
    /not JSON: COMPANY NO not found for this customer/
  );
});

test("an empty reply says so", () => {
  assert.throws(() => parseItdJson("", "createShipment"), /\(empty reply\)/);
});
