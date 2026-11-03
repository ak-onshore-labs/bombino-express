/**
 * The building blocks both profile screens are drawn from.
 *
 * The account profile (/profile) and the guest profile (/guest-profile) used
 * to be laid out separately, so the same kind of thing — a heading, a row of
 * details, the way out — looked different on each. Both now use these: one
 * hero that says who you are, section cards that all open the same way (icon,
 * title, one line of why), rows that put the value first and the action on
 * the right, and the same support and sign-out footer.
 *
 * Presentation only. Each screen keeps its own data and actions.
 */

import type { LucideIcon } from 'lucide-react';
import { BadgeCheck, ChevronRight, LogOut, Phone } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BuildVersion } from '@/components/BuildVersion';
import bombinoLogo from '@/assets/bombino-logo.png';
import whatsAppLogo from '@/assets/WhatsApp.svg.png';

/** Two letters at most. A monogram, not a name badly abbreviated. */
export function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  const letters = parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0];
  return letters.toUpperCase();
}

/** One way we reach this person, drawn under the name. */
export interface HeroLine {
  icon: LucideIcon;
  text: string;
  /** A small green tick after it: something we confirmed (the OTP'd number). */
  verified?: boolean;
}

/** One fact in the strip along the bottom of the hero. */
export interface HeroStat {
  label: string;
  value: string;
  icon?: LucideIcon;
  /** `good` is green (verified), `pending` amber (still to do). */
  tone?: 'plain' | 'good' | 'pending';
}

const STAT_TONE = {
  plain: 'text-foreground',
  good: 'text-green-700',
  pending: 'text-amber-700',
} as const;

/**
 * Who this is.
 *
 * A white card like every other section, so the page reads as one surface:
 * a short navy band for the brand, a round avatar sitting on its edge, the
 * name, then how we reach them. The facts that used to be pills (account
 * kind, since when, verified) are a three-column strip along the bottom —
 * labelled, aligned, and read in one pass instead of three.
 */
export function ProfileHero({
  name,
  lines = [],
  stats = [],
  className,
}: {
  name: string;
  lines?: HeroLine[];
  stats?: HeroStat[];
  className?: string;
}) {
  // Typed all lowercase at booking ("aditya kamarouthu"): shown as a name.
  const shownName =
    name === name.toLowerCase()
      ? name.replace(/(^|\s)(\p{L})/gu, (_match: string, space: string, letter: string) => space + letter.toUpperCase())
      : name;
  const initials = initialsOf(name);
  return (
    <section
      className={cn('overflow-hidden rounded-2xl border border-border bg-white shadow-card', className)}
      aria-label="Your profile"
      data-testid="profile-hero"
    >
      {/* Brand band. Decorative; the avatar overlaps its lower edge. */}
      <div className="h-16 bg-gradient-to-r from-primary to-[#2F4468]" aria-hidden />

      <div className="-mt-9 flex flex-col items-center px-5 pb-4 text-center">
        <div
          className="grid h-[72px] w-[72px] place-items-center rounded-full bg-[#EEF2F7] text-2xl font-bold text-primary ring-4 ring-white shadow-sm"
          aria-hidden
        >
          {initials || '·'}
        </div>

        <h2 className="mt-3 max-w-full truncate text-lg font-bold leading-tight text-foreground">{shownName}</h2>

        {lines.length > 0 && (
          <ul className="mt-1.5 space-y-1">
            {lines.map(({ icon: Icon, text, verified }) => (
              <li key={text} className="flex max-w-full items-center justify-center gap-1.5 text-sm text-muted-foreground">
                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="truncate">{text}</span>
                {verified && (
                  <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-green-600" aria-label="Verified" />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {stats.length > 0 && (
        <dl
          className="grid border-t border-border divide-x divide-border bg-[#F8F9FA]"
          style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }}
        >
          {stats.map(({ label, value, icon: Icon, tone = 'plain' }) => (
            <div key={label} className="min-w-0 px-2 py-3 text-center">
              <dt className="text-[11px] font-medium text-muted-foreground">{label}</dt>
              <dd
                className={cn(
                  'mt-0.5 flex items-center justify-center gap-1 truncate text-sm font-semibold',
                  STAT_TONE[tone],
                )}
              >
                {Icon && <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />}
                <span className="truncate">{value}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

const SECTION_TONE = {
  default: { card: 'border-border', tile: 'bg-[#2F4468]/8 text-secondary' },
  attention: { card: 'border-amber-200', tile: 'bg-amber-50 text-amber-700' },
} as const;

/**
 * A titled card. Every section opens the same way — icon, title, one line of
 * why — so a customer scanning the page reads headings, not layouts.
 */
export function ProfileSection({
  id,
  icon: Icon,
  title,
  description,
  trailing,
  tone = 'default',
  children,
  className,
  bodyClassName,
  testId,
}: {
  id?: string;
  icon: LucideIcon;
  title: string;
  description?: React.ReactNode;
  /** Top-right: a badge or a small action. */
  trailing?: React.ReactNode;
  /** `attention` for something the customer still has to do. */
  tone?: keyof typeof SECTION_TONE;
  children?: React.ReactNode;
  className?: string;
  /** Rows want no padding (they bring their own); forms want some. */
  bodyClassName?: string;
  testId?: string;
}) {
  const headingId = id ? `${id}-heading` : undefined;
  const t = SECTION_TONE[tone];
  return (
    <section
      id={id}
      className={cn('scroll-mt-24 overflow-hidden rounded-2xl border bg-white shadow-card', t.card, className)}
      aria-labelledby={headingId}
      data-testid={testId}
    >
      <div className="flex items-start gap-3 p-4">
        <div className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl', t.tile)} aria-hidden>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 id={headingId} className="text-sm font-semibold text-foreground">
            {title}
          </h3>
          {description && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>}
        </div>
        {trailing && <div className="shrink-0">{trailing}</div>}
      </div>
      {children && <div className={bodyClassName}>{children}</div>}
    </section>
  );
}

/** A small action on the right of a row, at a size a thumb can hit. */
export function RowAction({
  children,
  onClick,
  destructive = false,
  testId,
}: {
  children: React.ReactNode;
  onClick: () => void;
  destructive?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-9 min-w-[44px] items-center justify-center rounded-lg border px-3 text-xs font-semibold transition-colors',
        destructive
          ? 'border-red-200 text-red-600 hover:bg-red-50'
          : 'border-border text-secondary hover:bg-muted',
      )}
      data-testid={testId}
    >
      {children}
    </button>
  );
}

/** One detail: what it is, its value, a note under it, and what you can do with it. */
export function ProfileRow({
  id,
  icon: Icon,
  label,
  value,
  note,
  actions,
  children,
}: {
  id?: string;
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  note?: React.ReactNode;
  actions?: React.ReactNode;
  /** Extra content under the row (an inline warning with its own action). */
  children?: React.ReactNode;
}) {
  return (
    <div id={id} className="scroll-mt-24 px-4 py-3.5">
      <div className="flex items-center gap-3">
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
          <p className="truncate text-sm font-medium text-foreground">{value}</p>
          {note && <p className="mt-0.5 text-[11px] text-muted-foreground">{note}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
      </div>
      {children && <div className="mt-2.5 pl-7">{children}</div>}
    </div>
  );
}

/** Rows inside a section, split by hairlines. */
export function ProfileRows({ children }: { children: React.ReactNode }) {
  return <div className="divide-y divide-[#E2E8F0] border-t border-[#E2E8F0]">{children}</div>;
}

/** WhatsApp and phone, the same on both screens. */
export function ProfileSupportSection({
  waHref,
  telHref,
  officeLabel,
}: {
  waHref: string;
  telHref: string;
  officeLabel: string;
}) {
  const row =
    'flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-[#F8F9FA] active:bg-[#F3F4F6]';
  return (
    <ProfileSection icon={Phone} title="Help & support" description="Talk to the Bombino team." testId="profile-support">
      <ProfileRows>
        <a href={waHref} target="_blank" rel="noopener noreferrer" className={row} data-testid="link-profile-whatsapp">
          <img src={whatsAppLogo} alt="" className="h-4 w-4 shrink-0 object-contain" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">WhatsApp</p>
            <p className="text-xs text-muted-foreground">Chat with us, usually the quickest</p>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        </a>
        <a href={telHref} className={row} data-testid="link-profile-call">
          <Phone className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">Call us</p>
            <p className="text-xs text-muted-foreground">{officeLabel}</p>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        </a>
      </ProfileRows>
    </ProfileSection>
  );
}

/**
 * The way out, then the logo and build.
 *
 * Auto width and centred: the support orb floats bottom-right on every
 * customer screen, and a full-width last button ran under it.
 */
export function ProfileFooter({
  signOutLabel,
  onSignOut,
  testId,
}: {
  signOutLabel: string;
  onSignOut: () => void;
  testId?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-5 pt-2 pb-12">
      <button
        type="button"
        onClick={onSignOut}
        className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-6 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50"
        data-testid={testId}
      >
        <LogOut className="h-4 w-4" aria-hidden />
        {signOutLabel}
      </button>
      <div className="text-center">
        <img src={bombinoLogo} alt="Bombino" className="mx-auto mb-1 h-5 w-auto opacity-30" />
        <BuildVersion />
      </div>
    </div>
  );
}
