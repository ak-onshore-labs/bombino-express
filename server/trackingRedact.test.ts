import { test } from "node:test";
import assert from "node:assert/strict";

import { redactTracking } from "./trackingRedact.js";
import type { ITDTrackingResult } from "./itd.js";

const result = {
  errors: false,
  tracking_no: "72858924230",
  chargeable_weight: "2.000",
  forwarding_no: "9400100000000000000000",
  pcs: "1",
  docket_info: [
    ["Status", "In Transit"],
    ["Shipper Name", "Aditya Kamarouthu"],
    ["Shipper Company", "Onshore Labs"],
    ["Shipper City", "Raigarh(MH)"],
    ["Consignee Name", "Arbaaz Khan"],
    ["Consignee Phone", "+109198332075"],
    ["Consignee Address", "2B-1404, Rajyog CHS"],
    ["Consignee City", "Adrian"],
    ["Consignee Country", "US"],
    ["Chargeable Weight", "2.000"],
    ["Service Name", "BMS DDP LITE"],
  ],
  docket_events: [
    { event_at: "2026-10-06 10:00", event_description: "Delivered", event_location: "ADRIAN", event_remark: "RECEIVED BY ARBAAZ" },
  ],
  parcel_docket_events: { "01": [] },
  all_parcel_no: { "01": "7285892423001" },
} as unknown as ITDTrackingResult;

test("a stranger sees tracking fields only", () => {
  const [r] = redactTracking([result]);
  const keys = r.docket_info.map(([k]) => k);
  assert.deepEqual(keys, ["Status", "Shipper City", "Consignee City", "Consignee Country", "Service Name"]);
  assert.equal(r.chargeable_weight, "");
  assert.equal(r.forwarding_no, "9400100000000000000000");
  assert.deepEqual(r.all_parcel_no, {});
});

test("scan remarks are dropped, the scan itself is kept", () => {
  const [r] = redactTracking([result]);
  const ev = r.docket_events[0] as unknown as Record<string, string>;
  assert.equal(ev.event_remark, "");
  assert.equal(ev.event_description, "Delivered");
  assert.equal(ev.event_location, "ADRIAN");
});

test("no name, phone or address survives anywhere", () => {
  const text = JSON.stringify(redactTracking([result]));
  for (const secret of ["Aditya", "Onshore Labs", "Arbaaz", "+109198332075", "Rajyog"]) {
    assert.ok(!text.includes(secret), secret);
  }
});
