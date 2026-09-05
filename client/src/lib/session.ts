/**
 * What happens when the server stops recognising us.
 *
 * The bug this exists to close: `isLoggedIn` and `user` are persisted to
 * localStorage, so once the server session expired the app carried on
 * rendering the previous user's name, orders and addresses from disk. Every
 * action failed — the server was refusing correctly — but nothing told the
 * client to stop pretending. On a shared or borrowed phone that leaves one
 * person's details on screen for whoever picks it up next, and for the real
 * user it looks like the app is simply broken.
 *
 * Handled in one place rather than per call site. Before this, exactly one
 * mutation (order creation) knew how to sign out on a 401; every other screen
 * silently swallowed it.
 */

import { useAppStore } from '@/lib/store';

/**
 * Endpoints where a 401 is an answer, not an expiry.
 *
 * `/api/auth/*` covers login and the session probe itself: a failed login must
 * report "wrong code", not bounce the user to the screen they are already on,
 * and the probe's own 401 is handled by its caller. `/api/kyc/me` returns 401
 * for "no document on file" and is read by a hook that treats it as null.
 * `/api/account/verification` is the same shape: the banner asks it on every
 * customer screen, including ones a signed-out visitor can reach, and its 401
 * means "nobody is signed in" rather than "your session just died".
 *
 * `/api/payments/` is the guest case. A guest pays for the order they just
 * booked with no `session.user` at all, so a 401 from these endpoints does not
 * distinguish "your session died" from "you never had one" — and treating it
 * as an expiry signed a guest out of their own checkout and dropped them on
 * the login screen. The payment call reports its own failure to the customer;
 * a genuinely dead account session is still caught by `verifySession` on the
 * next foreground, and by the first non-payment request.
 */
const NOT_AN_EXPIRY = [
  '/api/auth/',
  '/api/kyc/me',
  '/api/account/verification',
  '/api/payments/',
  // The guest's own endpoints. Their 401 means "no verified number in this
  // browser" — the normal state for a visitor — and treating it as an expiry
  // would bounce a guest to the login screen for looking at their own profile.
  '/api/guest/',
];

function isExpiryPath(url: string): boolean {
  return !NOT_AN_EXPIRY.some((prefix) => url.includes(prefix));
}

/**
 * True once a sign-out is under way.
 *
 * A dead session usually surfaces as several parallel 401s — a screen firing
 * three queries at once gets three. Without this latch each one would clear
 * the store and issue its own redirect, and the toast would stack.
 */
let signingOut = false;

/**
 * Tear down the local session and send the user to sign in.
 *
 * `window.location.assign` rather than a router push, deliberately: a full
 * document load is the only way to guarantee no component is left holding
 * state derived from the dead session. This is the one place in the app where
 * losing in-memory state is the point.
 */
export function handleSessionExpired(): void {
  if (signingOut) return;
  signingOut = true;

  // Clears `isLoggedIn` and `user` from localStorage. The React Query cache
  // needs no explicit clear: the redirect below is a full document load, which
  // discards it along with every other piece of in-memory state.
  useAppStore.getState().logout();

  // Best effort — the session is already gone server-side, and the redirect
  // must not wait on the network to come back.
  void fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});

  // Already on the sign-in screen: clear the dead session and leave them
  // alone. Navigating would reload the page out from under a half-typed phone
  // number or OTP, and a banner about an old session expiring is noise to
  // someone who is already signing in.
  if (window.location.pathname === '/login') {
    signingOut = false;
    return;
  }

  // `redirect` is the param the login screen already honours, so the user
  // lands back where they were once they sign in again. `expired` is what
  // tells that screen to say why they were interrupted.
  const returnTo = window.location.pathname + window.location.search;
  window.location.assign(`/login?expired=1&redirect=${encodeURIComponent(returnTo)}`);
}

/** Call on every response. Returns true when the 401 meant "session gone". */
export function checkUnauthorized(url: string, status: number): boolean {
  if (status !== 401 || !isExpiryPath(url)) return false;
  handleSessionExpired();
  return true;
}

/**
 * Watch every response the app makes, not just the ones routed through
 * `apiRequest`.
 *
 * Twenty-one files call `fetch` directly with `credentials: 'include'` — the
 * agent hooks, the address picker, the order detail loader, the schedule
 * screen. Threading a wrapper through all of them would leave the next raw
 * fetch someone writes uncovered, which is how this bug survived in the first
 * place. Patching once here means a dead session is caught wherever it
 * surfaces.
 *
 * Reads `status` and the URL only, never the body, so the response reaches its
 * caller untouched and can still be consumed normally.
 */
export function installSessionInterceptor(): void {
  const original = window.fetch;

  window.fetch = async (...args: Parameters<typeof fetch>): Promise<Response> => {
    const res = await original(...args);

    try {
      const [input] = args;
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input instanceof Request
              ? input.url
              : '';
      // Only our own API. A 401 from anywhere else is not our session.
      if (url.includes('/api/')) checkUnauthorized(url, res.status);
    } catch {
      // Never let the interceptor break the request it is observing.
    }

    return res;
  };
}

/**
 * Ask the server whether the persisted session is still real.
 *
 * The 401 interceptor only fires once something is requested, and a screen
 * built entirely from persisted state requests nothing — the agent dashboard
 * and the profile page both render a name straight from localStorage. This is
 * what catches that case: it runs on mount and whenever the tab is brought
 * back to the foreground, which is exactly when a phone has been sitting in a
 * pocket long enough for the session to lapse.
 *
 * A network failure is explicitly not an expiry. Being offline in a stairwell
 * must not sign an agent out mid-shift.
 */
export async function verifySession(): Promise<void> {
  if (!useAppStore.getState().isLoggedIn) return;

  let res: Response;
  try {
    res = await fetch('/api/auth/me', { credentials: 'include', cache: 'no-store' });
  } catch {
    return; // offline, not expired
  }

  if (res.status === 401) handleSessionExpired();
}
