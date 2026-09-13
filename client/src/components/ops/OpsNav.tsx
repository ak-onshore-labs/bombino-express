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
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';

/**
 * Ops mobile bottom navigation — Dash / Pickups / Drops / Sent / More.
 * More opens a sheet for destinations that do not fit the five-tab bar.
 */
export function OpsNav() {
  const [location] = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const role = useAppStore((s) => s.user?.role);

  const items: TabItem[] = [
    ...OPS_NAV.filter((item) => item.mobile && isOpsNavVisible(item, role)).map((item) => ({
      icon: item.icon,
      label: item.mobileLabel,
      path: item.path,
    })),
    {
      icon: MoreHorizontal,
      label: 'More',
      onPress: () => setMoreOpen(true),
      active: isOpsMoreActive(location),
    },
  ];

  const moreItems = OPS_NAV.filter(
    (item) => item.mobileMore && isOpsNavVisible(item, role),
  );

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
                </Link>
              );
            })}
          </nav>
        </SheetContent>
      </Sheet>
    </>
  );
}
