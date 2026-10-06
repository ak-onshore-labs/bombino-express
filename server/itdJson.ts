/**
 * Read an ITD reply body as JSON without losing it when it is not.
 *
 * ITD answers 200 with text that is not JSON (BOM-100333: a reply starting
 * "COMPANY NO..."). `res.json()` threw on it and the body was gone, so nobody
 * could tell what ITD said, or whether it had filed the docket anyway.
 *
 * Two cases:
 *   - Text printed ahead of a normal JSON reply (a PHP notice or debug echo).
 *     The JSON after it is ITD's real answer, AWB included, so it is used and
 *     the leading text is logged.
 *   - No JSON at all. Throws with the body itself in the message, so it lands
 *     in the logs and in `metadata.docket_error`.
 */

const BODY_IN_ERROR = 400;

export function parseItdJson<T>(body: string, label: string): T {
  try {
    return JSON.parse(body) as T;
  } catch {
    // fall through
  }

  const start = body.search(/[{[]/);
  if (start > 0) {
    try {
      const parsed = JSON.parse(body.slice(start)) as T;
      console.warn(`[ITD ${label}] reply had text before its JSON: ${body.slice(0, start).trim().slice(0, BODY_IN_ERROR)}`);
      return parsed;
    } catch {
      // fall through
    }
  }

  const text = body.trim();
  console.error(`[ITD ${label}] reply is not JSON:`, text);
  throw new Error(
    `ITD ${label} replied with something that is not JSON: ${text.slice(0, BODY_IN_ERROR) || "(empty reply)"}`
  );
}
