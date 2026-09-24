import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { executeCanIShip, parseRestrictedTable, rowMatches, setRestrictedDir } from "./supportRestricted.js";
import type { SupportChatContext } from "./supportTypes.js";

const anon: SupportChatContext = {
  user: null,
  itdToken: null,
  dbUserId: null,
  sessionId: null,
  guestRef: null,
  guestPhone: null,
  screen: null,
};

const US = `# United States

Notes above the table are ignored.

| Item | Also called | Rule |
|---|---|---|
| Lithium batteries | battery, batteries, power bank | Not accepted, loose or packed separately. |
| Medicines | medicine, tablets | Up to 3 months' personal supply, with a copy of the prescription. |
`;
const ALL = `| Item | Also called | Rule |
|---|---|---|
| Cash | money, currency notes | Never accepted. |
`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bia-restricted-"));
fs.writeFileSync(path.join(dir, "US.md"), US);
fs.writeFileSync(path.join(dir, "ALL.md"), ALL);
fs.writeFileSync(path.join(dir, "GB.md"), "# United Kingdom\n\nNothing yet.\n");
after(() => {
  setRestrictedDir(null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the table is read; headings, notes, header and separator are not", () => {
  const rows = parseRestrictedTable(US);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    item: "Lithium batteries",
    aliases: ["battery", "batteries", "power bank"],
    rule: "Not accepted, loose or packed separately.",
  });
});

test("matching is by whole words, with plurals read as one word", () => {
  const [batteries, medicines] = parseRestrictedTable(US);
  assert.equal(rowMatches("a power bank for my phone", batteries), true);
  assert.equal(rowMatches("spare battery", batteries), true);
  assert.equal(rowMatches("some medicine for my mother", medicines), true);
  assert.equal(rowMatches("battery-operated toy car", batteries), true, "the rule is shown; its wording decides");
  assert.equal(rowMatches("a powerbanker", batteries), false);
  assert.equal(rowMatches("tabletop game", medicines), false);
});

test("a listed item gets its rule word for word, for the country and for everywhere", () => {
  setRestrictedDir(dir);
  const out = executeCanIShip({ item: "power bank", country: "USA" }, anon).content;
  assert.match(out, /Lithium batteries \(United States\): Not accepted, loose or packed separately\./);
  assert.match(out, /TAP_CONTACT_US/, "our team can still confirm an edge case");
  const cash = executeCanIShip({ item: "cash", country: "United Kingdom" }, anon).content;
  assert.match(cash, /Cash \(every destination\): Never accepted\./);
});

test("anything not on a list is 'check with our team', never a guess", () => {
  setRestrictedDir(dir);
  const unlisted = executeCanIShip({ item: "turmeric powder", country: "US" }, anon).content;
  assert.match(unlisted, /doesn't mention "turmeric powder"/);
  assert.match(unlisted, /our team will confirm/);
  assert.match(unlisted, /TAP_CONTACT_US/);
  // A file with no table counts as no file.
  assert.match(executeCanIShip({ item: "turmeric", country: "GB" }, anon).content, /no list of restricted items for United Kingdom yet/);
  assert.match(executeCanIShip({ item: "turmeric", country: "Canada" }, anon).content, /no list of restricted items for Canada yet/);
});

test("with no lists at all, every answer is 'check with our team'", () => {
  setRestrictedDir(path.join(dir, "missing"));
  for (const item of ["power bank", "cash", "medicine"]) {
    const out = executeCanIShip({ item, country: "US" }, anon).content;
    assert.match(out, /no list/);
    assert.match(out, /TAP_CONTACT_US/);
  }
});

test("the country comes from the question, else the booking form; India and nonsense are asked about", () => {
  setRestrictedDir(dir);
  const fromScreen = executeCanIShip({ item: "tablets" }, { ...anon, screen: { surface: "create", destination: "US" } }).content;
  assert.match(fromScreen, /Medicines \(United States\)/);
  assert.match(executeCanIShip({ item: "tablets" }, anon).content, /Ask which country/);
  assert.match(executeCanIShip({ item: "tablets", country: "Narnia" }, anon).content, /isn't a country/);
  assert.match(executeCanIShip({ item: "tablets", country: "India" }, anon).content, /from India to other countries/);
  assert.match(executeCanIShip({ item: "", country: "US" }, anon).content, /Ask what they want to send/);
});

test("a list name can't reach outside its folder", () => {
  setRestrictedDir(dir);
  assert.match(executeCanIShip({ item: "cash", country: "../US" }, anon).content, /isn't a country/);
});
