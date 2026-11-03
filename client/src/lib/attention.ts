/**
 * Home's "Needs your attention": the few things a customer has to act on, and
 * nothing else. Everything that is merely news lives in the bell.
 *
 * Built from data Home already holds (the order list and the bell), so it adds
 * no request of its own except the live OTP, which the card fetches itself.
 * Empty means the section is not drawn at all.
 */

import type { DisplayRow } from './shipmentRows';
import { hrefFor, notificationTarget } from './notificationLink';

export type AttentionItem =
  | {
      kind: 'otp';
      key: string;
      orderNo: string;
      handover: 'pickup' | 'dropoff';
      /** The agent is on the way: read it out now, not later. */
      urgent: boolean;
      pickupDate: string | null;
    }
  | { kind: 'pay'; key: string; orderNo: string; amount: number | null }
  | { kind: 'notice'; key: string; notificationId: string; title: string; body: string; href: string; tone: 'warning' | 'info' };

interface BellRow {
  id: string;
  type: string | null;
  title: string | null;
  body: string | null;
  data: unknown;
  is_read: boolean | null;
  created_at: string;
}

/** Lower sorts first. */
const RANK = { otpUrgent: 0, pay: 1, notice: 2, otp: 3 } as const;

export const ATTENTION_LIMIT = 3;

export function attentionItems(rows: DisplayRow[], bell: BellRow[]): AttentionItem[] {
  const ranked: { rank: number; at: string; item: AttentionItem }[] = [];

  for (const row of rows) {
    const o = row.order;
    if (!row.isOrder || !o) continue;

    // The OTP is due exactly where the order page shows it (server/routes.ts,
    // GET /api/orders/:orderNo `handoverKind`).
    const handover: 'pickup' | 'dropoff' | null =
      o.pickupRequest === 2
        ? o.status === 'awaiting_dropoff'
          ? 'dropoff'
          : null
        : o.status === 'agent_accepted' || o.status === 'out_for_pickup'
          ? 'pickup'
          : null;
    if (handover) {
      const urgent = o.status === 'out_for_pickup';
      ranked.push({
        rank: urgent ? RANK.otpUrgent : RANK.otp,
        at: row.updatedAt,
        item: {
          kind: 'otp',
          key: `otp-${row.key}`,
          orderNo: row.displayId,
          handover,
          urgent,
          pickupDate: o.pickupDate,
        },
      });
    }

    // Same gate as the order page's Pay button: pay-now, still pending, not
    // cancelled. `partially_paid` is a hub reprice and settles at the hub.
    if (o.paymentMethod === 'pay_now' && o.paymentStatus === 'pending' && o.status !== 'cancelled') {
      ranked.push({
        rank: RANK.pay,
        at: row.updatedAt,
        item: { kind: 'pay', key: `pay-${row.key}`, orderNo: row.displayId, amount: o.amountDue },
      });
    }
  }

  // Unread bell rows that ask something of the customer. Reading one clears it
  // from here, which is the honest way for it to go.
  for (const n of bell) {
    if (n.is_read) continue;
    const d = (n.data && typeof n.data === 'object' ? n.data : {}) as Record<string, unknown>;
    const target = notificationTarget(n);
    const href = hrefFor(target);
    if (!href) continue;
    const declined = d.cancellation === 'rejected';
    const fix = href === '/application/fix';
    if (!declined && !fix) continue;
    ranked.push({
      rank: RANK.notice,
      at: n.created_at,
      item: {
        kind: 'notice',
        key: `notice-${n.id}`,
        notificationId: n.id,
        title: n.title ?? (declined ? 'Cancellation declined' : 'Your application needs a change'),
        body: declined ? 'Your shipment is still going ahead.' : 'Update the details the Bombino team asked for.',
        href,
        tone: declined ? 'info' : 'warning',
      },
    });
  }

  return ranked
    .sort((a, b) => a.rank - b.rank || b.at.localeCompare(a.at))
    .slice(0, ATTENTION_LIMIT)
    .map((r) => r.item);
}
