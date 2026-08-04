import { useEffect } from "react";
import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { verifySession } from "./lib/session";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from '@/components/AppLayout';

import Splash from "@/pages/Splash";
import Onboarding from "@/pages/Onboarding";
import Home from "@/pages/Home";
import Track from "@/pages/Track";
import Receive from "@/pages/Receive";
import ShipmentDetails from "@/pages/ShipmentDetails";
import Rates from "@/pages/Rates";
import CreateShipment from "@/pages/CreateShipment";
import Orders from "@/pages/Orders";
import Notifications from "@/pages/Notifications";
import Login from "@/pages/Login";
import Signup from "@/pages/Signup";
import Privacy from "@/pages/Privacy";
import Profile from "@/pages/Profile";
import Support from "@/pages/Support";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Splash} />
      <Route path="/onboarding" component={Onboarding} />
      <Route path="/home" component={Home} />
      <Route path="/track" component={Track} />
      <Route path="/receive" component={Receive} />
      <Route path="/shipment/:awb" component={ShipmentDetails} />
      <Route path="/rates" component={Rates} />
      <Route path="/create" component={CreateShipment} />
      <Route path="/orders" component={Orders} />
      <Route path="/notifications" component={Notifications} />
      <Route path="/login" component={Login} />
      <Route path="/signup" component={Signup} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/profile" component={Profile} />
      <Route path="/help" component={Support} />
      <Route component={NotFound} />
    </Switch>
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
        <Toaster />
        <SessionWatch />
        <AppLayout>
          <Router />
        </AppLayout>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;