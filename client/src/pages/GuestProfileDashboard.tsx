import { useState } from 'react';
import { useLocation } from 'wouter';
import {
  ArrowLeft,
  Loader2,
  LogOut,
  ShieldCheck,
  UserCircle,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { useQueryClient } from '@tanstack/react-query';
import { GUEST_PROFILE_QUERY_KEY, useGuestProfile } from '@/hooks/useGuestProfile';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { parseApiErrorMessage } from '@/lib/apiError';
import { Button } from '@/components/ui/button';
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
import { BottomNav } from '@/components/BottomNav';
import { StateBlock } from '@/components/StateBlock';
import { ProfileProgressTracker } from '@/components/ProfileProgressTracker';
import { GuestOrders } from '@/components/GuestOrders';
import {
  ACCOUNT_TYPE_LABEL,
  formatGuestPhone,
  shadowProfileProgress,
  type GuestAccountType,
} from '@/lib/shadowProfile';

/**
 * What a guest has instead of an account.
 *
 * A verified phone number is already a customer record in everything but name:
 * it authorised a booking, it holds a staged identity document, and orders are
 * filed against it. This screen shows that record back to them, says plainly
 * which parts are missing, and offers each one on its own — rather than a
 * single "sign up" button, which is the thing they declined on the way in.
 *
 * Everything on it comes from `GET /api/guest/profile`, which resolves the
 * guest from the session's `guest_ref` — the same uuid that owns their staged
 * documents and their orders. Nothing is read from or written to localStorage:
 * a profile kept there would be one browser's private copy of a record the
 * server already holds.
 */
export default function GuestProfileDashboard(): React.JSX.Element {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const isLoggedIn = useAppStore((s) => s.isLoggedIn);
  const { data: guestProfile, isLoading } = useGuestProfile({ enabled: !isLoggedIn });

  const [signOutOpen, setSignOutOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const queryClient = useQueryClient();

  // A real account outranks a shadow of one. Someone who signed in since this
  // screen was linked belongs on the account profile, which can actually
  // change a password and unlink a number.
  if (isLoggedIn) {
    return (
      <GuestShell onBack={() => setLocation('/home')}>
        <StateBlock
          icon={UserCircle}
          title="You already have an account"
          description="Your name, email and documents live on your profile now."
          action={{ label: 'Go to profile', onClick: () => setLocation('/profile') }}
          testId="state-guest-profile-signed-in"
        />
      </GuestShell>
    );
  }

  // The read is in flight. Nothing is rendered rather than the empty state,
  // which would otherwise flash "Nothing here yet" at a guest who has plenty.
  if (isLoading) {
    return (
      <GuestShell onBack={() => setLocation('/home')}>
        <div className="flex items-center justify-center py-20" data-testid="guest-profile-loading">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
        </div>
      </GuestShell>
    );
  }

  // No verified number in this session means the server has no profile to
  // return. The way one comes into existence is a booking, so that is where
  // this sends them.
  if (!guestProfile) {
    return (
      <GuestShell onBack={() => setLocation('/home')}>
        <StateBlock
          icon={ShieldCheck}
          title="Nothing here yet"
          description="Verify your mobile number while booking a parcel and we'll keep your details here — no account needed."
          action={{ label: 'Book a parcel', onClick: () => setLocation('/create') }}
          secondaryAction={{ label: 'Sign in', onClick: () => setLocation('/login') }}
          testId="state-guest-profile-empty"
        />
      </GuestShell>
    );
  }

  const { pending } = shadowProfileProgress(guestProfile);
  /**
   * What is left that this screen can actually collect.
   *
   * The documents and the account itself are excluded: both are signup's to
   * finish, and gating the offer on them would hide it from a guest who has
   * answered every question we can ask here — which is precisely the moment
   * to offer it.
   */
  const typedPending = pending.filter(
    (field) => field.spec.key !== 'documents' && field.spec.key !== 'account'
  );
  const detailsDone = typedPending.length === 0;
  const orders = guestProfile.orders;

  /**
   * Forget this device.
   *
   * A guest is recognised by the session cookie alone — no password, no
   * sign-in screen — so without this there is no way to stop being them. On a
   * shared or borrowed phone that matters: the next person would get this
   * one's name, number, order list and, since the session authorises reading
   * it, a preview of their identity document.
   *
   * `/api/auth/logout` destroys the whole session, which is exactly right:
   * `guestRef`, `guestPhone`, `signupRef` and `signupPhone` all go with it.
   * Nothing is deleted server-side — their profile, documents and orders stay
   * filed against the number, and verifying it again brings all of it back.
   */
  const handleSignOut = async (): Promise<void> => {
    setIsSigningOut(true);
    try {
      await apiRequest('POST', '/api/auth/logout', {});
    } catch {
      // The session may already be gone server-side. Either way this device
      // must stop showing someone's details, so the local clear happens
      // regardless — the whole point of the button is that it always works.
    }
    queryClient.setQueryData(GUEST_PROFILE_QUERY_KEY, null);
    setIsSigningOut(false);
    setSignOutOpen(false);
    setLocation('/home');
    toast({
      title: 'Signed out',
      description: 'Verify your number again any time to get your orders back.',
    });
  };

  /**
   * Into the real signup, with what we already know.
   *
   * `type` preselects the shape so a company does not land on the personal
   * form and have to find the toggle; `phone` saves typing a number this
   * screen is named after. Everything else — the document matrix, the GSTIN
   * check, the contract — stays where it already lives.
   */
  const openSignup = (type: GuestAccountType | null): void => {
    const params = new URLSearchParams({ phone: guestProfile.phone, redirect: '/orders' });
    // Omitted when they have not chosen: signup then opens on its own account
    // type step rather than starting them on a shape nobody picked.
    if (type) params.set('type', type);
    setLocation(`/signup?${params.toString()}`);
  };

  return (
    <GuestShell onBack={() => setLocation('/home')}>
      <div className="space-y-4 px-4 py-4">
        {/* One card, one ask.
            The action lives with the list of gaps rather than in a card of its
            own repeating the same sentence, and the label follows the state:
            details first, then the account those details were for. The
            separate "want a full account?" card is gone because it offered the
            end of this same road. */}
        <ProfileProgressTracker
          profile={guestProfile}
          footer={
            <>
              {detailsDone ? (
                <>
                  <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
                    Every detail we can ask for here is answered. Opening an account
                    keeps your orders and documents together, and picks up from what
                    you have already filled in.
                  </p>
                  <Button
                    onClick={() => openSignup(guestProfile.account_type)}
                    className="h-12 w-full rounded-xl text-sm font-semibold"
                    data-testid="button-guest-open-account"
                  >
                    {guestProfile.account_type
                      ? `Open my ${ACCOUNT_TYPE_LABEL[guestProfile.account_type].toLowerCase()} account`
                      : 'Open my account'}
                  </Button>
                </>
              ) : (
                <>
                  <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
                    {typedPending.length === 1
                      ? 'One detail left. Add it once and your next booking is mostly done, with nothing to retype.'
                      : `${typedPending.length} details left. Add them once and your next booking is mostly done, with nothing to retype.`}
                  </p>
                  <Button
                    onClick={() => setLocation('/guest-profile/setup')}
                    className="h-12 w-full rounded-xl text-sm font-semibold"
                    data-testid="button-guest-setup"
                  >
                    Add my details
                  </Button>
                </>
              )}

              {/* The document is its own errand: a file, a camera roll and a
                  number to type, so it lives on the setup screen. */}
              {guestProfile.kyc === null && (
                <button
                  type="button"
                  onClick={() => setLocation('/create')}
                  className="mt-2 h-11 w-full rounded-xl border border-border text-sm font-semibold text-[#2F4468]"
                  data-testid="button-guest-add-document"
                >
                  Add my identity document
                </button>
              )}
            </>
          }
        />

        {/* The orders themselves, because there is nowhere else for a guest to
            read them: /orders is an account screen, and /api/orders/:orderNo
            answers only to an account. Shared with Home rather than duplicated
            — see components/GuestOrders.tsx. */}
        <GuestOrders orders={orders} />

        {/* Last, and quiet. Nothing here is destroyed by it — the copy in the
            dialog says so — but it is the only way to stop this device being
            somebody, so it must be findable rather than hidden. */}
        <button
          type="button"
          onClick={() => setSignOutOpen(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card py-3 text-sm font-semibold text-muted-foreground hover:bg-muted"
          data-testid="button-guest-sign-out"
        >
          <LogOut className="h-4 w-4" aria-hidden />
          Sign out of this device
        </button>
      </div>

      <AlertDialog open={signOutOpen} onOpenChange={setSignOutOpen}>
        <AlertDialogContent data-testid="dialog-guest-sign-out">
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out of this device?</AlertDialogTitle>
            <AlertDialogDescription>
              This phone will stop showing your details. Nothing is deleted —
              your orders and documents stay filed against{' '}
              {formatGuestPhone(guestProfile.phone)}, and verifying that number
              again brings them all back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-guest-sign-out-cancel">
              Stay signed in
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // Hold the dialog open until the request lands; closing first
                // leaves the screen looking idle mid-sign-out.
                e.preventDefault();
                void handleSignOut();
              }}
              disabled={isSigningOut}
              data-testid="button-guest-sign-out-confirm"
            >
              {isSigningOut ? 'Signing out…' : 'Sign out'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </GuestShell>
  );
}

/** The chrome, shared by the three states above so they cannot drift apart. */
function GuestShell({
  children,
  onBack,
}: {
  children: React.ReactNode;
  onBack: () => void;
}): React.JSX.Element {
  return (
    <div className="min-h-[100dvh] bg-background pb-nav" data-testid="screen-guest-profile">
      <header className="safe-top sticky top-0 z-50 border-b border-border bg-white md:hidden">
        <div className="mx-auto flex h-14 max-w-md items-center px-4">
          <button
            onClick={onBack}
            aria-label="Back"
            className="-ml-2 rounded-lg p-2 transition-colors hover:bg-muted"
            data-testid="button-guest-profile-back"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="ml-2 text-sm font-semibold">Your profile</h1>
        </div>
      </header>

      <main className="mx-auto max-w-md">{children}</main>

      <BottomNav />
    </div>
  );
}
