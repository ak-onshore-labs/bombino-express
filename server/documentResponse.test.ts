import { test } from "node:test";
import assert from "node:assert/strict";

import {
  sanitizeContentFilename,
  sendDocumentFile,
  wantsDownload,
} from "./documentResponse.js";

type SentResponse = {
  headers: Record<string, string>;
  body: Buffer | null;
};

/** Enough of an Express response for the two calls this module makes. */
function fakeRes(): { res: any; sent: SentResponse } {
  const sent: SentResponse = { headers: {}, body: null };
  const res = {
    set(headers: Record<string, string>) {
      Object.assign(sent.headers, headers);
      return res;
    },
    send(buffer: Buffer) {
      sent.body = buffer;
      return res;
    },
  };
  return { res, sent };
}

const doc = {
  mime_type: "application/pdf",
  file_data: Buffer.from("a pdf, honestly").toString("base64"),
  original_filename: "pan.pdf",
};

test("a document is served with every hardening header", () => {
  const { res, sent } = fakeRes();
  sendDocumentFile(res, doc);

  assert.equal(sent.headers["Content-Type"], "application/pdf");
  assert.equal(sent.headers["Cache-Control"], "no-store");
  assert.equal(sent.headers["X-Content-Type-Options"], "nosniff");
  assert.equal(sent.headers["X-Robots-Tag"], "noindex, nofollow, noarchive");
  assert.equal(sent.headers["Referrer-Policy"], "no-referrer");
  assert.equal(sent.headers["Content-Disposition"], 'inline; filename="pan.pdf"');
  assert.equal(sent.headers["Content-Length"], String(sent.body?.length));
  assert.equal(sent.body?.toString(), "a pdf, honestly");
});

test("a download is an attachment, otherwise identical", () => {
  const { res, sent } = fakeRes();
  sendDocumentFile(res, doc, "attachment");
  assert.equal(sent.headers["Content-Disposition"], 'attachment; filename="pan.pdf"');
  assert.equal(sent.headers["X-Content-Type-Options"], "nosniff");
});

test("a filename cannot end the header value or split the header", () => {
  assert.equal(sanitizeContentFilename('pan".pdf'), "pan.pdf");
  assert.equal(sanitizeContentFilename("pan\r\nX-Evil: 1.pdf"), "pan  X-Evil: 1.pdf");
  assert.equal(sanitizeContentFilename("back\\slash.pdf"), "backslash.pdf");
  assert.equal(sanitizeContentFilename("   "), "document");
});

test("a crafted filename survives the round trip into the header", () => {
  const { res, sent } = fakeRes();
  sendDocumentFile(res, { ...doc, original_filename: 'evil".pdf' });
  assert.equal(sent.headers["Content-Disposition"], 'inline; filename="evil.pdf"');
});

test("download is asked for explicitly, never by accident", () => {
  const ask = (query: Record<string, unknown>): boolean => wantsDownload({ query } as any);
  assert.equal(ask({ download: "1" }), true);
  assert.equal(ask({ download: "true" }), true);
  assert.equal(ask({ download: "0" }), false);
  assert.equal(ask({}), false);
  // An array arrives when the parameter is repeated; that is not a yes.
  assert.equal(ask({ download: ["1", "1"] }), false);
});
