import { Route, Switch } from 'wouter';
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
 */
export function AgentRoutes() {
  return (
    <Switch>
      <Route path="/agent" component={Dashboard} />
      <Route path="/agent/available" component={AvailablePickups} />
      <Route path="/agent/mine" component={MyPickups} />
      <Route path="/agent/pickup/:id" component={PickupDetail} />
      <Route path="/agent/collections" component={Collections} />
      {/* Not in the nav — the bar is full at five tabs. Reached from the person
          icon in the top bar. */}
      <Route path="/agent/profile" component={Profile} />
      <Route component={NotFound} />
    </Switch>
  );
}
