/**
 * Exercise both halves of the GST check without going through signup.
 *
 *   npx tsx --env-file=.env scripts/check-gst.ts verify 29AAICP2912R1ZR "UJJIVAN SMALL FINANCE BANK"
 *   npx tsx --env-file=.env scripts/check-gst.ts read ./gst-certificate.pdf 29AAICP2912R1ZR
 *
 * `verify` is the GST portal lookup (Cashfree /verification/gstin). `read` is
 * the certificate reader (server/gstCertificate.ts) — the PDF text layer, then
 * an OpenAI vision call if the file is an image with no text to extract.
 *
 * Sandbox test GSTINs (docs.cashfree.com — "VRS Sandbox Test Data"). Anything
 * else fails there regardless of whether it is real:
 *
 *   valid    29AAICP2912R1ZR, 05BBICP2912R1ZR
 *   invalid  29AAIZP2912R1ZR, 05BBICA2912R1ZR
 *
 * The lookup is billed against the VRS balance of whichever environment
 * CASHFREE_VRS_ENV names; `read` costs nothing unless it reaches the vision
 * fallback.
 */

import fs from "node:fs";
import path from "node:path";
import { isIdentityBypassed, isIdentityConfigured, verifyGstin } from "../server/cashfreeIdentity.js";
import { checkGstCertificate } from "../server/gstCertificate.js";

const MIME_BY_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

async function main(): Promise<void> {
  const [mode, ...args] = process.argv.slice(2);

  if (mode === "verify") {
    if (isIdentityBypassed("gstin")) {
      console.error(
        'IDENTITY_BYPASS includes "gstin": no GST portal lookup is made and any GSTIN\n' +
          "passes. Drop gstin from the flag to exercise the real path."
      );
      process.exit(1);
    }
    if (!isIdentityConfigured()) {
      console.error("CASHFREE_VRS_CLIENT_ID / CASHFREE_VRS_CLIENT_SECRET are not set.");
      process.exit(1);
    }

    const gstin = args[0];
    const name = args[1];
    if (!gstin || !name) {
      console.error('Usage: check-gst.ts verify <GSTIN> "<company name>"');
      process.exit(1);
    }

    const env = process.env.CASHFREE_VRS_ENV === "production" ? "PRODUCTION" : "sandbox";
    console.log(`environment : ${env}`);
    console.log(`GSTIN       : ${gstin}`);
    console.log(`company     : ${name}`);
    console.log("calling /verification/gstin…\n");

    const result = await verifyGstin(gstin, name);
    console.log(JSON.stringify(result, null, 2));
    console.log(
      `\nverdict: ${result.ok ? "VERIFIED" : `${result.failure.toUpperCase()} — would refuse`}`
    );
    return;
  }

  if (mode === "read") {
    const filePath = args[0];
    const expected = args[1];
    if (!filePath || !expected) {
      console.error("Usage: check-gst.ts read <file> <expected GSTIN>");
      process.exit(1);
    }
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
      console.error(`No such file: ${resolved}`);
      process.exit(1);
    }
    const mimeType = MIME_BY_EXT[path.extname(resolved).toLowerCase()] ?? "application/pdf";
    const file = fs.readFileSync(resolved);

    console.log(`file     : ${path.basename(resolved)} (${file.length} bytes, ${mimeType})`);
    console.log(`expected : ${expected}`);
    console.log("reading…\n");

    const check = await checkGstCertificate({ file, mimeType, verifiedGstin: expected });
    console.log(JSON.stringify(check, null, 2));
    console.log(
      `\nverdict: ${check.status}${check.blocking ? " (would REFUSE the upload)" : " (would allow the upload)"}` +
        `${check.source ? ` — read via ${check.source}` : ""}`
    );
    return;
  }

  console.error(
    "Usage:\n" +
      '  check-gst.ts verify <GSTIN> "<company name>"\n' +
      "  check-gst.ts read <file> <expected GSTIN>"
  );
  process.exit(1);
}

void main();
