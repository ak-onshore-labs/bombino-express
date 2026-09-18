/**
 * Express-session type augmentation for Bombino auth.
 * Extends session so req.session.user and req.session.itdToken are typed.
 * No runtime behavior.
 */

import type s from "express-session";
import type { ITDUserInfo } from "./itd";

declare global {
  namespace Express {
    interface Request {
      session: s.Session & Partial<s.SessionData> & {
        user?: ITDUserInfo;
        itdToken?: string;
        dbUserId?: string;
        signupRef?: string;
        signupPhone?: string;
      };
    }
  }
}

declare module "express-session" {
  interface SessionData {
    user?: ITDUserInfo;
    itdToken?: string;
    dbUserId?: string;
    /**
     * Owner of the documents uploaded during an in-flight signup, before an
     * account exists to own them. Minted on the first upload, cleared once
     * the account claims the rows. See migrations/add_account_categories_and_documents.sql.
     */
    signupRef?: string;
    /**
     * The phone that signupRef belongs to.
     *
     * Staged documents and verifications are owned by a number, not by a
     * browser. Without this the same signupRef survives a change of phone and
     * the next person to use this browser inherits whatever the last one
     * proved. See signupRefForPhone in routes.ts.
     */
    signupPhone?: string;
    /**
     * The guest this browser is booking as.
     *
     * Set when a guest booking is written, and it is the *same uuid* that was
     * `signupRef` while their documents were being staged — a guest booking is
     * the signup staging flow stopped one step short of an account. Promoting
     * it to its own field at the moment the order is written is what makes it
     * outlive the signup handshake: signupRef is re-minted whenever the phone
     * changes, and a guest still has to be able to pay for the order they just
     * placed.
     *
     * Proves ownership of a guest order for payment. Not an identity: it can
     * only ever have been minted by verifying an OTP on guestPhone.
     */
    guestRef?: string;
    /** The verified number that guestRef was minted against. */
    guestPhone?: string;
    /**
     * The number this browser last proved with a code, and when (ms epoch).
     * What signup, identity staging, guest booking and ITD linking check —
     * a verification belongs to the browser that typed the code, not to
     * anyone who knows the number. See isPhoneVerifiedHere in signupRef.ts.
     */
    verifiedPhone?: string;
    verifiedPhoneAt?: number;
  }
}
