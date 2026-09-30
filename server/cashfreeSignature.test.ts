import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { cashfreeSignatureHeader, normalisePublicKeyPem } from "./cashfreeSignature.js";

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = publicKey.export({ type: "spki", format: "pem" }).toString();
const NOW = new Date("2026-09-30T10:00:00Z");

function decrypt(signature: string): string {
  return crypto
    .privateDecrypt(
      { key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha1" },
      Buffer.from(signature, "base64")
    )
    .toString("utf8");
}

test("Cashfree x-cf-signature", async (t) => {
  const saved = process.env.CASHFREE_VRS_PUBLIC_KEY;
  t.after(() => {
    if (saved === undefined) delete process.env.CASHFREE_VRS_PUBLIC_KEY;
    else process.env.CASHFREE_VRS_PUBLIC_KEY = saved;
  });

  await t.test("no key, no header", () => {
    delete process.env.CASHFREE_VRS_PUBLIC_KEY;
    assert.deepEqual(cashfreeSignatureHeader("CF123", NOW), {});
  });

  await t.test("signs clientId.unixSeconds with OAEP SHA-1", () => {
    process.env.CASHFREE_VRS_PUBLIC_KEY = PEM;
    const header = cashfreeSignatureHeader("CF123", NOW);
    assert.equal(decrypt(header["x-cf-signature"]), `CF123.${NOW.getTime() / 1000}`);
  });

  await t.test("accepts a PEM pasted with literal \\n", () => {
    process.env.CASHFREE_VRS_PUBLIC_KEY = PEM.trim().replace(/\n/g, "\\n");
    const header = cashfreeSignatureHeader("CF123", NOW);
    assert.equal(decrypt(header["x-cf-signature"]), `CF123.${NOW.getTime() / 1000}`);
  });

  await t.test("accepts the bare base64 body", () => {
    const body = PEM.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
    assert.equal(normalisePublicKeyPem(body).replace(/\s+/g, ""), PEM.replace(/\s+/g, ""));
    process.env.CASHFREE_VRS_PUBLIC_KEY = body;
    assert.ok(cashfreeSignatureHeader("CF123", NOW)["x-cf-signature"]);
  });

  await t.test("a broken key sends no header instead of throwing", () => {
    process.env.CASHFREE_VRS_PUBLIC_KEY = "not a key";
    assert.deepEqual(cashfreeSignatureHeader("CF123", NOW), {});
  });
});
