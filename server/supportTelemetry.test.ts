import { test } from "node:test";
import assert from "node:assert/strict";
import { rateTurn, recordTurn } from "./supportTelemetry.js";

// Unit tests run without a database, which is exactly the state before the
// migration has run: both calls must shrug it off.

test("recording a turn without a database resolves quietly", async () => {
  await recordTurn({
    id: "00000000-0000-4000-8000-000000000001",
    sessionId: null,
    ownerKind: "anon",
    userId: null,
    guestRef: null,
    surface: "help",
    step: null,
    errorCode: null,
    modules: ["orders"],
    tools: [],
    cardKinds: [],
    latencyMs: 1200,
    fallback: false,
    promptTokens: 1,
    completionTokens: 1,
  });
});

test("rating without a database reads as not found", async () => {
  assert.equal(await rateTurn("00000000-0000-4000-8000-000000000001", 1, { kind: "anon" }), "not_found");
});
