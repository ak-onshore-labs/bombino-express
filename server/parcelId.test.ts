import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PARCEL_ID_ALPHABET,
  PARCEL_ID_LENGTH,
  formatParcelId,
  newParcelId,
  normaliseParcelId,
} from "./parcelId.js";

test("new IDs are 12 characters from the alphabet and contain a letter", () => {
  for (let i = 0; i < 500; i++) {
    const id = newParcelId();
    assert.equal(id.length, PARCEL_ID_LENGTH);
    for (const ch of id) assert.ok(PARCEL_ID_ALPHABET.includes(ch), id);
    assert.match(id, /[A-Z]/);
  }
});

test("new IDs do not repeat", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 5000; i++) seen.add(newParcelId());
  assert.equal(seen.size, 5000);
});

test("typed and printed forms normalise to the same ID", () => {
  const id = "7KQ2MX9P4HTR";
  assert.equal(normaliseParcelId(id), id);
  assert.equal(normaliseParcelId("7kq2-mx9p-4htr"), id);
  assert.equal(normaliseParcelId(" 7KQ2 MX9P 4HTR "), id);
  assert.equal(formatParcelId(id), "7KQ2-MX9P-4HTR");
});

test("not a parcel ID: wrong length, digits only, or unreadable symbols", () => {
  assert.equal(normaliseParcelId("7KQ2MX9P4HT"), null);
  assert.equal(normaliseParcelId("728589242300"), null); // an AWB-like number
  assert.equal(normaliseParcelId("BOM-100338"), null);
  assert.equal(normaliseParcelId("7KQ2MX9P4H0R"), null); // O/0 is not in the alphabet
});
