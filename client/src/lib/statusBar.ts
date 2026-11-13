import { getCapacitorStatusBar, isEdgeToEdgeShell } from './platform';

/*
 * Status bar icon colour, per screen. Only the edge-to-edge shell draws the
 * page under the status bar, so everywhere else these do nothing.
 *
 * Capacitor names the style after the background, not the icons:
 * 'LIGHT' means a light background, so dark icons; 'DARK' gives light icons.
 */
type StatusBarStyle = 'LIGHT' | 'DARK';

let darkAreas = 0;

function setStyle(style: StatusBarStyle): void {
  if (!isEdgeToEdgeShell()) return;
  try {
    const plugin = getCapacitorStatusBar();
    if (typeof plugin?.setStyle !== 'function') return;
    void Promise.resolve(plugin.setStyle({ style })).catch(() => {});
  } catch {
    // A shell without the plugin keeps whatever style it booted with.
  }
}

/** Dark icons, the app-wide default. Called once at start. */
export function installStatusBarStyle(): void {
  setStyle('LIGHT');
}

/** A dark screen is showing: light icons until every one has gone. */
export function acquireLightIcons(): void {
  darkAreas += 1;
  if (darkAreas === 1) setStyle('DARK');
}

export function releaseLightIcons(): void {
  if (darkAreas === 0) return;
  darkAreas -= 1;
  if (darkAreas === 0) setStyle('LIGHT');
}
