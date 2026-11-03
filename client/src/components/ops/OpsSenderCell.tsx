import type { KeyboardEvent, MouseEvent } from 'react';
import { Link, useLocation } from 'wouter';
import type { OpsBoardOrder } from '@/hooks/useOpsOrders';

const GUEST_CHIP_CLASS =
  'inline-flex items-center rounded-md bg-[#F3F4F6] px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground';

type SenderOrder = Pick<
  OpsBoardOrder,
  'order_no' | 'user_id' | 'customer_name' | 'guest_name'
>;

/**
 * Sender on a board row / card / order detail.
 *
 * Guest is `!user_id` only — a claimed guest still has leftover guest_ref but
 * is treated as a registered account holder (Plan A customer link).
 */
export function OpsSenderCell({
  order,
  context = 'board',
  nested = false,
}: {
  order: SenderOrder;
  context?: 'board' | 'detail';
  /** True when rendered inside another link (mobile cards) so we don't nest <a>. */
  nested?: boolean;
}) {
  if (order.user_id) {
    const href = `/ops/customers/${order.user_id}`;
    const name = order.customer_name?.trim() || 'Customer';
    const className =
      context === 'detail'
        ? 'text-[#F2A123] hover:underline'
        : 'font-semibold text-foreground hover:underline';
    const testId =
      context === 'detail'
        ? 'ops-order-customer-link'
        : `ops-board-customer-${order.order_no}`;

    if (nested) {
      return (
        <NestedCustomerLink href={href} className={className} testId={testId}>
          {name}
        </NestedCustomerLink>
      );
    }

    return (
      <Link
        href={href}
        className={className}
        onClick={(event) => event.stopPropagation()}
        data-testid={testId}
      >
        {name}
      </Link>
    );
  }

  const guestName = order.guest_name?.trim();
  if (guestName) {
    const chipId =
      context === 'detail'
        ? 'ops-order-guest-sender'
        : `ops-board-guest-${order.order_no}`;
    return (
      <span className="inline-flex items-center gap-1.5 min-w-0">
        <span className="truncate">{guestName}</span>
        <span className={GUEST_CHIP_CLASS} data-testid={chipId}>
          Guest
        </span>
      </span>
    );
  }

  return '—';
}

function NestedCustomerLink({
  href,
  className,
  testId,
  children,
}: {
  href: string;
  className: string;
  testId: string;
  children: string;
}) {
  const [, setLocation] = useLocation();

  const go = (event: MouseEvent | KeyboardEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    setLocation(href);
  };

  return (
    <span
      role="link"
      tabIndex={0}
      className={className}
      data-testid={testId}
      onClick={go}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') go(event);
      }}
    >
      {children}
    </span>
  );
}
