/**
 * Serving a stored document — the one place that decides the headers.
 *
 * Four copies of this block had drifted apart: the ops routes carried the full
 * set, `GET /api/kyc/me/file` carried none of the hardening, and two capability
 * routes interpolated `original_filename` into the header untouched. An
 * identity document is the worst thing in the database to serve carelessly, so
 * every route now goes through here.
 *
 * What the headers are for:
 *   no-store            re-uploads keep the capability id, so a cached copy goes stale
 *   noindex/nofollow    a leaked URL must not reach a search index
 *   nosniff             a browser must not be talked into executing a document
 *   no-referrer         the capability id must not travel in a Referer header
 */

import type { Request, Response } from "express";

/**
 * A filename safe to put inside a quoted header value. A quote would end the
 * value early and a control character could split the header, so both go, and
 * an empty result still needs a name.
 */
export function sanitizeContentFilename(name: string): string {
  const cleaned = name
    .replace(/["\\]/g, "")
    // Control characters are exactly what this is for: a CR or an LF in a
    // filename would split the header.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim();
  return cleaned || "document";
}

/**
 * A reviewer or customer asking to keep a copy rather than read it on screen.
 * `?download=1` on any document route: served as an attachment, and the caller
 * records it in the access log as a download rather than a view.
 */
export function wantsDownload(req: Request): boolean {
  const value = req.query.download;
  return value === "1" || value === "true";
}

export function sendDocumentFile(
  res: Response,
  doc: { mime_type: string; file_data: string; original_filename: string },
  disposition: "inline" | "attachment" = "inline"
): void {
  const buffer = Buffer.from(doc.file_data, "base64");
  res.set({
    "Content-Type": doc.mime_type,
    "Content-Length": String(buffer.length),
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Disposition": `${disposition}; filename="${sanitizeContentFilename(doc.original_filename)}"`,
  });
  res.send(buffer);
}
