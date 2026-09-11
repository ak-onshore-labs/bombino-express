import { test } from "node:test";
import assert from "node:assert/strict";
import { ALL_TOOLS, dispatchTool, toolName, toolsForTurn } from "./supportTools.js";
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

const names = (tools: readonly (typeof ALL_TOOLS)[number][]): string[] => tools.map(toolName).sort();

test("every tool has a unique name and a module", () => {
  const all = ALL_TOOLS.map(toolName);
  assert.equal(new Set(all).size, all.length);
  assert.ok(all.every((n) => n.length > 0));
});

test("the 2.0 tool set is what customers get by default", () => {
  assert.deepEqual(names(toolsForTurn(null, ["orders"]).tools), [
    "check_pickup",
    "escalate_support",
    "get_my_kyc_status",
    "get_order_status",
    "get_rates",
    "get_shipment_guidance",
    "get_tracking_summary",
    "list_my_orders",
  ]);
});

test("switching orders off takes its tools away", () => {
  const { modules, tools } = toolsForTurn(null, []);
  assert.deepEqual(modules, []);
  assert.ok(!names(tools).includes("list_my_orders"));
  assert.ok(names(tools).includes("get_rates"), "general tools stay");
});

test("a withheld tool does not run, even when the model names it", async () => {
  const { tools } = toolsForTurn(null, []);
  const outcome = await dispatchTool("list_my_orders", {}, anon, tools);
  assert.match(outcome.content, /Something went wrong/);
});

test("an old name still reaches its tool", async () => {
  const outcome = await dispatchTool("get_user_shipments", {}, anon);
  assert.match(outcome.content, /not signed in/i);
});

test("unknown tools and odd arguments get the safe reply, never a throw", async () => {
  assert.match((await dispatchTool("drop_tables", {}, anon)).content, /Something went wrong/);
  const outcome = await dispatchTool("check_pickup", ["not", "an", "object"], anon);
  assert.match(outcome.content, /6-digit/);
});
