import { test } from "node:test";
import assert from "node:assert/strict";

import { OWNER_PROFILES, ownerFrom, type OwnerRequest, type SessionOwner } from "./sessionOwner.js";

type Session = OwnerRequest["session"];

const USER = { id: "itd-1", role: "customer" };
const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const GUEST = "22222222-2222-4222-8222-222222222222";
const SIGNUP = "33333333-3333-4333-8333-333333333333";

/**
 * Every shape a session can arrive in, including the broken ones — a login that
 * half-cleared, a guest ref with no phone behind it, a browser carrying both a
 * guest ref and a signup ref.
 */
const SESSIONS: ReadonlyArray<{ name: string; session: Session }> = [
  { name: "empty", session: {} },
  { name: "account", session: { user: USER, dbUserId: ACCOUNT } },
  { name: "dbUserId without user", session: { dbUserId: ACCOUNT } },
  { name: "user without dbUserId", session: { user: USER } },
  { name: "guest with phone", session: { guestRef: GUEST, guestPhone: "9000000001" } },
  { name: "guest without phone", session: { guestRef: GUEST } },
  { name: "signup with phone", session: { signupRef: SIGNUP, signupPhone: "9000000002" } },
  { name: "signup without phone", session: { signupRef: SIGNUP } },
  {
    name: "guest and signup",
    session: { guestRef: GUEST, guestPhone: "9000000001", signupRef: SIGNUP, signupPhone: "9000000002" },
  },
  {
    name: "account still carrying a guest ref",
    session: { user: USER, dbUserId: ACCOUNT, guestRef: GUEST, guestPhone: "9000000001" },
  },
  {
    name: "signed in mid-signup",
    session: { user: USER, dbUserId: ACCOUNT, signupRef: SIGNUP, signupPhone: "9000000002" },
  },
];

/** What each profile answered before `ownerFrom` existed, verbatim. */
const ORIGINALS: Record<string, (s: Session) => unknown> = {
  // server/routes/payments.ts — paymentCallerFrom
  payment: (s) => {
    if (s.dbUserId) return { userId: s.dbUserId, guestRef: null };
    if (s.guestRef) return { userId: null, guestRef: s.guestRef };
    return null;
  },
  // server/routes/support.ts — sessionOwnerFor
  supportSession: (s) => {
    const dbUserId = s.dbUserId ?? null;
    if (s.user && dbUserId) return { userId: dbUserId };
    if (s.guestRef) return { guestRef: s.guestRef };
    return null;
  },
  // server/routes/bia.ts — nudgeOwnerFor
  nudges: (s) => {
    if (s.user && s.dbUserId) return { kind: "account", userId: s.dbUserId };
    if (s.guestRef && s.guestPhone) return { kind: "guest", guestRef: s.guestRef };
    if (s.signupRef && s.signupPhone) return { kind: "guest", guestRef: s.signupRef };
    return null;
  },
  // server/routes/guestProfile.ts — guestFrom
  guestProfile: (s) => {
    if (s.guestRef && s.guestPhone) return { ref: s.guestRef, phone: s.guestPhone };
    if (s.signupRef && s.signupPhone) return { ref: s.signupRef, phone: s.signupPhone };
    return null;
  },
  // server/routes.ts — sessionGuestRef
  guestNotifications: (s) => {
    if (s.user) return null;
    return s.guestRef ?? s.signupRef ?? null;
  },
};

/** The adapters each route wraps `ownerFrom` in, so the comparison is like for like. */
const ADAPTED: Record<string, (owner: SessionOwner | null) => unknown> = {
  payment: (o) =>
    o === null ? null : o.kind === "account" ? { userId: o.userId, guestRef: null } : { userId: null, guestRef: o.guestRef },
  supportSession: (o) => (o === null ? null : o.kind === "account" ? { userId: o.userId } : { guestRef: o.guestRef }),
  nudges: (o) =>
    o === null ? null : o.kind === "account" ? { kind: "account", userId: o.userId } : { kind: "guest", guestRef: o.guestRef },
  guestProfile: (o) => (o && o.kind === "guest" && o.phone ? { ref: o.guestRef, phone: o.phone } : null),
  guestNotifications: (o) => o?.guestRef ?? null,
};

for (const profile of Object.keys(ORIGINALS)) {
  test(`${profile} answers exactly what it answered before`, () => {
    const options = OWNER_PROFILES[profile as keyof typeof OWNER_PROFILES];
    for (const { name, session } of SESSIONS) {
      const before = ORIGINALS[profile](session);
      const after = ADAPTED[profile](ownerFrom({ session }, options));
      assert.deepEqual(after, before, `${profile} disagreed on the "${name}" session`);
    }
  });
}

test("the disagreements the profiles encode are the ones we know about", () => {
  const halfLogin: Session = { dbUserId: ACCOUNT };
  // Payments accept dbUserId on its own; the BIA routes want the user object too.
  assert.equal(ownerFrom({ session: halfLogin }, OWNER_PROFILES.payment)?.kind, "account");
  assert.equal(ownerFrom({ session: halfLogin }, OWNER_PROFILES.supportSession), null);

  const midSignup: Session = { signupRef: SIGNUP, signupPhone: "9000000002" };
  // A signup ref owns a conversation-in-progress but never owns a placed order.
  assert.equal(ownerFrom({ session: midSignup }, OWNER_PROFILES.nudges)?.guestRef, SIGNUP);
  assert.equal(ownerFrom({ session: midSignup }, OWNER_PROFILES.payment), null);

  const unprovenGuest: Session = { guestRef: GUEST };
  // The profile screens want the number proved; payments rely on the ref alone.
  assert.equal(ownerFrom({ session: unprovenGuest }, OWNER_PROFILES.guestProfile), null);
  assert.equal(ownerFrom({ session: unprovenGuest }, OWNER_PROFILES.payment)?.guestRef, GUEST);
});

test("a guest ref is preferred to a signup ref when a browser holds both", () => {
  const both: Session = {
    guestRef: GUEST,
    guestPhone: "9000000001",
    signupRef: SIGNUP,
    signupPhone: "9000000002",
  };
  assert.equal(ownerFrom({ session: both }, OWNER_PROFILES.nudges)?.guestRef, GUEST);
  assert.equal(ownerFrom({ session: both }, OWNER_PROFILES.guestProfile)?.phone, "9000000001");
});

test("a signed-in session is never served the guest branch of notifications", () => {
  const session: Session = { user: USER, dbUserId: ACCOUNT, guestRef: GUEST };
  assert.equal(ownerFrom({ session }, OWNER_PROFILES.guestNotifications), null);
});
