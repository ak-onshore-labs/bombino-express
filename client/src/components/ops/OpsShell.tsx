import type * as React from 'react';
import { LogOut } from 'lucide-react';
import { useLocation } from 'wouter';
import { useAppStore } from '@/lib/store';
import { TopBar } from '@/components/TopBar';
import { OpsNav } from './OpsNav';
import { OpsDesktopSidebar } from './OpsDesktopSidebar';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

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
  const [, setLocation] = useLocation();
  const { user, logout } = useAppStore();

  const handleLogout = async (): Promise<void> => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {
      // Ignore network failure — still clear the local session.
    }
    logout();
    setLocation('/login');
  };

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
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
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
              wide ? 'max-w-6xl' : 'max-w-md'
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
          <button
            type="button"
            onClick={() => void handleLogout()}
            aria-label="Sign out"
            className="p-2 -mr-2 rounded-xl hover:bg-muted active:scale-95 transition-all"
            data-testid="button-ops-logout"
          >
            <LogOut className="w-5 h-5 text-foreground" />
          </button>
        }
      />

      <main
        className={cn(
          'mx-auto px-4 py-4',
          wide ? 'max-w-6xl' : 'max-w-md'
        )}
      >
        {heading}
        {children}
      </main>

      <OpsNav />
    </div>
  );
}
