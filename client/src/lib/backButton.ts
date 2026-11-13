/**
 * Android hardware / gesture back for the Capacitor shell (BombinoShell/2+).
 *
 * With no listener the WebView does history.back() or exits. With a listener
 * the page decides. No-op everywhere except native Android when Plugins.App
 * exists; never throws.
 */

import { useEffect } from 'react';
import { isCapacitorNative, nativePlatform } from './platform';

type BackCloseEntry = {
  close: () => void;
  zIndex: number;
  seq: number;
};

const ROOT_PATHS = new Set([
  '/',
  '/home',
  '/agent',
  '/ops/dashboard',
  '/ops/applications',
]);

const stack: BackCloseEntry[] = [];
let seqCounter = 0;
let installed = false;

type AppPlugin = {
  addListener?: (
    event: 'backButton',
    handler: (info: { canGoBack: boolean }) => void,
  ) => Promise<{ remove: () => void }> | { remove: () => void };
  exitApp?: () => void | Promise<void>;
};

function getAppPlugin(): AppPlugin | null {
  if (typeof window === 'undefined') return null;
  const cap = (window as unknown as {
    Capacitor?: { Plugins?: { App?: AppPlugin } };
  }).Capacitor;
  return cap?.Plugins?.App ?? null;
}

function readZIndex(el: Element): number {
  const raw = window.getComputedStyle(el).zIndex;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : 50;
}

/** Topmost open Radix dialog / sheet / alert dialog (they set data-state). */
function topRadixOverlay(): HTMLElement | null {
  const nodes = document.querySelectorAll<HTMLElement>(
    '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
  );
  let best: HTMLElement | null = null;
  let bestZ = -Infinity;
  for (const el of nodes) {
    const z = readZIndex(el);
    if (z >= bestZ) {
      bestZ = z;
      best = el;
    }
  }
  return best;
}

function dispatchEscape(): void {
  document.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      keyCode: 27,
      which: 27,
      bubbles: true,
      cancelable: true,
    }),
  );
}

function blurFocusedField(): void {
  const el = document.activeElement;
  if (el instanceof HTMLElement && typeof el.blur === 'function') {
    el.blur();
  }
}

function isRootPath(pathname: string): boolean {
  return ROOT_PATHS.has(pathname);
}

/**
 * Register a close callback while a hand-built overlay is open.
 * Returns an unregister function.
 */
export function registerBackClose(close: () => void, zIndex = 50): () => void {
  const entry: BackCloseEntry = { close, zIndex, seq: ++seqCounter };
  stack.push(entry);
  return () => {
    const i = stack.indexOf(entry);
    if (i >= 0) stack.splice(i, 1);
  };
}

/**
 * While `open`, register `onClose` for the Android back button.
 * Pass a no-op (or a guarded close) when the overlay must stay open while busy.
 */
export function useBackClose(
  open: boolean,
  onClose: () => void,
  zIndex = 50,
): void {
  useEffect(() => {
    if (!open) return;
    return registerBackClose(onClose, zIndex);
  }, [open, onClose, zIndex]);
}

function closeTopOverlay(): boolean {
  const radix = topRadixOverlay();
  const reg = stack.length > 0 ? stack[stack.length - 1] : null;

  if (!radix && !reg) return false;

  const radixZ = radix ? readZIndex(radix) : -Infinity;
  const regZ = reg ? reg.zIndex : -Infinity;
  // Same z: prefer the later registration (hand-built) when both claim the layer;
  // Radix wins when its computed z is strictly higher.
  const preferRadix = radix != null && (reg == null || radixZ > regZ);

  if (preferRadix && radix) {
    if (radix.getAttribute('role') === 'alertdialog') {
      const cancel = radix.querySelector<HTMLElement>('[data-back-cancel]');
      if (cancel) {
        cancel.click();
      }
      // Absorb even if no Cancel — never Escape under an alert.
      return true;
    }
    dispatchEscape();
    return true;
  }

  if (reg) {
    reg.close();
    return true;
  }

  return false;
}

function onBackButton(info: { canGoBack: boolean }): void {
  try {
    if (document.documentElement.classList.contains('rzp-open')) {
      return;
    }

    if (closeTopOverlay()) {
      return;
    }

    if (document.documentElement.getAttribute('data-keyboard') === 'open') {
      blurFocusedField();
      return;
    }

    const path = window.location.pathname;
    if (!isRootPath(path) && info.canGoBack) {
      window.history.back();
      return;
    }

    const App = getAppPlugin();
    void App?.exitApp?.();
  } catch {
    // Never let a back-handler throw into the native bridge.
  }
}

/** Install once from main.tsx. Safe to call repeatedly; no-op off Android shell. */
export function installBackButton(): void {
  if (installed) return;
  installed = true;

  try {
    if (!isCapacitorNative() || nativePlatform() !== 'android') return;
    const App = getAppPlugin();
    if (typeof App?.addListener !== 'function') return;
    void Promise.resolve(App.addListener('backButton', onBackButton)).catch(() => {});
  } catch {
    // Missing plugin / bridge — leave WebView default behaviour.
  }
}
