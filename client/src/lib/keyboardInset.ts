/**
 * Where the on-screen keyboard is, as CSS variables on <html>:
 *
 *   --vh       the visual viewport's height (kept for `.h-viewport`)
 *   --kb       how much of the layout viewport the keyboard covers
 *   --vv-top   how far the visible area starts below the layout viewport's top
 *   --visible  the height left between that top and the keyboard
 *
 * A surface that must keep an input on top of the keyboard (BIA) pins itself
 * with `top: var(--vv-top); height: var(--visible)`, or `bottom: var(--kb)`.
 *
 * Three sources, because no single one works everywhere:
 *
 *  - visualViewport. iOS (Safari and the app's WKWebView) and Chrome lay the
 *    keyboard over the page and shrink only the visual viewport, so the gap
 *    between it and the layout viewport is the keyboard.
 *  - The VirtualKeyboard API. An edge-to-edge Android WebView neither resizes
 *    nor shrinks the visual viewport: the keyboard just covers the page and
 *    nothing in the DOM says so. With `overlaysContent` on, Chromium reports
 *    the keyboard's rectangle instead. It is switched on only while a pinned
 *    surface is open (`useKeyboardOverlay`), because it also stops Chrome from
 *    resizing the page, which every other form in the app relies on.
 *  - Capacitor's Keyboard plugin, in the iOS app. Depending on how the shell
 *    is set up, WKWebView may neither resize nor shrink the visual viewport
 *    reliably, but the plugin always fires `keyboardWillShow` with the
 *    keyboard's height. It only counts when the web view did not already
 *    shrink by that much, so a resizing shell is not lifted twice.
 *
 * iOS also reports the viewport change late, or part-way through the
 * keyboard's animation. So for a short while after any input gains or loses
 * focus the values are re-measured every frame, not only on events.
 *
 * Whether the keyboard is open at all is a separate flag, because a shell that
 * resizes the web view (iOS app, `resize: 'native'`) leaves `--kb` at 0: the
 * layout viewport simply ends at the keyboard. The flag also counts a focused
 * text field in a window that has lost more than 120px of height. It is
 * published as `html[data-keyboard="open"]` (CSS hides the bottom navs on it)
 * and as a `bombino:keyboard` window event carrying `{ open, height }`.
 */

import { useEffect, useState } from "react";

/** Keyboard height from Capacitor's plugin, and the window height when it opened. */
let nativeKb = 0;
let heightBeforeKeyboard = 0;

export const KEYBOARD_EVENT = "bombino:keyboard";

export interface KeyboardChange {
  open: boolean;
  height: number;
}

/** How far the window must shrink, with a field focused, to count as a keyboard. */
const RESIZE_THRESHOLD = 120;

let keyboardOpen = false;
/** The tallest window seen with no text field focused. */
let baselineHeight = 0;
/**
 * Set when the keyboard was reported closed (plugin hide, or focus left every
 * field), so the viewport catching up during the hide animation cannot reopen
 * the flag. Cleared when a field gains focus or the plugin shows the keyboard.
 */
let closedUntilFocus = false;

/** How long to keep re-measuring after focus moves: past iOS's keyboard animation. */
const SETTLE_MS = 800;
let settleUntil = 0;
let settling = false;

interface VirtualKeyboardLike extends EventTarget {
  overlaysContent: boolean;
  readonly boundingRect: DOMRect;
}

function virtualKeyboard(): VirtualKeyboardLike | null {
  const vk = (navigator as Navigator & { virtualKeyboard?: VirtualKeyboardLike }).virtualKeyboard;
  return vk ?? null;
}

function update(): void {
  const root = document.documentElement.style;
  const vv = window.visualViewport;
  const innerHeight = window.innerHeight;
  const vvHeight = vv?.height ?? innerHeight;
  const top = vv?.offsetTop ?? 0;

  const fromViewport = vv ? Math.max(0, innerHeight - vvHeight - top) : 0;
  const vk = virtualKeyboard();
  const fromApi = vk?.overlaysContent ? Math.max(0, vk.boundingRect.height) : 0;
  // The plugin's height, less whatever the web view already gave up for it.
  const shrunkBy = heightBeforeKeyboard > 0 ? Math.max(0, heightBeforeKeyboard - innerHeight) : 0;
  const fromNative = nativeKb > 0 ? Math.max(0, nativeKb - shrunkBy - top) : 0;
  const kb = Math.round(Math.max(fromViewport, fromApi, fromNative));

  root.setProperty("--vh", `${vvHeight}px`);
  root.setProperty("--kb", `${kb}px`);
  root.setProperty("--vv-top", `${Math.round(top)}px`);
  root.setProperty("--visible", `${Math.max(0, Math.round(innerHeight - kb - top))}px`);

  const focused = isTextEntry(document.activeElement);
  if (!focused) baselineHeight = Math.max(baselineHeight, innerHeight);
  const drop = baselineHeight > 0 ? Math.max(0, baselineHeight - innerHeight) : 0;
  const open =
    nativeKb > 0 || (!closedUntilFocus && (kb > 0 || (focused && drop > RESIZE_THRESHOLD)));
  setKeyboardOpen(open, kb || Math.round(nativeKb) || Math.round(drop));
}

function setKeyboardOpen(open: boolean, height: number): void {
  if (open === keyboardOpen) return;
  keyboardOpen = open;
  const root = document.documentElement;
  if (open) root.dataset.keyboard = "open";
  else delete root.dataset.keyboard;
  window.dispatchEvent(
    new CustomEvent<KeyboardChange>(KEYBOARD_EVENT, { detail: { open, height: open ? height : 0 } })
  );
}

/** Is the on-screen keyboard open right now? */
export function isKeyboardOpen(): boolean {
  return keyboardOpen;
}

/** Re-measure every frame until SETTLE_MS after the last call. */
function settle(): void {
  settleUntil = performance.now() + SETTLE_MS;
  if (settling) return;
  settling = true;
  const tick = (): void => {
    update();
    if (performance.now() < settleUntil) {
      requestAnimationFrame(tick);
    } else {
      settling = false;
    }
  };
  requestAnimationFrame(tick);
}

/** Input types that never open a keyboard. */
const NON_TEXT_INPUTS = new Set([
  "checkbox",
  "radio",
  "button",
  "submit",
  "reset",
  "range",
  "file",
  "color",
  "image",
  "hidden",
]);

/** Does this element take typed text (and so bring up the keyboard)? */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.tagName === "TEXTAREA") return true;
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(target.type);
  return false;
}

/** Called once at startup. */
export function installKeyboardInset(): void {
  window.visualViewport?.addEventListener("resize", update);
  window.visualViewport?.addEventListener("scroll", update);
  window.addEventListener("resize", update);
  virtualKeyboard()?.addEventListener("geometrychange", update);

  window.addEventListener("orientationchange", () => {
    baselineHeight = 0;
    settle();
  });

  document.addEventListener("focusin", (event) => {
    if (!isTextEntry(event.target)) return;
    closedUntilFocus = false;
    settle();
  });
  document.addEventListener("focusout", (event) => {
    if (!isTextEntry(event.target)) return;
    // After the task, not a microtask: the next field's focusin has to land
    // first, or moving between fields would close and reopen the flag.
    setTimeout(() => {
      if (isTextEntry(document.activeElement)) return;
      closedUntilFocus = true;
      setKeyboardOpen(false, 0);
    }, 0);
    settle();
  });

  // Capacitor's Keyboard plugin (iOS app): window events carrying the height.
  const onShow = (event: Event): void => {
    const height = Number((event as Event & { keyboardHeight?: unknown }).keyboardHeight);
    if (!Number.isFinite(height) || height <= 0) return;
    if (nativeKb === 0) heightBeforeKeyboard = window.innerHeight;
    nativeKb = height;
    closedUntilFocus = false;
    settle();
  };
  const onHide = (): void => {
    nativeKb = 0;
    heightBeforeKeyboard = 0;
    closedUntilFocus = true;
    setKeyboardOpen(false, 0);
    settle();
  };
  window.addEventListener("keyboardWillShow", onShow);
  window.addEventListener("keyboardDidShow", onShow);
  window.addEventListener("keyboardWillHide", onHide);
  window.addEventListener("keyboardDidHide", onHide);

  update();
}

/** Re-renders when the keyboard opens or closes. */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(keyboardOpen);
  useEffect(() => {
    const onChange = (event: Event): void => {
      setOpen((event as CustomEvent<KeyboardChange>).detail.open);
    };
    window.addEventListener(KEYBOARD_EVENT, onChange);
    setOpen(keyboardOpen);
    return () => window.removeEventListener(KEYBOARD_EVENT, onChange);
  }, []);
  return open;
}

let overlayUsers = 0;

/**
 * While mounted, ask Android to report the keyboard rather than resize under
 * it, so `--kb` is right there too. Counted, so the sheet and the page can
 * both hold it.
 */
export function useKeyboardOverlay(): void {
  useEffect(() => {
    const vk = virtualKeyboard();
    if (!vk) return;
    overlayUsers += 1;
    vk.overlaysContent = true;
    update();
    return () => {
      overlayUsers -= 1;
      if (overlayUsers === 0) vk.overlaysContent = false;
      update();
    };
  }, []);
}
