import { Menu, Bell } from 'lucide-react';
import { Link } from 'wouter';
import { useAppStore } from '@/lib/store';
import { TopBar } from '@/components/TopBar';
import { GuestProfileBanner } from '@/components/GuestProfileBanner';
import { useUnreadNotificationCount } from '@/hooks/useCustomerOrders';

interface HeaderProps {
  onMenuClick?: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  const { isLoggedIn } = useAppStore();

  // Derived from the notification list, which polls. This used to be a
  // fetch-once effect against /api/notifications/unread-count: the badge was
  // fixed at whatever the count was when the header first mounted, so it did
  // not clear when the customer read something and did not appear when
  // something arrived.
  const unreadCount = useUnreadNotificationCount(isLoggedIn);

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
        <Link
          href="/notifications"
          className="relative p-2 -mr-2 rounded-xl hover:bg-muted active:scale-95 transition-all"
          data-testid="button-notifications"
        >
          <Bell className="w-5 h-5 text-foreground" />
          {isLoggedIn && unreadCount > 0 && (
            <span className="absolute top-0.5 right-0.5 min-w-[18px] h-[18px] bg-primary text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 shadow-sm">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Link>
      }
    />
  );
}
