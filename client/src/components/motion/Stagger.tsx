import { motion, useReducedMotion } from 'framer-motion';
import { ITEM_IN, REDUCED, RISE, staggerDelay } from '@/lib/motion';

/**
 * A column of things that arrive in order.
 *
 * Deliberately *not* built on framer's `staggerChildren`, which needs a parent
 * with its own variants and propagates through every intermediate element. The
 * agent lists put real markup between the column and each card — a `<section>`,
 * a band header, a `<Link>` wrapping the body — and variant propagation through
 * that is fragile in a way an explicit per-item delay is not.
 *
 * Each item owns its delay, computed from its index, and animates on mount.
 * That distinction matters here: React Query polls these lists in the
 * background, and a refetch re-renders without remounting as long as keys are
 * stable (they are — every card is keyed by its order id). So a poll does not
 * re-stagger the list; only genuinely new jobs animate in, one after the other,
 * which is precisely the signal worth giving.
 */
export function StaggerItem({
  index,
  children,
  className,
  ...rest
}: {
  /** Position in the list. Delay is capped — see `staggerDelay`. */
  index: number;
  children: React.ReactNode;
  className?: string;
} & React.ComponentProps<typeof motion.div>) {
  const quiet = useReducedMotion();

  if (quiet) {
    // No rise, no ladder — every item fades at once. A staggered entrance is
    // exactly the kind of motion the setting is asking to be spared.
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={REDUCED} className={className} {...rest}>
        {children}
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: RISE }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...ITEM_IN, delay: staggerDelay(index) }}
      className={className}
      {...rest}
    >
      {children}
    </motion.div>
  );
}
