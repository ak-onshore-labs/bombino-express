import { createRoot } from "react-dom/client";
import App from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { installSessionInterceptor } from "./lib/session";
import { installKeyboardInset } from "./lib/keyboardInset";
import { installFocusReveal } from "./lib/focusReveal";
import { installStatusBarStyle } from "./lib/statusBar";
import { installBackButton } from "./lib/backButton";
import "./index.css";

// Before anything renders or fetches: a 401 on our API means the session is
// gone, and the app must stop showing the previous user's data rather than
// carry on from localStorage with every action failing.
installSessionInterceptor();

// --vh, --kb, --vv-top and --visible: where the keyboard is (lib/keyboardInset.ts).
installKeyboardInset();

// A focused field is scrolled clear of the header and the bar above the
// keyboard once the keyboard has opened (lib/focusReveal.ts).
installFocusReveal();

// Dark status bar icons unless a dark screen asks otherwise (lib/statusBar.ts),
// so the default does not depend on how the shell was configured.
installStatusBarStyle();

// Android hardware / gesture back: overlays, keyboard, history, or exit
// (lib/backButton.ts). No-op outside the Android Capacitor shell.
installBackButton();

createRoot(document.getElementById("root")!).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
);
