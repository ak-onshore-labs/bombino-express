import { createRoot } from "react-dom/client";
import App from "./App";
import { installSessionInterceptor } from "./lib/session";
import "./index.css";
import { isCapacitorIos } from "./lib/platform";

// In the iOS app, the page scrolls inside #root instead of the document. The
// WebView rubber-bands the document at both ends, dragging the fixed bottom
// nav and the header with it, and CSS cannot switch that bounce off. With the
// document still, only #root's content can move and the bars stay put.
// Before render, so the first paint already has it. See `.native-shell`.
if (isCapacitorIos()) {
  document.documentElement.classList.add("native-shell");
}

// Before anything renders or fetches: a 401 on our API means the session is
// gone, and the app must stop showing the previous user's data rather than
// carry on from localStorage with every action failing.
installSessionInterceptor();

function setVh() {
  const vh = window.visualViewport?.height ?? window.innerHeight;
  document.documentElement.style.setProperty("--vh", `${vh}px`);
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
