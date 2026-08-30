import type * as React from 'react';
import { UserRound, ChevronLeft } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import bombinoLogo from '@/assets/bombino-logo.png';
import { DAY_NAMES_SHORT, dayOfWeekForDate, todayInIst } from '@shared/istTime';
import { AgentNav } from './AgentNav';

/**
 * Chrome for every agent screen.
 *
 * Two shells, because the agent surface has two kinds of screen:
 *
 *   AgentShell     — a list screen. White top bar, a title, then a scrolling
 *                    column of cards with room around them.
 *   AgentJobSheet  — one job. The top bar turns navy and carries the order
 *                    number, because on this screen the number is the title.
 *
 * The single biggest correction in v4: **the screen scrolls, and the room goes
 * into air.** Earlier passes tried to fit each screen inside one 844px viewport
 * and everything came out cramped. Content taller than the viewport is correct
 * and expected here; 20px of padding on every side and 20–22px between blocks
 * is not negotiable, and recovering space by shrinking type or padding is
 * exactly what produced the version the agents rejected.
 *
 * The top bar is the agent surface's own, not the shared `TopBar`. It carries
 * an amber `Agent` tag on the left where the customer bar has nothing — the
 * fastest way to tell an agent they are looking at the agent app is to say so
 * in the one colour this surface reserves for their own work.
 *
 * `agent-surface` puts both shells on the plain system sans (see index.css).
 * Poppins and Geist Mono are the customer app's; the agent asked for something
 * generic and gets it.
 */

/**
 * Sign out, then leave.
 *
 * Exported for the profile page, which is where the button lives now — the top
 * bar carries the way *to* it rather than the way out.
 */
export function useLogout(): () => Promise<void> {
  const [, setLocation] = useLocation();
  const { logout } = useAppStore();

  return async (): Promise<void> => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {
      // Ignore network failure — still clear the local session.
    }
    logout();
    setLocation('/login');
  };
}

/** `TUE 18 AUG` — the shift's date, in the slot the `Agent` tag used to hold. */
function todayLine(): string {
  const today = todayInIst();
  const day = DAY_NAMES_SHORT[dayOfWeekForDate(today)];
  const when = new Date(`${today}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
  });
  return `${day} ${when}`.toUpperCase();
}

/**
 * The app-root bar: what day it is, where you are, and the way to your profile.
 *
 * The amber slot on the left used to say `Agent`. It says the date instead: the
 * agent knows which app they opened, and every screen under this bar is about
 * work owed today, so the date is the one fact worth the space. Still amber —
 * it is the shift's own marker, and the tag it replaced was amber.
 */
function AgentTopBar() {
  return (
    <header
      className="sticky top-0 z-40 bg-white border-b border-[#E2E8F0]! safe-top"
      data-testid="agent-topbar"
    >
      {/* Three columns, the outer two equal, so the logo sits on the screen's
          centre line rather than wherever `justify-between` leaves it. The date
          is wider than the profile icon, and with `justify-between` that pushed
          the logo visibly right of centre. */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center h-[58px] px-5 max-w-md mx-auto">
        <span
          className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#F2A123]"
          data-testid="text-today-date"
        >
          {todayLine()}
        </span>

        <Link href="/agent" className="flex items-center justify-center">
          <img
            src={bombinoLogo}
            alt="Bombino Express"
            className="h-9 w-auto object-contain"
            data-testid="img-logo"
          />
        </Link>

        {/* Sign-out moved inside the profile page. Signing out is a once-a-day
            act and it sat one mis-tap from the logo; the profile is the thing
            an agent actually reaches for mid-shift. */}
        <Link
          href="/agent/profile"
          aria-label="Your profile"
          className="w-[22px] h-[22px] grid place-items-center justify-self-end"
          data-testid="link-agent-profile"
        >
          <UserRound className="w-[22px] h-[22px] text-[#64748B]" strokeWidth={1.5} />
        </Link>
      </div>
    </header>
  );
}

export function AgentShell({
  title,
  meta,
  sub,
  gap = 20,
  children,
}: {
  /**
   * Omitted on Home, which has no title at all: the date is in the bar and the
   * first band names itself, so a heading over them said nothing twice.
   */
  title?: string;
  /** Right of the title, on its baseline: `2 free`, `3 jobs`, `Today`, `Saved`. */
  meta?: React.ReactNode;
  /** One plain line under the title row. Only My week has one. */
  sub?: string;
  /** Space between blocks: 22 on Home, 20 on the list screens. */
  gap?: 16 | 20 | 22;
  children: React.ReactNode;
}) {
  return (
    <div
      className="agent-surface min-h-[100dvh] bg-[#F1F3F5] pb-agent-nav"
      data-testid="agent-shell"
    >
      <AgentTopBar />

      <main className="max-w-md mx-auto px-5 pt-5 pb-6">
        <div className="flex flex-col" style={{ gap }}>
          {(title || meta || sub) && (
            <div>
              <div className="flex items-baseline justify-between gap-3">
                {title && (
                  <h1 className="text-[28px] font-bold tracking-[-0.02em] leading-none text-[#1B2A41]">
                    {title}
                  </h1>
                )}
                {typeof meta === 'string' ? (
                  <span className="shrink-0 text-[15px] font-semibold text-[#64748B]">{meta}</span>
                ) : (
                  meta
                )}
              </div>
              {sub && (
                <p className="text-[17px] font-medium leading-[1.5] text-[#475569] mt-3">{sub}</p>
              )}
            </div>
          )}

          {children}
        </div>
      </main>

      <AgentNav />
    </div>
  );
}

/**
 * The job sheet's shell.
 *
 * The bar is navy and carries the order number at the size a screen title would
 * be, with the status word amber on the right. On every other screen the number
 * leads a card; here there is only one job, so it leads the screen — and the
 * back label it replaced told the agent something they already knew.
 *
 * Height is the whole viewport: this screen renders no bottom nav — one job is
 * a place you are in, not a tab you are on — so the action bar sits on the
 * bottom edge of the phone. The sheet scrolls inside itself and the bar stays
 * put. The alternative — a `fixed` bar over a normally scrolling page — needs
 * the page to reserve the bar's height, which changes with how many actions the
 * server sends.
 */
export function AgentJobSheet({
  backHref,
  backLabel,
  orderNo,
  statusWord,
  actionBar,
  children,
}: {
  backHref: string;
  /** Screen-reader only now: the list this job came from. */
  backLabel: string;
  orderNo?: string;
  /** One word — Free, Mine, Going, Done, or how many days late. */
  statusWord?: string;
  actionBar?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className="agent-surface h-[100dvh] flex flex-col bg-white"
      data-testid="agent-job-sheet"
    >
      <header className="flex-none bg-[#1B2A41] safe-top">
        <div className="flex items-center gap-3.5 h-[58px] px-5 max-w-md mx-auto">
          <Link href={backHref} className="-ml-1 p-1" data-testid="link-back">
            <ChevronLeft className="w-[23px] h-[23px] text-white" strokeWidth={1.5} />
            <span className="sr-only">Back to {backLabel}</span>
          </Link>
          {orderNo && (
            <span className="text-[22px] font-bold tracking-[0.02em] text-white">{orderNo}</span>
          )}
          {statusWord && (
            <span
              className="ml-auto text-xs font-bold uppercase tracking-[0.1em] text-[#F2A123] shrink-0"
              data-testid="text-status-word"
            >
              {statusWord}
            </span>
          )}
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar">
        <div className="max-w-md mx-auto">{children}</div>
      </div>

      {actionBar && (
        <div
          className={cn('flex-none bg-white border-t border-[#D8DFE7]!', 'px-5 pt-3.5')}
          style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
          data-testid="agent-action-bar"
        >
          <div className="max-w-md mx-auto flex flex-col gap-2.5">{actionBar}</div>
        </div>
      )}
    </div>
  );
}
