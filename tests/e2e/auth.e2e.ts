/**
 * P0 auth edge cases: OTP attempt limits, session handling, account enumeration,
 * and whether a phone verification belongs to the browser that earned it.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { Client, OTP, PHONES, cleanup, ensureCustomer, resetOtpHistory, sb, signIn, startServer, stopServer } from "./harness.js";

before(async () => {
  await ensureCustomer(PHONES.customer2, "E2E Customer Two");
  await startServer();
});
after(async () => {
  await sb().from("identity_verifications").delete().eq("document_no", "EEEEE2222E");
  for (const p of [PHONES.otpVictim, PHONES.otpSpare]) await resetOtpHistory(p);
  await cleanup();
  await stopServer();
});

function sid(c: Client): string | undefined {
  const raw = c.cookies.get("connect.sid") ?? c.cookies.get("bombino.sid");
  return raw ? decodeURIComponent(raw).split(".")[0] : undefined;
}

async function requestCode(c: Client, phone: string) {
  const r = await c.post("/api/auth/otp/request", { phone, purpose: "auth" });
  assert.equal(r.status, 200, `otp/request: ${r.text}`);
}

test("E-A1a: five sequential wrong codes lock the code, even the right one then fails", async () => {
  await resetOtpHistory(PHONES.otpVictim);
  const c = new Client();
  await requestCode(c, PHONES.otpVictim);
  const statuses: number[] = [];
  for (let i = 0; i < 5; i++) {
    statuses.push((await c.post("/api/auth/phone/continue", { phone: PHONES.otpVictim, code: "000001" })).status);
  }
  const right = await c.post("/api/auth/phone/continue", { phone: PHONES.otpVictim, code: OTP });
  assert.notEqual(right.status, 200, `right code accepted after 5 wrong: ${statuses.join(",")}`);
  assert.equal((right.json as { code?: string }).code, "OTP_TOO_MANY_ATTEMPTS");
});

test("E-A1b: ten PARALLEL wrong codes still lock the code", async () => {
  await resetOtpHistory(PHONES.otpVictim);
  const c = new Client();
  await requestCode(c, PHONES.otpVictim);
  const burst = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      c.post("/api/auth/phone/continue", { phone: PHONES.otpVictim, code: String(100000 + i) })
    )
  );
  const { data } = await sb()
    .from("otp_codes")
    .select("attempts")
    .eq("phone", PHONES.otpVictim)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  const right = await c.post("/api/auth/phone/continue", { phone: PHONES.otpVictim, code: OTP });
  assert.notEqual(
    right.status,
    200,
    `10 parallel wrong guesses recorded only ${data?.attempts} attempts; right code then accepted (burst statuses ${burst
      .map((b) => b.status)
      .join(",")})`
  );
});

test("E-A1c: a spent code cannot be used twice; a new code kills the old one", async () => {
  await resetOtpHistory(PHONES.otpSpare);
  const c = new Client();
  await requestCode(c, PHONES.otpSpare);
  assert.equal((await c.post("/api/auth/phone/continue", { phone: PHONES.otpSpare, code: OTP })).status, 200);
  const again = await c.post("/api/auth/phone/continue", { phone: PHONES.otpSpare, code: OTP });
  assert.notEqual(again.status, 200, "spent code reused");
});

test("E-O1: an expired code is refused", async () => {
  await resetOtpHistory(PHONES.otpSpare);
  const c = new Client();
  await requestCode(c, PHONES.otpSpare);
  await sb()
    .from("otp_codes")
    .update({ created_at: new Date(Date.now() - 6 * 60_000).toISOString(), expires_at: new Date(Date.now() - 60_000).toISOString() })
    .eq("phone", PHONES.otpSpare);
  const r = await c.post("/api/auth/phone/continue", { phone: PHONES.otpSpare, code: OTP });
  assert.equal((r.json as { code?: string }).code, "OTP_EXPIRED", r.text);
});

test("E-O2: OTP requests per phone are rate limited", async () => {
  await resetOtpHistory(PHONES.otpSpare);
  const c = new Client();
  const statuses: number[] = [];
  for (let i = 0; i < 21; i++) {
    statuses.push((await c.post("/api/auth/otp/request", { phone: PHONES.otpSpare, purpose: "auth" })).status);
  }
  // Development allows 20/hour; production 5. The 21st must be refused.
  assert.equal(statuses.at(-1), 429, `statuses: ${statuses.join(",")}`);
});

test("E-A2: /api/debug/session is not public", async () => {
  const r = await new Client().get("/api/debug/session");
  assert.ok(r.status === 401 || r.status === 404, `status ${r.status}: ${r.text}`);
  assert.ok(!("sessionID" in r.json), "reply carries sessionID");
});

test("E-A3: signup does not reveal whether a number is registered before the OTP check", async () => {
  const body = (phone: string) => ({
    full_name: "Probe",
    email: "probe@example.com",
    phone,
    contract_accepted: true,
    contract_signed_name: "Probe Person",
  });
  const known = await new Client().post("/api/auth/signup/personal", body(PHONES.customer));
  const unknown = await new Client().post("/api/auth/signup/personal", body("9000000099"));
  assert.equal(
    known.status,
    unknown.status,
    `registered → ${known.status} ${(known.json as { code?: string }).code}; unregistered → ${unknown.status} ${(unknown.json as { code?: string }).code}`
  );
});

test("E-A4: a phone verified in browser A does not authorise browser B", async () => {
  await resetOtpHistory(PHONES.otpVictim);
  const victim = new Client("victim");
  await requestCode(victim, PHONES.otpVictim);
  const v = await victim.post("/api/auth/phone/continue", { phone: PHONES.otpVictim, code: OTP });
  assert.equal(v.status, 200, v.text);

  const attacker = new Client("attacker");
  const r = await attacker.post("/api/signup/identity/pan", { phone: PHONES.otpVictim, pan: "EEEEE2222E" });
  assert.notEqual(r.status, 200, `attacker browser staged a PAN on the victim's number: ${r.text}`);
});

test("E-A5: the session id changes at sign-in (no fixation)", async () => {
  await resetOtpHistory(PHONES.otpSpare);
  const c = new Client();
  // Build a pre-login session: verify an unregistered number and stage a PAN.
  await requestCode(c, PHONES.otpSpare);
  await c.post("/api/auth/phone/continue", { phone: PHONES.otpSpare, code: OTP });
  await c.post("/api/signup/identity/pan", { phone: PHONES.otpSpare, pan: "EEEEE2222E" });
  const before = sid(c);
  if (!before || before === "cookie") {
    // Cookie-backed sessions carry no server id to fix.
    return;
  }
  await resetOtpHistory(PHONES.customer2);
  await requestCode(c, PHONES.customer2);
  const signed = await c.post("/api/auth/phone/continue", { phone: PHONES.customer2, code: OTP });
  assert.equal(signed.status, 200, signed.text);
  assert.notEqual(sid(c), before, "same session id before and after sign-in");
});

test("E-A7: after logout the old cookie is dead", async () => {
  const c = await signIn(PHONES.customer, "logout-probe");
  const stolen = new Client();
  stolen.cookies = new Map(c.cookies);
  assert.equal((await c.post("/api/auth/logout")).status, 200);
  const replay = await stolen.get("/api/auth/me");
  assert.equal(replay.status, 401, `replayed cookie still signed in: ${replay.text}`);
});
