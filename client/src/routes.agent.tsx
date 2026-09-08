import { AnimatePresence } from 'framer-motion';
import { Route, Switch, useLocation } from 'wouter';
import { AgentNav } from '@/components/agent/AgentNav';
import { PageTransition } from '@/components/motion/PageTransition';
import Dashboard from '@/pages/agent/Dashboard';
import AvailablePickups from '@/pages/agent/AvailablePickups';
import MyPickups from '@/pages/agent/MyPickups';
import PickupDetail from '@/pages/agent/PickupDetail';
import Collections from '@/pages/agent/Collections';
import Profile from '@/pages/agent/Profile';
import NotFound from '@/pages/not-found';

/**
 * A1 / M0 item 2 — the agent surface's own route file.
 *
 * Mounted in `App.tsx` and edited by nobody else. The customer routes stay in
 * `App.tsx` until the rest of the split happens; ops gets `routes.ops.tsx` on
 * the same pattern.
 *
 * Owns its own <Switch> rather than contributing <Route>s to the parent one:
 * wouter's Switch reads `path` off its direct children, so a component
 * returning a fragment of Routes would never match. App.tsx picks the surface
 * first, then the surface picks the screen.
 *
 * It also owns the two things that must outlive a single screen: the bottom nav
 * and the transition between screens. See below — the order of those two is not
 * a style choice.
 */

/**
 * The job sheet is the one agent screen with no bottom nav: one job is a place
 * you are in, not a tab you are on, and its action bar owns the bottom edge.
 *
 * That rule used to live in the shells — `AgentShell` rendered the nav and
 * `AgentJobSheet` did not. It is stated here now because the nav is mounted
 * once, above the screens, and so has to be told when to stand down.
 */
function navVisible(location: string): boolean {
  return !location.startsWith('/agent/pickup');
}

export function AgentRoutes() {
  const [location] = useLocation();

  return (
    <>
      {/*
        `mode="wait"` — the leaving screen finishes before the arriving one
        mounts. Not a taste call: the list screens are `min-h-[100dvh]` and
        scroll the document, so two of them alive at once double the page height
        and the scrollbar jumps mid-transition.

        `initial={false}` so the first screen after a cold load or a surface
        switch is simply there, rather than scaling in from nothing.

        The key is the full path, so /agent/pickup/A → /agent/pickup/B animates
        too — those are two different jobs and reading them as one screen that
        silently rewrote itself is worse.
      */}
      <AnimatePresence mode="wait" initial={false}>
        <PageTransition key={location}>
          {/*
            wouter has no exit support of its own, so the leaving copy would
            otherwise re-match against the new URL and animate out showing the
            screen it was moving *to*. Passing `location` pins this Switch to the
            path it rendered with; AnimatePresence keeps the exiting element with
            the props it last had, and the old screen leaves as itself.
          */}
          <Switch location={location}>
            <Route path="/agent" component={Dashboard} />
            <Route path="/agent/available" component={AvailablePickups} />
            <Route path="/agent/mine" component={MyPickups} />
            <Route path="/agent/pickup/:id" component={PickupDetail} />
            <Route path="/agent/collections" component={Collections} />
            {/* Not in the nav — the bar is full at five tabs. Reached from the
                person icon in the top bar. */}
            <Route path="/agent/profile" component={Profile} />
            <Route component={NotFound} />
          </Switch>
        </PageTransition>
      </AnimatePresence>

      {/*
        Outside the transition, and that is the whole point.

        An animating `transform` becomes the containing block for `position:
        fixed` descendants. The nav is `fixed bottom-0`; rendered inside the
        page wrapper it would scale and drift with every navigation. Mounted
        here it stays nailed to the bottom of the phone — and, because it now
        survives the screen change, its active marker can slide between tabs
        instead of cutting.
      */}
      {navVisible(location) && <AgentNav />}
    </>
  );
}
