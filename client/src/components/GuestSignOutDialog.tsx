import { useState } from 'react';
import { useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { GUEST_PROFILE_QUERY_KEY } from '@/hooks/useGuestProfile';
import { NOTIFICATIONS_KEY } from '@/hooks/useCustomerOrders';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { formatGuestPhone, type GuestProfile } from '@/lib/shadowProfile';
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

interface GuestSignOutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: GuestProfile;
  /** After the session is gone — e.g. the side menu closing itself. */
  onSignedOut?: () => void;
}

/**
 * Forget this device, for a guest.
 *
 * A guest is recognised by the session cookie alone — no password, no
 * sign-in screen — so without this there is no way to stop being them. On a
 * shared or borrowed phone that matters: the next person would get this
 * one's name, number, order list and, since the session authorises reading
 * it, a preview of their identity document.
 *
 * Shared by the guest profile screen and both menus so the warning cannot say
 * one thing in one place and another elsewhere. It always asks first: there is
 * no password to get back in with, only another OTP, and someone who taps
 * "Sign out" expecting an account's behaviour should learn that before, not
 * after.
 *
 * `/api/auth/logout` destroys the whole session, which is exactly right:
 * `guestRef`, `guestPhone`, `signupRef` and `signupPhone` all go with it.
 * Nothing is deleted server-side — their profile, documents and orders stay
 * filed against the number, and verifying it again brings all of it back.
 */
export function GuestSignOutDialog({
  open,
  onOpenChange,
  profile,
  onSignedOut,
}: GuestSignOutDialogProps): React.JSX.Element {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const phone = formatGuestPhone(profile.phone);
  const orderCount = profile.orders.length;

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
    // Their order updates go with them — the next person on this device must
    // not open the bell onto someone else's parcels.
    queryClient.removeQueries({ queryKey: NOTIFICATIONS_KEY });
    setIsSigningOut(false);
    onOpenChange(false);
    onSignedOut?.();
    setLocation('/home');
    toast({
      title: 'Signed out',
      description: 'Verify your number again any time to get your orders back.',
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="dialog-guest-sign-out">
        <AlertDialogHeader>
          <AlertDialogTitle>Sign out of this device?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>
                You're using Bombino as a guest, so there's no password to sign
                back in with.{' '}
                {orderCount > 0
                  ? `This device will stop showing your ${orderCount === 1 ? 'shipment' : `${orderCount} shipments`} and details.`
                  : 'This device will stop showing your details.'}
              </p>
              <p>
                Nothing is deleted — your orders and documents stay filed
                against {phone}, and verifying that number again with an OTP
                brings them all back.
              </p>
            </div>
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
            className="bg-red-600 text-white hover:bg-red-700"
            data-testid="button-guest-sign-out-confirm"
          >
            {isSigningOut ? 'Signing out…' : 'Sign out'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
