// apiRequest throws Error(`${status}: ${bodyText}`), and route handlers send
// JSON bodies (`{"message": "..."}`) — this unwraps that back to plain text.
export function parseApiErrorMessage(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback;
  const stripped = err.message.replace(/^\d+:\s*/, '');
  try {
    const parsed = JSON.parse(stripped) as { message?: string };
    return parsed.message || fallback;
  } catch {
    return stripped || fallback;
  }
}

/**
 * The machine-readable `code` a route handler sent alongside its message.
 *
 * Callers that need to *act* on a failure — rather than only show it — read
 * this instead of matching on the prose, so rewording a message cannot
 * silently break the behaviour behind it. Returns null when the body carried
 * no code, which is most of them.
 */
export function parseApiErrorCode(err: unknown): string | null {
  if (!(err instanceof Error)) return null;
  const stripped = err.message.replace(/^\d+:\s*/, '');
  try {
    const parsed = JSON.parse(stripped) as { code?: unknown };
    return typeof parsed.code === 'string' ? parsed.code : null;
  } catch {
    return null;
  }
}

/**
 * The HTTP status a thrown fetch error carries, when it has one.
 *
 * Every client fetch path throws `Error("<status>: <body>")` (see
 * `readJson` / `throwIfResNotOk` in lib/queryClient.ts), so the status is
 * recoverable without threading a second value through React Query.
 */
export function apiErrorStatus(err: unknown): number | null {
  if (!(err instanceof Error)) return null;
  const match = /^(\d{3}):/.exec(err.message);
  return match ? Number(match[1]) : null;
}

/** A signed-in staff member without the role this screen needs. */
export function isForbiddenError(err: unknown): boolean {
  return apiErrorStatus(err) === 403;
}

/** The record is not there — usually a stale link, not a fault. */
export function isNotFoundError(err: unknown): boolean {
  return apiErrorStatus(err) === 404;
}
