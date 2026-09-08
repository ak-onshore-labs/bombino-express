import { forwardRef } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { TAP, TAP_SCALE } from '@/lib/motion';

/**
 * A button that gives way under the finger.
 *
 * Replaces the `active:scale-[0.98]` this surface used everywhere. The CSS
 * version snaps back the instant the finger lifts; the spring releases, which
 * on a 56–60px button pressed with gloves on is the difference between a
 * control that acknowledges you and one that merely redraws.
 *
 * `whileTap` also covers the case CSS `:active` handles badly on touch — a
 * press that slides off the target releases the scale instead of leaving the
 * button stuck down.
 *
 * Every prop passes through, so this is a drop-in for the `<button>` it
 * replaces: `type`, `disabled`, `onClick`, `data-testid`, `className`.
 */
export const PressableButton = forwardRef<
  HTMLButtonElement,
  React.ComponentProps<typeof motion.button>
>(function PressableButton({ children, disabled, ...rest }, ref) {
  const quiet = useReducedMotion();

  return (
    <motion.button
      ref={ref}
      disabled={disabled}
      // A disabled button must not move: the scale would read as a press that
      // did something.
      whileTap={quiet || disabled ? undefined : { scale: TAP_SCALE }}
      transition={TAP}
      {...rest}
    >
      {children}
    </motion.button>
  );
});

/**
 * The same feedback on something that is not a button — a card whose whole body
 * is a link, most often.
 *
 * Kept separate rather than given an `as` prop: `motion.div` and `motion.button`
 * have different prop types, and collapsing them costs more in casts than the
 * duplication costs in lines.
 */
export const PressableBox = forwardRef<
  HTMLDivElement,
  React.ComponentProps<typeof motion.div>
>(function PressableBox({ children, ...rest }, ref) {
  const quiet = useReducedMotion();

  return (
    <motion.div
      ref={ref}
      whileTap={quiet ? undefined : { scale: TAP_SCALE }}
      transition={TAP}
      {...rest}
    >
      {children}
    </motion.div>
  );
});
