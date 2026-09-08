import { useLayoutEffect } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { PAGE_IN, PAGE_OUT, PAGE_SCALE, REDUCED } from '@/lib/motion';

/**
 * One screen, arriving and leaving.
 *
 * The effect is depth: the outgoing screen falls away from the viewer while the
 * incoming one rises to meet them. No horizontal slide, so there is no forward/
 * back direction to track and no wrong-way animation when a redirect fires.
 *
 * Two constraints shaped this component, and both are easy to break:
 *
 * 1. **It must sit inside `<AnimatePresence mode="wait">`.** Under any other
 *    mode both screens are mounted at once, and since the agent list screens are
 *    `min-h-[100dvh]` and scroll the document, two of them stacked double the
 *    page height and jump the scrollbar mid-transition. `wait` keeps exactly one
 *    screen in the DOM, which is why the exit above is kept so short.
 *
 * 2. **Nothing that must stay still may live inside it.** An animating
 *    `transform` becomes the containing block for `position: fixed`
 *    descendants, so a fixed bottom nav rendered under here would scale and
 *    drift with the page. `AgentNav` is mounted above this wrapper in
 *    `routes.agent.tsx` for exactly that reason.
 *
 * No height, no overflow, no background: the screen inside owns its own box.
 * `AgentShell` is `min-h-[100dvh]` and `AgentJobSheet` is `h-[100dvh]`, and a
 * wrapper with opinions about either would break one of them.
 */
export function PageTransition({
  children,
  className,
}: {
  children: React.ReactNode;
  /** Rarely needed — this wrapper is deliberately styleless. */
  className?: string;
}) {
  const quiet = useReducedMotion();

  /**
   * Land at the top of the new screen.
   *
   * There is no scroll restoration anywhere in this app, so without this an
   * agent who scrolls to the bottom of a long job list and opens a job arrives
   * halfway down the job. `useLayoutEffect` so it happens before paint, in the
   * same frame the screen mounts — in an effect it shows as a visible jump.
   *
   * A no-op on the job sheet, which scrolls inside its own div rather than the
   * document.
   */
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // Reduced motion keeps the crossfade — some signal that the screen changed is
  // worth having — and drops every scale.
  const from = quiet ? { opacity: 0 } : { opacity: 0, scale: PAGE_SCALE };
  const to = quiet ? { opacity: 1 } : { opacity: 1, scale: 1 };

  return (
    <motion.div
      initial={from}
      animate={to}
      // Leaving carries its own, shorter transition. Under `mode="wait"` this
      // runs before the next screen starts, so it is pure latency and a spring's
      // settle would be spent on something already invisible.
      exit={{ ...from, transition: quiet ? REDUCED : PAGE_OUT }}
      transition={
        quiet
          ? REDUCED
          : { ...PAGE_IN, opacity: { duration: 0.16, ease: 'easeOut' } }
      }
      // Above centre: the eye sits nearer the top of a phone screen, and scaling
      // about the true middle drags the header down as the page arrives.
      style={{ transformOrigin: '50% 30%' }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
