import { useEffect } from "react";
import { Switch, Route, Redirect, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { verifySession } from "./lib/session";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from '@/components/AppLayout';
import { SurfaceGuard } from '@/components/SurfaceGuard';
import { AgentRoutes } from './routes.agent';
import { OpsRoutes } from './routes.ops';
import { surfaceForPath } from '@/lib/surface';

import Splash from "@/pages/Splash";
import Onboarding from "@/pages/Onboarding";
import Home from "@/pages/Home";
import Track from "@/pages/Track";
import Receive from "@/pages/Receive";
import ShipmentDetails from "@/pages/ShipmentDetails";
import OrderDetails from "@/pages/OrderDetails";
import Rates from "@/pages/Rates";
import CreateShipment from "@/pages/CreateShipment";
import Orders from "@/pages/Orders";
import Notifications from "@/pages/Notifications";
import Login from "@/pages/Login";
import Signup from "@/pages/Signup";
import Privacy from "@/pages/Privacy";
import Profile from "@/pages/Profile";
import GuestProfileDashboard from "@/pages/GuestProfileDashboard";
import GuestAccountSetup from "@/pages/GuestAccountSetup";
import { useGuestProfile } from "@/hooks/useGuestProfile";
import { useAppStore } from "@/lib/store";
import Support from "@/pages/Support";
import NotFound from "@/pages/not-found";

/**
 * `/profile` for whoever is asking.
 *
 * A signed-out visitor who has verified a number is not a stranger to be shown
 * a sign-in wall: they have a name, an identity document and orders filed
 * against them. Chosen here rather than inside `Profile` so a guest never
 * mounts that screen at all — it is entirely account machinery (KYC matrix,
 * username, unlink, sign out), none of which applies to a number with no
 * account behind it.
 *
 * Undecided while the profile read is in flight: rendering `Profile` first and
 * redirecting after would flash "sign in to view your profile" at someone on
 * their way to their own.
 */
function ProfileRoute() {
  const isLoggedIn = useAppStore((s) => s.isLoggedIn);
  const { data: guestProfile, isLoading } = useGuestProfile({ enabled: !isLoggedIn });

  if (!isLoggedIn && isLoading) return null;
  if (!isLoggedIn && guestProfile) return <GuestProfileDashboard />;
  return <Profile />;
}

function CustomerRouter() {
  return (
    <Switch>
      <Route path="/" component={Splash} />
      <Route path="/onboarding" component={Onboarding} />
      <Route path="/home" component={Home} />
      <Route path="/track" component={Track} />
      <Route path="/receive" component={Receive} />
      <Route path="/shipment/:awb" component={ShipmentDetails} />
      {/* Pre-docket orders. A shipment has an AWB and lives at /shipment;
          an order has only BOM-xxxxxx until ops generates one. */}
      <Route path="/order/:orderNo" component={OrderDetails} />
      <Route path="/rates" component={Rates} />
      <Route path="/create" component={CreateShipment} />
      <Route path="/orders" component={Orders} />
      <Route path="/notifications" component={Notifications} />
      <Route path="/login" component={Login} />
      <Route path="/signup" component={Signup} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/profile" component={ProfileRoute} />
      {/* The guest equivalent of /profile. Kept as its own route rather than a
          branch inside Profile: that screen is entirely account machinery —
          KYC matrix, username, unlink, sign-out — and none of it applies to a
          number that has no account behind it yet. */}
      <Route path="/guest-profile" component={GuestProfileDashboard} />
      {/* The form itself. Kept off the profile screen so that screen can stay a
          summary: a dozen fields answered one row at a time is right for
          correcting one and wrong for finishing the set. */}
      <Route path="/guest-profile/setup" component={GuestAccountSetup} />
      <Route path="/help" component={Support} />
      <Route component={NotFound} />
    </Switch>
  );
}

/**
 * A1 — surface selection.
 *
 * The agent app is not the customer app with different screens: it gets no
 * desktop sidebar, no top bar and no support FAB, so it renders outside
 * `AppLayout` entirely rather than trying to opt out of its parts.
 *
 * `SurfaceGuard` sits above agent and ops (and the customer app) and bounces
 * anyone onto their own surface. It is cosmetic — the real enforcement is
 * `requireRole` on the server.
 */
/**
 * Toasts, everywhere except the agent app.
 *
 * The agent surface is worked one-handed, outdoors, often mid-conversation with
 * a customer, and a card sliding over the top of the screen there is something
 * to dismiss rather than something to read. Its screens already say what
 * happened where the agent is looking: the job's status changes on the card
 * they just pressed, a rejected handover code appears under the field being
 * retyped, and a collection receipt holds its own sheet open.
 *
 * Not merely hidden — `Toaster` is not mounted at all on `/agent/*`, so a
 * stray `toast()` call from a shared component costs nothing and shows nothing.
 * Calls left in the agent code are inert by design; see the note in
 * `ActiveJobCard`.
 */
function SurfaceToaster() {
  const [location] = useLocation();
  if (surfaceForPath(location) === 'agent') return null;
  return <Toaster />;
}

function Surfaces() {
  const [location] = useLocation();

  if (surfaceForPath(location) === 'agent') {
    return <AgentRoutes />;
  }

  if (surfaceForPath(location) === 'ops') {
    return <OpsRoutes />;
  }

  // The verification banner is NOT mounted here. It has to sit below the nav
  // rather than above it, which means living inside the sticky chrome itself:
  // TopBar's `below` slot on mobile (via Header), and under DesktopTopBar in
  // AppLayout. Mounted at this level it rendered above the whole shell and
  // pushed the sidebar down the page.
  return (
    <AppLayout>
      <CustomerRouter />
    </AppLayout>
  );
}

/**
 * Confirms the persisted session is still real, on load and whenever the tab
 * comes back to the foreground.
 *
 * The 401 interceptor in queryClient only fires once something is requested,
 * and a screen assembled entirely from localStorage requests nothing — which
 * is exactly how a dead session used to keep showing a name, a job list and a
 * cash total. Foreground is the right second trigger: a phone that has been in
 * a pocket for an hour is the common way a session lapses.
 */
function SessionWatch() {
  useEffect(() => {
    void verifySession();

    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void verifySession();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, []);

  return null;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <SurfaceToaster />
        <SessionWatch />
        <SurfaceGuard>
          <Surfaces />
        </SurfaceGuard>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;