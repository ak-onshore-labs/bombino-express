import { useMemo, useState, type ComponentType, type ReactElement } from 'react';
import { useLocation } from 'wouter';
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  Check,
  CheckCheck,
  Copy,
  CheckCircle2,
  ChevronRight,
  KeyRound,
  LogIn,
  MapPin,
  Sparkles,
  Trash2,
  Truck,
  UserRound,
} from 'lucide-react';
import { format, isToday, isYesterday, parseISO, isValid, differenceInCalendarDays } from 'date-fns';
import { useAppStore } from '@/lib/store';
import { useGuestProfile } from '@/hooks/useGuestProfile';
import { openBia } from '@/lib/biaStore';
import { navigateInApp } from '@/lib/biaNavigate';
import {
  hrefFor,
  notificationCategory,
  notificationTarget,
  notificationTone,
  noticeFields,
  seedFor,
  type NotificationCategory,
  type NotificationTone,
} from '@/lib/notificationLink';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  useClearNotifications,
  useCustomerOrderDetail,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  type CustomerNotification as ApiNotification,
} from '@/hooks/useCustomerOrders';

type Filter = 'all' | NotificationCategory;

const FILTERS: { id: Filter; label: string; empty: string }[] = [
  { id: 'all', label: 'All', empty: "You'll see updates here when you have shipments." },
  { id: 'shipments', label: 'Shipments', empty: 'Pickup, hub and dispatch updates for your orders show up here.' },
  {
    id: 'otps',
    label: 'OTPs',
    empty: 'When a pickup is confirmed or you book a drop-off, the OTP you read out at handover shows up here.',
  },
  { id: 'account', label: 'Account', empty: 'Changes to your account and sign-in number show up here.' },
  { id: 'tips', label: 'BIA tips', empty: 'Reminders from BIA, your Bombino assistant, show up here.' },
];

const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  shipments: 'Shipment',
  otps: 'OTP',
  account: 'Account',
  tips: 'BIA',
};

const TONE_ICON: Record<NotificationTone, ComponentType<{ className?: string }>> = {
  neutral: UserRound,
  progress: Truck,
  success: CheckCircle2,
  warning: AlertTriangle,
  code: KeyRound,
  tip: Sparkles,
};

const TONE_CHIP: Record<NotificationTone, string> = {
  neutral: 'bg-[#F3F4F6] text-[#2F4468]',
  progress: 'bg-[lab(34.0831_-9.57756_-27.7093)]/8 text-[lab(34.0831_-9.57756_-27.7093)]',
  success: 'bg-emerald-50 text-emerald-700',
  warning: 'bg-amber-50 text-amber-700',
  code: 'bg-[#FDF3E1] text-[#B86E00]',
  tip: 'bg-[#FDF3E1] text-[#F2A123]',
};

/** "3 shipment updates", "Clear OTPs" — the noun for a tab's rows. */
function filterNoun(filter: Filter, count: number): string {
  const one = count === 1;
  switch (filter) {
    case 'shipments':
      return one ? 'shipment update' : 'shipment updates';
    case 'otps':
      return one ? 'OTP' : 'OTPs';
    case 'account':
      return one ? 'account update' : 'account updates';
    case 'tips':
      return one ? 'BIA tip' : 'BIA tips';
    default:
      return one ? 'notification' : 'notifications';
  }
}

function initialFilter(): Filter {
  if (typeof window === 'undefined') return 'all';
  const tab = new URLSearchParams(window.location.search).get('tab');
  return FILTERS.some((f) => f.id === tab) ? (tab as Filter) : 'all';
}

/** Today / Yesterday / This week / Earlier — the headings the list is cut by. */
function dayGroup(iso: string): string {
  const d = parseISO(iso);
  if (!isValid(d)) return 'Earlier';
  if (isToday(d)) return 'Today';
  if (isYesterday(d)) return 'Yesterday';
  if (differenceInCalendarDays(new Date(), d) < 7) return 'This week';
  return 'Earlier';
}

function formatTime(iso: string): string {
  const d = parseISO(iso);
  if (!isValid(d)) return '';
  return isToday(d) || isYesterday(d) ? format(d, 'h:mm a') : format(d, 'MMM d, h:mm a');
}

export default function Notifications() {
  const [, setLocation] = useLocation();
  const { isLoggedIn } = useAppStore();
  // A guest who booked gets their order updates here too, read from the
  // guest_ref their session holds. Only a visitor with neither is asked to
  // sign in.
  const { data: guestProfile, isLoading: guestLoading } = useGuestProfile({
    enabled: !isLoggedIn,
  });
  const hasBell = isLoggedIn || !!guestProfile;

  const { data, isLoading } = useNotifications(hasBell);
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  const clearNotifications = useClearNotifications();
  const [confirmClear, setConfirmClear] = useState(false);
  const [filter, setFilterState] = useState<Filter>(initialFilter);

  const items: ApiNotification[] = data ?? [];
  const loading = (!isLoggedIn && guestLoading) || (hasBell && isLoading);

  // Per-shelf totals and unread counts, one pass.
  const counts = useMemo(() => {
    const c: Record<Filter, { total: number; unread: number }> = {
      all: { total: 0, unread: 0 },
      shipments: { total: 0, unread: 0 },
      otps: { total: 0, unread: 0 },
      account: { total: 0, unread: 0 },
      tips: { total: 0, unread: 0 },
    };
    for (const n of items) {
      const cat = notificationCategory(n);
      const unread = n.is_read !== true ? 1 : 0;
      c.all.total += 1;
      c.all.unread += unread;
      c[cat].total += 1;
      c[cat].unread += unread;
    }
    return c;
  }, [items]);

  // Shipments and OTPs always get a tab — they are what customers come here
  // for. Account and BIA tips only when there is something on them. The one
  // being viewed stays, so a deep link to an empty shelf still lands.
  const visibleFilters = FILTERS.filter(
    (f) => f.id === 'all' || f.id === 'shipments' || f.id === 'otps' || f.id === filter || counts[f.id].total > 0
  );
  const showTabs = true;

  const shown = useMemo(
    () => (filter === 'all' ? items : items.filter((n) => notificationCategory(n) === filter)),
    [items, filter]
  );

  const groups = useMemo(() => {
    const out: { label: string; items: ApiNotification[] }[] = [];
    for (const n of shown) {
      const label = dayGroup(n.created_at);
      const last = out[out.length - 1];
      if (last?.label === label) last.items.push(n);
      else out.push({ label, items: [n] });
    }
    return out;
  }, [shown]);

  const setFilter = (next: Filter) => {
    setFilterState(next);
    // Kept in the URL so back from an order returns to the same shelf.
    try {
      const url = new URL(window.location.href);
      if (next === 'all') url.searchParams.delete('tab');
      else url.searchParams.set('tab', next);
      window.history.replaceState(window.history.state, '', url);
    } catch {
      // A URL that can't be rewritten only costs the remembered tab.
    }
  };

  /**
   * Navigate first, then mark read.
   *
   * The old order waited on the PATCH and navigated only if it succeeded, so a
   * flaky network left a tap doing nothing at all. Marking read is bookkeeping;
   * getting to the shipment is what the customer pressed for. The mutation is
   * optimistic, so the dot clears either way and rolls back if the write fails.
   */
  const handleNotificationClick = (n: ApiNotification) => {
    const link = notificationTarget(n);
    if (!n.is_read) markRead.mutate(n.id);
    const href = hrefFor(link);
    const seed = seedFor(link);
    if (href) {
      navigateInApp(setLocation, href);
    } else if (seed) {
      // Something BIA nudged about: BIA opens on it.
      openBia({ screen: { surface: 'help' }, seed });
    }
  };

  const activeEmpty = FILTERS.find((f) => f.id === filter)?.empty ?? FILTERS[0].empty;
  const canMarkAll = counts.all.unread > 0;

  const markAllButton = canMarkAll ? (
    <button
      type="button"
      onClick={() => markAllRead.mutate()}
      disabled={markAllRead.isPending}
      className="inline-flex items-center gap-1.5 min-h-11 px-3 -mr-3 rounded-xl text-xs font-semibold text-[#2F4468] hover:bg-muted active:scale-95 transition-all disabled:opacity-50"
      data-testid="button-mark-all-read"
    >
      <CheckCheck className="w-4 h-4" aria-hidden />
      Mark all read
    </button>
  ) : null;

  return (
    <div className="min-h-[100dvh] bg-background" data-testid="screen-notifications">
      <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-sm border-b border-[#E2E8F0] shadow-[0_1px_3px_oklch(17%_0.048_248_/_0.06)] safe-top md:hidden">
        <div className="flex items-center h-14 px-4 max-w-md mx-auto">
          <button
            onClick={() => window.history.back()}
            className="p-2 -ml-2 rounded-xl hover:bg-muted active:scale-95 transition-all"
            aria-label="Back"
            data-testid="button-back-notifications"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="ml-2 font-semibold text-sm">Notifications</h1>
          <div className="ml-auto">{markAllButton}</div>
        </div>
        {showTabs && (
          <FilterTabs
            filters={visibleFilters}
            counts={counts}
            active={filter}
            onChange={setFilter}
            className="max-w-md mx-auto px-4 pb-2.5"
          />
        )}
      </header>

      <main className="max-w-4xl mx-auto w-full px-4 md:px-8 py-5 md:py-6">
        {/* Desktop has no header of its own here (AppLayout's top bar carries
            the title), so the tabs and the bulk action sit above the list. */}
        {hasBell && !loading && items.length > 0 && (
          <div className="hidden md:flex items-center gap-4 mb-5">
            {showTabs && (
              <FilterTabs filters={visibleFilters} counts={counts} active={filter} onChange={setFilter} />
            )}
            <div className="ml-auto">{markAllButton}</div>
          </div>
        )}

        {/* Per-tab toolbar: how many are on this tab, and clearing just them. */}
        {hasBell && !loading && shown.length > 0 && (
          <div className="flex items-center justify-between gap-3 mb-3 -mt-1">
            <p className="text-xs text-muted-foreground">
              {shown.length} {filterNoun(filter, shown.length)}
            </p>
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              disabled={clearNotifications.isPending}
              className="inline-flex items-center gap-1.5 min-h-11 px-3 -mr-3 rounded-md text-xs font-semibold text-[#B42318] hover:bg-red-50 active:bg-red-50 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F2A123]"
              data-testid={`button-clear-notifications-${filter}`}
            >
              <Trash2 className="w-4 h-4" aria-hidden />
              {filter === 'all' ? 'Clear all' : `Clear ${filterNoun(filter, 2)}`}
            </button>
          </div>
        )}

        <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
          <AlertDialogContent className="rounded-lg max-w-[calc(100vw-32px)] sm:max-w-md">
            <AlertDialogHeader>
              <AlertDialogTitle>
                {filter === 'all' ? 'Clear all notifications?' : `Clear ${filterNoun(filter, 2)}?`}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {shown.length === 1 ? 'This notification' : `These ${shown.length} notifications`} will be removed
                from your bell. Your orders and shipments are not affected.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="button-clear-cancel">Keep</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => clearNotifications.mutate(shown.map((n) => n.id))}
                className="bg-[#B42318] hover:bg-[#B42318]/90 text-white"
                data-testid="button-clear-confirm"
              >
                Clear
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {loading ? (
          <div className="space-y-3" aria-busy="true" aria-label="Loading notifications">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex gap-3 p-4 rounded-lg border border-[#E2E8F0] bg-white">
                <div className="w-10 h-10 rounded-md bg-muted animate-pulse motion-reduce:animate-none" />
                <div className="flex-1 space-y-2 py-1">
                  <div className="h-3 w-1/2 rounded bg-muted animate-pulse motion-reduce:animate-none" />
                  <div className="h-3 w-5/6 rounded bg-muted animate-pulse motion-reduce:animate-none" />
                </div>
              </div>
            ))}
          </div>
        ) : !hasBell ? (
          <div className="text-center py-12 max-w-sm mx-auto">
            <div className="w-16 h-16 bg-[lab(34.0831_-9.57756_-27.7093)]/8 rounded-full flex items-center justify-center mx-auto mb-4">
              <Bell className="w-8 h-8 text-[lab(34.0831_-9.57756_-27.7093)]" />
            </div>
            <h2 className="font-semibold text-[lab(34.0831_-9.57756_-27.7093)] mb-2">No notifications yet</h2>
            <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
              Login to receive shipment updates and alerts.
            </p>
            <Button
              onClick={() => setLocation('/login')}
              className="bg-[#F2A123] hover:bg-[#F2A123]/90 text-[lab(34.0831_-9.57756_-27.7093)] font-semibold h-11 px-6 rounded-xl shadow-[0_4px_20px_oklch(17%_0.048_248_/_0.10)]"
              data-testid="button-login-notifications"
            >
              <LogIn className="w-4 h-4 mr-2" />
              Login
            </Button>
          </div>
        ) : groups.length === 0 ? (
          <div className="text-center py-12 max-w-sm mx-auto" data-testid={`empty-notifications-${filter}`}>
            <div className="w-16 h-16 bg-[#F3F4F6] rounded-full flex items-center justify-center mx-auto mb-4">
              {filter === 'otps' ? (
                <KeyRound className="w-8 h-8 text-muted-foreground" />
              ) : (
                <Bell className="w-8 h-8 text-muted-foreground" />
              )}
            </div>
            <h2 className="font-semibold text-[lab(34.0831_-9.57756_-27.7093)] mb-2">
              {filter === 'all' ? 'No notifications yet' : `No ${filter === 'otps' ? 'OTPs' : FILTERS.find((f) => f.id === filter)?.label.toLowerCase()} yet`}
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed">{activeEmpty}</p>
          </div>
        ) : (
          <div className="space-y-6" role="tabpanel" aria-label={FILTERS.find((f) => f.id === filter)?.label}>
            {groups.map((group) => (
              <section key={group.label} aria-labelledby={`notif-group-${group.label}`}>
                <h2
                  id={`notif-group-${group.label}`}
                  className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1"
                >
                  {group.label}
                </h2>
                <ul className="space-y-2.5">
                  {group.items.map((notif) => (
                    <li key={notif.id}>
                      <NotificationRow
                        notif={notif}
                        showCategory={filter === 'all'}
                        onClick={() => handleNotificationClick(notif)}
                        onTrack={(awb) => {
                          if (!notif.is_read) markRead.mutate(notif.id);
                          setLocation(`/shipment/${encodeURIComponent(awb)}`);
                        }}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function FilterTabs({
  filters,
  counts,
  active,
  onChange,
  className,
}: {
  filters: typeof FILTERS;
  counts: Record<Filter, { total: number; unread: number }>;
  active: Filter;
  onChange: (f: Filter) => void;
  className?: string;
}): ReactElement {
  return (
    <div
      role="tablist"
      aria-label="Filter notifications"
      className={cn(
        'flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className
      )}
    >
      {filters.map((f) => {
        const selected = f.id === active;
        const unread = counts[f.id].unread;
        return (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(f.id)}
            className={cn(
              'shrink-0 inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full text-xs font-semibold border transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F2A123] focus-visible:ring-offset-1',
              selected
                ? 'bg-[lab(34.0831_-9.57756_-27.7093)] border-[lab(34.0831_-9.57756_-27.7093)] text-white'
                : 'bg-white border-[#E2E8F0] text-[#2F4468] hover:bg-[#F3F4F6]'
            )}
            data-testid={`tab-notifications-${f.id}`}
          >
            {f.label}
            {unread > 0 && (
              <span
                className={cn(
                  'min-w-[18px] h-[18px] px-1 rounded-full text-[10px] leading-[18px] text-center tabular-nums',
                  selected ? 'bg-white/20 text-white' : 'bg-[#F2A123] text-[lab(34.0831_-9.57756_-27.7093)]'
                )}
                aria-label={`${unread} unread`}
              >
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function NotificationRow({
  notif,
  showCategory,
  onClick,
  onTrack,
}: {
  notif: ApiNotification;
  showCategory: boolean;
  onClick: () => void;
  onTrack: (awb: string) => void;
}): ReactElement {
  const unread = notif.is_read !== true;
  const category = notificationCategory(notif);
  const tone = notificationTone(notif);
  const link = notificationTarget(notif);
  const fields = noticeFields(notif);
  const Icon = TONE_ICON[tone];
  const isCode = category === 'otps';
  // A parcel's card always shows both references, so the customer never has
  // to wonder which one they are missing; account and BIA cards show any
  // they happen to carry.
  const isParcel = category === 'shipments' || category === 'otps';
  const hasRefs = !!(fields.orderNo || fields.awb);
  const bothRefs = isParcel && hasRefs;

  const primaryLabel =
    link?.kind === 'code'
      ? 'Open order'
      : link?.kind === 'order'
        ? 'View order'
        : link?.kind === 'shipment'
          ? 'Track shipment'
          : link?.kind === 'nudge'
            ? 'Ask BIA'
            : link?.kind === 'page'
              ? link.label
              : null;
  // Tracking as a second way out, when the primary goes to the order instead.
  const showTrack = !!fields.awb;
  // A row with nowhere to go but tracking: the pill is the only action shown.
  const trackIsPrimary = showTrack && link?.kind === 'shipment';

  const timeStamp = (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums shrink-0 leading-5">
      {unread && <span className="w-2 h-2 bg-[#F2A123] rounded-full" aria-label="Unread" />}
      {formatTime(notif.created_at)}
    </p>
  );

  return (
    <article
      className={cn(
        'relative rounded-lg border bg-white overflow-hidden transition-shadow',
        'has-[[data-primary]:focus-visible]:ring-2 has-[[data-primary]:focus-visible]:ring-[#F2A123]',
        'has-[[data-primary]:active]:bg-[#F8FAFC] has-[[data-primary]:active]:shadow-none',
        unread
          ? isCode
            ? 'border-[#F5D9A8] shadow-[0_2px_12px_oklch(17%_0.048_248_/_0.08)]'
            : 'border-[#E2E8F0] shadow-[0_2px_12px_oklch(17%_0.048_248_/_0.08),_0_1px_3px_oklch(17%_0.048_248_/_0.05)]'
          : 'border-[#E2E8F0] shadow-[0_1px_3px_oklch(17%_0.048_248_/_0.04)] hover:shadow-[0_2px_12px_oklch(17%_0.048_248_/_0.08)]'
      )}
      data-testid={`notification-item-${notif.id}`}
      data-category={category}
    >
      {unread && (
        <span
          className={cn(
            'absolute left-0 top-0 bottom-0 w-1',
            isCode ? 'bg-[#F2A123]' : 'bg-[lab(34.0831_-9.57756_-27.7093)]'
          )}
          aria-hidden
        />
      )}

      {/* Head: what happened. */}
      <div className="flex items-start gap-3 p-4 pb-3">
        <div className={cn('w-10 h-10 rounded-md flex items-center justify-center flex-shrink-0', TONE_CHIP[tone])}>
          <Icon className="w-5 h-5" aria-hidden />
        </div>
        <div className="flex-1 min-w-0">
          {/* In All, a category line sits above the title with the time
              beside it; on a tab the tab already says the category, so the
              title takes the top line beside the time. */}
          {showCategory && (
            <div className="flex items-center justify-between gap-2 h-5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {CATEGORY_LABEL[category]}
              </p>
              {timeStamp}
            </div>
          )}
          <div className="flex items-start justify-between gap-2">
            <p
              className={cn(
                'font-semibold text-[15px] leading-5 min-w-0',
                unread ? 'text-[lab(34.0831_-9.57756_-27.7093)]' : 'text-foreground'
              )}
            >
              {notif.title ?? ''}
            </p>
            {!showCategory && timeStamp}
          </div>
          {fields.message && (
            <p className="text-[13px] text-muted-foreground mt-1 leading-relaxed line-clamp-3">{fields.message}</p>
          )}
          {link?.kind === 'code' && <LiveOtp orderNo={link.orderNo} handover={link.handover} />}
        </div>
      </div>

      {/* References: the numbers a customer quotes on the phone, as fields. */}
      {(hasRefs || fields.destination) && (
        <div className="mx-4 mb-3 rounded-md border border-[#E2E8F0] bg-[#F8FAFC]">
          {hasRefs && (
            <div
              className={cn(
                'grid',
                bothRefs || (fields.orderNo && fields.awb) ? 'grid-cols-2 divide-x divide-[#E2E8F0]' : 'grid-cols-1'
              )}
            >
              {fields.orderNo ? (
                <RefField label="Order ID" value={fields.orderNo} />
              ) : (
                bothRefs && <RefPending label="Order ID" note="Booked direct" />
              )}
              {fields.awb ? (
                <RefField label="AWB number" value={fields.awb} />
              ) : (
                bothRefs && <RefPending label="AWB number" note="Not issued yet" />
              )}
            </div>
          )}
          {fields.destination && (
            <div
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 text-xs text-[#2F4468]',
                hasRefs && 'border-t border-[#E2E8F0]'
              )}
            >
              <MapPin className="w-3.5 h-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="text-muted-foreground">To</span>
              <span className="font-medium truncate">{fields.destination}</span>
            </div>
          )}
        </div>
      )}

      {/* Actions. Track is the one real button, a pill on the left; the
          subtle link on the right stretches over the whole card, so a tap
          anywhere opens it, and the pill and copy fields sit above the stretch. When tracking is
          the only way out, the pill stands alone and the stretch goes there. */}
      {primaryLabel ? (
        <div className="flex items-center gap-3 border-t border-[#EEF2F6] pl-3 pr-2 h-14">
          {showTrack && (
            <button
              type="button"
              onClick={() => onTrack(fields.awb as string)}
              className={cn(
                'relative z-10 inline-flex items-center gap-1.5 h-9 pl-3 pr-4 rounded-full',
                'bg-[lab(34.0831_-9.57756_-27.7093)] text-white text-xs font-semibold',
                'shadow-[0_1px_2px_oklch(17%_0.048_248_/_0.20)] hover:bg-[lab(34.0831_-9.57756_-27.7093)]/90 active:scale-[0.97]',
                'transition-[background-color,transform] duration-150 motion-reduce:transition-none',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F2A123] focus-visible:ring-offset-2',
                // 36px to look at, 44px to hit.
                'before:absolute before:-inset-x-1 before:-inset-y-1 before:content-[""]'
              )}
              aria-label={`Track shipment ${fields.awb}`}
              data-testid="button-notification-track"
            >
              <Truck className="w-4 h-4" aria-hidden />
              Track
            </button>
          )}
          {trackIsPrimary ? (
            // Tap anywhere tracks; the pill says so. Same handler as the row
            // always had for an AWB-only row (`handleNotificationClick`).
            <button
              type="button"
              onClick={onClick}
              data-primary
              className="absolute inset-0 focus-visible:outline-none"
              data-testid="button-notification-open"
            >
              <span className="sr-only">Track shipment {fields.awb}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onClick}
              data-primary
              className={cn(
                'ml-auto inline-flex items-center gap-0.5 h-11 px-2 rounded-md text-xs font-semibold transition-colors focus-visible:outline-none',
                'after:absolute after:inset-0',
                isCode ? 'text-[#B86E00]' : 'text-[#2F4468]'
              )}
              data-testid={link?.kind === 'nudge' ? 'badge-open-in-bia' : 'button-notification-open'}
            >
              {primaryLabel}
              <ChevronRight className="w-4 h-4" aria-hidden />
            </button>
          )}
        </div>
      ) : (
        unread && (
          // Nowhere to go, but still a way to clear the dot.
          <button
            type="button"
            onClick={onClick}
            data-primary
            className="absolute inset-0 focus-visible:outline-none"
            aria-label={`Mark "${notif.title ?? 'notification'}" read`}
          />
        )
      )}
    </article>
  );
}

/** A reference the parcel does not have yet — said, rather than left out. */
function RefPending({ label, note }: { label: string; note: string }): ReactElement {
  return (
    <div className="min-w-0 px-3 py-2 min-h-11">
      <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="mt-0.5 block text-[13px] italic text-muted-foreground truncate">{note}</span>
    </div>
  );
}

/** One reference, copyable with a tap — the whole cell is the target. */
function RefField({ label, value }: { label: string; value: string }): ReactElement {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast({ title: `${label} copied`, description: value });
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: 'Could not copy', description: value });
    }
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="relative z-10 min-w-0 text-left px-3 py-2 min-h-11 hover:bg-white/70 active:bg-white transition-colors first:rounded-l-md last:rounded-r-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#F2A123]"
      aria-label={`Copy ${label} ${value}`}
      data-testid={`copy-${label === 'Order ID' ? 'order-id' : 'awb'}`}
    >
      <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="mt-0.5 flex items-center gap-1.5">
        <span className="font-mono text-[13px] font-semibold text-[lab(34.0831_-9.57756_-27.7093)] truncate tabular-nums">
          {value}
        </span>
        {copied ? (
          <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" aria-hidden />
        ) : (
          <Copy className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-hidden />
        )}
      </span>
    </button>
  );
}

/**
 * The OTP itself, read live from the order — the same read the order page
 * makes (`GET /api/orders/:orderNo`, customer's own codes only).
 *
 * Never from the bell row: a code can be regenerated after a lock and is spent
 * at handover, so a stored copy would go stale. Once the handover is behind the
 * order, `handover` comes back null and the card says so instead of showing a
 * number that opens nothing.
 */
function LiveOtp({ orderNo, handover }: { orderNo: string; handover: 'pickup' | 'dropoff' }): ReactElement {
  const { data, isLoading, isError } = useCustomerOrderDetail(orderNo);
  const label = handover === 'pickup' ? 'Pickup OTP' : 'Drop-off OTP';

  if (isLoading) {
    return (
      <div className="mt-2.5 h-[52px] rounded-md bg-[#F2A123]/10 animate-pulse motion-reduce:animate-none" aria-busy="true" />
    );
  }

  const live = data?.handover;
  if (isError || !live || live.kind !== handover) {
    return (
      <div className="mt-2.5 inline-flex items-center gap-1.5 rounded-md bg-[#F3F4F6] px-2.5 py-1.5" data-testid="otp-used">
        <CheckCircle2 className="w-3.5 h-3.5 text-muted-foreground" aria-hidden />
        <span className="text-[11px] font-medium text-muted-foreground">
          {isError ? 'Open the order to see this OTP' : 'Used — no longer needed'}
        </span>
      </div>
    );
  }

  if (live.locked || !live.code) {
    return (
      <div
        className="mt-2.5 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2"
        data-testid="otp-needs-new"
      >
        <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" aria-hidden />
        <span className="text-[11px] font-medium text-amber-900 leading-snug">
          {live.locked ? 'Locked after wrong attempts. Open the order to get a new OTP.' : 'Open the order to generate your OTP.'}
        </span>
      </div>
    );
  }

  return (
    <div className="mt-2.5 rounded-md border border-[#F5D9A8] bg-white px-3 py-2" data-testid="otp-live">
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#B86E00]">{label}</p>
      <p
        className="font-mono text-2xl font-bold leading-tight tracking-[0.3em] tabular-nums text-[lab(34.0831_-9.57756_-27.7093)]"
        aria-label={`${label} ${live.code.split('').join(' ')}`}
        data-testid="text-otp-live"
      >
        {live.code}
      </p>
    </div>
  );
}
