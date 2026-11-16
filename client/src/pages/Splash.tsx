import { useEffect, type ReactElement } from 'react';
import { useLocation } from 'wouter';
import { useAppStore } from '@/lib/store';
import { landingPathForRole } from '@/lib/surface';
import bombinoLogo from '@/assets/bombino-logo.png';

/* How long the splash holds. The progress rule underneath fills over the same
   time (see .splash-progress in index.css), so keep the two in step. */
const SPLASH_MS = 1800;

export default function Splash(): ReactElement {
  const [, setLocation] = useLocation();
  const { hasSeenOnboarding, isLoggedIn, user } = useAppStore();

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!hasSeenOnboarding) {
        setLocation('/onboarding');
        return;
      }
      // Role-aware landing: an agent reopening the app goes straight to their
      // queue, not to the customer home. Logged-out users still get /home,
      // which handles its own signed-out state.
      setLocation(isLoggedIn ? landingPathForRole(user?.role) : '/home');
    }, SPLASH_MS);

    return () => clearTimeout(timer);
  }, [hasSeenOnboarding, isLoggedIn, user?.role, setLocation]);

  // White, like the native launch screen in the shell, so the hand-over from
  // the store app to the web view does not flash.
  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center bg-card safe-top safe-bottom"
      data-testid="screen-splash"
    >
      <div className="flex flex-col items-center animate-scale-in">
        <img
          src={bombinoLogo}
          alt="Bombino Express"
          className="h-auto w-[248px] object-contain"
          data-testid="img-splash-logo"
        />
        <p
          className="doc-label mt-5 opacity-0 animate-fade-in"
          style={{ animationDelay: '250ms' }}
        >
          India <span className="text-accent">→</span> the world · door to door
        </p>
      </div>

      <div
        className="absolute h-[3px] w-24 overflow-hidden rounded-full bg-border"
        style={{ bottom: 'calc(3.5rem + var(--sab))' }}
        role="progressbar"
        aria-label="Opening Bombino Express"
      >
        <span
          className="splash-progress block h-full w-full origin-left rounded-full bg-accent"
          style={{ animationDuration: `${SPLASH_MS}ms` }}
        />
      </div>
    </div>
  );
}
