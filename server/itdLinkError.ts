/**
 * What the customer is told when linking an ITD login fails.
 *
 * `itdClient.loginUser` throws ITD's own wording: "ITD auth failed: 401
 * Unauthorized" for an HTTP refusal, ITD's `errors` list (or "Invalid
 * credentials") for a 200 that says no, and `withTimeout` adds "… timed out
 * after Nms". None of that is for a customer. Two cases matter to them: the
 * email and password did not match, or Bombino's system could not be reached
 * and trying again later may work. The raw message is for the log.
 */
export interface ItdLinkFailure {
  status: 401 | 502;
  code: "ITD_LOGIN_FAILED" | "ITD_UNAVAILABLE";
  message: string;
}

const UNREACHABLE = /timed out|fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|ITD auth failed: 5\d\d/i;

export function itdLinkFailure(raw: string): ItdLinkFailure {
  if (UNREACHABLE.test(raw)) {
    return {
      status: 502,
      code: "ITD_UNAVAILABLE",
      message: "We couldn't reach Bombino's system just now. Please try again in a minute.",
    };
  }
  return {
    status: 401,
    code: "ITD_LOGIN_FAILED",
    message:
      "That email and password didn't match a Bombino account. Check them, or use the ones you sign in to the Bombino portal with.",
  };
}
