import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { LayoutGrid, PackageSearch, ClipboardList, Wallet } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { cn } from '@/lib/utils';
import { INDICATOR, POP, POP_VARIANTS } from '@/lib/motion';
import { useAvailablePickups, useMyPickups } from '@/hooks/useAgentPickups';

/**
 * Agent bottom navigation — the agent surface's own bar, not the shared
 * `TabBar`.
 *
 * Forked rather than given a `variant` prop: almost nothing survives. The bar
 * is 70px not 64, the labels are plain sans in sentence case, the active item
 * is marked by a 2px amber rule along its top edge instead of a floating white
 * pill, and there is no shadow and no rounding anywhere. A variant that changed
 * all of that would be two components sharing a file, and the customer app
 * still uses `TabBar` as it stands.
 *
 * Four tabs, ordered by how often a working agent needs them. Five is the
 * ceiling: past that, labels truncate and targets fall below the touch minimum
 * on a 360px phone. The fifth used to be My week, the weekly availability
 * editor, which went when pickups stopped carrying a time window.
 *
 * Labels are shorter than the routes they point at — New, My jobs, Money —
 * because the full words do not fit. Routes are unchanged.
 *
 * The two work tabs carry live counts. Both queries are already warm from the
 * screens themselves, so this costs nothing extra. A badge is a count of work
 * owed, which is money's neighbour, so it is amber.
 *
 * Not hidden on desktop: this surface is phone-only, so there is no sidebar to
 * hand over to.
 *
 * Mounted once for the whole surface, in `routes.agent.tsx`, above the page
 * transition — a `fixed` element inside an animating `transform` takes that
 * transform as its containing block and rides along with the page. Living
 * outside it also means this component does not remount when the screen
 * changes, which is what lets the active marker travel between tabs rather than
 * blink from one to the next.
 */

interface AgentTab {
  icon: typeof LayoutGrid;
  label: string;
  path: string;
  badge?: number;
}

export function AgentNav() {
  const [location] = useLocation();
  const quiet = useReducedMotion();
  const { data: available } = useAvailablePickups();
  const { data: mine } = useMyPickups();

  const items: AgentTab[] = [
    { icon: LayoutGrid, label: 'Home', path: '/agent' },
    { icon: PackageSearch, label: 'New', path: '/agent/available', badge: available?.length },
    { icon: ClipboardList, label: 'My jobs', path: '/agent/mine', badge: mine?.length },
    { icon: Wallet, label: 'Money', path: '/agent/collections' },
  ];

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-[#1B2A41] safe-bottom"
      data-testid="agent-nav"
    >
      <div className="flex items-stretch h-[70px] max-w-md mx-auto">
        {items.map(({ icon: Icon, label, path, badge }) => {
          // Exact match on the surface root so a detail route doesn't light up
          // two tabs at once; prefix match for the rest. The job sheet lives
          // under /agent/pickup and belongs to neither, which is correct — it
          // has its own back target in the top bar.
          const isActive = path === '/agent' ? location === path : location.startsWith(path);
          const testId = label.toLowerCase().replace(/\s+/g, '-');

          return (
            <Link
              key={path}
              href={path}
              // The top border stays on every tab and stays transparent on all
              // of them: it is now spacing only, holding the 2px the marker
              // occupies so nothing shifts as the marker moves in and out.
              className={cn(
                'agent-surface relative flex-1 flex flex-col items-center justify-center gap-1.5 border-t-2 border-transparent!',
              )}
              data-testid={`nav-${testId}`}
            >
              {isActive && (
                // One marker, shared across the four tabs by `layoutId`, so it
                // slides the width of the bar instead of being redrawn in
                // place. Rendered only under the active tab — framer moves the
                // single element between the two positions itself.
                <motion.span
                  layoutId={quiet ? undefined : 'agent-nav-indicator'}
                  transition={INDICATOR}
                  className="absolute -top-[2px] left-0 right-0 h-[2px] bg-[#F2A123]"
                  data-testid="nav-indicator"
                />
              )}

              <Icon
                className={cn(
                  'w-[21px] h-[21px]',
                  isActive ? 'text-white' : 'text-white/60',
                )}
                strokeWidth={1.5}
              />
              {/*
                Keyed on the count, so a job taken or a booking arriving pops the
                number rather than swapping it silently. This surface has no
                toasts at all (see `SurfaceToaster` in App.tsx) — a badge that
                moves is the only word an agent gets that the queue changed.
              */}
              <AnimatePresence mode="popLayout" initial={false}>
                {typeof badge === 'number' && badge > 0 && (
                  <motion.span
                    key={badge}
                    variants={quiet ? undefined : POP_VARIANTS}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    transition={POP}
                    className="absolute top-[9px] right-[18px] min-w-[17px] h-[17px] px-1 rounded-[9px] bg-[#F2A123] grid place-items-center text-[11px] font-bold text-[#1B2A41]"
                    data-testid={`nav-badge-${testId}`}
                  >
                    {badge > 99 ? '99+' : badge}
                  </motion.span>
                )}
              </AnimatePresence>
              <span
                className={cn(
                  'text-[11px] font-semibold',
                  isActive ? 'text-white' : 'text-white/60',
                )}
              >
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
