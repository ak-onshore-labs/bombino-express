import { useState } from 'react';
import { useLocation, Link } from 'wouter';
import { Search, ArrowRight, BadgeDollarSign, Send, Phone, Bell, ChevronRight } from 'lucide-react';
import { Header } from '@/components/Header';
import { BottomNav } from '@/components/BottomNav';
import { SideMenu } from '@/components/SideMenu';
import { StatusBadge } from '@/components/StatusBadge';
import { useAppStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useIsMobile } from '@/hooks/use-mobile';
import whatsAppLogo from '@/assets/WhatsApp.svg.png';
import { type DisplayRow } from '@/lib/shipmentRows';
import { useNotifications, useOrderHistory } from '@/hooks/useCustomerOrders';
import { useGuestProfile } from '@/hooks/useGuestProfile';
import { GuestOrders } from '@/components/GuestOrders';
import HomeDesktop from '@/pages/HomeDesktop';

function HomeShipmentsSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-[rgba(198,40,40,0.08)] p-4 animate-pulse">
      <div className="flex justify-between items-start">
        <div className="space-y-2">
          <div className="h-4 w-32 bg-gray-100 rounded-md" />
          <div className="h-3 w-20 bg-gray-100 rounded-md" />
        </div>
        <div className="h-5 w-14 bg-gray-100 rounded-full" />
      </div>
    </div>
  );
}

function HomeNotificationsSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-[rgba(198,40,40,0.08)] p-4 animate-pulse">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 bg-gray-100 rounded-full shrink-0" />
        <div className="space-y-2 flex-1">
          <div className="h-4 w-36 bg-gray-100 rounded-md" />
          <div className="h-3 w-48 bg-gray-100 rounded-md" />
        </div>
      </div>
    </div>
  );
}

function WhyBombinoSection() {
  return (
    <section className="pt-2 text-center" data-testid="zone-trust">
      <div className="px-1 pb-8">
        <h2 className="text-lg font-semibold tracking-tight text-foreground/90 mb-1">Why <span className="text-primary">Bombino</span>?</h2>
        <p className="text-xs text-muted-foreground/90 tracking-wide">Trusted worldwide. Reliable, efficient, premium logistics.</p>
      </div>

      <div className="flex flex-wrap justify-center gap-x-8 gap-y-8 sm:gap-x-10">
        <div className="flex flex-col items-center min-w-0 flex-1 basis-24">
          <p className="text-[1.625rem] font-bold tabular-nums tracking-tight leading-none text-foreground">
            <span className="metric-number-shimmer">30+</span>
          </p>
          <p className="text-sm font-medium text-gray-500 tracking-tight mt-0.5 min-h-[2.25rem] flex items-center justify-center">Years</p>
          <p className="text-xs text-muted-foreground mt-3 tracking-wide max-w-[11rem]">Of global logistics excellence</p>
        </div>

        <div className="flex flex-col items-center min-w-0 flex-1 basis-24">
          <p className="text-[1.625rem] font-bold tabular-nums tracking-tight leading-none text-foreground">
            <span className="metric-number-shimmer">140+</span>
          </p>
          <p className="text-sm font-medium text-gray-500 tracking-tight mt-0.5 min-h-[2.25rem] flex items-center justify-center">Kilograms</p>
          <p className="text-xs text-muted-foreground mt-3 tracking-wide max-w-[11rem]">Shipped around the world per hour</p>
        </div>

        <div className="flex flex-col items-center min-w-0 flex-1 basis-24">
          <p className="text-[1.625rem] font-bold tabular-nums tracking-tight leading-none text-foreground">
            <span className="metric-number-shimmer">250+</span>
          </p>
          <p className="text-sm font-medium text-gray-500 tracking-tight mt-0.5 min-h-[2.25rem] flex items-center justify-center">Happy Clients</p>
          <p className="text-xs text-muted-foreground mt-3 tracking-wide max-w-[11rem]">Sending and receiving shipments worldwide</p>
        </div>
      </div>
    </section>
  );
}


export default function Home() {
  const isMobile = useIsMobile();

  // ─── DESKTOP: delegate to the new desktop view (mobile path below is untouched) ───
  if (!isMobile) {
    return <HomeDesktop />;
  }

  // ─── MOBILE (unchanged from original) ──────────────────────────────────────────
  return <HomeMobile />;
}

function HomeMobile() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [trackingNumber, setTrackingNumber] = useState('');
  const [, setLocation] = useLocation();
  const { isLoggedIn, user } = useAppStore();
  // A guest's bookings live nowhere they can reach — /orders is an account
  // screen. Home is where someone looks for "where is my parcel", so the
  // orders they placed belong here rather than only behind the profile link.
  const { data: guestProfile } = useGuestProfile({ enabled: !isLoggedIn });

  // Both poll while the tab is in front — home is the screen a customer leaves
  // open, and it was the worst offender for showing yesterday's state.
  const {
    data: historyData,
    isLoading: historyLoading,
    isError: shipmentsError,
  } = useOrderHistory(isLoggedIn);
  const { data: notificationsData, isError: notificationsError } =
    useNotifications(isLoggedIn);

  const shipmentRows: DisplayRow[] = historyData ?? [];
  const apiNotifications = notificationsData ?? [];
  const shipmentsLoading = isLoggedIn && historyLoading;

  const userShipments = shipmentRows.slice(0, 2);
  const userNotifications = apiNotifications.slice(0, 3);

  const handleTrack = () => {
    if (trackingNumber.trim()) {
      setLocation(`/shipment/${trackingNumber.trim()}`);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-background pb-nav" data-testid="screen-home">
      <Header onMenuClick={() => setMenuOpen(true)} />
      <SideMenu isOpen={menuOpen} onClose={() => setMenuOpen(false)} />

      <main className="px-4 py-5 max-w-md mx-auto space-y-7 md:max-w-none md:px-0 md:py-0">
        {isLoggedIn && (
          <div className="mb-6">
            <p className="text-muted-foreground text-sm">
              Welcome back, <span className="font-semibold text-foreground">{user?.fullName?.split(' ')[0] || user?.email}</span>
            </p>
          </div>
        )}

        {/* ZONE 1: Hero - Track Shipment (Primary Action) */}
        <div 
          className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary/8 via-primary/4 to-transparent border border-primary/10 p-5 shadow-[0_8px_32px_rgba(198,40,40,0.10)] md:py-8 md:px-8"
          data-testid="zone-hero"
        >
          <div className="relative z-10">
            <h1 className="text-lg font-semibold text-foreground mb-1 md:text-2xl md:font-bold md:mb-2">Track Any Order</h1>
            <p className="text-sm text-muted-foreground mb-4">Enter AWB number to get real-time status</p>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={trackingNumber}
                  onChange={(e) => setTrackingNumber(e.target.value)}
                  placeholder="e.g. BMB123456789"
                  className="h-12 pl-10 text-sm bg-white border-border rounded-xl shadow-sm md:h-14 md:text-base md:pl-12"
                  onKeyDown={(e) => e.key === 'Enter' && handleTrack()}
                  data-testid="input-tracking"
                />
              </div>
              <Button
                onClick={handleTrack}
                className="h-12 px-5 bg-primary hover:bg-primary/90 rounded-xl shadow-lg shadow-primary/25 active:scale-[0.97] transition-all font-semibold md:h-14 md:px-8 md:text-base"
                data-testid="button-track"
              >
                Track
                <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        </div>

        {/* ZONE 2: Action Strip - Core Actions */}
        <div className="flex gap-3" data-testid="zone-actions">
          <Link
            href="/rates"
            className="flex-1 flex items-center gap-3 p-4 card-elevated active:scale-[0.98] transition-transform md:py-6 md:px-6 md:gap-4 md:rounded-2xl"
            data-testid="button-get-rates"
          >
            <div className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center flex-shrink-0 md:w-14 md:h-14 md:rounded-2xl">
              <BadgeDollarSign className="w-5 h-5 text-amber-600 md:w-7 md:h-7" />
            </div>
            <div>
              <p className="font-medium text-sm text-foreground md:text-base md:font-semibold">Get Rates</p>
              <p className="text-[11px] text-muted-foreground md:text-sm md:mt-1">Check costs</p>
            </div>
          </Link>

          <Link
            href="/create"
            className="flex-1 flex items-center gap-3 p-4 card-elevated active:scale-[0.98] transition-transform md:py-6 md:px-6 md:gap-4 md:rounded-2xl"
            data-testid="button-ship"
          >
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 md:w-14 md:h-14 md:rounded-2xl">
              <Send className="w-5 h-5 text-primary md:w-7 md:h-7" />
            </div>
            <div>
              <p className="font-medium text-sm text-foreground md:text-base md:font-semibold">Ship Now</p>
              <p className="text-[11px] text-muted-foreground md:text-sm md:mt-1">Create shipment</p>
            </div>
          </Link>
        </div>

        {/* ZONE 2.5: A guest's own bookings.
            Above the sign-in prompt deliberately: what they already have with
            us outranks an invitation to open an account. Capped at three —
            Home is a starting point, and the full list is one tap away. */}
        {!isLoggedIn && guestProfile && guestProfile.orders.length > 0 && (
          <GuestOrders orders={guestProfile.orders} limit={3} showViewAll />
        )}

        {/* ZONE 3: Auth (visitors we do not recognise).
            Was a bare row: a sentence wrapping to two lines beside two small
            buttons of near-equal weight, with a red-tinted shadow left over
            from an older palette sitting under a navy button. It read as
            something dropped between two cards rather than part of the page.

            Now one line, one action, and the second offered as text. Hidden
            entirely from a guest we recognise — their orders are already above
            this and the side menu holds the way in, so telling them to sign in
            to manage shipments they can see is noise. */}
        {!isLoggedIn && !guestProfile && (
          <div
            className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
            data-testid="zone-auth"
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">
                Keep your shipments in one place
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                Sign in to track every parcel and reuse your saved details.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-4">
              <Link href="/login">
                <Button
                  className="h-10 rounded-xl bg-primary px-5 text-sm font-semibold hover:bg-primary/90"
                  data-testid="button-login"
                >
                  Sign in
                </Button>
              </Link>
              <Link
                href="/signup"
                className="text-sm font-semibold text-[#2F4468] underline underline-offset-4"
                data-testid="button-signup"
              >
                Create account
              </Link>
            </div>
          </div>
        )}

        {/* ZONE 4: Support + Trust (Guest Only) */}
        {!isLoggedIn && (
          <>
            {/* Support Pills - refined */}
            <div className="flex gap-3" data-testid="zone-support">
              <a
                href="https://api.whatsapp.com/send?phone=917045999553"
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-2 h-11 rounded-xl bg-white border border-border text-green-700 text-sm font-medium shadow-[0_2px_8px_rgba(0,0,0,0.04)] hover:border-green-200 hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] active:scale-[0.98] transition-all"
                data-testid="button-whatsapp-home"
              >
                <img src={whatsAppLogo} alt="WhatsApp" className="w-4 h-4 object-contain" />
                WhatsApp
              </a>
              <a
                href="tel:+912266400000"
                className="flex-1 flex items-center justify-center gap-2 h-11 rounded-xl bg-white border border-border text-foreground text-sm font-medium shadow-[0_2px_8px_rgba(0,0,0,0.04)] hover:border-primary/20 hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] active:scale-[0.98] transition-all"
                data-testid="button-call-home"
              >
                <Phone className="w-4 h-4 text-muted-foreground" />
                Call Us
              </a>
            </div>

            <WhyBombinoSection />
          </>
        )}

        {isLoggedIn && (
          <div className="space-y-7 md:space-y-0 md:grid md:grid-cols-[1fr_320px] md:gap-8 md:items-start">
            <div className="space-y-7">
              {!shipmentsError && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-medium text-foreground md:text-base md:font-semibold">My Shipments</h2>
                    <Link href="/orders" className="text-xs text-[#FBAD1F] font-medium flex items-center gap-0.5 hover:underline">
                      View all <ChevronRight className="w-3 h-3" />
                    </Link>
                  </div>

                  <div className="hidden md:grid md:grid-cols-[2fr_1fr_auto_auto] md:gap-4 md:px-4 md:py-2 md:text-xs md:font-medium md:text-muted-foreground md:border-b md:border-border">
                    <span>AWB Number</span>
                    <span>Destination</span>
                    <span className="text-right">Amount</span>
                    <span>Status</span>
                  </div>

                  <div className="space-y-2 md:space-y-0">
                    {shipmentsLoading && (
                      <>
                        <HomeShipmentsSkeleton />
                        <HomeShipmentsSkeleton />
                      </>
                    )}
                    {!shipmentsLoading &&
                      userShipments.length > 0 &&
                      userShipments.map((row) => {
                        const dest = [row.city, row.country].filter(Boolean).join(', ') || '—';
                        const rowClassName =
                          'block card-accent hover:border-primary/25 active:scale-[0.99] transition-all md:grid md:grid-cols-[2fr_1fr_auto_auto] md:gap-4 md:items-center md:rounded-none md:border-0 md:border-b md:border-border md:shadow-none md:px-4 md:py-3';
                        const content = (
                          <>
                            <div className="flex items-center justify-between mb-1 md:mb-0">
                              <span className="text-sm font-semibold tabular-nums tracking-[0.02em] text-foreground">
                                {row.isOrder && (
                                  <span className="mr-1.5 text-[9px] font-bold uppercase tracking-[0.08em] text-muted-foreground bg-muted px-1.5 py-0.5 rounded align-middle">
                                    Order
                                  </span>
                                )}
                                {row.displayId}
                              </span>
                              <StatusBadge className="md:hidden" status={row.statusLabel} tone={row.statusTone} />
                            </div>
                            <div className="flex items-center justify-between text-xs text-muted-foreground md:contents">
                              <span className="md:text-sm">{dest}</span>
                              <span className="md:text-sm md:text-right">{row.amountStr ?? '—'}</span>
                            </div>
                            <StatusBadge
                              className="hidden md:flex md:shrink-0"
                              status={row.statusLabel}
                              tone={row.statusTone}
                            />
                          </>
                        );
                        return (
                          <Link
                            key={row.key}
                            href={`${row.isOrder ? '/order' : '/shipment'}/${encodeURIComponent(row.displayId)}`}
                            className={rowClassName}
                            data-testid={`shipment-card-${row.displayId}`}
                          >
                            {content}
                          </Link>
                        );
                      })}
                    {!shipmentsLoading && shipmentRows.length === 0 && (
                      <div className="card-elevated flex items-center justify-center px-4 py-8 text-center text-sm text-muted-foreground">
                        No shipments yet
                      </div>
                    )}
                  </div>
                </div>
              )}
              <div className="hidden md:block">
                <WhyBombinoSection />
              </div>
            </div>

            <div>
              {!notificationsError && (
                <div className="md:sticky md:top-4">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-medium text-foreground md:text-base md:font-semibold">Recent Updates</h2>
                    <Link href="/notifications" className="text-xs text-[#FBAD1F] font-medium flex items-center gap-0.5 hover:underline">
                      View all <ChevronRight className="w-3 h-3" />
                    </Link>
                  </div>
                  <div className="space-y-2">
                    {shipmentsLoading && (
                      <>
                        <HomeNotificationsSkeleton />
                        <HomeNotificationsSkeleton />
                      </>
                    )}
                    {!shipmentsLoading &&
                      userNotifications.length > 0 &&
                      userNotifications.map((notif) => (
                        <div
                          key={notif.id}
                          className="flex items-start gap-3 card-accent"
                          data-testid={`notification-${notif.id}`}
                        >
                          <div className="rounded-full bg-primary/8 p-2 flex items-center justify-center flex-shrink-0">
                            <Bell className="w-4 h-4 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm text-foreground">{notif.title ?? ''}</p>
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{notif.body ?? ''}</p>
                          </div>
                        </div>
                      ))}
                    {!shipmentsLoading && apiNotifications.length === 0 && (
                      <div className="card-elevated flex items-center justify-center px-4 py-8 text-center text-sm text-muted-foreground">
                        No recent updates
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="md:hidden">
          {isLoggedIn && <WhyBombinoSection />}
        </div>
      </main>

      <BottomNav />
    </div>
  );
}
