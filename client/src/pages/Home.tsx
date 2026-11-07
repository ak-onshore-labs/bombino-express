import { useState } from 'react';
import { useLocation, Link } from 'wouter';
import { openBia } from '@/lib/biaStore';
import { Search, ArrowRight, BadgeDollarSign, Send, Phone, Sparkles } from 'lucide-react';
import { Header } from '@/components/Header';
import { BottomNav } from '@/components/BottomNav';
import { SideMenu } from '@/components/SideMenu';
import { useAppStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useIsMobile } from '@/hooks/use-mobile';
import whatsAppLogo from '@/assets/WhatsApp.svg.png';
import { useGuestProfile } from '@/hooks/useGuestProfile';
import { useSupportContacts } from '@/hooks/useSupportContacts';
import { ApplicationStatusCard } from '@/components/ApplicationStatusCard';
import { WhatsappAltCard } from '@/components/WhatsappAltCard';
import HomeDesktop from '@/pages/HomeDesktop';
import { ParcelsQuickAccess } from '@/components/ParcelsQuickAccess';
import { RewardsTeaser } from '@/components/rewards/RewardsTeaser';

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
  const { waHref, telHref } = useSupportContacts();
  // Home is where someone looks for "where is my parcel", so a guest's orders
  // belong here as well as on /orders, rather than only behind the profile link.
  const { data: guestProfile } = useGuestProfile({ enabled: !isLoggedIn });

  const handleTrack = () => {
    if (trackingNumber.trim()) {
      setLocation(`/shipment/${trackingNumber.trim()}`);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-background pb-nav" data-testid="screen-home">
      <Header onMenuClick={() => setMenuOpen(true)} />
      <SideMenu isOpen={menuOpen} onClose={() => setMenuOpen(false)} />

      <main className="px-4 pt-5 pb-24 max-w-md mx-auto space-y-7 md:max-w-none md:px-0 md:py-0">
        {isLoggedIn && (
          <div className="mb-6">
            <p className="text-muted-foreground text-sm">
              Welcome back, <span className="font-semibold text-foreground">{user?.fullName?.split(' ')[0] || user?.email}</span>
            </p>
          </div>
        )}

        {/* Account review: where their account stands, above everything else
            that is theirs — it is the reason they are still a guest. */}
        {!isLoggedIn && guestProfile?.application && (
          <ApplicationStatusCard application={guestProfile.application} phone={guestProfile.phone} compact />
        )}

        {/* A customer from abroad whose number has no WhatsApp: ask for an
            Indian one, or their parcel updates reach nobody. */}
        {(isLoggedIn || guestProfile) && <WhatsappAltCard onlyWhenNeeded />}

        {/* ZONE 1: one container for everything to do with a parcel — the
            track box, the booking shortcuts and My parcels (Sending |
            Receiving), kept close together. The container draws nothing; each
            keeps its own design. */}
        <section
          className="space-y-3"
          data-testid="zone-parcel-group"
        >
          {/* Hero - Track Shipment (Primary Action) */}
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

          {/* Action Strip - Core Actions */}
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

          {/* My parcels — Sending | Receiving with the newest few of each.
              Replaces the account's "My Shipments" list and a guest's
              bookings list. Absent for a visitor we do not recognise. */}
          <ParcelsQuickAccess />
        </section>

        {/* Points and the year's milestone. Renders nothing for guests. */}
        <RewardsTeaser />

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
            {/* Support pills, with a little more room between them. */}
            <div
              className="flex gap-4"
              data-testid="zone-support"
            >
              <a
                href={waHref}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-2 h-11 rounded-xl bg-white border border-border text-green-700 text-sm font-medium shadow-card hover:border-green-200 hover:shadow-card-hover active:scale-[0.98] transition-all"
                data-testid="button-whatsapp-home"
              >
                <img src={whatsAppLogo} alt="WhatsApp" className="w-4 h-4 object-contain" />
                WhatsApp
              </a>
              <a
                href={telHref}
                className="flex-1 flex items-center justify-center gap-2 h-11 rounded-xl bg-white border border-border text-foreground text-sm font-medium shadow-card hover:border-primary/20 hover:shadow-card-hover active:scale-[0.98] transition-all"
                data-testid="button-call-home"
              >
                <Phone className="w-4 h-4 text-muted-foreground" />
                Call Us
              </a>
              <button
                type="button"
                onClick={() => openBia({ screen: { surface: "home" } })}
                className="flex-1 flex items-center justify-center gap-2 h-11 rounded-xl bg-white border border-border text-foreground text-sm font-medium shadow-card hover:border-primary/20 hover:shadow-card-hover active:scale-[0.98] transition-all"
                data-testid="button-bia-home"
              >
                <Sparkles className="w-4 h-4 text-[#F2A123]" />
                Ask BIA
              </button>
            </div>
          </>
        )}


      </main>

      <BottomNav />
    </div>
  );
}
