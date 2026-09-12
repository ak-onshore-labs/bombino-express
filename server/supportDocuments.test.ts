import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describeSummary,
  executeExplainDocumentIssue,
  executeGetDocumentStatus,
  executeOfferDocumentUpload,
  executeGetSignupProgress,
  inferShape,
  replaceSignupLoader,
  summarizeDocuments,
} from "./supportDocuments.js";
import type { SupportChatContext } from "./supportTypes.js";
import { ERROR_CATALOG } from "../shared/errorCatalog.js";

const anon: SupportChatContext = {
  user: null,
  itdToken: null,
  dbUserId: null,
  sessionId: null,
  guestRef: null,
  guestPhone: null,
  screen: null,
};

// A half-finished e-commerce signup: PAN matched, the GST certificate unreadable,
// the IEC certificate in, the authorization letter still to come.
const NUMBERS = [
  { kind: "pan", document_no: "ABCPE1234K" },
  { kind: "gstin", document_no: "27ABCPE1234K1Z5" },
];
const DOCS = [
  { doc_slot: "pan_card", ocr_status: "match" },
  { doc_slot: "gst_certificate", ocr_status: "unreadable" },
  { doc_slot: "iec_certificate", ocr_status: "skipped" },
];

test("a half-finished e-commerce signup reads as 3 of 4, one needing a clearer photo", () => {
  const s = summarizeDocuments("ecommerce", NUMBERS, DOCS);
  assert.equal(s.uploaded, 3);
  assert.equal(s.total, 4);
  assert.deepEqual(
    s.items.map((i) => [i.slot, i.state]),
    [
      ["gst_certificate", "attention"],
      ["iec_certificate", "on_file"],
      ["pan_card", "on_file"],
      ["authorization_letter", "missing"],
    ]
  );
  const text = describeSummary(s);
  assert.match(text, /3 of 4 uploaded/);
  assert.match(text, /PAN ending 234K/);
  assert.match(text, /GST number ending K1Z5/);
  assert.match(text, /couldn't be read/i);
  assert.doesNotMatch(text, /ABCPE|27ABC/, "no more than the last four");
});

test("bypassed and skipped are simply on file, with no word about checking", () => {
  const s = summarizeDocuments("personal", [], [
    { doc_slot: "aadhaar_card", ocr_status: "bypassed" },
    { doc_slot: "pan_card", ocr_status: "skipped" },
  ]);
  assert.deepEqual(s.items.map((i) => [i.state, i.note]), [
    ["on_file", null],
    ["on_file", null],
  ]);
  assert.doesNotMatch(describeSummary(s), /verif|check|bypass|skip|match/i);
});

test("an unknown company category lists what every company needs, with no total", () => {
  const s = summarizeDocuments("company", [], [{ doc_slot: "electricity_bill", ocr_status: "skipped" }]);
  assert.equal(s.total, null);
  assert.deepEqual(s.items.map((i) => i.slot), [
    "gst_certificate",
    "iec_certificate",
    "pan_card",
    "authorization_letter",
    "electricity_bill",
  ]);
  assert.match(describeSummary(s), /depends on the account type/);
});

test("the shape is inferred from what's recorded, and left open when it can't be", () => {
  assert.equal(inferShape([{ kind: "gstin", document_no: "x" }], []), "company");
  assert.equal(inferShape([{ kind: "aadhaar", document_no: "x" }], []), "personal");
  assert.equal(inferShape([{ kind: "pan", document_no: "x" }], []), null);
});

test("signup progress reads the session's own signup and hands back to signup", async () => {
  replaceSignupLoader(async (ref) => {
    assert.equal(ref, "ref-1");
    return { numbers: NUMBERS, documents: DOCS };
  });
  try {
    // On the signup screen, which says the account: the full list, and no
    // button, since they're already where it would go.
    const onSignup = await executeGetSignupProgress({ ...anon, signupRef: "ref-1", screen: { surface: "signup", account: "ecommerce" } });
    assert.match(onSignup.content, /E-commerce account/);
    assert.doesNotMatch(onSignup.content, /TAP_RESUME_SIGNUP/);
    const card = onSignup.cards?.[0];
    assert.ok(card && card.kind === "docStatus");
    assert.equal(card.done, 3);
    assert.equal(card.total, 4);
    assert.doesNotMatch(JSON.stringify(card), /ABCPE|27ABC/);

    // Anywhere else only "a company" is known, and the button goes back to it.
    const fromHelp = await executeGetSignupProgress({ ...anon, signupRef: "ref-1", screen: { surface: "help" } });
    assert.match(fromHelp.content, /company account/);
    assert.match(fromHelp.content, /^TAP_RESUME_SIGNUP:company$/m);
    const helpCard = fromHelp.cards?.[0];
    assert.ok(helpCard && helpCard.kind === "docStatus");
    assert.equal(helpCard.total, null);
  } finally {
    replaceSignupLoader(null);
  }
});

test("only a number recorded, account kind unknown: the number, and no empty card", async () => {
  replaceSignupLoader(async () => ({ numbers: [{ kind: "pan", document_no: "ABCPE1234K" }], documents: [] }));
  try {
    const outcome = await executeGetSignupProgress({ ...anon, signupRef: "ref-2", screen: { surface: "help" } });
    assert.match(outcome.content, /PAN ending 234K/);
    assert.equal(outcome.cards, undefined);
  } finally {
    replaceSignupLoader(null);
  }
});

test("no signup under way, or an account holder, gets no lookup", async () => {
  let called = false;
  replaceSignupLoader(async () => {
    called = true;
    return { numbers: [], documents: [] };
  });
  try {
    const none = (await executeGetSignupProgress(anon)).content;
    assert.match(none, /Nothing has been recorded/);
    // They may well have verified already: never send them to the Ship screen for it.
    assert.doesNotMatch(none, /verify(ing)? their phone on the Ship/);
    const account = { ...anon, user: { id: "c", email: "", fullName: "", code: "" }, dbUserId: "u1", signupRef: "ref-1" };
    assert.match((await executeGetSignupProgress(account)).content, /get_document_status/);
    assert.equal(called, false);
  } finally {
    replaceSignupLoader(null);
  }
});

test("document status is for accounts; a guest and a visitor are pointed elsewhere", async () => {
  assert.match((await executeGetDocumentStatus(anon)).content, /aren't signed in/);
  assert.match((await executeGetDocumentStatus({ ...anon, guestRef: "g1" })).content, /get_my_kyc_status/);
});

test("a checked document with no verdict at all is asked for again, as the upload screen asks", () => {
  const s = summarizeDocuments("personal", [], [
    { doc_slot: "aadhaar_card", ocr_status: null },
    { doc_slot: "pan_card", ocr_status: "bypassed" },
  ]);
  const aadhaar = s.items.find((i) => i.slot === "aadhaar_card");
  assert.equal(aadhaar?.state, "attention");
  assert.equal(aadhaar?.note, ERROR_CATALOG.DOCUMENTS_UNVERIFIED.title);
  assert.equal(s.items.find((i) => i.slot === "pan_card")?.state, "on_file");
});

const accountCtx: SupportChatContext = {
  ...anon,
  user: { id: "c", email: "", fullName: "", code: "" },
  dbUserId: "u1",
};

test("explain_document_issue words a problem the way the upload screen does", () => {
  const out = executeExplainDocumentIssue({ issue: "unreadable" }, accountCtx).content;
  assert.match(out, new RegExp(ERROR_CATALOG.OCR_UNREADABLE.title));
  assert.ok(out.includes(ERROR_CATALOG.OCR_UNREADABLE.fix));
  assert.match(out, /Profile/);
  assert.match(out, /TAP_ACCOUNT_DOCUMENTS/);
  // Already on the documents screen: no button back to it.
  const here = executeExplainDocumentIssue({ issue: "unreadable" }, { ...accountCtx, screen: { surface: "documents" } });
  assert.doesNotMatch(here.content, /TAP_ACCOUNT_DOCUMENTS/);
});

test("with no issue named, the one on screen is explained; with neither, BIA asks", () => {
  const onScreen = executeExplainDocumentIssue({}, { ...anon, screen: { surface: "signup", errorCode: "OCR_TAMPERED" } });
  assert.match(onScreen.content, new RegExp(ERROR_CATALOG.OCR_TAMPERED.title));
  assert.match(onScreen.content, /signup's documents step/);
  assert.match(executeExplainDocumentIssue({ issue: "made_up" }, anon).content, /word for word/);
  // A non-document error on screen isn't this tool's to explain.
  const otp = executeExplainDocumentIssue({}, { ...anon, screen: { surface: "signup", errorCode: "OTP_RATE_LIMITED" } });
  assert.match(otp.content, /word for word/);
});

test("a guest is sent back to the booking form's identity upload, never to an account's Profile", () => {
  const out = executeExplainDocumentIssue({ issue: "mismatch" }, { ...anon, guestRef: "g1" }).content;
  assert.match(out, /booking form/);
  assert.doesNotMatch(out, /TAP_ACCOUNT_DOCUMENTS|Profile/);
});

// Only the branches that return before any lookup: the rest read the shared
// database, and are covered by the evals (documents.json) instead.
test("no upload card for someone signed out, or for a signup: signup's own screen does those", async () => {
  const signedOut = await executeOfferDocumentUpload({ document: "aadhaar_card" }, anon);
  assert.equal(signedOut.cards, undefined);
  assert.match(signedOut.content, /aren't signed in/);
  const signingUp = await executeOfferDocumentUpload({ document: "pan_card" }, { ...anon, signupRef: "ref-1" });
  assert.equal(signingUp.cards, undefined);
  assert.match(signingUp.content, /signup's documents step/);
});

test("an account must name a real document before a card is offered", async () => {
  const out = await executeOfferDocumentUpload({ document: "passport" }, accountCtx);
  assert.equal(out.cards, undefined);
  assert.match(out.content, /Ask which document/);
});
