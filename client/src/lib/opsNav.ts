/**
 * Ops console destinations — one list so the desktop rail and mobile bar
 * cannot drift. The mobile bar holds four primary tabs plus More; destinations
 * with `mobileMore` live in the More sheet (Transactions, Users).
 */

import type { LucideIcon } from 'lucide-react';
import {
  ContactRound,
  Route as RouteIcon,
  LayoutDashboard,
  MapPin,
  Package,
  Send,
  Settings,
  Truck,
  UserRound,
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
  /** Hidden unless the session role is super_admin. Cosmetic — the API is the lock. */
  superAdminOnly?: boolean;
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
    label: 'Guests',
    mobileLabel: 'Guests',
    path: '/ops/guests',
    icon: UserRound,
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
  {
    // A desk task — editing rider coverage is not something done on a phone in
    // the street — so it sits in the More sheet rather than on the four-tab bar.
    label: 'Beats',
    mobileLabel: 'Beats',
    path: '/ops/beats',
    icon: RouteIcon,
    mobile: false,
    mobileMore: true,
  },
  {
    label: 'Pincodes',
    mobileLabel: 'Pincodes',
    path: '/ops/pincodes',
    icon: MapPin,
    mobile: false,
    mobileMore: false,
  },
  {
    label: 'Settings',
    mobileLabel: 'Settings',
    path: '/ops/settings',
    icon: Settings,
    mobile: false,
    mobileMore: true,
    superAdminOnly: true,
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

export function isOpsNavVisible(
  item: OpsNavItem,
  role: string | undefined,
): boolean {
  return !item.superAdminOnly || role === 'super_admin';
}
