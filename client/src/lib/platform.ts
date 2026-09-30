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

export function getCapacitorShare(): CapacitorPlugin | null {
  return getCapacitor()?.Plugins?.Share ?? null;
}

export function getCapacitorFilesystem(): CapacitorPlugin | null {
  return getCapacitor()?.Plugins?.Filesystem ?? null;
}
