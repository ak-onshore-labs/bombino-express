import { useEffect, useRef, useState } from 'react';
import { isIndianMobile } from '@shared/contact';
import { Loader2, ShieldCheck, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { apiRequest } from '@/lib/queryClient';
import { parseApiErrorCode, parseApiErrorMessage } from '@/lib/apiError';
import { AskBiaLink } from '@/components/bia/AskBiaLink';
import type { AuthUser } from '@/lib/store';
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

const RESEND_COOLDOWN_SECONDS = 30;



interface GuestVerificationProps {
  /**
   * The verified number, or null while it is not. The parent sends this as the
   * sender phone, so the number that authorised the booking and the number on
   * the order are the same by construction.
   */
  onVerifiedPhoneChange: (phone: string | null) => void;
  /**
   * Called when a verified number is given up — changed, or its OTP expired.
   * Whatever was staged belonged to that number, so the parent drops its view
   * of the documents too rather than showing ticks for rows that are gone.
   */
  onReset: () => void;
  /**
   * The number has an account and they chose to use it. The code they already
   * typed signed them in — no second SMS — so the parent leaves guest mode and
   * carries on as that customer.
   */
  onSignedIn: (user: AuthUser) => void;
}

/**
 * The first half of what a guest has to prove: the phone number.
 *
 * First on the Sender step, because everything else on the booking depends on
 * it. The staging endpoints that take their documents are authorised by this
 * OTP rather than by a session, so nothing can be uploaded until it passes,
 * and the number proved here is written into the sender field below — typed
 * once, not twice.
 *
 * The documents themselves are asked for further down the step, after the
 * address, by `AccountDocuments` in its `signup` mode. Kept apart deliberately:
 * this card is short and always answerable, while the document form is long
 * and needs the address settled first. Booking without an account is still not
 * booking without KYC — the server refuses a guest order until both halves are
 * done.
 */
export function GuestVerification({
  onVerifiedPhoneChange,
  onReset,
  onSignedIn,
}: GuestVerificationProps): React.JSX.Element {
  // Nothing to prefill from: this card is the first thing on the step, which
  // is the point — the number proved here is the one written into the sender
  // field below, rather than a second number typed there and reconciled after.
  const [phone, setPhone] = useState('');
  const [step, setStep] = useState<'phone' | 'otp' | 'documents'>('phone');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [verifiedPhone, setVerifiedPhone] = useState<string | null>(null);
  /** The number turned out to have an account. Shown as a dialog, not inline. */
  const [existingAccount, setExistingAccount] = useState(false);
  const phoneRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // The parent gates Continue on this, and treats an unverified guest as
  // having every document outstanding — there is nowhere to stage them yet.
  useEffect(() => {
    onVerifiedPhoneChange(verifiedPhone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verifiedPhone]);

  // The last error the server returned, with its code, so "Ask BIA" can say
  // which error it was. Used only while its message is the one on screen.
  const lastApiErrorRef = useRef<{ message: string; code: string | null } | null>(null);
  const rememberApiError = (err: unknown, fallback: string): string => {
    const message = parseApiErrorMessage(err, fallback);
    lastApiErrorRef.current = { message, code: parseApiErrorCode(err) };
    return message;
  };

  const requestOtp = async (): Promise<void> => {
    setIsLoading(true);
    setError('');
    try {
      await apiRequest('POST', '/api/auth/otp/request', { phone: phone.trim(), purpose: 'auth' });
      setStep('otp');
      setOtp('');
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setError(rememberApiError(err, 'Could not send code'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendOtp = (): void => {
    if (!isIndianMobile(phone.trim())) {
      setError('Enter a valid 10-digit phone number');
      phoneRef.current?.focus();
      return;
    }
    void requestOtp();
  };

  const submitOtp = async (code: string): Promise<void> => {
    setIsLoading(true);
    setError('');
    try {
      // NOT /api/auth/phone/continue: that endpoint signs the customer in the
      // moment it recognises the number, which would leave a real session
      // behind a screen still showing a guest booking. This one only proves
      // the number, and refuses it outright when an account already holds it.
      await apiRequest('POST', '/api/guest/phone/verify', { phone: phone.trim(), code });
      setVerifiedPhone(phone.trim());
      setStep('documents');
    } catch (err) {
      if (parseApiErrorCode(err) === 'ACCOUNT_EXISTS') {
        // Deserves a dialog rather than a line of red text under the field:
        // it is not a typo to correct, it is a different route to take.
        //
        // `otp` is deliberately kept. The server did not spend the code on this
        // answer, so "Sign in" below can use the one already typed instead of
        // sending them away for another.
        setExistingAccount(true);
        return;
      }
      setError(rememberApiError(err, 'Incorrect code'));
      setOtp('');
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Use the account this number already has.
   *
   * The code is still live — /api/guest/phone/verify checks it without spending
   * it precisely so this can work — so signing in costs nothing more than the
   * tap. /api/auth/phone/continue is the login screen's own endpoint and mints
   * the ITD token where the account has one.
   */
  const signInWithSameCode = async (): Promise<void> => {
    setIsLoading(true);
    setError('');
    try {
      const res = await apiRequest('POST', '/api/auth/phone/continue', {
        phone: phone.trim(),
        code: otp,
      });
      const data = (await res.json()) as { status: string; user?: AuthUser };
      if (data.status === 'signed_in' && data.user) {
        setExistingAccount(false);
        onSignedIn(data.user);
        return;
      }
      // Should not happen: this branch only runs on a number the server just
      // told us has an account.
      setExistingAccount(false);
      setError('Could not sign you in. Please use the sign-in screen.');
    } catch (err) {
      setExistingAccount(false);
      setError(rememberApiError(err, 'Could not sign you in'));
      setOtp('');
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Change the number after it has been verified.
   *
   * Everything staged belongs to the old one — the server discards it when the
   * phone changes, and `AccountDocuments` re-reads on the new ref — so this
   * drops the local view of it too rather than leaving ticks on screen for
   * documents that are no longer there.
   */
  const handleEditPhone = (): void => {
    setVerifiedPhone(null);
    setOtp('');
    setError('');
    setStep('phone');
    onReset();
  };

  return (
    <div
      className="rounded-xl border border-[#E2E8F0] bg-white p-4 space-y-4"
      data-testid="guest-verification"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#F2A123]/12">
          <ShieldCheck className="h-4 w-4 text-[#F2A123]" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[lab(34.0831_-9.57756_-27.7093)]">
            Verify it&rsquo;s you
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            We&rsquo;ll text you a 6-digit code.
          </p>
        </div>
      </div>

      {step === 'phone' && (
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">Mobile number *</Label>
            <div className="mt-1 flex items-center gap-2">
              <span className="flex h-11 shrink-0 items-center rounded-xl border border-[#E2E8F0] bg-[#F3F4F6] px-3 text-sm font-medium text-muted-foreground">
                +91
              </span>
              <Input
                ref={phoneRef}
                type="tel"
                inputMode="numeric"
                maxLength={10}
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value.replace(/\D/g, '').slice(0, 10));
                  setError('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleSendOtp();
                  }
                }}
                placeholder="10-digit number"
                // Same reason the OTP field locks: the request is already out,
                // and a number edited underneath it would not be the one the
                // code was sent to.
                disabled={isLoading}
                className="h-11 rounded-xl"
                data-testid="input-guest-phone"
              />
            </div>
          </div>
          <Button
            type="button"
            onClick={handleSendOtp}
            disabled={isLoading || phone.trim().length !== 10}
            className="h-11 w-full rounded-xl bg-[lab(34.0831_-9.57756_-27.7093)] text-sm font-semibold text-[#F8F9FA] hover:opacity-90 disabled:opacity-60"
            data-testid="button-guest-send-otp"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send code'}
          </Button>
        </div>
      )}

      {step === 'otp' && (
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">
              Enter the code sent to +91 {phone}
            </Label>
            <div className="mt-2 flex justify-center">
              <InputOTP
                maxLength={6}
                value={otp}
                autoFocus
                // The code submits itself on the sixth digit, so without this
                // the field stays live and editable while the request is out —
                // a seventh keystroke lands in a box that is already deciding,
                // and a second submit can be fired over the first.
                disabled={isLoading}
                onChange={(v) => {
                  setOtp(v);
                  setError('');
                  // Submit on the last digit, as the login screen does — the
                  // extra tap is ceremony once the code is complete.
                  if (v.length === 6 && !isLoading) void submitOtp(v);
                }}
              >
                <InputOTPGroup>
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <InputOTPSlot
                      key={i}
                      index={i}
                      className="h-12 w-11 text-base"
                      data-testid={`input-guest-otp-slot-${i}`}
                    />
                  ))}
                </InputOTPGroup>
              </InputOTP>
            </div>
          </div>
          {/* Said out loud, in the place the next thing will appear. The
              submit happens on the sixth keystroke rather than on a button
              press, so without this the screen looks like it simply took the
              code and stopped — and the wait covers a network round trip plus
              an account lookup, which is long enough to be doubted. */}
          {isLoading ? (
            <div
              className="flex items-center justify-center gap-2 py-1"
              role="status"
              aria-live="polite"
              data-testid="status-guest-verifying"
            >
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#2F4468]" aria-hidden />
              <span className="text-xs font-medium text-[#64748B]">Verifying…</span>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={handleEditPhone}
                className="text-xs font-semibold text-[#64748B] underline underline-offset-4"
                data-testid="button-guest-change-phone"
              >
                Change number
              </button>
              <button
                type="button"
                onClick={() => cooldown === 0 && void requestOtp()}
                disabled={cooldown > 0}
                className="text-xs font-semibold text-[#2F4468] underline underline-offset-4 disabled:text-muted-foreground disabled:no-underline"
                data-testid="button-guest-resend-otp"
              >
                {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
              </button>
            </div>
          )}
        </div>
      )}

      {step === 'documents' && verifiedPhone && (
        <div className="flex items-center justify-between rounded-lg bg-[#F3F4F6] px-3 py-2">
          <span className="text-xs text-[lab(34.0831_-9.57756_-27.7093)]">
            <span className="font-semibold">+91 {verifiedPhone}</span> verified
          </span>
          <button
            type="button"
            onClick={handleEditPhone}
            className="inline-flex items-center gap-1 text-xs font-semibold text-[#2F4468] underline underline-offset-4"
            data-testid="button-guest-edit-verified-phone"
          >
            <Pencil className="h-3 w-3" aria-hidden />
            Change
          </button>
        </div>
      )}

      {error && (
        <div className="flex flex-col items-start gap-1">
          <p className="text-xs text-red-600" role="alert" data-testid="text-guest-verification-error">
            {error}
          </p>
          <AskBiaLink
            screen={{ surface: 'create', step: 'sender' }}
            code={lastApiErrorRef.current?.message === error ? lastApiErrorRef.current.code : null}
            message={error}
          />
        </div>
      )}

      {/* Not a failure to correct — a different door to go through. The number
          is theirs, they just already have an account holding their orders,
          addresses and identity document, and booking beside it as a stranger
          would split one customer across two records. */}
      <AlertDialog open={existingAccount} onOpenChange={setExistingAccount}>
        <AlertDialogContent data-testid="dialog-guest-account-exists">
          <AlertDialogHeader>
            <AlertDialogTitle>This number already has an account</AlertDialogTitle>
            <AlertDialogDescription>
              +91 {phone} is registered with Bombino. Sign in to book with it — your
              saved addresses and identity document are already there — or use a
              different number to carry on as a guest.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                // Back to an empty field, ready for another number. The code
                // just used is spent either way.
                setExistingAccount(false);
                setPhone('');
                setOtp('');
                setStep('phone');
                setError('');
              }}
              data-testid="button-guest-use-another-number"
            >
              Use a different number
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // Keep the dialog up until the request lands; closing first
                // leaves the card looking idle while a sign-in is in flight.
                e.preventDefault();
                void signInWithSameCode();
              }}
              disabled={isLoading}
              data-testid="button-guest-go-sign-in"
            >
              {isLoading ? 'Signing in…' : 'Sign in'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
