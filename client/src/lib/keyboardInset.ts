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
 * Two sources, because no single one works everywhere:
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
 */

import { useEffect } from "react";

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
  const kb = Math.round(Math.max(fromViewport, fromApi));

  root.setProperty("--vh", `${vvHeight}px`);
  root.setProperty("--kb", `${kb}px`);
  root.setProperty("--vv-top", `${Math.round(top)}px`);
  root.setProperty("--visible", `${Math.max(0, Math.round(innerHeight - kb - top))}px`);
}

/** Called once at startup. */
export function installKeyboardInset(): void {
  window.visualViewport?.addEventListener("resize", update);
  window.visualViewport?.addEventListener("scroll", update);
  window.addEventListener("resize", update);
  virtualKeyboard()?.addEventListener("geometrychange", update);
  update();
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
