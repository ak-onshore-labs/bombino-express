import { useMemo, type ComponentType } from 'react';
import { signOutAndRedirect } from '@/lib/session';
import { LogOut, User } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import bombinoLogo from '@/assets/bombino-logo.png';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import { OPS_NAV, isOpsNavActive, isOpsNavVisible } from '@/lib/opsNav';
import { useOpsNavBadges } from '@/hooks/useOpsNavBadges';

function NavItem({
  icon: Icon,
  label,
  path,
  active,
  badge = 0,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  path: string;
  active: boolean;
  /** New since this person last opened the section; hidden at 0. */
  badge?: number;
}) {
  const slug = label.toLowerCase().replace(/\s+/g, '-');
  return (
    <Link
      href={path}
      className={cn(
        'flex items-center gap-3 px-3 py-2.5 rounded-xl mx-2 my-0.5 transition-all duration-150 cursor-pointer select-none group',
        active
          ? 'bg-[#F2A123]/[0.12] text-white'
          : 'text-white/50 hover:bg-white/[0.06] hover:text-white/80'
      )}
      data-testid={`ops-sidebar-${slug}`}
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
      {badge > 0 && (
        <span
          className="ml-auto min-w-[20px] h-5 px-1.5 rounded-full bg-[#F2A123] text-[11px] font-bold text-[#1B2A41] grid place-items-center tabular-nums"
          aria-label={`${badge} new`}
          data-testid={`ops-sidebar-badge-${slug}`}
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </Link>
  );
}

function roleLabel(role: string | undefined): string {
  if (role === 'super_admin') return 'Super admin';
  if (role === 'admin') return 'Admin';
  return role ?? 'Operations';
}

/**
 * Ops desktop rail — same chrome as the customer DesktopSidebar (navy
 * gradient, logo, amber active state, sticky w-60), ops destinations only.
 * Do not import the customer sidebar.
 */
export function OpsDesktopSidebar() {
  const [location, setLocation] = useLocation();
  const user = useAppStore((s) => s.user);
  const badges = useOpsNavBadges();

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
    return 'O';
  }, [user?.fullName]);

  const handleLogout = (): Promise<void> => signOutAndRedirect(setLocation);

  return (
    <div
      className="hidden md:flex relative flex-col w-60 h-screen sticky top-0 bg-gradient-to-b from-[lab(34.0831_-9.57756_-27.7093)] to-[#0c1a25] border-r border-white/[0.07] overflow-hidden"
      data-testid="ops-desktop-sidebar"
    >
      <div
        className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-[#F2A123]/[0.05] to-transparent pointer-events-none"
        aria-hidden
      />
      <div className="h-16 flex items-center px-5 border-b border-white/[0.07]">
        <img
          src={bombinoLogo}
          alt="Bombino Express"
          className="h-8 w-auto"
          style={{ filter: 'brightness(0) invert(1)' }}
        />
      </div>

      <div className="px-4 py-4 border-b border-white/[0.07] flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center bg-[#F2A123]/20">
          {user ? (
            <span className="text-[#F2A123] text-xs font-bold">{initials}</span>
          ) : (
            <User className="w-4 h-4 text-white/30" />
          )}
        </div>
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-white truncate max-w-[160px]">
            {user?.fullName || 'Operations'}
          </p>
          <p className="text-xs text-white/40 truncate max-w-[160px] mt-0.5">
            {roleLabel(user?.role)}
          </p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto py-3">
        <p className="px-5 mb-2 mt-1 text-[10px] font-semibold tracking-widest text-white/25 uppercase">
          Operations
        </p>
        {OPS_NAV.filter((item) => isOpsNavVisible(item, user?.role)).map(
          ({ label, icon, path }) => (
          <NavItem
            key={path}
            icon={icon}
            label={label}
            path={path}
            active={isOpsNavActive(location, path)}
            badge={badges[path]}
          />
        ))}
      </nav>

      <div className="flex-shrink-0 border-t border-white/[0.07] px-3 pt-2 pb-3">
        <button
          type="button"
          onClick={() => void handleLogout()}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-white/40 hover:bg-red-500/[0.12] hover:text-red-400 transition-all duration-150 text-left"
          data-testid="button-ops-sidebar-logout"
        >
          <LogOut className="w-[18px] h-[18px]" />
          <span className="text-sm font-medium">Sign out</span>
        </button>
      </div>
    </div>
  );
}
