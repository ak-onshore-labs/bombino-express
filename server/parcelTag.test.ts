import { test } from "node:test";
import assert from "node:assert/strict";

import { parcelTagFor, verifyParcelTag } from "./parcelTag.js";

const ID = "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const SECRET = "test-secret";

test("a tag round-trips to its order id", () => {
  const tag = parcelTagFor(ID, SECRET);
  assert.equal(verifyParcelTag(tag, SECRET), ID);
});

test("a tag signed with another secret is refused", () => {
  const tag = parcelTagFor(ID, "other-secret");
  assert.equal(verifyParcelTag(tag, SECRET), null);
});

test("changing one character of the signature is refused", () => {
  const tag = parcelTagFor(ID, SECRET);
  const last = tag.at(-1) === "A" ? "B" : "A";
  assert.equal(verifyParcelTag(tag.slice(0, -1) + last, SECRET), null);
});

test("another order's id under a valid signature is refused", () => {
  const sig = parcelTagFor(ID, SECRET).split(".")[1];
  assert.equal(verifyParcelTag(`00000000-0000-4000-8000-000000000000.${sig}`, SECRET), null);
});

test("malformed tags are refused, not thrown on", () => {
  for (const bad of ["", ".", "abc", `${ID}.`, `${ID}.short`, `not-a-uuid.${"A".repeat(22)}`, `${ID}.!!!`]) {
    assert.equal(verifyParcelTag(bad, SECRET), null, bad);
  }
});
