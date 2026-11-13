import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { useAppStore } from '@/lib/store';
import { landingPathForRole } from '@/lib/surface';
import bombinoLogo from '@/assets/bombino-logo.png';

export default function Splash() {
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
    }, 1800);

    return () => clearTimeout(timer);
  }, [hasSeenOnboarding, isLoggedIn, user?.role, setLocation]);

  return (
    <div className="fixed inset-0 bg-white flex flex-col items-center justify-center safe-top safe-bottom" data-testid="screen-splash">
      <div className="animate-scale-in flex flex-col items-center">
        <img 
          src={bombinoLogo} 
          alt="Bombino Express - Bringing the world closer" 
          className="w-[280px] h-auto object-contain"
          data-testid="img-splash-logo"
        />
      </div>
      <div
        className="absolute flex flex-col items-center animate-fade-in"
        style={{ animationDelay: '400ms', bottom: 'calc(3rem + var(--sab))' }}
      >
        <div className="flex gap-1">
          <span className="w-2 h-2 rounded-full bg-primary animate-pulse" style={{ animationDelay: '0ms' }} />
          <span className="w-2 h-2 rounded-full bg-primary/60 animate-pulse" style={{ animationDelay: '150ms' }} />
          <span className="w-2 h-2 rounded-full bg-primary/30 animate-pulse" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  );
}