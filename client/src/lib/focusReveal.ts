/**
 * Keep the focused field visible once the on-screen keyboard is up.
 *
 * The visible window is what lies between the bottom of the screen's top bar
 * (`[data-top-bar]`) and the top of the highest bar sitting on the keyboard
 * (`[data-bottom-bar]`, e.g. the booking step's Back / Continue). If the field
 * is not fully inside it, with a 16px margin, its scroller is moved by exactly
 * the difference, instantly: a smooth scroll races the keyboard animation and
 * `html { scroll-behavior: smooth }` would otherwise apply.
 *
 * It waits for the keyboard to finish opening (the `bombino:keyboard` event or
 * the viewport resizing, then a quiet spell), because measuring while the web
 * view is still shrinking gives the wrong answer. Surfaces pinned to the
 * keyboard (`[data-keyboard-pinned]`, BIA) keep their own input in view.
 */

import { KEYBOARD_EVENT, isKeyboardOpen, isTextEntry, type KeyboardChange } from "./keyboardInset";

const MARGIN = 16;
/** No viewport change for this long means the keyboard has settled. */
const QUIET_MS = 150;
/** Reveal anyway if neither the keyboard event nor a resize arrives. */
const FALLBACK_MS = 600;

let cancelPending: (() => void) | null = null;

function isShown(el: Element): boolean {
  if (el.getClientRects().length === 0) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function viewportBounds(): { top: number; bottom: number } {
  const vv = window.visualViewport;
  if (!vv) return { top: 0, bottom: window.innerHeight };
  return { top: vv.offsetTop, bottom: vv.offsetTop + vv.height };
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

function reveal(target: HTMLElement): void {
  if (!target.isConnected || document.activeElement !== target) return;

  const delta = overflowOf(target);
  if (Math.abs(delta) < 1) return;

  const scroller = scrollableAncestor(target);
  if (scroller) {
    scroller.scrollBy({ top: delta, behavior: "instant" });
    // A scroller already at its end leaves the rest to the page.
    const rest = overflowOf(target);
    if (Math.abs(rest) >= 1) window.scrollBy({ top: rest, behavior: "instant" });
    return;
  }
  window.scrollBy({ top: delta, behavior: "instant" });
}

function schedule(target: HTMLElement): void {
  cancelPending?.();

  let quietTimer: ReturnType<typeof setTimeout> | null = null;
  const fallbackTimer = setTimeout(() => finish(), FALLBACK_MS);

  const finish = (): void => {
    cleanup();
    requestAnimationFrame(() => reveal(target));
  };

  const arm = (): void => {
    if (quietTimer !== null) clearTimeout(quietTimer);
    quietTimer = setTimeout(finish, QUIET_MS);
  };

  const onKeyboard = (event: Event): void => {
    if ((event as CustomEvent<KeyboardChange>).detail.open) arm();
  };

  const vv = window.visualViewport;
  window.addEventListener(KEYBOARD_EVENT, onKeyboard);
  window.addEventListener("resize", arm);
  vv?.addEventListener("resize", arm);

  const cleanup = (): void => {
    clearTimeout(fallbackTimer);
    if (quietTimer !== null) clearTimeout(quietTimer);
    window.removeEventListener(KEYBOARD_EVENT, onKeyboard);
    window.removeEventListener("resize", arm);
    vv?.removeEventListener("resize", arm);
    if (cancelPending === cleanup) cancelPending = null;
  };
  cancelPending = cleanup;

  // Moving between fields with the keyboard already up: nothing more is
  // coming unless the keyboard changes shape, so only the quiet spell is waited.
  if (isKeyboardOpen()) arm();
}

/** Called once at startup, after installKeyboardInset. */
export function installFocusReveal(): void {
  document.addEventListener("focusin", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !isTextEntry(target)) return;
    if (target.closest("[data-keyboard-pinned]")) {
      cancelPending?.();
      return;
    }
    schedule(target);
  });
}
