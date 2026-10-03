import { createRoot } from "react-dom/client";
import App from "./App";
import { installSessionInterceptor } from "./lib/session";
import { installKeyboardInset } from "./lib/keyboardInset";
import "./index.css";

// Before anything renders or fetches: a 401 on our API means the session is
// gone, and the app must stop showing the previous user's data rather than
// carry on from localStorage with every action failing.
installSessionInterceptor();

// --vh, --kb, --vv-top and --visible: where the keyboard is (lib/keyboardInset.ts).
installKeyboardInset();

let focusScrollTimeout: ReturnType<typeof setTimeout> | null = null;

document.addEventListener("focusin", (e) => {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;

  const tag = target.tagName;
  const isInput =
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    target.isContentEditable;

  if (!isInput) return;
  // Surfaces pinned to the keyboard (BIA) already keep their input in view;
  // scrolling them as well is what made the chat jump up and down.
  if (target.closest("[data-keyboard-pinned]")) return;

  if (focusScrollTimeout !== null) {
    clearTimeout(focusScrollTimeout);
  }

  focusScrollTimeout = setTimeout(() => {
    focusScrollTimeout = null;
    target.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, 400);
});

createRoot(document.getElementById("root")!).render(<App />);
