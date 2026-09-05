import { X, User, LogOut, LogIn, Bot, Phone, ShieldCheck } from 'lucide-react';
import { Link } from 'wouter';
import { useAppStore } from '@/lib/store';
import { useGuestProfile } from '@/hooks/useGuestProfile';
import { formatGuestPhone } from '@/lib/shadowProfile';
import { apiRequest } from '@/lib/queryClient';
import bombinoLogo from '@/assets/bombino-logo.png';
import whatsAppLogo from '@/assets/WhatsApp.svg.png';

interface SideMenuProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SideMenu({ isOpen, onClose }: SideMenuProps) {
  const { isLoggedIn, user, logout } = useAppStore();
  /**
   * A guest is not a stranger.
   *
   * Someone who verified a number and booked has a profile, an identity
   * document and orders filed against them — and this menu used to offer them
   * nothing but "Sign In", which is how their details went missing the moment
   * they left the confirmation screen. The banner is not a substitute: it
   * hides itself once the profile is complete, which is exactly when someone
   * is most likely to come looking for what they filled in.
   */
  const { data: guestProfile } = useGuestProfile({ enabled: !isLoggedIn });
  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 animate-fade-in"
        onClick={onClose}
        data-testid="overlay-menu"
      />
      <div className="fixed inset-y-0 left-0 w-80 max-w-[85vw] bg-white z-50 shadow-2xl animate-slide-in-left safe-top safe-bottom">
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-between p-4 border-b border-border">
            <div className="flex items-center gap-3">
              <img src={bombinoLogo} alt="Bombino" className="h-9 w-auto" />
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-xl hover:bg-muted active:scale-95 transition-all"
              data-testid="button-close-menu"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-4 bg-gradient-to-br from-primary/5 to-transparent">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center">
                <User className="w-6 h-6 text-primary" />
              </div>
              <div>
                <p className="font-semibold text-foreground">
                  {isLoggedIn
                    ? user?.fullName || user?.email
                    : guestProfile?.full_name?.trim() || 'Guest'}
                </p>
                {/* One size whoever is looking: this line holds the account
                    email and the guest's number, and scaling only one branch
                    made the menu header change size with the session. */}
                <p className="text-sm text-muted-foreground">
                  {isLoggedIn ? (
                    user?.email
                  ) : guestProfile ? (
                    // The tick says "verified" without spending a word on it.
                    // Its meaning is not lost to a screen reader: the label is
                    // on the icon, which is what the word used to be.
                    <span className="flex items-center gap-1">
                      <ShieldCheck
                        className="h-4 w-4 shrink-0 text-green-600"
                        aria-label="Verified"
                      />
                      {formatGuestPhone(guestProfile.phone)}
                    </span>
                  ) : (
                    'Sign in to continue'
                  )}
                </p>
              </div>
            </div>
          </div>

          <nav className="flex-1 p-4 space-y-1">
            {isLoggedIn ? (
              <>
                <Link
                  href="/profile"
                  onClick={onClose}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-muted active:scale-[0.98] transition-all"
                  data-testid="link-profile"
                >
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center">
                    <User className="w-5 h-5 text-primary" />
                  </div>
                  <span className="font-medium">My Profile</span>
                  {/* The menu is where someone goes looking for their account,
                      so the outstanding document is marked here too — quiet,
                      and pointing at the screen that clears it. */}
                </Link>
                <button
                  onClick={() => {
                    apiRequest('POST', '/api/auth/logout').catch(() => {});
                    logout();
                    onClose();
                  }}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-muted active:scale-[0.98] transition-all w-full text-left"
                  data-testid="button-logout"
                >
                  <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
                    <LogOut className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <span className="font-medium">Sign Out</span>
                </button>
              </>
            ) : (
              <>
                {/* The way back to a guest's own details. Same position and
                    same wording as the account entry above it, because it is
                    the same errand. */}
                {guestProfile && (
                  <Link
                    href="/guest-profile"
                    onClick={onClose}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-muted active:scale-[0.98] transition-all"
                    data-testid="link-guest-profile"
                  >
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center">
                      <User className="w-5 h-5 text-primary" />
                    </div>
                    <span className="font-medium">My Profile</span>
                  </Link>
                )}
                <Link
                  href="/login"
                  onClick={onClose}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-muted active:scale-[0.98] transition-all"
                  data-testid="link-login"
                >
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center">
                    <LogIn className="w-5 h-5 text-primary" />
                  </div>
                  <span className="font-medium">Sign In</span>
                </Link>
              </>
            )}

            <div className="border-t border-border my-4" />

            <a
              href="https://api.whatsapp.com/send?phone=917045999553"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-muted active:scale-[0.98] transition-all"
              data-testid="link-whatsapp"
            >
              <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center">
                <img src={whatsAppLogo} alt="WhatsApp" className="w-5 h-5 object-contain" />
              </div>
              <span className="font-medium">WhatsApp Support</span>
            </a>

            <a
              href="tel:+912266400000"
              className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-muted active:scale-[0.98] transition-all"
              data-testid="link-call"
            >
              <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
                <Phone className="w-5 h-5 text-blue-600" />
              </div>
              <span className="font-medium">Call Support</span>
            </a>

            <Link
              href="/help"
              onClick={onClose}
              className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-muted active:scale-[0.98] transition-all"
              data-testid="link-help"
            >
              <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
                <Bot className="w-5 h-5 text-muted-foreground" />
              </div>
              <span className="font-medium">Ask BIA</span>
            </Link>
          </nav>

          <div className="p-4 border-t border-border">
            <p className="text-xs text-muted-foreground text-center">
              Bombino Express v1.0.0
            </p>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes slide-in-left {
          from {
            transform: translateX(-100%);
          }
          to {
            transform: translateX(0);
          }
        }
        .animate-slide-in-left {
          animation: slide-in-left 0.2s ease-out;
        }
      `}</style>
    </>
  );
}