import { useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Loader2 } from 'lucide-react';
import { AuthShell } from '@/components/auth/AuthShell';
import { Button } from '@/components/ui/button';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { useToast } from '@/hooks/use-toast';
import { parseApiErrorMessage } from '@/lib/apiError';
import { useAccountDeletion } from '@/hooks/useAccountDeletion';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useGuestProfile } from '@/hooks/useGuestProfile';
import { useAppStore } from '@/lib/store';

/**
 * Delete account — preflight, then OTP, then a final confirm.
 * Reachable from Profile and GuestProfileDashboard only.
 */
export default function DeleteAccount() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const isLoggedIn = useAppStore((s) => s.isLoggedIn);
  const { preflight, requestOtp, confirmDelete } = useAccountDeletion();
  const { data: accountProfile } = useUserProfile(isLoggedIn);
  const { data: guestProfile } = useGuestProfile({ enabled: !isLoggedIn });

  const phone = useMemo(() => {
    if (isLoggedIn) {
      const p = accountProfile?.phone;
      return typeof p === 'string' ? p.trim() : '';
    }
    return guestProfile?.phone?.trim() ?? '';
  }, [isLoggedIn, accountProfile, guestProfile]);

  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');

  const back = () => setLocation(isLoggedIn ? '/profile' : '/guest-profile');

  const sendCode = async () => {
    setError('');
    if (!phone) {
      setError('No phone number on file.');
      return;
    }
    try {
      await requestOtp.mutateAsync(phone);
      setOtpSent(true);
      setOtp('');
    } catch (err) {
      setError(parseApiErrorMessage(err, 'Could not send code'));
    }
  };

  const onDelete = async () => {
    setError('');
    if (otp.length !== 6) {
      setError('Enter the 6-digit code');
      return;
    }
    try {
      await confirmDelete.mutateAsync(otp);
      setLocation('/home');
      toast({ title: 'Your account has been deleted.' });
    } catch (err) {
      setError(parseApiErrorMessage(err, 'Could not delete account'));
    }
  };

  if (preflight.isLoading) {
    return (
      <AuthShell title="Delete account" onBack={back} testId="page-delete-account">
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AuthShell>
    );
  }

  if (preflight.isError) {
    return (
      <AuthShell title="Delete account" onBack={back} testId="page-delete-account">
        <p className="text-sm text-red-600">
          {parseApiErrorMessage(preflight.error, 'Could not check whether deletion is allowed.')}
        </p>
        <Button type="button" variant="outline" className="mt-4 w-full" onClick={() => void preflight.refetch()}>
          Try again
        </Button>
      </AuthShell>
    );
  }

  const data = preflight.data;
  if (!data) {
    return (
      <AuthShell title="Delete account" onBack={back} testId="page-delete-account">
        <p className="text-sm text-muted-foreground">Nothing to show.</p>
      </AuthShell>
    );
  }

  if (!data.allowed) {
    return (
      <AuthShell
        title="Delete account"
        subtitle="Finish these first, then you can delete."
        onBack={back}
        testId="page-delete-account"
      >
        <p className="text-sm text-foreground mb-4">
          Deletion becomes available once every open shipment is finished or cancelled,
          any amount due is paid, and any refund or application is closed.
        </p>
        <ul className="space-y-3" data-testid="list-delete-blockers">
          {data.blockers.map((blocker, i) => (
            <li
              key={`${blocker.order_no ?? 'app'}-${i}`}
              className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm"
            >
              {blocker.order_no ? (
                <Link
                  href={`/order/${blocker.order_no}`}
                  className="font-semibold text-primary underline-offset-2 hover:underline"
                >
                  {blocker.order_no}
                </Link>
              ) : (
                <span className="font-semibold text-foreground">Application</span>
              )}
              <p className="text-muted-foreground mt-0.5">{blocker.reason}</p>
            </li>
          ))}
        </ul>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Delete account"
      subtitle={
        data.phone_last4
          ? `We'll send a code to the number ending ${data.phone_last4} to confirm.`
          : 'Confirm with a code sent to your phone.'
      }
      onBack={back}
      testId="page-delete-account"
    >
      <div className="space-y-4 text-sm text-foreground">
        <div>
          <p className="font-semibold mb-1">What we remove</p>
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
            <li>Your profile and saved addresses</li>
            <li>Chats with Bombino support (BIA)</li>
            <li>In-app notifications</li>
            <li>Any unused reward points (they are forfeited)</li>
          </ul>
        </div>
        <div>
          <p className="font-semibold mb-1">What we keep</p>
          <p className="text-muted-foreground">
            Order, payment and customs records stay on file, with your name and phone
            removed, so we can still run the business and meet legal requirements.
          </p>
        </div>
      </div>

      <div className="mt-6 space-y-3">
        {!otpSent ? (
          <Button
            type="button"
            className="w-full h-12 rounded-xl"
            onClick={() => void sendCode()}
            disabled={requestOtp.isPending || !phone}
            data-testid="button-delete-send-otp"
          >
            {requestOtp.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              'Send confirmation code'
            )}
          </Button>
        ) : (
          <>
            <p className="text-xs text-muted-foreground text-center">
              Enter the 6-digit code
            </p>
            <div className="flex justify-center">
              <InputOTP
                maxLength={6}
                value={otp}
                onChange={setOtp}
                data-testid="input-delete-otp"
              >
                <InputOTPGroup>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <InputOTPSlot key={i} index={i} />
                  ))}
                </InputOTPGroup>
              </InputOTP>
            </div>
            <button
              type="button"
              className="w-full text-xs text-primary font-medium"
              onClick={() => void sendCode()}
              disabled={requestOtp.isPending}
            >
              Resend code
            </button>
            <Button
              type="button"
              variant="destructive"
              className="w-full h-12 rounded-xl"
              onClick={() => void onDelete()}
              disabled={confirmDelete.isPending || otp.length !== 6}
              data-testid="button-delete-confirm"
            >
              {confirmDelete.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                'Delete my account'
              )}
            </Button>
          </>
        )}
        {error && (
          <p className="text-sm text-red-600 text-center" data-testid="error-delete-account">
            {error}
          </p>
        )}
      </div>
    </AuthShell>
  );
}
