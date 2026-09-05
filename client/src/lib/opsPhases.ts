/**
 * Ops board phases — display labels + grouping. Status sets and
 * phaseIdForStatus live in shared/opsBoardQuery so the stage filter and
 * export cannot drift from what the board shows.
 */

import type { OrderStatus } from '@shared/orderContract';
import {
  OPS_PHASE_STATUSES,
  phaseIdForStatus,
  type OpsPhaseId,
} from '@shared/opsBoardQuery';

export type { OpsPhaseId };
export { phaseIdForStatus };

export type OpsPhase = {
  id: OpsPhaseId;
  label: string;
  /** When true, the board collapses this phase by default. */
  collapsedByDefault: boolean;
  /** Shown as a desktop column (cancelled is listed separately). */
  showAsColumn: boolean;
  statuses: readonly OrderStatus[];
};

export const OPS_PHASES: readonly OpsPhase[] = [
  {
    id: 'inbound',
    label: 'Pickup / inbound',
    collapsedByDefault: false,
    showAsColumn: true,
    statuses: OPS_PHASE_STATUSES.inbound,
  },
  {
    id: 'hub',
    label: 'At hub',
    collapsedByDefault: false,
    showAsColumn: true,
    statuses: OPS_PHASE_STATUSES.hub,
  },
  {
    id: 'settled',
    label: 'Settled',
    collapsedByDefault: false,
    showAsColumn: true,
    statuses: OPS_PHASE_STATUSES.settled,
  },
  {
    id: 'dispatched',
    label: 'Dispatched',
    collapsedByDefault: false,
    showAsColumn: true,
    statuses: OPS_PHASE_STATUSES.dispatched,
  },
  {
    id: 'cancelled',
    label: 'Cancelled',
    collapsedByDefault: true,
    showAsColumn: false,
    statuses: OPS_PHASE_STATUSES.cancelled,
  },
] as const;

export function groupOrdersByPhase<T extends { status: string }>(
  orders: T[]
): Record<OpsPhaseId, T[]> {
  const out: Record<OpsPhaseId, T[]> = {
    inbound: [],
    hub: [],
    settled: [],
    dispatched: [],
    cancelled: [],
  };
  for (const order of orders) {
    out[phaseIdForStatus(order.status)].push(order);
  }
  return out;
}
