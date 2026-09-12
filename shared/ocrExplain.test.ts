import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ERROR_CATALOG } from "./errorCatalog.js";
import {
  DOCUMENT_ISSUE_NAMES,
  OCR_VERDICTS,
  explainDocumentIssue,
  explainDocumentIssueByName,
  isDocumentIssueName,
  type OcrVerdict,
} from "./ocrExplain.js";

test("the shared verdict list is exactly the server's OcrStatus union", () => {
  // Read from the source: test files aren't type-checked, and the client
  // can't import the server's type.
  const source = readFileSync(new URL("../server/cashfreeOcr.ts", import.meta.url), "utf8");
  const union = source.match(/export type OcrStatus =([\s\S]*?);/)?.[1] ?? "";
  const members = [...union.matchAll(/\|\s*"([a-z_]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(members, [...OCR_VERDICTS].sort());
});

test("every verdict has an answer: silence for match, bypassed and skipped; an explanation for the rest", () => {
  const expected: Record<OcrVerdict, string | null> = {
    match: null,
    bypassed: null,
    skipped: null,
    mismatch: "OCR_MISMATCH",
    wrong_document: "OCR_WRONG_DOCUMENT",
    tampered: "OCR_TAMPERED",
    unreadable: "OCR_UNREADABLE",
    unavailable: "OCR_UNAVAILABLE",
  };
  for (const verdict of OCR_VERDICTS) {
    assert.equal(explainDocumentIssue({ verdict })?.code ?? null, expected[verdict], verdict);
  }
});

test("the words are the error catalog's", () => {
  const issue = explainDocumentIssue({ verdict: "unreadable" });
  assert.ok(issue);
  assert.equal(issue.headline, ERROR_CATALOG.OCR_UNREADABLE.title);
  assert.equal(issue.why, ERROR_CATALOG.OCR_UNREADABLE.why);
  assert.equal(issue.fix, ERROR_CATALOG.OCR_UNREADABLE.fix);
});

test("an outage isn't a bad photo: its retry doesn't ask for a clearer one", () => {
  assert.equal(explainDocumentIssue({ verdict: "unavailable" })?.retryLabel, "Try again");
  assert.equal(explainDocumentIssue({ verdict: "unreadable" })?.retryLabel, "Upload a clearer photo");
  assert.equal(explainDocumentIssue({ verdict: "wrong_document" })?.retryLabel, "Upload the right document");
});

test("a code names the problem exactly, and wins over the verdict", () => {
  assert.equal(explainDocumentIssue({ code: "DOCUMENTS_OUTDATED", verdict: "match" })?.code, "DOCUMENTS_OUTDATED");
  assert.equal(explainDocumentIssue({ code: "GSTIN_CHANGED" })?.headline, ERROR_CATALOG.GSTIN_CHANGED.title);
  assert.equal(explainDocumentIssue({ code: "IDENTITY_NUMBER_FIRST" })?.code, "IDENTITY_NUMBER_FIRST");
});

test("anything that isn't a document problem is left to the screen's own message", () => {
  assert.equal(explainDocumentIssue({ code: "OTP_RATE_LIMITED" }), null);
  assert.equal(explainDocumentIssue({ code: "FILE_MISSING" }), null, "a form error, worded well already");
  assert.equal(explainDocumentIssue({ code: "NOT_A_CODE" }), null);
  assert.equal(explainDocumentIssue({ verdict: "something_new" }), null);
  assert.equal(explainDocumentIssue({}), null);
  // An unknown code falls back to the verdict.
  assert.equal(explainDocumentIssue({ code: "NOT_A_CODE", verdict: "tampered" })?.code, "OCR_TAMPERED");
});

test("every issue BIA can name explains itself from the catalog", () => {
  for (const name of DOCUMENT_ISSUE_NAMES) {
    const issue = explainDocumentIssueByName(name);
    assert.equal(issue.headline, ERROR_CATALOG[issue.code].title, name);
    assert.ok(issue.fix.length > 0, name);
  }
  assert.equal(isDocumentIssueName("unreadable"), true);
  assert.equal(isDocumentIssueName("constructor"), false);
});
