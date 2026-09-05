import { useEffect } from 'react';

/**
 * Lift the support orb while this screen owns the bottom band.
 *
 * The orb is fixed just above the bottom nav, which is exactly where a form
 * parks its Continue bar and where a profile ends in Sign out. Two tap targets
 * in one place is a tap the customer loses to the wrong one.
 *
 * Driven by a CSS variable rather than by the route, because the route is a
 * poor proxy: /create is a sticky action bar once you are in the form and a
 * short centred card before that, and raising the orb on the second put it on
 * top of "Use a different number". A component that actually renders a bottom
 * control declares it; nothing else has to know.
 *
 * The orb is mounted by BottomNav, far from any of these screens, so a CSS
 * variable on the root is what carries the message — no context, no props
 * threaded through three components that do not care.
 */
const FAB_BOTTOM = '--fab-bottom';
const RAISED = 'calc(4rem + env(safe-area-inset-bottom, 0px) + 5.5rem)';

export function useRaisedSupportFab(active = true): void {
  useEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    root.style.setProperty(FAB_BOTTOM, RAISED);
    return () => {
      // removeProperty returns the old value; the effect cleanup must return
      // nothing, so it is swallowed here rather than handed back to React.
      root.style.removeProperty(FAB_BOTTOM);
    };
  }, [active]);
}
