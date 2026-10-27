/**
 * Which assigned jobs this agent has already looked at, on this phone.
 *
 * The branch head assigns pickups from the ops console and the agent gets no
 * toast for it (the agent surface has none). Home names the one job in their
 * hands, so a second job arriving went unnoticed. Home now says "new job" for
 * any job this phone has not yet shown on My jobs.
 *
 * Per-device convenience only. Storage can be missing or throw (private mode,
 * cleared data); then every waiting job reads as new, which is the safe side.
 */

const KEY = 'bombino-agent-seen-jobs';
/** Old ids are dropped past this; a job leaves the list at the hub anyway. */
const MAX_IDS = 200;

export function seenJobIds(): Set<string> {
  try {
    const raw = window.localStorage.getItem(KEY);
    const ids: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

export function markJobsSeen(ids: readonly string[]): void {
  if (ids.length === 0) return;
  try {
    const merged = [...new Set([...seenJobIds(), ...ids])].slice(-MAX_IDS);
    window.localStorage.setItem(KEY, JSON.stringify(merged));
  } catch {
    // Nothing to do: the card simply shows again next time.
  }
}
