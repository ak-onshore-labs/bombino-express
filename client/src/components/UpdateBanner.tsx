import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { X } from 'lucide-react';
import { useAppUpdate } from '@/hooks/useAppUpdate';
import { surfaceForPath } from '@/lib/surface';

const DISMISS_KEY = 'bombino-update-banner-dismissed-at';
const DISMISS_MS = 24 * 60 * 60 * 1000;

function wasDismissedRecently(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const at = Number(raw);
    return Number.isFinite(at) && Date.now() - at < DISMISS_MS;
  } catch {
    return false;
  }
}

function rememberDismiss(): void {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    /* private mode */
  }
}

function openStore(url: string): void {
  window.location.href = url;
}

/**
 * Soft update strip for the customer chrome (TopBar below slot / under desktop bar).
 * Hidden on /create and /login. Dismissible for 24 hours.
 */
export function UpdateBanner() {
  const [location] = useLocation();
  const decision = useAppUpdate();
  const [dismissed, setDismissed] = useState(wasDismissedRecently);

  useEffect(() => {
    setDismissed(wasDismissedRecently());
  }, [decision.kind]);

  if (decision.kind !== 'soft') return null;
  if (surfaceForPath(location) !== 'customer') return null;
  if (location === '/create' || location === '/login' || location.startsWith('/create?')) {
    return null;
  }
  if (dismissed) return null;

  return (
    <div
      className="flex items-center gap-2 bg-[#FFF8EB] border-b border-amber-200 px-3 py-2 text-sm text-foreground"
      data-testid="banner-app-update"
    >
      <p className="min-w-0 flex-1 text-[13px]">
        {decision.setting.message?.trim() || 'A new version of Bombino is available'}
      </p>
      <button
        type="button"
        className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white"
        onClick={() => openStore(decision.setting.store_url)}
        data-testid="button-app-update"
      >
        Update
      </button>
      <button
        type="button"
        className="shrink-0 rounded-lg p-1.5 text-muted-foreground hover:bg-amber-100"
        aria-label="Dismiss"
        onClick={() => {
          rememberDismiss();
          setDismissed(true);
        }}
        data-testid="button-app-update-dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

/** Plain static strip for agent and ops soft updates. */
export function UpdateStrip() {
  const decision = useAppUpdate();
  if (decision.kind !== 'soft') return null;

  return (
    <div
      className="flex items-center justify-between gap-2 border-b border-border bg-muted px-3 py-2 text-sm"
      data-testid="strip-app-update"
    >
      <span className="min-w-0 flex-1">
        {decision.setting.message?.trim() || 'A new version of Bombino is available'}
      </span>
      <button
        type="button"
        className="shrink-0 font-semibold text-primary underline-offset-2 hover:underline"
        onClick={() => openStore(decision.setting.store_url)}
      >
        Update
      </button>
    </div>
  );
}
