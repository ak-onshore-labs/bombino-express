import { useEffect } from 'react';
import { acquireLightIcons, releaseLightIcons } from '@/lib/statusBar';

/** Light status bar icons while this dark screen is mounted and active. */
export function useDarkStatusBarArea(active = true): void {
  useEffect(() => {
    if (!active) return;
    acquireLightIcons();
    return releaseLightIcons;
  }, [active]);
}
