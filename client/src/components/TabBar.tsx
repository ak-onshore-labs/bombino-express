import type { LucideIcon } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { cn } from '@/lib/utils';

/**
 * The customer surface's bottom navigation.
 *
 * Presentation only: the surface owns its own item list and its responsive
 * behaviour (the customer bar hides on desktop).
 *
 * The agent surface used to render this too. It no longer does — the docket
 * grammar changed the bar's height, its labels' family, and how the active item
 * is marked, so `AgentNav` draws its own. Anything changed here stays on the
 * customer app, which is the point.
 *
 * `onPress` / `active` are optional slots the ops More tab uses. Customer
 * items stay path-only Links.
 */

export interface TabItem {
  icon: LucideIcon;
  label: string;
  path?: string;
  /** When set, the tab is a button (no navigation). */
  onPress?: () => void;
  /** Override path-based active (e.g. More lighting on nested destinations). */
  active?: boolean;
  /** Small count on the icon. Omit or pass 0 to hide. */
  badge?: number;
  /**
   * Draw the icon on an amber pill so the tab stands out from the rest. The
   * ops More tab uses it: half the console lives behind it on a phone.
   */
  highlight?: boolean;
}

function tabClass(isActive: boolean): string {
  return cn(
    'flex flex-col items-center justify-center flex-1 h-full transition-all relative active:scale-95',
    isActive ? 'text-white' : 'text-white/65',
  );
}

function TabChrome({
  icon: Icon,
  label,
  badge,
  isActive,
  highlight = false,
}: {
  icon: LucideIcon;
  label: string;
  badge?: number;
  isActive: boolean;
  highlight?: boolean;
}) {
  const slug = label.toLowerCase().replace(/\s+/g, '-');
  return (
    <>
      <span
        className={cn(
          'relative',
          highlight && 'grid place-items-center w-11 h-7 -my-1 rounded-full bg-[#F2A123] text-[#1B2A41] shadow-sm',
        )}
      >
        <Icon className={cn('w-5 h-5 transition-all', (isActive || highlight) && 'stroke-[2.5]')} />
        {typeof badge === 'number' && badge > 0 && (
          <span
            className={cn(
              'absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold grid place-items-center tabular-nums',
              // On the amber pill an amber count would vanish.
              highlight ? 'bg-white text-primary ring-1 ring-primary' : 'bg-[#F2A123] text-[#1B2A41]',
            )}
            data-testid={`nav-badge-${slug}`}
          >
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </span>
      <span
        className={cn(
          'text-[10px] mt-1 transition-all',
          isActive || highlight ? 'font-semibold' : 'font-medium',
          highlight && 'text-white',
        )}
      >
        {label}
      </span>
      {isActive && (
        <span
          className="absolute top-0 left-1/2 -translate-x-1/2 w-5 h-0.5 bg-white rounded-full"
          aria-hidden
        />
      )}
    </>
  );
}

function isPathActive(location: string, path: string): boolean {
  // Exact match for surface roots so a detail route doesn't light up
  // two tabs at once; prefix match for the rest.
  const isRoot = path === '/home' || path === '/agent' || path === '/ops';
  return isRoot
    ? location === path || (path === '/home' && location === '/')
    : location.startsWith(path);
}

export function TabBar({
  items,
  className,
  testId = 'tab-bar',
}: {
  items: TabItem[];
  className?: string;
  testId?: string;
}) {
  const [location] = useLocation();

  return (
    <nav
      className={cn(
        'fixed bottom-0 left-0 right-0 z-50 bg-primary shadow-[0_-4px_12px_rgba(0,0,0,0.12)] safe-bottom',
        className,
      )}
      data-testid={testId}
    >
      <div className="flex items-center justify-around h-16 max-w-md mx-auto">
        {items.map(({ icon, label, path, badge, onPress, active, highlight }) => {
          const isActive = active ?? (path ? isPathActive(location, path) : false);
          const slug = label.toLowerCase().replace(/\s+/g, '-');
          const chrome = (
            <TabChrome
              icon={icon}
              label={label}
              badge={badge}
              isActive={isActive}
              highlight={highlight}
            />
          );

          if (onPress) {
            return (
              <button
                key={path ?? label}
                type="button"
                onClick={onPress}
                className={cn(tabClass(isActive), 'bg-transparent border-0 cursor-pointer')}
                data-testid={`nav-${slug}`}
              >
                {chrome}
              </button>
            );
          }

          return (
            <Link
              key={path ?? label}
              href={path ?? '/'}
              className={tabClass(isActive)}
              data-testid={`nav-${slug}`}
            >
              {chrome}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
