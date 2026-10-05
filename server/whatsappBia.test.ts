import { test } from "node:test";
import assert from "node:assert/strict";

import { countMessage, historyFor, isDuplicate, WA_RATE_LIMIT_PER_HOUR, type WaConversation } from "./whatsappBiaStore.js";
import { greetingPart, localIndianNumber } from "./whatsappBia.js";
import { inboundMessageText } from "./routes/whatsapp.js";
import { NOT_ME_ID } from "../shared/whatsappBiaFormat.js";

const NOW = Date.parse("2026-10-05T10:00:00Z");

function conv(over: Partial<WaConversation> = {}): WaConversation {
  return {
    waNumber: "919876543210",
    messages: [],
    greetedAt: null,
    identityDeclined: false,
    recentMessageIds: [],
    windowStartedAt: null,
    windowCount: 0,
    lastInboundAt: null,
    ...over,
  };
}

test("only Indian mobiles can be an account here", () => {
  assert.equal(localIndianNumber("919876543210"), "9876543210");
  assert.equal(localIndianNumber("+91 98765 43210"), "9876543210");
  assert.equal(localIndianNumber("12125550100"), null);
  assert.equal(localIndianNumber("911234567890"), null);
});

test("a retried webhook is answered once", () => {
  assert.equal(isDuplicate(conv({ recentMessageIds: ["wamid.1"] }), "wamid.1"), true);
  assert.equal(isDuplicate(conv({ recentMessageIds: ["wamid.1"] }), "wamid.2"), false);
});

test("the hourly limit counts within the hour and resets after it", () => {
  let c = conv();
  for (let i = 0; i < WA_RATE_LIMIT_PER_HOUR; i++) {
    const r = countMessage(c, NOW + i * 1000);
    assert.equal(r.limited, false);
    c = r.next;
  }
  assert.equal(countMessage(c, NOW + 60_000).limited, true);
  assert.equal(countMessage(c, NOW + 61 * 60_000).limited, false);
});

test("an old conversation starts fresh", () => {
  const messages = [{ role: "user" as const, content: "hi" }];
  assert.deepEqual(historyFor(conv({ messages, lastInboundAt: new Date(NOW - 60_000).toISOString() }), NOW), messages);
  assert.deepEqual(historyFor(conv({ messages, lastInboundAt: new Date(NOW - 7 * 3600_000).toISOString() }), NOW), []);
});

test("the greeting masks the name and always offers the way out", () => {
  const g = greetingPart({ kind: "account", dbUserId: "u", user: { id: "1", email: "", fullName: "Aditya Kamarouthu", code: "" } });
  assert.equal(g?.kind, "buttons");
  if (g?.kind !== "buttons") return;
  assert.match(g.body, /A\*\*\*\*\* K\./);
  assert.doesNotMatch(g.body, /Aditya|Kamarouthu/);
  assert.deepEqual(g.buttons, [{ id: NOT_ME_ID, title: "Not me" }]);
  assert.equal(greetingPart({ kind: "visitor" }), null);
});

test("the webhook reads typed text, button taps and list picks", () => {
  assert.equal(inboundMessageText({ text: { body: " hello " } }), "hello");
  assert.equal(inboundMessageText({ interactive: { button_reply: { id: "s:Get rates", title: "Get rates" } } }), "s:Get rates");
  assert.equal(inboundMessageText({ interactive: { list_reply: { id: "s:Track", title: "Track" } } }), "s:Track");
  assert.equal(inboundMessageText({ button: { text: "Yes" } }), "Yes");
  assert.equal(inboundMessageText({ image: { id: "x" } }), null);
});
