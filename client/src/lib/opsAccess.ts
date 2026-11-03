/**
 * The signed-in ops role, read against shared/staffAccess.ts.
 *
 * COSMETIC, like everything on the client: it hides tabs and buttons a role
 * cannot use so nobody is shown a page that answers 403. The server's
 * `opsGateFor` is the lock.
 */

import { can, canSeeTab, type OpsPermission, type OpsTab } from '@shared/staffAccess';
import { useAppStore } from '@/lib/store';

export function useOpsRole(): string | undefined {
  return useAppStore((s) => s.user?.role);
}

export function useCan(permission: OpsPermission): boolean {
  return can(useOpsRole(), permission);
}

export function useCanSeeTab(tab: OpsTab): boolean {
  return canSeeTab(useOpsRole(), tab);
}
