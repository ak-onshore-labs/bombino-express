import { Menu, Bell } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { AskBiaTopButton } from '@/components/bia/AskBiaTopButton';
import { useAppStore } from '@/lib/store';
import { TopBar } from '@/components/TopBar';
import { GuestProfileBanner } from '@/components/GuestProfileBanner';
import { useUnreadNotificationCount } from '@/hooks/useCustomerOrders';
import { useGuestProfile } from '@/hooks/useGuestProfile';

interface HeaderProps {
  onMenuClick?: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  const { isLoggedIn } = useAppStore();
  // A verified guest has a bell too — their order updates are keyed on the
  // guest_ref their session holds. See /api/notifications.
  const { data: guestProfile } = useGuestProfile({ enabled: !isLoggedIn });
  const hasBell = isLoggedIn || !!guestProfile;

  // Derived from the notification list, which polls. This used to be a
  // fetch-once effect against /api/notifications/unread-count: the badge was
  // fixed at whatever the count was when the header first mounted, so it did
  // not clear when the customer read something and did not appear when
  // something arrived.
  const unreadCount = useUnreadNotificationCount(hasBell);
  // Home keeps BIA's floating button; every other screen has it up here.
  const [location] = useLocation();
  const onHome = location === '/home';

  return (
    <TopBar
      homeHref="/home"
      className="md:hidden"
      testId="header"
      // Outside the `md:hidden` header now, so it needs its own breakpoint
      // guard. Desktop gets its copy from AppLayout.
      below={
        <div className="md:hidden">
          {/* Below the sticky bar, inside its `below` slot: above the header it
              would push the bar down the page, inside it it would pin a strip
              of the viewport on every screen. Renders nothing for an account
              holder or a visitor with no verified number. */}
          <GuestProfileBanner />
        </div>
      }
      left={
        <button
          onClick={onMenuClick}
          className="p-2 -ml-2 rounded-xl hover:bg-muted active:scale-95 transition-all"
          data-testid="button-menu"
        >
          <Menu className="w-5 h-5 text-foreground" />
        </button>
      }
      right={
        <div className="flex items-center gap-1 -mr-2">
        {!onHome && <AskBiaTopButton />}
        <Link
          href="/notifications"
          className="relative p-2 rounded-xl hover:bg-muted active:scale-95 transition-all"
          data-testid="button-notifications"
        >
          <Bell className="w-5 h-5 text-foreground" />
          {hasBell && unreadCount > 0 && (
            <span className="absolute top-0.5 right-0.5 min-w-[18px] h-[18px] bg-primary text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 shadow-sm">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Link>
        </div>
      }
    />
  );
}
