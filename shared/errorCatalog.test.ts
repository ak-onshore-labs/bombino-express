import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ERROR_CATALOG,
  UNCATALOGUED_CODES,
  explainError,
  identityFailureCode,
  isErrorCode,
  ocrErrorCode,
} from "./errorCatalog.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Every server file that answers requests with `{ message, code }`.
 *
 * Scanned, not listed: a hand-written list goes stale the moment a handler
 * moves to a new module — which is exactly what happened when the lifecycle
 * arms were lifted out of `routes.ts` into `orderActions.ts`.
 */
function serverSources(): { file: string; text: string }[] {
  const isSource = (f: string): boolean => f.endsWith(".ts") && !f.endsWith(".test.ts");
  const files = [
    ...fs
      .readdirSync(path.join(root, "server"))
      .filter(isSource)
      .map((f) => `server/${f}`),
    ...fs
      .readdirSync(path.join(root, "server/routes"))
      .filter(isSource)
      .map((f) => `server/routes/${f}`),
  ];
  return files.map((file) => ({ file, text: fs.readFileSync(path.join(root, file), "utf8") }));
}

/**
 * The codes a file sends: `code: "X"` literals (a zod refinement's
 * `params: { code: "X" }` included), and `code: SOME_CONST` resolved through a
 * `const SOME_CONST = "x"` in the same file.
 */
function codesIn(text: string): string[] {
  const found = new Set<string>();
  // Upper case only: `code: "en"` in a WhatsApp template is a language tag.
  for (const m of text.matchAll(/\bcode:\s*"([A-Z][A-Z0-9_]*)"/g)) found.add(m[1]);
  for (const m of text.matchAll(/\bcode:\s*([A-Z][A-Z0-9_]+)\s*[,}\n]/g)) {
    // Also upper case: `const LANGUAGE_CODE = "en"` is not an error code.
    const def = text.match(new RegExp(`const ${m[1]}\\s*=\\s*"([A-Z][A-Z0-9_]*)"`));
    if (def) found.add(def[1]);
  }
  return [...found];
}

test("every code the server sends is explained or knowingly left out", () => {
  const uncatalogued = new Set<string>(UNCATALOGUED_CODES);
  const unknown: string[] = [];
  for (const { file, text } of serverSources()) {
    for (const code of codesIn(text)) {
      if (!isErrorCode(code) && !uncatalogued.has(code)) unknown.push(`${code} (${file})`);
    }
  }
  assert.deepEqual(unknown, [], "add these to ERROR_CATALOG, or to UNCATALOGUED_CODES if no customer sees them");
});

test("the uncatalogued list holds only codes that exist and aren't catalogued", () => {
  const sent = new Set(serverSources().flatMap(({ text }) => codesIn(text)));
  for (const code of UNCATALOGUED_CODES) {
    assert.ok(!isErrorCode(code), `${code} is in both lists`);
    assert.ok(sent.has(code), `${code} is no longer sent by any route; drop it from UNCATALOGUED_CODES`);
  }
});

test("phone_unverified keeps its lowercase name, which Signup.tsx matches on", () => {
  assert.ok(isErrorCode("phone_unverified"));
});

test("every explanation is complete and written to the customer", () => {
  for (const [code, e] of Object.entries(ERROR_CATALOG)) {
    for (const field of ["title", "why", "fix"] as const) {
      assert.ok(e[field].trim().length > 0, `${code}.${field} is empty`);
      assert.doesNotMatch(e[field], /!/, `${code}.${field} shouts`);
    }
    assert.doesNotMatch(e.title, /\.$/, `${code}.title ends with a full stop`);
    assert.match(e.fix, /\.$/, `${code}.fix is not a sentence`);
    assert.doesNotMatch(`${e.why} ${e.fix}`, /\b(your fault|you failed|invalid request)\b/i, `${code} blames`);
  }
});

test("document verdicts map to codes, and the harmless ones to nothing", () => {
  assert.equal(ocrErrorCode("mismatch"), "OCR_MISMATCH");
  assert.equal(ocrErrorCode("wrong_document"), "OCR_WRONG_DOCUMENT");
  assert.equal(ocrErrorCode("tampered"), "OCR_TAMPERED");
  assert.equal(ocrErrorCode("unreadable"), "OCR_UNREADABLE");
  assert.equal(ocrErrorCode("unavailable"), "OCR_UNAVAILABLE");
  for (const quiet of ["match", "bypassed", "skipped", null, undefined, "something new"]) {
    assert.equal(ocrErrorCode(quiet), null, String(quiet));
  }
});

test("identity failures map to catalogued codes", () => {
  for (const failure of ["rejected", "expired", "unavailable"]) {
    assert.ok(isErrorCode(identityFailureCode(failure)), failure);
  }
});

test("explainError answers only for catalogued codes", () => {
  assert.equal(explainError("KYC_REQUIRED")?.area, "booking");
  assert.equal(explainError("FORBIDDEN"), null);
  assert.equal(explainError(null), null);
});
