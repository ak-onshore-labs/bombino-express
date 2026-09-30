export function isAndroid(): boolean {
  return typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);
}

interface CapacitorPlugin {
  [method: string]: (...args: any[]) => Promise<any>;
}

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: {
    Share?: CapacitorPlugin;
    Filesystem?: CapacitorPlugin;
    [name: string]: CapacitorPlugin | undefined;
  };
}

function getCapacitor(): CapacitorGlobal | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor ?? null;
}

export function isCapacitorNative(): boolean {
  return getCapacitor()?.isNativePlatform?.() === true;
}

/** Inside the iOS app shell (not iOS Safari). */
export function isCapacitorIos(): boolean {
  return isCapacitorNative() && getCapacitor()?.getPlatform?.() === 'ios';
}

/**
 * Back to the top of the screen, wherever the screen scrolls.
 *
 * In the iOS shell the document does not scroll — `#root` does (see
 * `.native-shell` in index.css) — so `window.scrollTo` alone would do nothing
 * there. Both are called; the one that is not scrolling ignores it.
 */
export function scrollToTop(): void {
  window.scrollTo(0, 0);
  document.getElementById('root')?.scrollTo(0, 0);
}

export function getCapacitorShare(): CapacitorPlugin | null {
  return getCapacitor()?.Plugins?.Share ?? null;
}

export function getCapacitorFilesystem(): CapacitorPlugin | null {
  return getCapacitor()?.Plugins?.Filesystem ?? null;
}
