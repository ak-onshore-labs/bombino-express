/**
 * Who is asking: the one place that reads a session and answers "account,
 * guest, or nobody".
 *
 * Five routes used to answer it five ways, and they disagreed on two points —
 * whether a signup ref counts as a guest, and whether `session.user` has to be
 * present beside `dbUserId`. That is an authorisation decision, so a fix
 * applied to one of them never reached the other four.
 *
 * The disagreements are kept, but as named options rather than as five
 * implementations: each caller passes the profile it has always had, and
 * changing one is now a visible, reviewable edit. `server/sessionOwner.test.ts`
 * pins every profile's truth table.
 *
 * What the session fields mean (server/session.d.ts has the long version):
 *   dbUserId    the account row; set by ensureDbUser after a login
 *   user        the ITD user object; present only on a real login
 *   guestRef    the ref a guest's booking and documents are written under
 *   guestPhone  the verified number guestRef was minted against
 *   signupRef   the staging ref of an in-flight signup, before an account
 *   signupPhone the verified number signupRef belongs to
 *
 * NOT for the write paths in `routes.ts` that mint a ref: `resolveKycOwner`
 * verifies an OTP, refuses numbers that already have an account, and creates a
 * signup ref as a side effect. This module only reads what the session already
 * proved.
 */

export type SessionOwner =
  | { kind: "account"; userId: string; guestRef: null; phone: string | null }
  | { kind: "guest"; userId: null; guestRef: string; phone: string | null };

/** Only the fields this module reads, so a plain object can be passed in tests. */
export type OwnerRequest = {
  session: {
    user?: unknown;
    dbUserId?: string;
    guestRef?: string;
    guestPhone?: string;
    signupRef?: string;
    signupPhone?: string;
  };
};

export type OwnerOptions = {
  /**
   * What a signed-in session means for this route.
   *   resolve — answer with the account (the usual case)
   *   refuse  — answer nobody; the route's account path is mounted separately
   *   ignore  — skip the account and look for a guest anyway
   */
  onAccount?: "resolve" | "refuse" | "ignore";
  /**
   * Whether `session.user` must be present beside `dbUserId` for the session to
   * count as an account. `dbUserId` alone survives a logout that failed to
   * clear everything, so the stricter routes ask for both.
   */
  requireUserObject?: boolean;
  /**
   * Whether a guest ref counts only when this session also holds the phone it
   * was minted against. Stricter, and what the profile-shaped routes use.
   */
  requireGuestPhone?: boolean;
  /**
   * Whether an in-flight signup's ref counts as a guest ref. It is the same
   * uuid a guest booking would later carry, so routes that serve someone
   * mid-signup say yes and routes about a placed order say no.
   */
  allowSignupRef?: boolean;
};

export function ownerFrom(req: OwnerRequest, options: OwnerOptions = {}): SessionOwner | null {
  const {
    onAccount = "resolve",
    requireUserObject = false,
    requireGuestPhone = false,
    allowSignupRef = false,
  } = options;
  const session = req.session;

  if (onAccount === "refuse" && session.user) return null;

  if (onAccount === "resolve") {
    const isAccount = requireUserObject ? Boolean(session.user && session.dbUserId) : Boolean(session.dbUserId);
    if (isAccount && session.dbUserId) {
      return { kind: "account", userId: session.dbUserId, guestRef: null, phone: null };
    }
  }

  if (session.guestRef && (!requireGuestPhone || session.guestPhone)) {
    return {
      kind: "guest",
      userId: null,
      guestRef: session.guestRef,
      phone: session.guestPhone ?? null,
    };
  }

  if (allowSignupRef && session.signupRef && (!requireGuestPhone || session.signupPhone)) {
    return {
      kind: "guest",
      userId: null,
      guestRef: session.signupRef,
      phone: session.signupPhone ?? null,
    };
  }

  return null;
}

/**
 * The profiles in use, named where they are read rather than spelled out at
 * each call site. Changing one of these changes who a route serves — say so in
 * the commit message.
 */
export const OWNER_PROFILES = {
  /** Payments: ownership of a placed order. A signup ref never owns an order. */
  payment: { onAccount: "resolve", requireUserObject: false } satisfies OwnerOptions,
  /** BIA's saved conversation: the account, else the guest this session verified. */
  supportSession: { onAccount: "resolve", requireUserObject: true } satisfies OwnerOptions,
  /** BIA's nudge switches: as above, but a guest must have proved their number. */
  nudges: {
    onAccount: "resolve",
    requireUserObject: true,
    requireGuestPhone: true,
    allowSignupRef: true,
  } satisfies OwnerOptions,
  /** The guest profile screen: guests only — an account is answered 409 by the route. */
  guestProfile: {
    onAccount: "ignore",
    requireGuestPhone: true,
    allowSignupRef: true,
  } satisfies OwnerOptions,
  /** Notifications: the guest branch, mounted in front of the account branch. */
  guestNotifications: { onAccount: "refuse", allowSignupRef: true } satisfies OwnerOptions,
} as const;
