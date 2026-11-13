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
    StatusBar?: CapacitorPlugin;
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

/** The shell's `BombinoShell/<n>` user-agent marker, or 0 when absent. */
export function shellVersion(): number {
  if (typeof navigator === 'undefined') return 0;
  const match = /BombinoShell\/(\d+)/.exec(navigator.userAgent);
  return match ? Number(match[1]) : 0;
}

/**
 * The shell draws the web view under the status bar and home indicator and
 * lets the page choose the status bar icon style. The live store shells send
 * no marker, so this is false for them and for every browser.
 */
export function isEdgeToEdgeShell(): boolean {
  return isCapacitorNative() && shellVersion() >= 2;
}

/** Running inside the iOS app shell (not iOS Safari). */
export function isIosApp(): boolean {
  const cap = getCapacitor();
  return cap?.isNativePlatform?.() === true && cap.getPlatform?.() === 'ios';
}

export function getCapacitorShare(): CapacitorPlugin | null {
  return getCapacitor()?.Plugins?.Share ?? null;
}

export function getCapacitorFilesystem(): CapacitorPlugin | null {
  return getCapacitor()?.Plugins?.Filesystem ?? null;
}

export function getCapacitorStatusBar(): CapacitorPlugin | null {
  return getCapacitor()?.Plugins?.StatusBar ?? null;
}
