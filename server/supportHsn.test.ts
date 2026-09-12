import { test } from "node:test";
import assert from "node:assert/strict";
import { HSN_ENTRIES, executeSuggestHsn, matchHsn, replaceHsnPicker } from "./supportHsn.js";
import type { SupportChatContext } from "./supportTypes.js";
import { isBiaCard } from "../shared/biaCards.js";
import { getHsnCode } from "../shared/hsn.js";

const ctx: SupportChatContext = {
  user: null,
  itdToken: null,
  dbUserId: null,
  sessionId: null,
  guestRef: null,
  guestPhone: null,
  screen: null,
};

test("an item typed as an entry is a sure match, full names first", () => {
  assert.deepEqual(matchHsn("Turmeric powder"), { sure: true, entries: [{ description: "TURMERIC POWDER", code: "09103030" }] });
  // "BED SHEETS" and "BED SHEET(…)" carry different codes; the plain name wins.
  assert.equal(matchHsn("bed sheets").entries[0]?.description, "BED SHEETS");
  assert.equal(matchHsn("").entries.length, 0);
});

test("each entry's code is the one the booking form fills", () => {
  for (const e of HSN_ENTRIES) assert.equal(e.code, getHsnCode(e.description), e.description);
  assert.equal(new Set(HSN_ENTRIES.map((e) => e.description)).size, HSN_ENTRIES.length);
});

test("anything not typed exactly goes to the model; its pick must be on the list", async () => {
  const kurta = HSN_ENTRIES.find((e) => e.description === "COTTON LADIES KURTA")!;
  replaceHsnPicker(async () => [kurta]);
  try {
    const out = await executeSuggestHsn({ item: "cotton kurta" }, ctx);
    const card = out.cards?.[0];
    assert.ok(card && isBiaCard(card) && card.kind === "hsn");
    assert.equal(card.kind === "hsn" && card.sure, false);
    assert.deepEqual(card.kind === "hsn" && card.candidates, [{ description: "COTTON LADIES KURTA", code: "62113200" }]);
    assert.match(out.content, /Shipment Content/);
    assert.match(out.content, /never say you filled anything in/);
  } finally {
    replaceHsnPicker(null);
  }
});

test("when the model can't answer, word matches stand in; with neither, our team", async () => {
  replaceHsnPicker(async () => []);
  try {
    const watch = await executeSuggestHsn({ item: "wrist watch for my dad" }, ctx);
    assert.match(watch.content, /WRIST WATCH: HS code 91011900/);
    const parrot = await executeSuggestHsn({ item: "a live parrot" }, ctx);
    assert.equal(parrot.cards, undefined);
    assert.match(parrot.content, /our team/);
    assert.match(parrot.content, /TAP_CONTACT_US/);
  } finally {
    replaceHsnPicker(null);
  }
});

test("on a CSB V booking, BIA says the form wants 10 digits and these are 8", async () => {
  const out = await executeSuggestHsn({ item: "books" }, { ...ctx, screen: { surface: "create", productType: "CSB V" } });
  assert.match(out.content, /10-digit/);
  assert.doesNotMatch((await executeSuggestHsn({ item: "books" }, ctx)).content, /10-digit/);
});

test("an hsn card carries 8-digit codes from the list, and at most three", () => {
  const card = { kind: "hsn", item: "books", sure: true, candidates: [{ description: "BOOKS", code: "49019100" }] };
  assert.equal(isBiaCard(card), true);
  assert.equal(isBiaCard({ ...card, candidates: [{ description: "BOOKS", code: "4901" }] }), false);
  assert.equal(isBiaCard({ ...card, candidates: [] }), false);
  assert.equal(isBiaCard({ ...card, candidates: Array(4).fill(card.candidates[0]) }), false);
});
