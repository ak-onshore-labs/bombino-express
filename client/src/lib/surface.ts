/**
 * A1 — which of the three products a URL belongs to, and where each role lands.
 *
 * One codebase serves customer, agent and ops. A person opening the app must
 * land in what feels like a different application depending on who they are.
 *
 * IMPORTANT: everything here is COSMETIC. It stops an agent stumbling into the
 * customer app and vice versa. It is not access control — that is enforced
 * server-side by `requireRole` (M1). Never rely on a check in this file to
 * keep anyone out of anything.
 */

import { isRole, roleSatisfies } from '@shared/orderContract';

export type Surface = 'customer' | 'agent' | 'ops';

/** Where each role goes on login, and when it hits a surface it doesn't own. */
const LANDING_BY_ROLE: Record<string, string> = {
  agent: '/agent',
  admin: '/ops',
  super_admin: '/ops',
  customer: '/home',
};

/**
 * Landing path for a role. Unknown roles fall through to the customer home —
 * ITD password logins return arbitrary role strings, and stranding those users
 * on a blank screen would be worse than showing them the app they had before.
 */
export function landingPathForRole(role: string | undefined): string {
  if (!role) return '/home';
  return LANDING_BY_ROLE[role] ?? '/home';
}

export function surfaceForPath(path: string): Surface {
  if (path === '/agent' || path.startsWith('/agent/')) return 'agent';
  if (path === '/ops' || path.startsWith('/ops/')) return 'ops';
  return 'customer';
}

export function surfaceForRole(role: string | undefined): Surface {
  if (role === 'agent') return 'agent';
  if (isRole(role) && roleSatisfies(role, 'admin')) return 'ops';
  return 'customer';
}

/**
 * Paths every role may reach regardless of surface — auth, legal, and the
 * splash redirector. Without this an agent could never reach /login to sign
 * out of a bad session.
 *
 * `/profile` is deliberately NOT here. It is the customer's account page — KYC
 * upload, username, the customer nav — and an agent who reached it got all of
 * that wrapped in the wrong app. They have their own at `/agent/profile`, and
 * landing on this path now bounces them home.
 */
const SURFACE_AGNOSTIC = new Set(['/', '/login', '/signup', '/onboarding', '/privacy']);

export function isSurfaceAgnostic(path: string): boolean {
  return SURFACE_AGNOSTIC.has(path);
}
