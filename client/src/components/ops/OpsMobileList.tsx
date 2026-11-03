import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The phone layout for anything the ops console shows as a table on a larger
 * screen. Tables are hidden below `md`; this list takes their place.
 *
 * One item per row of the table, with nothing dropped: the title line carries
 * the row's name and its key figure, and every other column becomes a labelled
 * line underneath (`OpsMobileField`). Tapping the item does what clicking the
 * row does.
 */
export function OpsMobileList({
  children,
  className,
  testId,
}: {
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <ul
      className={cn('md:hidden ops-rise rounded-md border border-border bg-white divide-y divide-border', className)}
      data-testid={testId}
    >
      {children}
    </ul>
  );
}

export function OpsMobileItem({
  href,
  title,
  aside,
  children,
  testId,
}: {
  /** Where tapping the item goes. Omit for an item that only shows facts. */
  href?: string;
  title: ReactNode;
  /** Right of the title: an amount, a count, a status. */
  aside?: ReactNode;
  /** `OpsMobileField`s and anything else that belongs under the title. */
  children?: ReactNode;
  testId?: string;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 font-semibold text-foreground break-words">{title}</div>
        <div className="flex shrink-0 items-center gap-1.5">
          {aside}
          {href && <ChevronRight className="w-4 h-4 text-muted-foreground" aria-hidden />}
        </div>
      </div>
      {children && <dl className="mt-1.5 space-y-1">{children}</dl>}
    </>
  );

  return (
    <li data-testid={testId}>
      {href ? (
        <Link href={href} className="ops-press block px-4 py-3 active:bg-[#F3F4F6]">
          {body}
        </Link>
      ) : (
        <div className="px-4 py-3">{body}</div>
      )}
    </li>
  );
}

/** One column of the desktop table, as a labelled line. */
export function OpsMobileField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2 text-xs leading-snug">
      <dt className="w-24 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-foreground break-words">{children}</dd>
    </div>
  );
}
