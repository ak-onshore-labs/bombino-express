import { useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { TabBar, type TabItem } from '@/components/TabBar';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { OPS_NAV, isOpsMoreActive, isOpsNavActive, isOpsNavVisible } from '@/lib/opsNav';
import { useOpsNavBadges } from '@/hooks/useOpsNavBadges';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';

/**
 * Ops mobile bottom navigation — Dash / Pickups / Drops / Sent / More.
 * More opens a sheet for destinations that do not fit the five-tab bar; its
 * tab carries the sum of the pills inside, so nothing new hides behind it.
 */
export function OpsNav() {
  const [location] = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const role = useAppStore((s) => s.user?.role);
  const badges = useOpsNavBadges();

  const moreItems = OPS_NAV.filter(
    (item) => item.mobileMore && isOpsNavVisible(item, role),
  );
  const moreBadge = moreItems.reduce((sum, item) => sum + (badges[item.path] ?? 0), 0);

  const items: TabItem[] = [
    ...OPS_NAV.filter((item) => item.mobile && isOpsNavVisible(item, role)).map((item) => ({
      icon: item.icon,
      label: item.mobileLabel,
      path: item.path,
      badge: badges[item.path],
    })),
    {
      icon: MoreHorizontal,
      label: 'More',
      onPress: () => setMoreOpen(true),
      active: isOpsMoreActive(location),
      badge: moreBadge,
    },
  ];

  return (
    <>
      <TabBar items={items} testId="ops-nav" />
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent
          side="bottom"
          className="rounded-t-2xl max-h-[85vh] overflow-y-auto"
        >
          <SheetHeader className="text-left mb-4">
            <SheetTitle>More</SheetTitle>
          </SheetHeader>
          <nav className="space-y-1" data-testid="ops-nav-more-sheet">
            {moreItems.map((item) => {
              const active = isOpsNavActive(location, item.path);
              const Icon = item.icon;
              const badge = badges[item.path] ?? 0;
              return (
                <Link
                  key={item.path}
                  href={item.path}
                  onClick={() => setMoreOpen(false)}
                  className={cn(
                    'flex items-center gap-3 px-3 py-3 rounded-xl transition-colors',
                    active
                      ? 'bg-muted font-semibold text-foreground'
                      : 'text-foreground hover:bg-muted/50',
                  )}
                  data-testid={`ops-more-${item.mobileLabel.toLowerCase()}`}
                >
                  <Icon className="w-5 h-5 shrink-0" aria-hidden />
                  {item.label}
                  {badge > 0 && (
                    <span
                      className="ml-auto min-w-[20px] h-5 px-1.5 rounded-full bg-[#F2A123] text-[11px] font-bold text-[#1B2A41] grid place-items-center tabular-nums"
                      aria-label={`${badge} new`}
                      data-testid={`ops-more-badge-${item.mobileLabel.toLowerCase()}`}
                    >
                      {badge > 99 ? '99+' : badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </SheetContent>
      </Sheet>
    </>
  );
}
