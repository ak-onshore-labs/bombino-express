/**
 * Ops console destinations — one list so the desktop rail and mobile bar
 * cannot drift. The mobile bar holds four primary tabs plus More; destinations
 * with `mobileMore` live in the More sheet (Transactions, Users).
 */

import type { LucideIcon } from 'lucide-react';
import {
  ContactRound,
  LayoutDashboard,
  Package,
  Send,
  Truck,
  Users,
  Wallet,
} from 'lucide-react';

export type OpsNavItem = {
  label: string;
  /** Shorter word for the five-tab mobile bar. */
  mobileLabel: string;
  path: string;
  icon: LucideIcon;
  /** On the mobile bottom bar. */
  mobile: boolean;
  /** In the mobile More sheet — not on the bar. */
  mobileMore: boolean;
};

export const OPS_NAV: readonly OpsNavItem[] = [
  {
    label: 'Dashboard',
    mobileLabel: 'Dash',
    path: '/ops/dashboard',
    icon: LayoutDashboard,
    mobile: true,
    mobileMore: false,
  },
  {
    label: 'Pickups',
    mobileLabel: 'Pickups',
    path: '/ops/pickups',
    icon: Truck,
    mobile: true,
    mobileMore: false,
  },
  {
    label: 'Drop-offs',
    mobileLabel: 'Drops',
    path: '/ops/dropoffs',
    // lucide 0.545 has no PackageDown — Package is the drop-off stand-in.
    icon: Package,
    mobile: true,
    mobileMore: false,
  },
  {
    label: 'Dispatched',
    mobileLabel: 'Sent',
    path: '/ops/dispatched',
    icon: Send,
    mobile: true,
    mobileMore: false,
  },
  {
    label: 'Transactions',
    mobileLabel: 'Txns',
    path: '/ops/transactions',
    icon: Wallet,
    mobile: false,
    mobileMore: true,
  },
  {
    label: 'Customers',
    mobileLabel: 'Customers',
    path: '/ops/customers',
    icon: ContactRound,
    mobile: false,
    mobileMore: false,
  },
  {
    label: 'Users',
    mobileLabel: 'Users',
    path: '/ops/users',
    icon: Users,
    mobile: false,
    mobileMore: true,
  },
];

/** Prefix match, but `/ops/orders/:id` does not light any section tab. */
export function isOpsNavActive(location: string, path: string): boolean {
  return location === path || location.startsWith(`${path}/`);
}

/** True when the current route is a More-sheet destination. */
export function isOpsMoreActive(location: string): boolean {
  return OPS_NAV.some(
    (item) => item.mobileMore && isOpsNavActive(location, item.path),
  );
}
