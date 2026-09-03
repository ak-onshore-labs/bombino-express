import { Redirect, Route, Switch } from 'wouter';
import OpsDashboard from '@/pages/ops/OpsDashboard';
import OpsPickups from '@/pages/ops/OpsPickups';
import OpsDropoffs from '@/pages/ops/OpsDropoffs';
import OpsDispatched from '@/pages/ops/OpsDispatched';
import OpsTransactions from '@/pages/ops/OpsTransactions';
import OpsOrderDetail from '@/pages/ops/OpsOrderDetail';
import OpsCustomers from '@/pages/ops/OpsCustomers';
import OpsCustomerDetail from '@/pages/ops/OpsCustomerDetail';
import OpsUsers from '@/pages/ops/OpsUsers';
import NotFound from '@/pages/not-found';

/**
 * Ops surface router — mirror of routes.agent.tsx.
 * Mounted from App.tsx when surfaceForPath === 'ops', still under SurfaceGuard.
 */
export function OpsRoutes() {
  return (
    <Switch>
      <Route path="/ops">
        <Redirect to="/ops/dashboard" />
      </Route>
      <Route path="/ops/dashboard" component={OpsDashboard} />
      <Route path="/ops/pickups" component={OpsPickups} />
      <Route path="/ops/dropoffs" component={OpsDropoffs} />
      <Route path="/ops/dispatched" component={OpsDispatched} />
      <Route path="/ops/transactions" component={OpsTransactions} />
      <Route path="/ops/customers" component={OpsCustomers} />
      <Route path="/ops/customers/:id" component={OpsCustomerDetail} />
      <Route path="/ops/users" component={OpsUsers} />
      <Route path="/ops/orders/:id" component={OpsOrderDetail} />
      <Route component={NotFound} />
    </Switch>
  );
}
