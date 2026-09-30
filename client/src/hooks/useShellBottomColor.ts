import { useEffect } from 'react';

/**
 * Paint the iPhone home-indicator strip in this bar's colour.
 *
 * In the iOS app shell the page is pinned (`.native-shell` in index.css) and
 * the WebView lays it out above the home indicator, leaving a strip below the
 * web page that only the document background can colour. A bottom bar calls
 * this so the strip continues the bar to the screen's edge; when the bar goes
 * away, the strip falls back to the page background.
 *
 * A no-op outside the shell: nothing reads `--shell-bottom` there.
 */
export function useShellBottomColor(color: string): void {
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--shell-bottom', color);
    return () => {
      root.style.removeProperty('--shell-bottom');
    };
  }, [color]);
}
