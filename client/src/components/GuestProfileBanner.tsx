import { useCallback, useSyncExternalStore } from 'react';
import { useLocation } from 'wouter';
import { useAppStore } from '@/lib/store';
import { useGuestProfile } from '@/hooks/useGuestProfile';
import { ProfileCompletionBanner } from '@/components/ProfileCompletionBanner';

/**
 * `ProfileCompletionBanner`, wired to the store and the router.
 *
 * The banner itself takes a profile and two callbacks and knows nothing about
 * where either comes from — that keeps it testable and lets the guest
 * dashboard reuse the same component. This is the connected half, so the two
 * mount points (mobile `Header`, desktop `AppLayout`) stay one line each and
 * cannot disagree about when to show it.
 */

const DISMISS_KEY = 'bombino-guest-banner-dismissed';

/**
 * Dismissal lives in `sessionStorage`, not `localStorage`, and deliberately.
 *
 * Hiding it forever is the wrong trade: the profile really is incomplete, and
 * a customer who comes back next week to book again is someone worth asking
 * once more. Hiding it for the rest of this visit is enough to stop it nagging
 * the person who has already said no.
 */
const dismissListeners = new Set<() => void>();

function readDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    // Storage denied (private mode, or a browser set to block site data).
    // Showing the banner is the safe answer — it is dismissible either way.
    return false;
  }
}

function subscribeDismissed(listener: () => void): () => void {
  dismissListeners.add(listener);
  return () => {
    dismissListeners.delete(listener);
  };
}

function setDismissed(): void {
  try {
    sessionStorage.setItem(DISMISS_KEY, '1');
  } catch {
    // Nothing to do. The banner will come back on the next render, which is an
    // honest reflection of a browser that cannot remember the choice.
  }
  dismissListeners.forEach((listener) => listener());
}

export function GuestProfileBanner({
  className,
}: {
  className?: string;
}): React.JSX.Element | null {
  const [, setLocation] = useLocation();
  const isLoggedIn = useAppStore((s) => s.isLoggedIn);
  // Not asked at all for an account holder: they have their own verification
  // banner, and the endpoint answers them 409 anyway.
  const { data: guestProfile } = useGuestProfile({ enabled: !isLoggedIn });
  const dismissed = useSyncExternalStore(subscribeDismissed, readDismissed, () => false);

  const handleComplete = useCallback(() => {
    setLocation('/guest-profile');
  }, [setLocation]);

  // An account holder has a real profile screen and a real verification
  // banner; this one is only for a number that has no account behind it.
  if (isLoggedIn || !guestProfile || dismissed) return null;

  return (
    <ProfileCompletionBanner
      profile={guestProfile}
      onComplete={handleComplete}
      onDismiss={setDismissed}
      className={className}
    />
  );
}
