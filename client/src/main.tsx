import { createRoot } from "react-dom/client";
import App from "./App";
import { installSessionInterceptor } from "./lib/session";
import "./index.css";

// Before anything renders or fetches: a 401 on our API means the session is
// gone, and the app must stop showing the previous user's data rather than
// carry on from localStorage with every action failing.
installSessionInterceptor();

function setVh() {
  const vv = window.visualViewport;
  const vh = vv?.height ?? window.innerHeight;
  document.documentElement.style.setProperty("--vh", `${vh}px`);
  // How much of the layout viewport the on-screen keyboard covers. iOS (and
  // the iOS app shell) lays the keyboard over the page without resizing it,
  // so anything pinned to `bottom: 0` ends up underneath it; Android resizes
  // the page instead and this stays 0 there.
  const kb = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
  document.documentElement.style.setProperty("--kb", `${Math.round(kb)}px`);
}

if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", setVh);
  window.visualViewport.addEventListener("scroll", setVh);
}
window.addEventListener("resize", setVh);
setVh();

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
