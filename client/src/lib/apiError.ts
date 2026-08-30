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
