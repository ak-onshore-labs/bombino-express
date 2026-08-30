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
  }
}
