/**
 * Confirm the Cashfree Smart OCR integration is wired up and the credentials
 * work, without spending a real document on it.
 *
 *   npx tsx --env-file=.env scripts/check-cashfree-ocr.ts
 *   npx tsx --env-file=.env scripts/check-cashfree-ocr.ts ./pan.jpg ABCDE1234F
 *
 * With no arguments it sends a 1x1 PNG. That cannot be a PAN card, so the
 * right answer is a NON-blocking `unreadable` — which still proves the base
 * URL, the header names and the credentials, because anything wrong there
 * comes back as `unavailable` with the HTTP status in `error`.
 *
 * With a file argument it runs the real check against that file and number.
 * Point it at your own document, never a customer's.
 *
 * Every call is billed against the VRS balance of whichever environment
 * CASHFREE_VRS_ENV names. It defaults to sandbox.
 */

import fs from "node:fs";
import path from "node:path";
import { isOcrBypassed, isOcrConfigured, runSmartOcr } from "../server/cashfreeOcr.js";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".pdf": "application/pdf",
};

async function main(): Promise<void> {
  // With the bypass on, runSmartOcr never calls Cashfree — so this script
  // would report a healthy-looking `bypassed` and prove nothing about the
  // credentials. Say so instead of pretending to have checked.
  if (isOcrBypassed()) {
    console.error(
      "OCR_BYPASS=1 is set: documents are stored WITHOUT verification and no\n" +
        "call is made to Cashfree. Unset it to exercise the real OCR path."
    );
    process.exit(1);
  }

  if (!isOcrConfigured()) {
    console.error(
      "CASHFREE_VRS_CLIENT_ID / CASHFREE_VRS_CLIENT_SECRET are not set.\n" +
        "OCR is disabled in this state: uploads still succeed and are stored as unverified."
    );
    process.exit(1);
  }

  // `<number>` alone is allowed: the sandbox returns the same canned PAN for
  // any image, so typing that number is how you exercise the match path
  // without owning a document. `<file> <number>` runs the real thing.
  // --type=AADHAAR etc. The sandbox answers with canned data per type, so this
  // is how you find out what number to type to exercise the match path.
  const allArgs = process.argv.slice(2);
  const typeArg = allArgs.find((a) => a.startsWith("--type="));
  const documentType = (typeArg?.split("=")[1]?.toUpperCase() ?? "PAN") as
    | "PAN"
    | "AADHAAR"
    | "DRIVING_LICENCE"
    | "VOTER_ID"
    | "PASSPORT";
  const args = allArgs.filter((a) => !a.startsWith("--"));
  const firstIsFile = args[0] !== undefined && fs.existsSync(path.resolve(args[0]));
  const filePath = firstIsFile ? args[0] : undefined;
  const typedNumber = firstIsFile ? args[1] : args[0];
  const env = process.env.CASHFREE_VRS_ENV === "production" ? "PRODUCTION" : "sandbox";

  let file = ONE_PIXEL_PNG;
  let filename = "smoke.png";
  let mimeType = "image/png";
  let number = typedNumber ?? "ABCDE1234F";

  if (filePath) {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
      console.error(`No such file: ${resolved}`);
      process.exit(1);
    }
    file = fs.readFileSync(resolved);
    filename = path.basename(resolved);
    mimeType = MIME_BY_EXT[path.extname(resolved).toLowerCase()] ?? "image/jpeg";
    if (!typedNumber) {
      console.error("Pass the number printed on the document as the second argument.");
      process.exit(1);
    }
    number = typedNumber;
  }

  console.log(`environment : ${env}`);
  console.log(`document    : ${documentType}`);
  console.log(`file        : ${filename} (${file.length} bytes, ${mimeType})`);
  console.log(`typed number: ${number}`);
  console.log("calling Smart OCR…\n");

  const result = await runSmartOcr({
    documentType,
    typedNumber: number,
    file,
    filename,
    mimeType,
    tag: "check",
  });

  console.log(JSON.stringify(result, null, 2));
  console.log(
    `\nverdict: ${result.status}${result.blocking ? " (would REFUSE the upload)" : " (would allow the upload)"}`
  );
}

void main();
