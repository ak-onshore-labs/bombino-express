import { test } from "node:test";
import assert from "node:assert/strict";
import { applyOrderRefs, destinationOf } from "./notificationRefs.js";

const ref = {
  order_no: "BOM-100200",
  awb_no: "1234567890",
  consignee: { city: "New York", country_name: "United States" },
};

test("an order update learns its AWB and destination from the order", () => {
  const [row] = applyOrderRefs([{ id: "1", data: { order_no: "BOM-100200", status: "dispatched" } }], [ref]);
  assert.deepEqual(row.data, {
    order_no: "BOM-100200",
    status: "dispatched",
    awb: "1234567890",
    destination: "New York, United States",
  });
});

test("a Shipment Booked row learns its order number from the AWB", () => {
  const [row] = applyOrderRefs([{ id: "2", data: { awb: "1234567890" } }], [ref]);
  assert.equal((row.data as Record<string, unknown>).order_no, "BOM-100200");
});

test("an order with no AWB yet stays without one", () => {
  const [row] = applyOrderRefs([{ id: "3", data: { order_no: "BOM-100200" } }], [{ ...ref, awb_no: null }]);
  assert.equal("awb" in (row.data as Record<string, unknown>), false);
});

test("rows that match nothing, and nudges, are left alone", () => {
  const rows = [
    { id: "4", data: { order_no: "BOM-999999" } },
    { id: "5", data: { kind: "bia_nudge", nudge: "pickup_tomorrow", order_no: "BOM-100200" } },
    { id: "6", data: null },
  ];
  assert.deepEqual(applyOrderRefs(rows, [ref]), rows);
});

test("destination is City, Country from whatever the consignee has", () => {
  assert.equal(destinationOf({ city: " London ", country_name: "United Kingdom" }), "London, United Kingdom");
  assert.equal(destinationOf({ country_name: "Canada" }), "Canada");
  assert.equal(destinationOf(null), null);
  assert.equal(destinationOf({ city: "" }), null);
});
