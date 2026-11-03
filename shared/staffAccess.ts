/**
 * Who on the Bombino team can see and do what in the ops console.
 *
 * Source: "Bombino Ops Console – Team Access", Proposed Roles tab, 6 Oct 2026.
 * One table, read by both sides:
 *
 *   - the server gates every /api/ops route on a permission (`can`), which is
 *     the actual lock;
 *   - the client hides the tabs and buttons a role cannot use (`OPS_TABS_BY_ROLE`,
 *     `can`), which is only so nobody is shown a page that answers 403.
 *
 * A branch manager is the one role scoped to a city. Their city is the hub they
 * were created with (`itd_users.metadata.hub_id`, via `hubCityForId`), and the
 * server filters orders, agents and beats to it. Everyone else sees all cities.
 *
 * Agents are not ops staff: they use the agent app and appear here only so the
 * Users page can create them.
 */

export const OPS_ROLES = [
  'super_admin',
  'admin',
  'branch_manager',
  'customer_support',
  'accounts',
  'kyc_reviewer',
] as const;

export type OpsRole = (typeof OPS_ROLES)[number];

/** Every staff role, ops and field. What `itd_users.role` may hold for a staff row. */
export const STAFF_ROLES = [...OPS_ROLES, 'agent'] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

export function isOpsRole(value: unknown): value is OpsRole {
  return typeof value === 'string' && (OPS_ROLES as readonly string[]).includes(value);
}

export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === 'string' && (STAFF_ROLES as readonly string[]).includes(value);
}

export const ROLE_LABELS: Record<StaffRole, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin (Head Office Ops)',
  branch_manager: 'Branch Manager',
  customer_support: 'Customer Support & KYC',
  accounts: 'Accounts / Finance',
  kyc_reviewer: 'KYC / Onboarding',
  agent: 'Pickup Agent',
};

export function roleLabel(role: string | null | undefined): string {
  return isStaffRole(role) ? ROLE_LABELS[role] : (role ?? '').replace(/_/g, ' ');
}

// ── Tabs ─────────────────────────────────────────────────────────────────────

export type OpsTab =
  | 'dashboard'
  | 'pickups'
  | 'dropoffs'
  | 'dispatched'
  | 'transactions'
  | 'customers'
  | 'guests'
  | 'applications'
  | 'users'
  | 'beats'
  | 'pincodes'
  | 'settings';

/** The sheet's "Ops console tabs" column, in nav order. */
export const OPS_TABS_BY_ROLE: Record<OpsRole, readonly OpsTab[]> = {
  super_admin: [
    'dashboard', 'pickups', 'dropoffs', 'dispatched', 'transactions', 'customers',
    'guests', 'applications', 'users', 'beats', 'pincodes', 'settings',
  ],
  admin: [
    'dashboard', 'pickups', 'dropoffs', 'dispatched', 'transactions', 'customers',
    'guests', 'applications', 'users', 'beats', 'pincodes',
  ],
  branch_manager: ['dashboard', 'pickups', 'dropoffs', 'dispatched', 'users', 'beats', 'pincodes'],
  customer_support: [
    'dashboard', 'pickups', 'dropoffs', 'dispatched', 'customers', 'guests', 'applications', 'pincodes',
  ],
  accounts: ['dashboard', 'transactions', 'dispatched', 'customers'],
  kyc_reviewer: ['applications', 'customers', 'guests'],
};

export function canSeeTab(role: string | null | undefined, tab: OpsTab): boolean {
  return isOpsRole(role) && OPS_TABS_BY_ROLE[role].includes(tab);
}

// ── Permissions ──────────────────────────────────────────────────────────────

export type OpsPermission =
  /** Read orders, their events and the cancellation queue. */
  | 'orders.view'
  /** Move orders through the lifecycle, assign agents, take payment at the hub. */
  | 'orders.act'
  /** The payments ledger (Transactions). */
  | 'payments.view'
  | 'customers.view'
  | 'guests.view'
  /** Open, approve and send back account applications, and their documents. */
  | 'applications.review'
  /** A customer's or guest's KYC images and identity numbers. Every view is logged. */
  | 'kyc.view'
  | 'users.view'
  /** Create pickup agents and edit or deactivate staff. */
  | 'users.manage'
  /** Create any staff role and change someone's role. */
  | 'users.assign_roles'
  | 'beats.view'
  | 'beats.manage'
  | 'pincodes.view'
  | 'settings';

const ALL: readonly OpsPermission[] = [
  'orders.view', 'orders.act', 'payments.view', 'customers.view', 'guests.view',
  'applications.review', 'kyc.view', 'users.view', 'users.manage', 'users.assign_roles',
  'beats.view', 'beats.manage', 'pincodes.view', 'settings',
];

/** The sheet's "What it does" and "Access notes" columns. */
export const OPS_PERMISSIONS_BY_ROLE: Record<OpsRole, readonly OpsPermission[]> = {
  super_admin: ALL,
  // "No Settings, no KYC document view." Creates agents; only a super admin
  // creates other staff and assigns roles.
  admin: ALL.filter((p) => p !== 'settings' && p !== 'kyc.view' && p !== 'users.assign_roles'),
  // "Only their city's orders and agents. Users and Beats are view only."
  // Their own city only: add and edit pickup agents, add and edit beats. The
  // city line is enforced on every write in server/routes/ops.ts.
  branch_manager: [
    'orders.view',
    'orders.act',
    'users.view',
    'users.manage',
    'beats.view',
    'beats.manage',
    'pincodes.view',
  ],
  // "Orders view only: cannot move orders, take payments or assign agents. Can
  // view KYC documents and approve applications."
  customer_support: [
    'orders.view', 'customers.view', 'guests.view', 'applications.review', 'kyc.view', 'pincodes.view',
  ],
  // "Dispatched and Customers are view only."
  accounts: ['orders.view', 'payments.view', 'customers.view'],
  kyc_reviewer: ['customers.view', 'guests.view', 'applications.review', 'kyc.view'],
};

export function can(role: string | null | undefined, permission: OpsPermission): boolean {
  return isOpsRole(role) && OPS_PERMISSIONS_BY_ROLE[role].includes(permission);
}

/** Roles whose orders, agents and beats are limited to their own city. */
export function isCityScoped(role: string | null | undefined): boolean {
  return role === 'branch_manager';
}

/** The roles a caller may give someone when creating or editing their account. */
export function assignableRoles(role: string | null | undefined): readonly StaffRole[] {
  if (can(role, 'users.assign_roles')) return STAFF_ROLES.filter((r) => r !== 'super_admin');
  if (can(role, 'users.manage')) return ['agent'];
  return [];
}

/** Where an ops role lands: its first tab. */
export function opsLandingPath(role: string | null | undefined): string {
  if (!isOpsRole(role)) return '/ops/dashboard';
  return `/ops/${OPS_TABS_BY_ROLE[role][0]}`;
}
