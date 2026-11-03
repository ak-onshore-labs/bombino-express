import { Home, BadgeDollarSign, Send, PackageSearch } from 'lucide-react';
import { SupportFab } from '@/components/SupportFab';
import { TabBar, type TabItem } from '@/components/TabBar';
import { useParcelsOverview } from '@/hooks/useParcelsOverview';

/**
 * Customer bottom navigation.
 *
 * Presentation moved to the shared `TabBar` so the agent surface renders the
 * identical bar rather than a copy that drifts. This file keeps what is
 * customer-specific: the destinations, the support FAB, and hiding on desktop
 * where the sidebar takes over.
 */
const navItems: TabItem[] = [
  { icon: Home, label: 'Home', path: '/home' },
  { icon: BadgeDollarSign, label: 'Rates', path: '/rates' },
  { icon: Send, label: 'Ship', path: '/create' },
  { icon: PackageSearch, label: 'Orders', path: '/orders' },
];

export function BottomNav() {
  // Parcels, sent or coming to you, that moved since Orders was last open.
  const { unseen } = useParcelsOverview();
  const items = navItems.map((item) => (item.path === '/orders' ? { ...item, badge: unseen } : item));
  return (
    <>
      <div className="md:hidden">
        <SupportFab />
      </div>
      <TabBar items={items} className="md:hidden" testId="bottom-nav" />
    </>
  );
}
