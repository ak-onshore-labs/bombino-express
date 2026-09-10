import { useState } from 'react';
import { useLocation } from 'wouter';
import { useAppStore } from '@/lib/store';
import { apiRequest } from '@/lib/queryClient';
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

interface AccountSignOutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** After the session is gone — e.g. the side menu closing itself. */
  onSignedOut?: () => void;
}

/**
 * Sign out, for an account holder — asked first.
 *
 * The guest's equivalent is GuestSignOutDialog; the two are separate because
 * what is at stake differs. A guest has no password to come back with, so
 * their copy is about what this device forgets. An account holder signs back
 * in with the same number or password, so this one only confirms the tap was
 * meant — the button sits one row from My Profile in the menus.
 *
 * The local sign-out happens whether or not the request lands: the session
 * may already be gone server-side, and the button must always work.
 */
export function AccountSignOutDialog({
  open,
  onOpenChange,
  onSignedOut,
}: AccountSignOutDialogProps): React.JSX.Element {
  const [, setLocation] = useLocation();
  const logout = useAppStore((s) => s.logout);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = async (): Promise<void> => {
    setIsSigningOut(true);
    try {
      await apiRequest('POST', '/api/auth/logout', {});
    } catch {
      // Ignore network failure — still clear the local session.
    }
    logout();
    setIsSigningOut(false);
    onOpenChange(false);
    onSignedOut?.();
    setLocation('/login');
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="dialog-account-sign-out">
        <AlertDialogHeader>
          <AlertDialogTitle>Sign out?</AlertDialogTitle>
          <AlertDialogDescription>
            You'll need to sign in again to book, track your orders or see your
            profile on this device.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="button-account-sign-out-cancel">
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
            data-testid="button-account-sign-out-confirm"
          >
            {isSigningOut ? 'Signing out…' : 'Sign out'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
