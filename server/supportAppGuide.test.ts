import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { executeGetAppHelp, matchAppGuide, parseAppGuide } from "./supportAppGuide.js";
import { parseBiaButton } from "../shared/biaCta.js";
import type { SupportChatContext } from "./supportTypes.js";

const FILE = path.resolve(process.cwd(), "content", "bia", "app-guide.md");
const guide = parseAppGuide(fs.readFileSync(FILE, "utf8"));
const anon: SupportChatContext = {
  user: null,
  itdToken: null,
  dbUserId: null,
  sessionId: null,
  guestRef: null,
  guestPhone: null,
  screen: null,
};

test("every section of the real guide has a title, ways it's asked, and an answer", () => {
  assert.ok(guide.length >= 15, `only ${guide.length} sections`);
  for (const s of guide) {
    assert.ok(s.askedAs.length >= 3, `${s.title}: too few "Asked as"`);
    assert.ok(s.body.length > 80, `${s.title}: answer too short`);
    for (const b of s.buttons) assert.ok(parseBiaButton(b), `${s.title}: unknown button ${b}`);
  }
});

test("the guide never has BIA doing something for the customer", () => {
  for (const s of guide) {
    assert.doesNotMatch(s.body, /\bI('ll| will) (book|cancel|pay|upload|change|update|send|submit)\b/i, s.title);
  }
});

test("questions land on the right section", () => {
  const top = (q: string) => matchAppGuide(guide, q)[0]?.title ?? "(none)";
  assert.equal(top("How do I change my mobile number?"), "Your profile and account details");
  assert.equal(top("Where can I download the shipping label?"), "Shipping labels and invoice");
  assert.equal(top("Can I export my shipments to a spreadsheet?"), "Your orders and shipments");
  assert.equal(top("How do I stop WhatsApp messages?"), "WhatsApp messages from Bombino");
  assert.equal(top("how do I turn off BIA reminders"), "Reminders from BIA");
  assert.equal(top("I didn't get the OTP"), "Signing in");
  assert.equal(top("where is the nearest counter to drop off"), "Drop-off counters");
  assert.deepEqual(matchAppGuide(guide, "xyzzy plugh"), []);
});

test("an answer carries the section's words, its buttons, and the rule to add nothing", () => {
  const out = executeGetAppHelp({ question: "How do I change my mobile number?" }, anon, FILE);
  assert.match(out.content, /Change number/);
  assert.match(out.content, /never say you'll do it/);
  const labels = executeGetAppHelp({ question: "drop-off counter near me" }, anon, FILE);
  assert.match(labels.content, /TAP_LOCATIONS/);
});

test("nothing matching lists what the guide covers and offers our team; no guide says it can't look it up", () => {
  const none = executeGetAppHelp({ question: "xyzzy plugh" }, anon, FILE);
  assert.match(none.content, /It covers: /);
  assert.match(none.content, /TAP_CONTACT_US/);
  const missing = executeGetAppHelp({ question: "labels" }, anon, path.resolve(process.cwd(), "content", "bia", "no-such-file.md"));
  assert.match(missing.content, /couldn't be read/);
});
