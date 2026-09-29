import { test } from "node:test";
import assert from "node:assert/strict";
import { sendOtpBySms } from "./sms.js";

const OTP_URL = "https://control.msg91.com/api/v5/otp";
const CODE = "246813";
const PHONE = "9876543210";

const ENV_KEYS = ["MSG91_AUTHKEY", "MSG91_TEMPLATE_ID", "MSG91_OTP_EXPIRY_MIN", "MSG91_OTP_VAR"] as const;

function withoutMsg91Env(): void {
  for (const key of ENV_KEYS) delete process.env[key];
}

function withMsg91Env(): void {
  process.env.MSG91_AUTHKEY = "test-authkey";
  process.env.MSG91_TEMPLATE_ID = "send-otp-template-1";
  delete process.env.MSG91_OTP_EXPIRY_MIN;
  delete process.env.MSG91_OTP_VAR;
}

test("MSG91 Send OTP", async (t) => {
  const saved: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  const originalFetch = globalThis.fetch;

  t.after(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    globalThis.fetch = originalFetch;
  });

  await t.test("unconfigured does not fetch", async () => {
    withoutMsg91Env();
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      throw new Error("fetch should not run");
    }) as typeof fetch;

    const result = await sendOtpBySms(PHONE, CODE);
    assert.deepEqual(result, { ok: false, reason: "unconfigured" });
    assert.equal(called, false);
  });

  await t.test("configured posts our code on the query and no body", async () => {
    withMsg91Env();
    const seen: { url: string; init: RequestInit }[] = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ type: "success", message: "req-1" }), { status: 200 });
    }) as typeof fetch;

    const logs = captureLogs();
    try {
      const result = await sendOtpBySms(PHONE, CODE);
      assert.deepEqual(result, { ok: true });
    } finally {
      logs.restore();
    }

    assert.equal(seen.length, 1);
    const url = new URL(seen[0].url);
    assert.equal(`${url.origin}${url.pathname}`, OTP_URL);
    assert.equal(url.searchParams.get("template_id"), "send-otp-template-1");
    assert.equal(url.searchParams.get("mobile"), "919876543210");
    assert.equal(url.searchParams.get("otp"), CODE);
    assert.equal(url.searchParams.get("otp_length"), "6");
    assert.equal(url.searchParams.get("otp_expiry"), "5");
    assert.equal(seen[0].init.body, undefined);
    const headers = new Headers(seen[0].init.headers);
    assert.equal(headers.get("content-type"), "application/json");
    assert.equal(headers.get("authkey"), "test-authkey");
    assert.equal(logs.text().includes(CODE), false);
  });

  await t.test("MSG91_OTP_EXPIRY_MIN overrides the default", async () => {
    withMsg91Env();
    process.env.MSG91_OTP_EXPIRY_MIN = "10";
    let seen = "";
    globalThis.fetch = (async (url: string | URL | Request) => {
      seen = String(url);
      return new Response(JSON.stringify({ type: "success", message: "req-1" }), { status: 200 });
    }) as typeof fetch;

    const result = await sendOtpBySms(PHONE, CODE);
    assert.deepEqual(result, { ok: true });
    assert.equal(new URL(seen).searchParams.get("otp_expiry"), "10");
  });

  await t.test("HTTP 200 with type error is a failure and the code is not logged", async () => {
    withMsg91Env();
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ type: "error", message: "template missing" }), {
        status: 200,
      });
    }) as typeof fetch;

    const logs = captureLogs();
    try {
      const result = await sendOtpBySms(`91${PHONE}`, CODE);
      assert.deepEqual(result, { ok: false, reason: "failed" });
    } finally {
      logs.restore();
    }
    assert.equal(logs.text().includes(CODE), false);
  });
});

function captureLogs(): { text: () => string; restore: () => void } {
  const lines: string[] = [];
  const orig = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };
  const record = (...args: unknown[]) => {
    lines.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
  };
  console.log = record;
  console.info = record;
  console.warn = record;
  console.error = record;
  return {
    text: () => lines.join("\n"),
    restore: () => {
      console.log = orig.log;
      console.info = orig.info;
      console.warn = orig.warn;
      console.error = orig.error;
    },
  };
}
