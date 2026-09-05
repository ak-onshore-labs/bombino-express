import type * as React from 'react';
import { useLocation } from 'wouter';
import { useIsMobile } from '@/hooks/use-mobile';
import { DesktopSidebar } from './DesktopSidebar';
import { DesktopTopBar } from './DesktopTopBar';
import { GuestProfileBanner } from './GuestProfileBanner';

export function AppLayout({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile();
  const [location] = useLocation();
  const isFullscreenPage = location === '/help';

  if (isMobile === undefined) {
    return <>{children}</>;
  }

  if (isMobile) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <DesktopSidebar />
      <main
        className={`app-content-desktop flex-1 flex flex-col ${
          isFullscreenPage
            ? 'overflow-hidden fullscreen-page bg-[#080808]'
            : 'overflow-y-auto bg-[#F8F9FA]'
        }`}
      >
        <DesktopTopBar />
        {/* Under the top bar, not above the whole shell — a full-width strip
            above the sidebar pushed the entire app down the page. */}
        <GuestProfileBanner />
        {isFullscreenPage ? (
          children
        ) : (
          <div className="max-w-7xl mx-auto w-full px-6 md:px-8 py-6 flex-1 min-h-0">
            {children}
          </div>
        )}
      </main>
    </div>
  );
}
