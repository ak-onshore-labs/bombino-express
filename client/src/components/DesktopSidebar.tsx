import { useMemo, type ComponentType } from 'react';
import {
  Home,
  BadgeDollarSign,
  Send,
  PackageSearch,
  MapPin,
  User,
  Bot,
  Bell,
  LogOut,
  LogIn,
} from 'lucide-react';
import { Link, useLocation } from 'wouter';
import bombinoLogo from '@/assets/bombino-logo.png';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import { useGuestProfile } from '@/hooks/useGuestProfile';
import { apiRequest } from '@/lib/queryClient';
import { useUnreadNotificationCount } from '@/hooks/useCustomerOrders';

const MAIN_NAV = [
  { label: 'Home', icon: Home, path: '/home' },
  { label: 'Rates', icon: BadgeDollarSign, path: '/rates' },
  { label: 'Create Shipment', icon: Send, path: '/create' },
  // Cancellations deliberately absent: they live as a tab inside My Orders,
  // because a cancellation is something that happened to an order rather than
  // a separate part of the app.
  { label: 'My Orders', icon: PackageSearch, path: '/orders' },
  { label: 'Track', icon: MapPin, path: '/track' },
] as const;

const ACCOUNT_NAV = [
  { label: 'My Profile', icon: User, path: '/profile', authRequired: true as const },
  { label: 'Ask BIA', icon: Bot, path: '/help' },
] as const;

function NavItem({
  icon: Icon,
  label,
  path,
  active,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  path: string;
  active: boolean;
}) {
  return (
    <Link
      href={path}
      className={cn(
        'flex items-center gap-3 px-3 py-2.5 rounded-xl mx-2 my-0.5 transition-all duration-150 cursor-pointer select-none group',
        active
          ? 'bg-[#F2A123]/[0.12] text-white'
          : 'text-white/50 hover:bg-white/[0.06] hover:text-white/80'
      )}
    >
      <Icon
        className={cn(
          'w-[18px] h-[18px] flex-shrink-0 transition-colors',
          active ? 'text-[#F2A123]' : 'text-white/40 group-hover:text-white/70'
        )}
      />
      <span className={cn('text-sm leading-none', active ? 'font-semibold' : 'font-medium')}>
        {label}
      </span>
    </Link>
  );
}

export function DesktopSidebar() {
  const [location] = useLocation();
  const { isLoggedIn, user, logout } = useAppStore();
  // A verified guest has a profile screen of their own — see SideMenu for why
  // hiding it left their details unreachable once the banner cleared.
  const { data: guestProfile } = useGuestProfile({ enabled: !isLoggedIn });
  // Shares the polled notification list with the mobile header — see the note
  // on `useUnreadNotificationCount`. One query, two badges, always in step.
  const unreadCount = useUnreadNotificationCount(isLoggedIn);

  const initials = useMemo(() => {
    if (user?.fullName?.trim()) {
      const parts = user.fullName.trim().split(/\s+/).filter(Boolean);
      if (parts.length >= 2) {
        const a = parts[0][0] ?? '';
        const b = parts[parts.length - 1][0] ?? '';
        return `${a}${b}`.toUpperCase();
      }
      if (parts.length === 1) {
        return (parts[0][0] ?? '').toUpperCase();
      }
    }
    if (user?.email?.trim()) {
      return (user.email.trim()[0] ?? '').toUpperCase();
    }
    return '';
  }, [user?.fullName, user?.email]);

  const isActive = (path: string): boolean => {
    if (path === '/home') return location === '/home' || location === '/';
    return location === path || location.startsWith(path + '/');
  };

  const visibleAccountNav = ACCOUNT_NAV.filter(
    (item) => !('authRequired' in item && item.authRequired) || isLoggedIn || !!guestProfile
  ).map((item) =>
    // Same row, same label, different destination: /profile is the account
    // screen and turns a guest away, /guest-profile is theirs.
    item.path === '/profile' && !isLoggedIn && guestProfile
      ? { ...item, path: '/guest-profile' }
      : item
  );

  return (
    <div className="hidden md:flex relative flex-col w-60 h-screen sticky top-0 bg-gradient-to-b from-[lab(34.0831_-9.57756_-27.7093)] to-[#0c1a25] border-r border-white/[0.07] overflow-hidden">
      <div
        className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-[#F2A123]/[0.05] to-transparent pointer-events-none"
        aria-hidden
      />
      <div className="h-16 flex items-center justify-between px-5 border-b border-white/[0.07]">
        <img
          src={bombinoLogo}
          alt="Bombino Express"
          className="h-8 w-auto"
          style={{ filter: 'brightness(0) invert(1)' }}
        />
        <Link
          href="/notifications"
          className="relative p-2 rounded-xl hover:bg-white/[0.08] transition-colors"
        >
          <Bell className="w-[18px] h-[18px] text-white/60" />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 w-2 h-2 bg-red-400 rounded-full" />
          )}
        </Link>
      </div>

      <div className="px-4 py-4 border-b border-white/[0.07] flex items-center gap-3">
        <div
          className={cn(
            'w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center',
            isLoggedIn ? 'bg-[#F2A123]/20' : 'bg-white/[0.08]'
          )}
        >
          {isLoggedIn ? (
            <span className="text-[#F2A123] text-xs font-bold">
              {initials || 'U'}
            </span>
          ) : (
            <User className="w-4 h-4 text-white/30" />
          )}
        </div>
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-white truncate max-w-[160px]">
            {isLoggedIn
              ? user?.fullName || user?.email || 'User'
              : 'Guest User'}
          </p>
          <p className="text-xs text-white/40 truncate max-w-[160px] mt-0.5">
            {isLoggedIn ? user?.email : 'Sign in to manage shipments'}
          </p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto py-3">
        <p className="px-5 mb-2 mt-1 text-[10px] font-semibold tracking-widest text-white/25 uppercase">
          Main
        </p>
        {MAIN_NAV.map(({ label, icon, path }) => (
          <NavItem
            key={path}
            icon={icon}
            label={label}
            path={path}
            active={isActive(path)}
          />
        ))}

        <div className="my-3 mx-4 h-px bg-white/[0.07]" />

        <p className="px-5 mb-2 text-[10px] font-semibold tracking-widest text-white/25 uppercase">
          Account
        </p>
        {visibleAccountNav.map(({ label, icon, path }) => (
          <NavItem
            key={path}
            icon={icon}
            label={label}
            path={path}
            active={isActive(path)}
          />
        ))}
      </nav>

      <div className="flex-shrink-0 border-t border-white/[0.07] px-3 pt-2 pb-3">
        {isLoggedIn ? (
          <button
            type="button"
            onClick={() => {
              apiRequest('POST', '/api/auth/logout').catch(() => {});
              logout();
            }}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-white/40 hover:bg-red-500/[0.12] hover:text-red-400 transition-all duration-150 text-left"
          >
            <LogOut className="w-[18px] h-[18px]" />
            <span className="text-sm font-medium">Sign out</span>
          </button>
        ) : (
          <Link
            href="/login"
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-[#F2A123]/70 hover:bg-[#F2A123]/[0.08] hover:text-[#F2A123] transition-all duration-150"
          >
            <LogIn className="w-[18px] h-[18px]" />
            <span className="text-sm font-medium">Sign in</span>
          </Link>
        )}
      </div>
    </div>
  );
}

