/**
 * Who an agent calls from the Problem button.
 *
 * FOR NOW one person for every agent: Ali, the Mumbai branch head (6 Oct 2026).
 * When each city has its own branch head this should come from the server —
 * the branch manager whose city matches the agent's (shared/staffAccess.ts) —
 * rather than from here.
 */
export const BRANCH_HEAD = {
  name: 'Ali',
  phone: '9930141954',
} as const;
