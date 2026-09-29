/**
 * Account applications over HTTP: the customer's side and the ops console's.
 *
 * Self-registering: `registerAccountApplicationRoutes(app)` is called from
 * routes.ts. Filing an application is not here — it is the tail of the signup
 * endpoints, which own the gates it must pass (server/accountApplications.ts).
 *
 * Customer routes answer to the guest on this session and nobody else: the
 * phone comes from the session, never from a request body.
 *
 * Ops routes are admin/super_admin, viewing an application's documents
 * included: the reviewer is usually a plain admin and cannot decide without
 * them. Every view is logged. A customer's documents, once the account is
 * open, stay super_admin (routes/ops.ts §opsKycGate).
 */

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { opsDbGate } from "../routeGuards.js";
import {
  findApplicationDuplicates,
  getApplicationById,
  getLatestApplicationByPhone,
  insertApplicationEvent,
  listApplicationEvents,
  listApplications,
  toCustomerView,
  updateApplicationFrom,
  type ApplicationRow,
} from "../accountApplicationsDb.js";
import {
  isAccountReviewEnabled,
  notifyChangesRequested,
  notifyRejected,
  parseRequestedChanges,
  sendTestApplicationAlert,
  withdrawApplication,
} from "../accountApplications.js";
import { alertEmailsSchema, getApplicationAlertRecipients, setApplicationAlertRecipients } from "../opsSettings.js";
import { mailSender } from "../mailer.js";
import { approveApplication, finalizeApplication, replaceItdCredentials } from "../accountApproval.js";
import {
  getSignupDocumentWithFile,
  getUserDocumentWithFile,
  listDocumentsBySignupRef,
  listDocumentsByUserId,
  markDocumentVerifiedManually,
} from "../accountDocsDb.js";
import { getItdUserProfileById } from "../appDb.js";
import { AuditLogUnavailableError, logDocumentAccessOrThrow } from "../documentAccessLog.js";
import { sendDocumentFile, wantsDownload } from "../documentResponse.js";
import { maskNumber } from "../accountEmails.js";
import { applicationToFix, fixNeeds, FIX_NOT_OPEN_MESSAGE } from "../applicationFix.js";
import {
  COMPANY_CATEGORY_SPECS,
  DOC_SLOT_SPECS,
  isCompanyCategory,
  isDocSlot,
  isStaffVerified,
  requiredDocuments,
  type CompanyCategory,
} from "../../shared/accountSpec.js";
import {
  ACTION_FROM,
  APPLICATION_STATUSES,
  OPEN_APPLICATION_STATUSES,
  actionAllowed,
  isApplicationStatus,
  isOpsApplicationAction,
  type ApplicationStatus,
} from "../../shared/applicationStatus.js";

/** The phone this session proved, as a guest or mid-signup. */
function guestPhoneFrom(req: Request): string | null {
  return req.session.guestPhone ?? req.session.signupPhone ?? null;
}

/** One row of the queue. */
function queueItem(row: ApplicationRow) {
  const name = row.account_type === "company" ? row.details.company_name : row.details.full_name;
  return {
    id: row.id,
    phone: row.phone,
    name: name ?? null,
    email: row.details.email,
    account_type: row.account_type,
    company_category: row.company_category,
    category_label: isCompanyCategory(row.company_category) ? COMPANY_CATEGORY_SPECS[row.company_category].label : "Personal",
    status: row.status,
    reviewer_id: row.reviewer_id,
    claimed_at: row.claimed_at,
    resubmission_count: row.resubmission_count,
    submitted_at: row.submitted_at,
    // Moves when the customer edits or resends, or it goes back in the queue:
    // what the console's "new" pill counts from. submitted_at never moves.
    updated_at: row.updated_at,
    decided_at: row.decided_at,
    finalize_error: row.finalize_error,
    email_error: row.email_error,
    email_sent_at: row.email_sent_at,
  };
}

export function registerAccountApplicationRoutes(app: Express): void {
  // ── Customer ──────────────────────────────────────────────────────────────

  // GET /api/signup/application — this number's newest application, if any.
  app.get("/api/signup/application", async (req: Request, res: Response) => {
    const phone = guestPhoneFrom(req);
    if (!phone || req.session.user || !isAccountReviewEnabled()) {
      res.json({ enabled: isAccountReviewEnabled(), application: null });
      return;
    }
    const row = await getLatestApplicationByPhone(phone);
    res.json({ enabled: isAccountReviewEnabled(), application: row ? toCustomerView(row) : null });
  });

  /**
   * GET /api/signup/application/fix — what fixing a sent-back application
   * needs from what is on file right now: the documents the team asked for,
   * and any the application must have but doesn't (lost, never uploaded, or
   * missing the number it was checked against). The fix screen asks for both.
   */
  app.get("/api/signup/application/fix", async (req: Request, res: Response) => {
    const phone = guestPhoneFrom(req);
    const fixing = phone && !req.session.user ? await applicationToFix(req, phone) : null;
    res.set("Cache-Control", "no-store");
    if (!fixing) {
      res.status(409).json({ message: FIX_NOT_OPEN_MESSAGE, code: "APPLICATION_NOT_AWAITING_CHANGES" });
      return;
    }
    res.json(await fixNeeds(fixing));
  });

  // POST /api/signup/application/withdraw
  app.post("/api/signup/application/withdraw", async (req: Request, res: Response) => {
    const phone = guestPhoneFrom(req);
    if (!phone || req.session.user) {
      res.status(401).json({ message: "No verified number in this session." });
      return;
    }
    const result = await withdrawApplication(phone);
    if (!result.ok) {
      res.status(result.status).json({ message: result.message, code: result.code });
      return;
    }
    res.json({ application: toCustomerView(result.value) });
  });

  // ── Ops ───────────────────────────────────────────────────────────────────

  // Who is emailed when an application arrives. Registered before
  // /api/ops/applications/:id so "settings" is never read as an id.
  app.get("/api/ops/settings/application-alerts", ...opsDbGate, async (_req: Request, res: Response) => {
    const recipients = await getApplicationAlertRecipients();
    res.json({ ...recipients, sender: mailSender() });
  });

  app.put("/api/ops/settings/application-alerts", ...opsDbGate, async (req: Request, res: Response) => {
    const actorId = req.session.dbUserId;
    if (!actorId) {
      res.status(401).json({ message: "Not authenticated" });
      return;
    }
    const parsed = alertEmailsSchema.safeParse(req.body?.emails);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Enter valid email addresses", code: "INVALID_EMAILS" });
      return;
    }
    const result = await setApplicationAlertRecipients(parsed.data, actorId);
    if (!result.ok) {
      res.status(503).json({
        message: "Couldn't save. The settings table may not exist yet: run migrations/add_ops_settings.sql.",
        code: "SETTINGS_UNAVAILABLE",
      });
      return;
    }
    console.log(`[ops] application alert recipients set to ${parsed.data.length} address(es) by ${actorId}`);
    res.json({ ...result.value, sender: mailSender() });
  });

  app.post("/api/ops/settings/application-alerts/test", ...opsDbGate, async (_req: Request, res: Response) => {
    const { emails } = await getApplicationAlertRecipients();
    if (emails.length === 0) {
      res.status(400).json({ message: "Add an address first.", code: "NO_RECIPIENTS" });
      return;
    }
    const result = await sendTestApplicationAlert(emails);
    if (!result.ok) {
      res.status(502).json({ message: `The test email was not sent: ${result.error}`, code: "MAIL_FAILED" });
      return;
    }
    res.json({ sent_to: emails });
  });

  // GET /api/ops/applications?status=open|all|<status>
  app.get("/api/ops/applications", ...opsDbGate, async (req: Request, res: Response) => {
    const raw = typeof req.query.status === "string" ? req.query.status : "open";
    let statuses: ApplicationStatus[] | undefined;
    if (raw === "open") statuses = [...OPEN_APPLICATION_STATUSES];
    else if (raw === "all") statuses = undefined;
    else if (isApplicationStatus(raw)) statuses = [raw];
    else {
      res.status(400).json({ message: `status must be open, all, or one of ${APPLICATION_STATUSES.join(", ")}` });
      return;
    }
    const rows = await listApplications({ statuses });
    res.json({ enabled: isAccountReviewEnabled(), applications: rows.map(queueItem) });
  });

  // GET /api/ops/applications/:id — everything a reviewer needs to decide.
  app.get("/api/ops/applications/:id", ...opsDbGate, async (req: Request, res: Response) => {
    const row = await getApplicationById(req.params.id);
    if (!row) {
      res.status(404).json({ message: "Application not found." });
      return;
    }
    const category: CompanyCategory | null = isCompanyCategory(row.company_category) ? row.company_category : null;
    const spec = category ? COMPANY_CATEGORY_SPECS[category] : null;
    const docs = row.user_id ? await listDocumentsByUserId(row.user_id) : await listDocumentsBySignupRef(row.signup_ref);
    const required = requiredDocuments(row.account_type, category);
    const [events, duplicates, reviewer] = await Promise.all([
      listApplicationEvents(row.id),
      findApplicationDuplicates(row),
      row.reviewer_id ? getItdUserProfileById(row.reviewer_id) : Promise.resolve(null),
    ]);
    // History says who, not just what. A handful of staff at most per application.
    const actorIds = Array.from(new Set(events.map((e) => e.actor_id).filter((id): id is string => Boolean(id))));
    const actorNames = new Map<string, string>();
    await Promise.all(
      actorIds.map(async (id) => {
        const profile = id === row.reviewer_id ? reviewer : await getItdUserProfileById(id);
        const name = typeof profile?.full_name === "string" ? profile.full_name.trim() : "";
        if (name) actorNames.set(id, name);
      })
    );

    res.json({
      application: {
        ...queueItem(row),
        details: row.details,
        contract: {
          signed_name: row.contract_signed_name,
          version: row.contract_version,
          accepted_at: row.contract_accepted_at,
        },
        requested_changes: row.requested_changes,
        decision_note: row.decision_note,
        user_id: row.user_id,
        itd_customer_id: row.itd_customer_id,
        finalized_at: row.finalized_at,
        reviewer_name: (reviewer?.full_name as string | undefined) ?? null,
      },
      // What the reviewer should set in ITD so the two agree (edge case: the
      // category's contract head and group code live only on our side).
      itd_setup: spec ? { contract_head: spec.contractHead, group_code: spec.groupCode ?? null } : null,
      documents: required.map((slot) => {
        const doc = docs.find((d) => d.doc_slot === slot);
        return {
          slot,
          label: DOC_SLOT_SPECS[slot].label,
          provided: Boolean(doc),
          // Last four only, like every other ops list. The full number is one
          // click away on the (logged) document view.
          number: doc?.document_no ? maskNumber(doc.document_no) : null,
          // Cashfree's first-layer verdict, advice to the reviewer.
          ocr_status: doc?.ocr_status ?? null,
          // The reviewer's own check: required on every document before approval.
          verified_at: doc?.ocr_verified_at ?? null,
        };
      }),
      duplicates,
      events: events.map((e) => ({ ...e, actor_name: e.actor_id ? actorNames.get(e.actor_id) ?? null : null })),
      allowed_actions: (Object.keys(ACTION_FROM) as Array<keyof typeof ACTION_FROM>).filter((a) =>
        actionAllowed(a, row.status)
      ),
    });
  });

  // GET /api/ops/applications/:id/documents/:slot/file — any ops reviewer, logged.
  app.get("/api/ops/applications/:id/documents/:slot/file", ...opsDbGate, async (req: Request, res: Response) => {
    const row = await getApplicationById(req.params.id);
    const slot = req.params.slot;
    if (!row || !isDocSlot(slot)) {
      res.status(404).json({ message: "Document not found." });
      return;
    }
    const download = wantsDownload(req);
    try {
      const doc = row.user_id
        ? await getUserDocumentWithFile(row.user_id, slot)
        : await getSignupDocumentWithFile(row.signup_ref, slot);
      if (!doc) {
        res.status(404).json({ message: "Document not found." });
        return;
      }
      await logDocumentAccessOrThrow(req, {
        source: "account",
        outcome: "served",
        documentId: doc.id,
        userId: row.user_id,
        actorUserId: req.session.dbUserId ?? null,
        action: download ? "download" : "view",
        capabilityId: doc.capability_id,
      });
      sendDocumentFile(res, doc, download ? "attachment" : "inline");
    } catch (err) {
      if (err instanceof AuditLogUnavailableError) {
        res.status(500).json({ message: "Audit unavailable." });
        return;
      }
      console.error("[GET /api/ops/applications/:id/documents/:slot/file] failed:", err);
      res.status(500).json({ message: "Failed to retrieve document." });
    }
  });

  // POST /api/ops/applications/:id/documents/:slot/verify — a reviewer has
  // looked at the document and vouches for it. Logged in the history with
  // Cashfree's earlier result.
  app.post("/api/ops/applications/:id/documents/:slot/verify", ...opsDbGate, async (req: Request, res: Response) => {
    const actorId = req.session.dbUserId;
    if (!actorId) {
      res.status(401).json({ message: "Not authenticated" });
      return;
    }
    const row = await getApplicationById(req.params.id);
    const slot = req.params.slot;
    if (!row || !isDocSlot(slot)) {
      res.status(404).json({ message: "Document not found." });
      return;
    }
    if (row.status === "rejected" || row.status === "withdrawn") {
      res.status(409).json({
        message: "This application is closed. Refresh and look again.",
        code: "APPLICATION_STATE_CHANGED",
      });
      return;
    }
    const docs = row.user_id ? await listDocumentsByUserId(row.user_id) : await listDocumentsBySignupRef(row.signup_ref);
    const doc = docs.find((d) => d.doc_slot === slot);
    if (!doc) {
      res.status(404).json({ message: "That document hasn't been uploaded.", code: "DOCUMENT_NOT_UPLOADED" });
      return;
    }
    if (isStaffVerified(doc)) {
      res.status(409).json({ message: "That document is already verified.", code: "ALREADY_VERIFIED" });
      return;
    }
    const ok = await markDocumentVerifiedManually(doc.id, actorId);
    if (!ok) {
      res.status(503).json({
        message: "Couldn't save. The database may need migrations/add_manual_document_verification.sql.",
        code: "VERIFY_UNAVAILABLE",
      });
      return;
    }
    await insertApplicationEvent({
      application_id: row.id,
      event: "document_verified",
      actor_id: actorId,
      metadata: { slot, previous: doc.ocr_status ?? null },
    });
    res.json({ verified: true, slot });
  });

  const approveSchema = z.object({
    itd_email: z.string().trim().email("Enter the ITD login email"),
    itd_password: z.string().min(1, "Enter the ITD password"),
  });
  const rejectSchema = z.object({
    reason: z.string().trim().min(5, "Give the customer a reason (5 characters or more)").max(1000),
  });

  // POST /api/ops/applications/:id/actions  { action, ...payload }
  app.post("/api/ops/applications/:id/actions", ...opsDbGate, async (req: Request, res: Response) => {
    const actorId = req.session.dbUserId;
    if (!actorId) {
      res.status(401).json({ message: "Not authenticated" });
      return;
    }
    const action = req.body?.action;
    if (!isOpsApplicationAction(action)) {
      res.status(400).json({ message: "Unknown action", code: "UNKNOWN_ACTION" });
      return;
    }
    const row = await getApplicationById(req.params.id);
    if (!row) {
      res.status(404).json({ message: "Application not found." });
      return;
    }
    if (!actionAllowed(action, row.status)) {
      res.status(409).json({
        message: "This application has already moved on. Refresh and look again.",
        code: "APPLICATION_STATE_CHANGED",
        status: row.status,
      });
      return;
    }
    const stale = (): void => {
      res.status(409).json({
        message: "Someone else acted on this application first. Refresh and look again.",
        code: "APPLICATION_STATE_CHANGED",
      });
    };

    switch (action) {
      case "claim": {
        const updated = await updateApplicationFrom(row.id, ACTION_FROM.claim, {
          status: "in_review",
          reviewer_id: actorId,
          claimed_at: new Date().toISOString(),
        });
        if (!updated) return stale();
        await insertApplicationEvent({ application_id: row.id, event: "claimed", actor_id: actorId });
        res.json({ application: queueItem(updated) });
        return;
      }

      case "release": {
        // The reviewer's own, or a super_admin taking it back from someone away.
        if (row.reviewer_id !== actorId && req.session.user?.role !== "super_admin") {
          res.status(403).json({ message: "Only the reviewer or a super admin can release this.", code: "FORBIDDEN" });
          return;
        }
        const updated = await updateApplicationFrom(row.id, ACTION_FROM.release, {
          status: "submitted",
          reviewer_id: null,
          claimed_at: null,
        });
        if (!updated) return stale();
        await insertApplicationEvent({ application_id: row.id, event: "released", actor_id: actorId });
        res.json({ application: queueItem(updated) });
        return;
      }

      case "request_changes": {
        const parsed = parseRequestedChanges(req.body);
        if (!parsed.ok) {
          res.status(parsed.status).json({ message: parsed.message, code: parsed.code });
          return;
        }
        const updated = await updateApplicationFrom(row.id, ACTION_FROM.request_changes, {
          status: "changes_requested",
          requested_changes: parsed.value,
          reviewer_id: row.reviewer_id ?? actorId,
        });
        if (!updated) return stale();
        await insertApplicationEvent({
          application_id: row.id,
          event: "changes_requested",
          actor_id: actorId,
          note: parsed.value.note || null,
          metadata: { fields: parsed.value.fields, slots: parsed.value.slots },
        });
        void notifyChangesRequested(updated);
        res.json({ application: queueItem(updated) });
        return;
      }

      case "reject": {
        const parsed = rejectSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid request" });
          return;
        }
        const updated = await updateApplicationFrom(row.id, ACTION_FROM.reject, {
          status: "rejected",
          decision_note: parsed.data.reason,
          decided_at: new Date().toISOString(),
          reviewer_id: row.reviewer_id ?? actorId,
        });
        if (!updated) return stale();
        await insertApplicationEvent({ application_id: row.id, event: "rejected", actor_id: actorId, note: parsed.data.reason });
        void notifyRejected(updated);
        res.json({ application: queueItem(updated) });
        return;
      }

      case "approve": {
        const parsed = approveSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid request" });
          return;
        }
        const result = await approveApplication({
          applicationId: row.id,
          reviewerId: actorId,
          itdEmail: parsed.data.itd_email,
          itdPassword: parsed.data.itd_password,
        });
        if (!result.ok) {
          res.status(result.error.status).json({ message: result.error.message, code: result.error.code });
          return;
        }
        res.json({
          application: queueItem(result.value.application),
          finalized: result.value.finalized,
          email_sent: result.value.emailSent,
        });
        return;
      }

      case "retry_finalize":
      case "resend_email": {
        const result = await finalizeApplication(row.id, { actorId, forceEmail: action === "resend_email" });
        await insertApplicationEvent({ application_id: row.id, event: action, actor_id: actorId });
        const latest = (await getApplicationById(row.id)) ?? row;
        res.json({
          application: queueItem(latest),
          finalized: result.finalized,
          email_sent: result.emailSent,
          error: result.error,
        });
        return;
      }
    }
  });

  // PUT /api/ops/customers/:id/itd-credentials — a new ITD login for an account.
  app.put("/api/ops/customers/:id/itd-credentials", ...opsDbGate, async (req: Request, res: Response) => {
    const parsed = approveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid request" });
      return;
    }
    const result = await replaceItdCredentials({
      userId: req.params.id,
      itdEmail: parsed.data.itd_email,
      itdPassword: parsed.data.itd_password,
    });
    if (!result.ok) {
      res.status(result.error.status).json({ message: result.error.message, code: result.error.code });
      return;
    }
    console.log(`[ops] ITD login replaced on ${req.params.id} by ${req.session.dbUserId ?? "unknown"}`);
    res.json({ updated: true });
  });
}
