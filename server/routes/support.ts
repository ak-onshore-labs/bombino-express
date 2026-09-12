/**
 * BIA's HTTP surface: the chat endpoint, starter chips, and the signed-in
 * user's saved conversation.
 *
 * Moved here from routes.ts unchanged (BIA 3.0, package 0.2) so the packages
 * that grow BIA do not all edit the same 5,000-line file. Registered from the
 * spot the block used to occupy, so route order is exactly what it was.
 *
 * Identity comes from the session alone: `supportContextFor` is the only
 * place a request turns into a SupportChatContext, and every BIA tool reads
 * ownership from that context.
 */

import crypto from "node:crypto";
import type { Express, Request, Response } from "express";
import {
  createNewSupportSession,
  generateSessionTitle,
  getOrCreateSupportSession,
  isSupportSessionOwnedBy,
  resolveSupportSession,
  updateSupportSessionMessages,
  type SupportSessionOwner,
} from "../appDb.js";
import { refreshItdTokenIfNeeded } from "../itdTokenRefresh.js";
import { ensureDbUser } from "../routeGuards.js";
import { parseBiaScreen, type BiaScreen } from "../../shared/biaScreen.js";
import { handleChat } from "../supportAgent.js";
import { maskSensitive } from "../supportPrivacy.js";
import { isChatUploadOutcome, rateTurn, recordChatUpload, recordTurn, type RatingOwner } from "../supportTelemetry.js";
import { suggestionsFor } from "../supportOrders.js";
import { supportChatRateLimit } from "../supportRateLimit.js";
import {
  SUPPORT_CHAT_MAX_CONTENT_LENGTH,
  SUPPORT_CHAT_MAX_MESSAGES,
  type ChatMessage,
  type SupportChatContext,
} from "../supportTypes.js";

export function registerSupportRoutes(app: Express): void {
  /**
   * Who BIA is talking to, from the session alone. A signed-in account wins;
   * otherwise a guest ref, which only an OTP on `guestPhone` can have minted.
   * BIA's order tools read ownership from here and nowhere else.
   */
  function supportContextFor(
    req: Request,
    sessionId: string | null,
    screen: BiaScreen | null = null
  ): SupportChatContext {
    const dbUserId = req.session.dbUserId ?? null;
    const isLoggedIn = !!req.session.user && !!dbUserId;
    return {
      user: req.session.user ?? null,
      itdToken: req.session.itdToken ?? null,
      dbUserId,
      sessionId,
      guestRef: isLoggedIn ? null : (req.session.guestRef ?? null),
      guestPhone: isLoggedIn ? null : (req.session.guestPhone ?? null),
      // Only a signup bound to the number this session verified; the same
      // rule as signupRefForReading in routes.ts.
      signupRef: !isLoggedIn && req.session.signupPhone ? (req.session.signupRef ?? null) : null,
      screen,
    };
  }

  /**
   * Whose saved conversation this request may read and write: the signed-in
   * account, else the guest whose phone this session verified, else nobody.
   * A guest's is kept once migrations/support_sessions_guest_ref.sql has run;
   * before that the guest calls fail soft and the chat keeps it in the tab.
   */
  function sessionOwnerFor(req: Request): SupportSessionOwner | null {
    const dbUserId = req.session.dbUserId ?? null;
    if (req.session.user && dbUserId) return { userId: dbUserId };
    if (req.session.guestRef) return { guestRef: req.session.guestRef };
    return null;
  }

  // POST /api/support/chat — guest and logged-in. Body: { messages, sessionId?, screen? };
  // returns { message, sessionId, suggestions, cards }.
  app.post(
    "/api/support/chat",
    ensureDbUser,
    refreshItdTokenIfNeeded,
    supportChatRateLimit,
    async (req: Request, res: Response) => {
    const body = req.body as { messages?: unknown; sessionId?: unknown; screen?: unknown };
    const messages = body?.messages;
    const bodySessionId =
      typeof body?.sessionId === "string" && body.sessionId.trim() !== ""
        ? body.sessionId.trim()
        : null;

    if (!Array.isArray(messages)) {
      res.status(400).json({ message: "messages must be an array" });
      return;
    }
    if (messages.length < 1 || messages.length > SUPPORT_CHAT_MAX_MESSAGES) {
      res.status(400).json({
        message: `messages must have 1–${SUPPORT_CHAT_MAX_MESSAGES} items`,
      });
      return;
    }

    for (let i = 0; i < messages.length; i++) {
      const m = messages[i] as Record<string, unknown>;
      if (m?.role !== "user" && m?.role !== "assistant") {
        res.status(400).json({
          message: `messages[${i}]: role must be "user" or "assistant"`,
        });
        return;
      }
      if (typeof m?.content !== "string") {
        res.status(400).json({
          message: `messages[${i}]: content must be a string`,
        });
        return;
      }
      if (m.content.length > SUPPORT_CHAT_MAX_CONTENT_LENGTH) {
        res.status(400).json({
          message: `messages[${i}]: content must be at most ${SUPPORT_CHAT_MAX_CONTENT_LENGTH} characters`,
        });
        return;
      }
    }

    // Identity numbers are masked to their last four before anything else sees
    // them: the model, and the transcript we store (server/supportPrivacy.ts).
    const chatMessages: ChatMessage[] = messages.map((m: Record<string, unknown>) => ({
      role: m.role as "user" | "assistant",
      content: maskSensitive(String(m.content)),
    }));

    const dbUserId = req.session.dbUserId ?? null;
    const isLoggedIn = !!req.session.user && !!dbUserId;

    const owner = sessionOwnerFor(req);
    let activeSessionId: string | null = null;
    if (owner) {
      // The client's session id is only a hint. Unchecked, anyone could name
      // someone else's session and overwrite that transcript.
      if (bodySessionId && (await isSupportSessionOwnedBy(bodySessionId, owner))) {
        activeSessionId = bodySessionId;
      } else {
        const row = await getOrCreateSupportSession(owner);
        activeSessionId = row?.id ?? null;
      }
    }

    // Only known surfaces, steps, order-number shapes and catalogued error codes
    // survive; anything else the client sent is dropped here, before the model.
    const context = supportContextFor(req, activeSessionId, parseBiaScreen(body?.screen));
    const turnId = crypto.randomUUID();

    try {
      const startedAt = Date.now();
      const { message, suggestions, cards, meta } = await handleChat(chatMessages, context);
      const stored: ChatMessage[] = [
        ...chatMessages,
        { role: "assistant" as const, content: message },
      ];

      if (activeSessionId) {
        const firstUser = chatMessages.find((m) => m.role === "user");
        const titleCandidate =
          firstUser !== undefined
            ? generateSessionTitle(firstUser.content)
            : undefined;
        void updateSupportSessionMessages(
          activeSessionId,
          stored,
          titleCandidate
        );

        const lastUserMsg =
          chatMessages
            .filter((m) => m.role === "user")
            .at(-1)
            ?.content?.toLowerCase() ?? "";
        const isThankyou = [
          "thank you",
          "thanks",
          "bye",
          "goodbye",
          "perfect",
          "great",
        ].some((phrase) => lastUserMsg.includes(phrase));
        const hasContactCta = message
          .toLowerCase()
          .includes("tap_contact_us");
        if (isThankyou && !hasContactCta && activeSessionId) {
          void resolveSupportSession(activeSessionId);
        }
      }

      res.json({
        message,
        sessionId: activeSessionId,
        suggestions,
        cards,
        turnId,
      });

      // After the reply is on its way: the customer never waits on the log.
      void recordTurn({
        id: turnId,
        sessionId: activeSessionId,
        ownerKind: isLoggedIn ? "account" : context.guestRef ? "guest" : "anon",
        userId: isLoggedIn ? dbUserId : null,
        guestRef: isLoggedIn ? null : context.guestRef,
        surface: context.screen?.surface ?? null,
        step: context.screen?.step ?? null,
        errorCode: context.screen?.errorCode ?? null,
        modules: meta.modules,
        tools: meta.tools,
        cardKinds: cards.map((c) => c.kind),
        latencyMs: Date.now() - startedAt,
        fallback: meta.fallback,
        promptTokens: meta.promptTokens,
        completionTokens: meta.completionTokens,
      });
    } catch {
      res.status(500).json({
        message:
          "Something went wrong. Please try again or contact support from the app menu.",
      });
    }
  });

  // POST /api/support/feedback — a thumbs up or down on one of the caller's own
  // answers. Body: { turnId, rating: 1 | -1 }. 404 for a turn that isn't
  // theirs, doesn't exist, or can't be recorded yet — alike, on purpose.
  app.post(
    "/api/support/feedback",
    ensureDbUser,
    async (req: Request, res: Response) => {
      const body = req.body as { turnId?: unknown; rating?: unknown };
      const turnId = typeof body?.turnId === "string" ? body.turnId.trim() : "";
      const rating = body?.rating === 1 || body?.rating === -1 ? body.rating : null;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(turnId) || rating === null) {
        res.status(400).json({ message: "turnId and a rating of 1 or -1 are required" });
        return;
      }
      const context = supportContextFor(req, null);
      const owner: RatingOwner =
        context.user && context.dbUserId
          ? { kind: "account", userId: context.dbUserId }
          : context.guestRef
            ? { kind: "guest", guestRef: context.guestRef }
            : { kind: "anon" };
      const result = await rateTurn(turnId, rating, owner);
      if (result === "ok") res.json({ ok: true });
      else res.status(404).json({ message: "That answer could not be rated." });
    }
  );

  // POST /api/support/upload-outcome — what came of an upload from one of the
  // caller's own BIA upload cards, for the turn log. Body: { turnId, outcome }.
  // Telemetry only: the upload itself went to the screen's own endpoint.
  app.post(
    "/api/support/upload-outcome",
    ensureDbUser,
    async (req: Request, res: Response) => {
      const body = req.body as { turnId?: unknown; outcome?: unknown };
      const turnId = typeof body?.turnId === "string" ? body.turnId.trim() : "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(turnId) || !isChatUploadOutcome(body?.outcome)) {
        res.status(400).json({ message: "turnId and a known outcome are required" });
        return;
      }
      const context = supportContextFor(req, null);
      const owner: RatingOwner =
        context.user && context.dbUserId
          ? { kind: "account", userId: context.dbUserId }
          : context.guestRef
            ? { kind: "guest", guestRef: context.guestRef }
            : { kind: "anon" };
      const result = await recordChatUpload(turnId, body.outcome, owner);
      if (result === "ok") res.json({ ok: true });
      else res.status(404).json({ message: "That answer could not be found." });
    }
  );

  // GET /api/support/suggestions — starter chips for an empty chat, led by the
  // caller's own live orders. Anyone may call it; an anonymous caller gets the
  // generic set.
  app.get(
    "/api/support/suggestions",
    ensureDbUser,
    async (req: Request, res: Response) => {
      const chips = await suggestionsFor(supportContextFor(req, null));
      res.json({ chips });
    }
  );

  // GET /api/support/session — the caller's open conversation: an account's,
  // or a verified guest's. Anyone else has none to read.
  app.get(
    "/api/support/session",
    ensureDbUser,
    async (req: Request, res: Response) => {
      const owner = sessionOwnerFor(req);
      if (!owner) {
        res.status(401).json({ message: "Not authenticated" });
        return;
      }

      const row = await getOrCreateSupportSession(owner);
      if (!row) {
        res.json({
          sessionId: null,
          messages: [] as ChatMessage[],
          title: null as string | null,
        });
        return;
      }

      res.json({
        sessionId: row.id,
        messages: row.messages,
        title: row.title,
      });
    }
  );

  // POST /api/support/new-session — start a fresh conversation, for an account
  // or a verified guest.
  app.post(
    "/api/support/new-session",
    ensureDbUser,
    async (req: Request, res: Response) => {
      const owner = sessionOwnerFor(req);
      if (!owner) {
        res.status(401).json({ message: "Not authenticated" });
        return;
      }

      const created = await createNewSupportSession(owner);
      if (!created) {
        res.status(503).json({ message: "Could not create a new session" });
        return;
      }

      res.json({ sessionId: created.id });
    }
  );
}
