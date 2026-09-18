import type { NextFunction, Request, Response } from "express";

const LOGGED_IN_LIMIT = 20;
const GUEST_LIMIT = 10;
const WINDOW_MS = 60 * 60 * 1000; // 1 hour
/** How often expired windows are swept, so idle keys don't pile up. */
const PRUNE_EVERY_MS = 10 * 60 * 1000;

/**
 * Fixed-window counter held in this process.
 *
 * It replaced a Redis counter that let every message through whenever Redis
 * was slow or missing — the limit is what caps OpenAI spend, so it must never
 * fail open. Railway runs one replica, so one process sees every request. If
 * the service is ever scaled out (or served from Vercel's serverless
 * functions), each instance counts on its own and the effective limit becomes
 * limit × instances.
 */
export class FixedWindowLimiter {
  private windows = new Map<string, { count: number; resetAt: number }>();
  private lastPrune = 0;

  constructor(private readonly windowMs: number) {}

  /** Counts one hit against `key` and returns the count inside the current window. */
  hit(key: string, now = Date.now()): number {
    this.prune(now);
    const current = this.windows.get(key);
    if (!current || current.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      return 1;
    }
    current.count += 1;
    return current.count;
  }

  size(): number {
    return this.windows.size;
  }

  private prune(now: number): void {
    if (now - this.lastPrune < PRUNE_EVERY_MS) return;
    this.lastPrune = now;
    for (const [key, w] of this.windows) {
      if (w.resetAt <= now) this.windows.delete(key);
    }
  }
}

const limiter = new FixedWindowLimiter(WINDOW_MS);

export function supportChatRateLimit(req: Request, res: Response, next: NextFunction): void {
  const dbUserId = req.session.dbUserId;
  const isLoggedIn = !!dbUserId;

  const key = isLoggedIn
    ? `support:${dbUserId}`
    : `support:ip:${req.ip || req.socket.remoteAddress || "unknown"}`;

  const limit = isLoggedIn ? LOGGED_IN_LIMIT : GUEST_LIMIT;

  if (limiter.hit(key) > limit) {
    res.status(200).json({
      message:
        "I've reached my message limit " +
        "for now. You can continue our " +
        "conversation in about an hour, " +
        "or contact our team directly " +
        "for immediate help." +
        "\nTAP_CONTACT_US",
      sessionId: null,
      rateLimited: true,
    });
    return;
  }

  next();
}
