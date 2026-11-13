/**
 * Keep the focused field visible once the on-screen keyboard is up.
 *
 * The visible window is what lies between the bottom of the screen's top bar
 * (`[data-top-bar]`) and the top of the highest bar sitting on the keyboard
 * (`[data-bottom-bar]`, e.g. the booking step's Back / Continue), or the
 * keyboard itself. If the field is not fully inside it, with a 16px margin,
 * its scroller is moved by exactly the difference, instantly: a smooth scroll
 * races the keyboard animation and `html { scroll-behavior: smooth }` would
 * otherwise apply.
 *
 * When the keyboard settles depends on where the app runs. The iOS shell
 * (`resize: 'native'`) shrinks the web view only after the keyboard has
 * finished animating, well after `keyboardDidShow`. So while a field is
 * focused the reveal re-runs on every keyboard event, every window and
 * visual viewport resize, and on timers after focus. Each run measures fresh
 * and does nothing when the field is already clear. Surfaces pinned to the
 * keyboard (`[data-keyboard-pinned]`, BIA) keep their own input in view.
 */

import {
  KEYBOARD_EVENT,
  isTextEntry,
  keyboardCoverPx,
  type KeyboardChange,
} from "./keyboardInset";

const MARGIN = 16;
/** Re-reveal this long after focus, in case no event marks the keyboard settling. */
const FALLBACK_MS = [100, 300, 600];

let active: HTMLElement | null = null;
let timers: ReturnType<typeof setTimeout>[] = [];
let frame = 0;

function isShown(el: Element): boolean {
  if (el.getClientRects().length === 0) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function viewportBounds(): { top: number; bottom: number } {
  const vv = window.visualViewport;
  const top = vv?.offsetTop ?? 0;
  const vvBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
  // Before the shell's web view shrinks, the keyboard covers its bottom.
  return { top, bottom: Math.min(vvBottom, window.innerHeight - keyboardCoverPx()) };
}

/** The window between the top bar and the bars on the keyboard, in client px. */
function visibleWindow(target: HTMLElement): { top: number; bottom: number } {
  const viewport = viewportBounds();
  let top = viewport.top;
  let bottom = viewport.bottom;

  document.querySelectorAll("[data-top-bar]").forEach((bar) => {
    if (bar.contains(target) || !isShown(bar)) return;
    const rect = bar.getBoundingClientRect();
    if (rect.bottom <= viewport.top || rect.top >= viewport.bottom) return;
    top = Math.max(top, rect.bottom);
  });

  document.querySelectorAll("[data-bottom-bar]").forEach((bar) => {
    if (bar.contains(target) || !isShown(bar)) return;
    const rect = bar.getBoundingClientRect();
    if (rect.top >= viewport.bottom || rect.bottom <= viewport.top) return;
    bottom = Math.min(bottom, rect.top);
  });

  return { top, bottom };
}

/** How far to scroll so the target fits the window; 0 when it already does. */
function overflowOf(target: HTMLElement): number {
  const rect = target.getBoundingClientRect();
  const win = visibleWindow(target);
  const minTop = win.top + MARGIN;
  const maxBottom = win.bottom - MARGIN;

  if (rect.top < minTop) return rect.top - minTop;
  if (rect.bottom > maxBottom) {
    // Taller than the window: line its top up rather than push it off the top.
    return Math.min(rect.bottom - maxBottom, rect.top - minTop);
  }
  return 0;
}

function scrollableAncestor(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY;
    if ((overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") &&
        node.scrollHeight > node.clientHeight) {
      return node;
    }
  }
  return null;
}

/** Scroll without animation, whatever `scroll-behavior` the page sets. */
function scrollInstantly(scroller: Element, delta: number): void {
  const html = document.documentElement;
  const previous = html.style.scrollBehavior;
  html.style.scrollBehavior = "auto";
  scroller.scrollTo({ top: scroller.scrollTop + delta, behavior: "instant" });
  html.style.scrollBehavior = previous;
}

function reveal(target: HTMLElement): void {
  if (!target.isConnected || document.activeElement !== target) return;

  const delta = overflowOf(target);
  if (Math.abs(delta) < 1) return;

  const page = document.scrollingElement ?? document.documentElement;
  const scroller = scrollableAncestor(target);
  if (scroller) {
    scrollInstantly(scroller, delta);
    // A scroller already at its end leaves the rest to the page.
    const rest = overflowOf(target);
    if (Math.abs(rest) >= 1) scrollInstantly(page, rest);
    return;
  }
  scrollInstantly(page, delta);
}

/** Reveal the active field two frames from now, once layout has caught up. */
function request(): void {
  if (!active) return;
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (active) reveal(active);
    });
  });
}

function clearTimers(): void {
  timers.forEach(clearTimeout);
  timers = [];
}

function release(): void {
  active = null;
  clearTimers();
  cancelAnimationFrame(frame);
  frame = 0;
}

/** Called once at startup, after installKeyboardInset. */
export function installFocusReveal(): void {
  document.addEventListener("focusin", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !isTextEntry(target)) return;
    if (target.closest("[data-keyboard-pinned]")) {
      release();
      return;
    }
    active = target;
    clearTimers();
    timers = FALLBACK_MS.map((ms) => setTimeout(request, ms));
    request();
  });

  document.addEventListener("focusout", () => {
    // After the task: the next field's focusin lands first.
    setTimeout(() => {
      if (active && document.activeElement !== active) release();
    }, 0);
  });

  window.addEventListener(KEYBOARD_EVENT, (event) => {
    if ((event as CustomEvent<KeyboardChange>).detail.open) request();
  });
  window.addEventListener("keyboardWillShow", request);
  window.addEventListener("keyboardDidShow", request);
  window.addEventListener("resize", request);
  window.visualViewport?.addEventListener("resize", request);
}
