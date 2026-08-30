/**
 * Check an Aadhaar or PAN the way signup will.
 *
 *   npx tsx --env-file=.env scripts/check-cashfree-identity.ts aadhaar 234567890124
 *   npx tsx --env-file=.env scripts/check-cashfree-identity.ts pan ABCPV1234D
 *
 * NEITHER MODE CALLS CASHFREE ANY MORE, and neither costs anything. There is
 * nothing left here to call: the DigiLocker journey, Offline Aadhaar
 * Verification and the Income Tax PAN lookup have all been removed, so an
 * Aadhaar or a PAN is only ever checked for its own shape. These modes
 * exercise those validators, which are the entire server-side check on each
 * number — see shared/aadhaar.ts and isValidPanNumber.
 *
 * The one number still verified with an authority is the GSTIN. It has its
 * own script: scripts/check-gst.ts.
 */

import { isValidPanNumber } from "../server/cashfreeIdentity.js";
import { validateAadhaar } from "../shared/aadhaar.js";

const UNVERIFIED_NOTE =
  "Nothing has confirmed it is issued, or whose it is. The document uploaded " +
  "at the next step must carry it, and OCR reads numbers, never names.";

async function main(): Promise<void> {
  const [mode, ...args] = process.argv.slice(2);

  if (mode === "aadhaar") {
    const aadhaar = args[0];
    if (!aadhaar) {
      console.error("Usage: check-cashfree-identity.ts aadhaar <12-digit number>");
      process.exit(1);
    }
    console.log(`Aadhaar : ${aadhaar}`);
    console.log("no call is made — the number is only checked for its Verhoeff check digit\n");

    const result = validateAadhaar(aadhaar);
    console.log(JSON.stringify(result, null, 2));
    console.log(
      `\nverdict: ${
        result.valid
          ? `WELL-FORMED — accepted at signup and recorded self_declared. ${UNVERIFIED_NOTE}`
          : "REJECTED — the form would refuse this"
      }`
    );
    return;
  }

  if (mode === "pan") {
    const pan = args[0];
    if (!pan) {
      console.error("Usage: check-cashfree-identity.ts pan <10-character PAN>");
      process.exit(1);
    }
    console.log(`PAN : ${pan}`);
    console.log("no call is made — the Income Tax lookup was removed\n");

    const valid = isValidPanNumber(pan);
    console.log(JSON.stringify({ valid }, null, 2));
    console.log(
      `\nverdict: ${
        valid
          ? `WELL-FORMED — accepted at signup and recorded self_declared. ${UNVERIFIED_NOTE}`
          : "REJECTED — the form would refuse this"
      }`
    );
    return;
  }

  console.error(
    "Usage:\n" +
      "  check-cashfree-identity.ts aadhaar <12-digit number>\n" +
      "  check-cashfree-identity.ts pan <10-character PAN>\n" +
      "\nBoth are offline. For the GSTIN check, which does call out, see scripts/check-gst.ts."
  );
  process.exit(1);
}

void main();
