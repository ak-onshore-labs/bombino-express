import type { ReactNode } from 'react';
import { Redirect, Route, Switch } from 'wouter';
import OpsDashboard from '@/pages/ops/OpsDashboard';
import OpsPickups from '@/pages/ops/OpsPickups';
import OpsDropoffs from '@/pages/ops/OpsDropoffs';
import OpsDispatched from '@/pages/ops/OpsDispatched';
import OpsTransactions from '@/pages/ops/OpsTransactions';
import OpsOrderDetail from '@/pages/ops/OpsOrderDetail';
import OpsCustomers from '@/pages/ops/OpsCustomers';
import OpsCustomerDetail from '@/pages/ops/OpsCustomerDetail';
import OpsGuests from '@/pages/ops/OpsGuests';
import OpsGuestDetail from '@/pages/ops/OpsGuestDetail';
import OpsUsers from '@/pages/ops/OpsUsers';
import OpsStaffDetail from '@/pages/ops/OpsStaffDetail';
import OpsBeats from '@/pages/ops/OpsBeats';
import OpsPincodeLookup from '@/pages/ops/OpsPincodeLookup';
import OpsSettings from '@/pages/ops/OpsSettings';
import OpsApplications from '@/pages/ops/OpsApplications';
import OpsApplicationDetail from '@/pages/ops/OpsApplicationDetail';
import NotFound from '@/pages/not-found';
import { useAppStore } from '@/lib/store';
import { can, canSeeTab, opsLandingPath, type OpsTab } from '@shared/staffAccess';

/** Renders the page only for roles with this tab; anyone else goes to their own first tab. */
function TabGate({ tab, children }: { tab: OpsTab | 'orders'; children: ReactNode }) {
  const role = useAppStore((s) => s.user?.role);
  const allowed = tab === 'orders' ? can(role, 'orders.view') : canSeeTab(role, tab);
  return allowed ? <>{children}</> : <Redirect to={opsLandingPath(role)} />;
}

/**
 * Ops surface router — mirror of routes.agent.tsx.
 * Mounted from App.tsx when surfaceForPath === 'ops', still under SurfaceGuard.
 *
 * Each page is reachable only by roles that have its tab (shared/staffAccess.ts);
 * anyone else is sent to their own first tab. Cosmetic — the API is the lock.
 */
export function OpsRoutes() {
  const role = useAppStore((s) => s.user?.role);

  return (
    <Switch>
      <Route path="/ops">
        <Redirect to={opsLandingPath(role)} />
      </Route>
      <Route path="/ops/dashboard">
        <TabGate tab="dashboard">
          <OpsDashboard />
        </TabGate>
      </Route>
      <Route path="/ops/pickups">
        <TabGate tab="pickups">
          <OpsPickups />
        </TabGate>
      </Route>
      <Route path="/ops/dropoffs">
        <TabGate tab="dropoffs">
          <OpsDropoffs />
        </TabGate>
      </Route>
      <Route path="/ops/dispatched">
        <TabGate tab="dispatched">
          <OpsDispatched />
        </TabGate>
      </Route>
      <Route path="/ops/transactions">
        <TabGate tab="transactions">
          <OpsTransactions />
        </TabGate>
      </Route>
      <Route path="/ops/customers">
        <TabGate tab="customers">
          <OpsCustomers />
        </TabGate>
      </Route>
      <Route path="/ops/customers/:id">
        <TabGate tab="customers">
          <OpsCustomerDetail />
        </TabGate>
      </Route>
      <Route path="/ops/guests">
        <TabGate tab="guests">
          <OpsGuests />
        </TabGate>
      </Route>
      <Route path="/ops/guests/:ref">
        <TabGate tab="guests">
          <OpsGuestDetail />
        </TabGate>
      </Route>
      <Route path="/ops/applications">
        <TabGate tab="applications">
          <OpsApplications />
        </TabGate>
      </Route>
      <Route path="/ops/applications/:id">
        <TabGate tab="applications">
          <OpsApplicationDetail />
        </TabGate>
      </Route>
      <Route path="/ops/users">
        <TabGate tab="users">
          <OpsUsers />
        </TabGate>
      </Route>
      <Route path="/ops/users/:id">
        <TabGate tab="users">
          <OpsStaffDetail />
        </TabGate>
      </Route>
      <Route path="/ops/beats">
        <TabGate tab="beats">
          <OpsBeats />
        </TabGate>
      </Route>
      <Route path="/ops/pincodes">
        <TabGate tab="pincodes">
          <OpsPincodeLookup />
        </TabGate>
      </Route>
      <Route path="/ops/settings">
        <TabGate tab="settings">
          <OpsSettings />
        </TabGate>
      </Route>
      <Route path="/ops/orders/:id">
        <TabGate tab="orders">
          <OpsOrderDetail />
        </TabGate>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}
