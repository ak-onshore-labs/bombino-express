import { useLayoutEffect } from 'react';
import type * as React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { PAGE_IN, PAGE_SCALE, REDUCED } from '@/lib/motion';
import { signOutAndRedirect } from '@/lib/session';
import { LogOut } from 'lucide-react';
import { useLocation } from 'wouter';
import { useAppStore } from '@/lib/store';
import { TopBar } from '@/components/TopBar';
import { OpsNav } from './OpsNav';
import { OpsDesktopSidebar } from './OpsDesktopSidebar';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { ScanParcelButton } from '@/components/ScanParcelSheet';

/**
 * Chrome for every ops screen.
 * Desktop: customer AppLayout split (left rail + scrollable main).
 * Mobile: TopBar + children + bottom OpsNav.
 */
export function OpsShell({
  title,
  subtitle,
  eyebrow,
  actions,
  wide = false,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Above the title: a way back to the list a detail page came from. */
  eyebrow?: React.ReactNode;
  /** Beside the title, on the right: page-level buttons (settings, export). */
  actions?: React.ReactNode;
  wide?: boolean;
  children: React.ReactNode;
}) {
  const isMobile = useIsMobile();
  const [location, setLocation] = useLocation();
  const quiet = useReducedMotion();

  // Land at the top of each new screen, before paint (as the agent app does).
  useLayoutEffect(() => {
    if (isMobile) window.scrollTo(0, 0);
  }, [isMobile, location]);
  const user = useAppStore((s) => s.user);

  const handleLogout = (): Promise<void> => signOutAndRedirect(setLocation);

  const heading = (
    <div className="mb-4">
      {eyebrow && <div className="mb-2">{eyebrow}</div>}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight text-foreground leading-tight">
            {title}
          </h1>
          <p className="text-sm font-medium text-muted-foreground mt-0.5">
            {subtitle ?? user?.fullName ?? 'Operations'}
          </p>
        </div>
        {/* Scan sits with the page's own buttons on desktop; on phones it is
            in the top bar, where a thumb finds it on every screen. */}
        {(actions || !isMobile) && (
          <div className="flex shrink-0 items-center gap-2">
            {actions}
            {!isMobile && <ScanParcelButton surface="ops" />}
          </div>
        )}
      </div>
    </div>
  );

  if (!isMobile) {
    return (
      <div className="flex h-screen overflow-hidden" data-testid="ops-shell">
        <OpsDesktopSidebar />
        <main className="flex-1 flex flex-col overflow-y-auto bg-[#F8F9FA]">
          <div
            className={cn(
              'mx-auto w-full px-6 md:px-8 py-6',
              wide ? 'max-w-6xl' : 'max-w-3xl'
            )}
          >
            {heading}
            {children}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background pb-nav" data-testid="ops-shell">
      <TopBar
        homeHref="/ops"
        testId="ops-topbar"
        right={
          <div className="flex items-center gap-1 -mr-2">
          <ScanParcelButton surface="ops" variant="icon" />
          <button
            type="button"
            onClick={() => void handleLogout()}
            aria-label="Sign out"
            className="p-2 rounded-md hover:bg-muted active:scale-95 transition-all"
            data-testid="button-ops-logout"
          >
            <LogOut className="w-5 h-5 text-foreground" />
          </button>
          </div>
        }
      />

      {/* The screen rises to meet you, like the agent app's PageTransition.
          Only the content moves: TopBar and OpsNav are fixed, and a fixed
          element inside an animating transform would drift with it. Keyed on
          the path so moving between two orders replays it. */}
      <motion.main
        key={location}
        initial={quiet ? { opacity: 0 } : { opacity: 0, scale: PAGE_SCALE }}
        animate={quiet ? { opacity: 1 } : { opacity: 1, scale: 1 }}
        transition={quiet ? REDUCED : { ...PAGE_IN, opacity: { duration: 0.16, ease: 'easeOut' } }}
        style={{ transformOrigin: '50% 30%' }}
        className={cn(
          'mx-auto px-4 py-4',
          wide ? 'max-w-6xl' : 'max-w-md'
        )}
      >
        {heading}
        {children}
      </motion.main>

      <OpsNav />
    </div>
  );
}
