import type { Transition, Variants } from 'framer-motion';

/**
 * The agent app's motion vocabulary, in one file.
 *
 * Every number a component animates comes from here. Motion that is tuned per
 * call site stops reading as one app: two screens spring at different rates and
 * the surface feels assembled rather than built. There are four ideas in the
 * whole system — pages scale through each other, lists arrive in order, presses
 * give way, and numbers pop when they change — and each has exactly one set of
 * numbers below.
 *
 * Timings are chosen for a phone held in one hand at arm's length in daylight,
 * which is where this app is actually used. Nothing here runs longer than
 * ~260ms: an agent tapping through six jobs must never wait on the animation.
 *
 * Every consumer pairs these with `useReducedMotion()` and falls back to a
 * plain opacity fade. The tokens themselves stay motion-full; the decision to
 * quiet them belongs to the component, not the token.
 */

/** Scale a page falls to as it leaves, and rises from as it arrives. */
export const PAGE_SCALE = 0.96;

/**
 * Leaving is faster than arriving and uses a duration, not a spring: a spring
 * settling toward opacity 0 wastes its tail on a thing nobody can see. Under
 * `mode="wait"` this is dead time before the next screen starts, so it is the
 * shortest thing in the file.
 */
export const PAGE_OUT: Transition = { duration: 0.13, ease: 'easeIn' };

/**
 * Arriving springs. `damping: 30` against `stiffness: 320` is just short of
 * critical, so the screen settles with a hint of overshoot — the difference
 * between a page that lands and a page that stops.
 */
export const PAGE_IN: Transition = {
  type: 'spring',
  stiffness: 320,
  damping: 30,
  mass: 0.8,
};

/** Opacity-only replacement used whenever the OS asks for less motion. */
export const REDUCED: Transition = { duration: 0.1, ease: 'linear' };

/** How far a staggered item rises into place. */
export const RISE = 8;

/**
 * 35ms between cards, and the delay stops growing after the sixth.
 *
 * Uncapped, a 30-job list would take a full second to finish arriving and the
 * agent would be reading a half-drawn screen. Past the cap every remaining card
 * shares the sixth one's delay, which is invisible — by then the eye has
 * already been given its sense of order.
 */
export const STAGGER_STEP = 0.035;
export const STAGGER_CAP = 6;

/** Entrance transition for one staggered item at list position `index`. */
export function staggerDelay(index: number): number {
  return Math.min(index, STAGGER_CAP) * STAGGER_STEP;
}

export const ITEM_IN: Transition = {
  type: 'spring',
  stiffness: 420,
  damping: 34,
  mass: 0.7,
};

/**
 * Press feedback. Stiffer and lighter than anything else here because the
 * finger is still on the glass: the response has to beat the press, not follow
 * it. 0.975 rather than the 0.98 the CSS used — the spring's release reads
 * softer, so the travel can be slightly larger without feeling like a bounce.
 */
export const TAP_SCALE = 0.975;
export const TAP: Transition = { type: 'spring', stiffness: 500, damping: 30 };

/**
 * A number that changed.
 *
 * The agent surface carries no toasts at all (see `SurfaceToaster` in App.tsx),
 * so a nav badge ticking up is the only signal an agent gets that the work
 * queue moved. It overshoots on purpose — this one is meant to be caught out of
 * the corner of an eye.
 */
export const POP: Transition = { type: 'spring', stiffness: 560, damping: 22 };

export const POP_VARIANTS: Variants = {
  initial: { scale: 0.4, opacity: 0 },
  animate: { scale: 1, opacity: 1 },
  exit: { scale: 0.4, opacity: 0 },
};

/**
 * The sliding active marker under the bottom nav's current tab, and any other
 * shared-element move. Slower than a press and heavier than a pop: it is a
 * physical object travelling a real distance across the bar.
 */
/**
 * Timing for the agent surface's bottom sheets, as Tailwind classes.
 *
 * The shared `Sheet` primitive ships 500ms open / 300ms close with
 * `ease-in-out`, which is a desktop drawer's timing. A sheet an agent opens at
 * a customer's door to take ₹4,820 in cash has to be there when they look
 * down. Passed through `cn()` at each agent call site rather than changed in
 * `components/ui/sheet.tsx` — the customer app's sheets are unaffected and stay
 * as they are.
 *
 * The curve decelerates hard at the end, so the panel arrives and settles
 * rather than coasting the last third of its travel.
 */
export const AGENT_SHEET_MOTION =
  'data-[state=open]:duration-300 data-[state=closed]:duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]';

export const INDICATOR: Transition = {
  type: 'spring',
  stiffness: 400,
  damping: 34,
  mass: 0.6,
};
