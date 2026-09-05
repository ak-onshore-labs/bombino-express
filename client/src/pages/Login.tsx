import { useState, useEffect, useRef } from 'react';
import {
  Loader2,
  Mail,
  Lock,
  Eye,
  EyeOff,
  UserPlus,
  BadgeCheck,
  ArrowRight,
  Phone,
  ShieldCheck,
} from 'lucide-react';
import { useLocation, Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { AuthShell } from '@/components/auth/AuthShell';
import { useAppStore, type AuthUser } from '@/lib/store';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateGuestProfile, useGuestProfile } from '@/hooks/useGuestProfile';
import {
  SHADOW_STATUS_META,
  formatGuestPhone,
  shadowProfileProgress,
} from '@/lib/shadowProfile';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { apiRequest } from '@/lib/queryClient';
import { landingPathForRole } from '@/lib/surface';
import { parseApiErrorMessage } from '@/lib/apiError';

const RESEND_COOLDOWN_SECONDS = 30;

/**
 * Single entry point for every account.
 *
 * The phone number is the identity: it is collected and verified first, and
 * only then does the server say whether it already belongs to an account. A
 * customer who predates this app — one ITD provisioned an email/password for —
 * proves that account once on the `link` step, after which their number signs
 * them in on its own and the password is never asked for again.
 *
 * phone → otp → ┬ (number known)   sign in
 *               └ (number unknown) choice → link (existing ITD account)
 *                                         └ /signup (new customer)
 */
type Step = 'phone' | 'otp' | 'guest' | 'choice' | 'link';

type ContinueResponse =
  | { status: 'signed_in'; user: AuthUser }
  /**
   * No account, but the number has booked as a guest before — the server has
   * put this session back on their `guest_ref`. They are already who they came
   * here to be, so there is nothing left to ask.
   */
  | { status: 'guest' }
  | { status: 'needs_account' };

const STEP_META: Record<Step, { title: string; subtitle: string; index: number }> = {
  guest: { title: 'Welcome back', subtitle: '', index: 3 },
  phone: {
    title: 'Sign in',
    subtitle: 'Enter your mobile number to get started. New and returning customers both start here.',
    index: 1,
  },
  otp: { title: 'Verify your number', subtitle: '', index: 2 },
  choice: { title: 'One more thing', subtitle: '', index: 3 },
  link: {
    title: 'Find your account',
    subtitle: 'Sign in once with your Bombino email and password.',
    index: 3,
  },
};

export default function Login() {
  const [, setLocation] = useLocation();
  const { login } = useAppStore();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  /**
   * Only asked for once the number turns out to be a guest's. Before that
   * there is nothing to read and the endpoint would answer 401.
   */
  const [step, setStep] = useState<Step>(
    new URLSearchParams(window.location.search).get('link') === '1' &&
      new URLSearchParams(window.location.search).get('phone')
      ? 'link'
      : 'phone'
  );
  const { data: guestProfile } = useGuestProfile({ enabled: step === 'guest' });
  const [pendingOpen, setPendingOpen] = useState(false);
  /** The rows the popup lists. Empty for a guest who has answered everything. */
  const guestPending = guestProfile ? shadowProfileProgress(guestProfile).pending : [];
  // Prefilled when another screen sent them here with a number already in
  // hand, so an expiry does not cost them typing it again.
  const [phone, setPhone] = useState(
    () => new URLSearchParams(window.location.search).get('phone') ?? '',
  );
  const [otp, setOtp] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  /** Inline confirmation for a resend, where nothing else on screen changes. */
  const [justSent, setJustSent] = useState(false);

  const phoneRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  const params = new URLSearchParams(window.location.search);
  const redirect = params.get('redirect');
  /**
   * Sent here to attach a number to an ITD account that predates phone
   * sign-in.
   *
   * The only route to this step since a number we have never seen goes
   * straight to signup. Signup offers it in its footer, immediately after the
   * OTP, because `/api/auth/link/itd` needs a verification less than
   * OTP_VERIFICATION_WINDOW_MINUTES old — which is exactly what the customer
   * has just done.
   */
  const linkRequested = params.get('link') === '1';
  // Set when the session lapsed under the user rather than them signing out.
  // Without it, being thrown back here reads as the app losing their login for
  // no reason.
  const expired = params.get('expired') === '1';
  /**
   * Why they were sent here, when it was not an ordinary visit.
   *
   * `session` is the signed-in case `expired=1` has always covered.
   * `signup_otp` is someone part-way through signup whose phone verification
   * ran out — they were never signed in, so the session copy would be a lie,
   * and they need a fresh code rather than a sign-in.
   */
  const reason = params.get('reason') === 'signup_otp' ? 'signup_otp' : expired ? 'session' : null;

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  // Land focus where the next input is, so the flow can be completed without
  // reaching for the screen between steps.
  useEffect(() => {
    if (step === 'phone') phoneRef.current?.focus();
    if (step === 'link') emailRef.current?.focus();
  }, [step]);

  const finishSignIn = (user: AuthUser): void => {
    login(user);
    setLocation(redirect || landingPathForRole(user.role));
  };

  const requestOtp = async (): Promise<void> => {
    setIsLoading(true);
    setError('');
    try {
      await apiRequest('POST', '/api/auth/otp/request', { phone, purpose: 'auth' });
      setStep('otp');
      setOtp('');
      setCooldown(RESEND_COOLDOWN_SECONDS);
      // No toast: the OTP step's own subtitle already reads "We sent a
      // 6-digit code to +91 …". A full-width banner over the header repeated
      // that and covered the back button while doing it.
      setJustSent(true);
    } catch (err) {
      setError(parseApiErrorMessage(err, 'Could not send code'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendOtp = (): void => {
    if (!/^\d{10}$/.test(phone.trim())) {
      setError('Enter a valid 10-digit phone number');
      phoneRef.current?.focus();
      return;
    }
    void requestOtp();
  };

  const handleResendOtp = (): void => {
    if (cooldown > 0) return;
    void requestOtp();
  };

  const submitOtp = async (code: string): Promise<void> => {
    setIsLoading(true);
    setError('');
    try {
      const res = await apiRequest('POST', '/api/auth/phone/continue', { phone, code });
      const data = (await res.json()) as ContinueResponse;
      if (data.status === 'signed_in') {
        finishSignIn(data.user);
        return;
      }
      if (data.status === 'guest') {
        // The session changed under a cache that outlives the navigation:
        // wouter pushes rather than reloads, so a `null` left by an earlier
        // sign-out on this tab would still be fresh and the next screen would
        // render as though nobody had verified anything.
        invalidateGuestProfile(queryClient);
        // Offered, not assumed. The number is theirs either way, but whether
        // they want to carry on as a guest or turn it into an account is a
        // decision they came to this screen to make.
        setStep('guest');
        return;
      }
      // Nothing on file at all. The old screen asked "have you shipped with
      // Bombino before?" and made an account the second of two answers; a
      // number we have never seen has one useful next step, so it happens.
      goToSignup();
    } catch (err) {
      setError(parseApiErrorMessage(err, 'Incorrect code'));
      setOtp('');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerify = (): void => {
    if (!/^\d{6}$/.test(otp)) {
      setError('Enter the 6-digit code');
      return;
    }
    void submitOtp(otp);
  };

  const handleLink = async (): Promise<void> => {
    if (!email.trim() || !password.trim()) {
      setError('Please enter your email and password');
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      const res = await apiRequest('POST', '/api/auth/link/itd', {
        phone,
        email: email.trim(),
        password,
      });
      const user = (await res.json()) as AuthUser;
      toast({
        title: 'Mobile number linked',
        description: `${phone} is now linked to your account.`,
      });
      finishSignIn(user);
    } catch (err) {
      setError(parseApiErrorMessage(err, 'Could not verify those credentials'));
    } finally {
      setIsLoading(false);
    }
  };

  // The number is already verified, so signup can skip straight to details.
  const goToSignup = (): void => {
    const search = new URLSearchParams({ phone, verified: '1' });
    if (redirect) search.set('redirect', redirect);
    setLocation(`/signup?${search.toString()}`);
  };

  const handleBack = (): void => {
    const previous: Partial<Record<Step, Step>> = {
      otp: 'phone',
      guest: 'phone',
      choice: 'phone',
      link: 'choice',
    };
    const target = previous[step];
    if (!target) {
      setLocation('/home');
      return;
    }
    setStep(target);
    setError('');
  };

  const meta = STEP_META[step];

  /** The customer's own number, set the way every other figure on these
   *  screens is set. It is the subject of both sentences below, so it should
   *  not read as ordinary body text. */
  const phoneMark = (
    <span className="font-mono font-semibold text-foreground whitespace-nowrap">
      +91 {phone}
    </span>
  );

  const subtitle =
    step === 'otp' ? (
      <>We sent a 6-digit code to {phoneMark}.</>
    ) : step === 'choice' ? (
      <>We don't have {phoneMark} on file yet.</>
    ) : (
      meta.subtitle
    );

  return (
    <AuthShell
      title={meta.title}
      subtitle={subtitle}
      onBack={handleBack}
      step={meta.index}
      totalSteps={3}
      testId="screen-login"
      footer={
        step === 'phone' ? (
          <p className="text-center text-sm text-muted-foreground mt-5">
            New here?{' '}
            <Link
              href={redirect ? `/signup?redirect=${encodeURIComponent(redirect)}` : '/signup'}
              className="text-[#F2A123] font-semibold hover:underline"
            >
              Create account
            </Link>
          </p>
        ) : null
      }
    >
      {reason && (
        <div
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3"
          role="status"
          data-testid={
            reason === 'signup_otp' ? 'notice-signup-otp-expired' : 'notice-session-expired'
          }
        >
          <p className="text-sm font-semibold text-amber-900">
            {reason === 'signup_otp' ? 'Your verification expired' : 'Your session expired'}
          </p>
          <p className="text-xs text-amber-800 mt-0.5 leading-relaxed">
            {reason === 'signup_otp'
              ? 'The code that started your signup timed out. Get a new one to carry on.'
              : 'You were signed out for security. Sign in again to pick up where you left off.'}
          </p>
        </div>
      )}

      {step === 'phone' && (
        <div>
          <Label htmlFor="login-phone" className="text-sm font-medium text-[lab(34.0831_-9.57756_-27.7093)]">
            Mobile number
          </Label>
          <div className="relative mt-2">
            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input
              id="login-phone"
              ref={phoneRef}
              type="tel"
              inputMode="numeric"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value.replace(/\D/g, '').slice(0, 10));
                setError('');
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleSendOtp()}
              placeholder="10-digit mobile number"
              className="pl-10 h-12 bg-[#F3F4F6] border border-[#E2E8F0] rounded-xl"
              autoComplete="tel"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'login-error' : undefined}
              data-testid="input-phone"
            />
          </div>
        </div>
      )}

      {step === 'otp' && (
        <div>
          <Label className="text-sm font-medium text-[lab(34.0831_-9.57756_-27.7093)]">Verification code</Label>
          <div className="mt-3 flex justify-center">
            <InputOTP
              maxLength={6}
              value={otp}
              autoFocus
              onChange={(v) => {
                setOtp(v);
                setError('');
                // Submit as soon as the last digit lands — the extra tap on
                // "Verify" was pure ceremony once the code is complete.
                if (v.length === 6 && !isLoading) void submitOtp(v);
              }}
            >
              <InputOTPGroup>
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <InputOTPSlot
                    key={i}
                    index={i}
                    className="h-12 w-11 text-base"
                    data-testid={`input-otp-slot-${i}`}
                  />
                ))}
              </InputOTPGroup>
            </InputOTP>
          </div>
          {justSent && (
            <p
              className="text-xs text-muted-foreground text-center mt-3"
              role="status"
              data-testid="text-code-sent"
            >
              Code sent
            </p>
          )}
          <button
            type="button"
            onClick={handleResendOtp}
            disabled={cooldown > 0}
            className="text-xs text-[#F2A123] mt-3 mx-auto block disabled:text-muted-foreground disabled:cursor-not-allowed"
            data-testid="button-resend-otp"
          >
            {cooldown > 0 ? `Resend OTP in ${cooldown}s` : 'Resend OTP'}
          </button>
        </div>
      )}

      {step === 'guest' && (
        <div className="space-y-4" data-testid="step-guest">
          <div className="rounded-xl border border-[#E2E8F0] bg-[#F3F4F6] px-4 py-3">
            <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <ShieldCheck className="h-4 w-4 shrink-0 text-green-600" aria-label="Verified" />
              {formatGuestPhone(phone)}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {guestProfile?.orders.length
                ? `${guestProfile.orders.length === 1 ? '1 booking is' : `${guestProfile.orders.length} bookings are`} filed against this number.`
                : 'This number has shipped with us before.'}
            </p>
          </div>

          {/* Guest first, because it is what this number already is. Opening an
              account is the bigger commitment and sits underneath as the
              quieter option, not as a wall in front of the parcel. */}
          <Button
            onClick={() => setPendingOpen(true)}
            className="h-12 w-full rounded-xl bg-[#F2A123] text-base font-semibold text-[lab(34.0831_-9.57756_-27.7093)] hover:bg-[#F2A123]/90"
            data-testid="button-continue-as-guest"
          >
            Continue as guest
          </Button>

          <button
            type="button"
            onClick={goToSignup}
            className="w-full text-center text-sm font-semibold text-[#2F4468] underline underline-offset-4"
            data-testid="button-guest-create-account"
          >
            Create an account instead
          </button>
        </div>
      )}

      {step === 'choice' && (
        <div>
          <p className="text-sm font-medium text-[lab(34.0831_-9.57756_-27.7093)] mb-3">Have you shipped with Bombino before?</p>
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => {
                setStep('link');
                setError('');
              }}
              className="w-full flex items-start gap-3 text-left rounded-xl border border-[#E2E8F0] bg-[#F3F4F6] p-4 hover:border-[#F2A123] transition-colors"
              data-testid="button-existing-customer"
            >
              <BadgeCheck className="w-[18px] h-[18px] text-[#F2A123] shrink-0 mt-0.5" />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-foreground">
                  Yes, I have an account
                </span>
                <span className="block text-xs text-muted-foreground mt-0.5 leading-relaxed">
                  Sign in with your email and password once — we'll link this number to it.
                </span>
              </span>
              <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
            </button>
            <button
              type="button"
              onClick={goToSignup}
              className="w-full flex items-start gap-3 text-left rounded-xl border border-[#E2E8F0] bg-[#F3F4F6] p-4 hover:border-[#F2A123] transition-colors"
              data-testid="button-new-customer"
            >
              <UserPlus className="w-[18px] h-[18px] text-[#F2A123] shrink-0 mt-0.5" />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-foreground">
                  No, I'm new here
                </span>
                <span className="block text-xs text-muted-foreground mt-0.5 leading-relaxed">
                  Create an account — it takes a minute.
                </span>
              </span>
              <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
            </button>
          </div>
        </div>
      )}

      {step === 'link' && (
        <>
          <div className="rounded-xl border border-[#E2E8F0] bg-[#F3F4F6] px-4 py-3">
            <p className="text-sm font-medium text-[lab(34.0831_-9.57756_-27.7093)]">Linking</p>
            <p className="font-mono mt-1 text-sm font-medium text-foreground">+91 {phone}</p>
          </div>

          <div>
            <Label htmlFor="login-email" className="text-sm font-medium text-[lab(34.0831_-9.57756_-27.7093)]">
              Email
            </Label>
            <div className="relative mt-2">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground pointer-events-none" />
              <Input
                id="login-email"
                ref={emailRef}
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError('');
                }}
                onKeyDown={(e) => e.key === 'Enter' && void handleLink()}
                placeholder="Enter your email"
                className="pl-10 h-12 bg-[#F3F4F6] border border-[#E2E8F0] rounded-xl"
                autoComplete="email"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'login-error' : undefined}
                data-testid="input-email"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="login-password" className="text-sm font-medium text-[lab(34.0831_-9.57756_-27.7093)]">
              Password
            </Label>
            <div className="relative mt-2">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground z-10 pointer-events-none" />
              <Input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError('');
                }}
                onKeyDown={(e) => e.key === 'Enter' && void handleLink()}
                placeholder="Enter your password"
                className="pl-10 pr-12 h-12 bg-[#F3F4F6] border border-[#E2E8F0] rounded-xl"
                autoComplete="current-password"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'login-error' : undefined}
                data-testid="input-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </>
      )}

      {/* role="alert" so the message is announced, not just coloured red. */}
      {error && (
        <p
          id="login-error"
          role="alert"
          className="text-sm text-red-500 text-center"
          data-testid="text-login-error"
        >
          {error}
        </p>
      )}

      {/* The guest step carries its own two actions, and the choice step is
          made of buttons. Neither wants a third one underneath. */}
      {step !== 'choice' && step !== 'guest' && (
        <Button
          onClick={
            step === 'phone' ? handleSendOtp : step === 'otp' ? handleVerify : () => void handleLink()
          }
          disabled={isLoading || (step === 'phone' && phone.length !== 10)}
          className="w-full h-12 text-base font-semibold bg-[#F2A123] hover:bg-[#F2A123]/90 text-[lab(34.0831_-9.57756_-27.7093)] rounded-xl shadow-[0_4px_20px_oklch(17%_0.048_248_/_0.10)] disabled:opacity-70 mt-1"
          data-testid="button-sign-in"
        >
          {isLoading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : step === 'phone' ? (
            'Send OTP'
          ) : step === 'otp' ? (
            'Verify & Sign In'
          ) : (
            'Link & Sign In'
          )}
        </Button>
      )}
      {/* What is still missing, said once, on the way through.
          A guest can ship without any of it, so nothing here blocks: the
          dialog names the gaps, offers the screen that closes them, and its
          other button is simply the way home. */}
      <Dialog
        open={pendingOpen}
        onOpenChange={(open) => {
          setPendingOpen(open);
          // Dismissed by the overlay or Escape is still an answer. Sending
          // them home is what they asked for by continuing as a guest.
          if (!open) setLocation(redirect || '/home');
        }}
      >
        <DialogContent className="max-w-sm rounded-2xl" data-testid="dialog-guest-pending">
          <DialogHeader>
            <DialogTitle>
              {guestPending.length === 0 ? "You're all set" : 'Still to add'}
            </DialogTitle>
            <DialogDescription>
              {guestPending.length === 0
                ? 'Nothing outstanding on your profile.'
                : 'Your bookings work without these. They speed up the next one.'}
            </DialogDescription>
          </DialogHeader>

          {guestPending.length > 0 && (
            <ul className="space-y-2" data-testid="list-guest-pending">
              {guestPending.map((field) => (
                <li
                  key={field.spec.key}
                  className="flex items-start gap-3 rounded-xl border border-border p-3"
                >
                  <field.spec.icon
                    className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-foreground">
                      {field.spec.label}
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                      {field.spec.pendingHint}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${SHADOW_STATUS_META.pending.badge}`}
                  >
                    {SHADOW_STATUS_META.pending.label}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-1 space-y-2">
            {guestPending.length > 0 && (
              <Button
                onClick={() => {
                  setPendingOpen(false);
                  setLocation('/guest-profile');
                }}
                className="h-12 w-full rounded-xl text-sm font-semibold"
                data-testid="button-pending-complete"
              >
                Complete my profile
              </Button>
            )}
            <Button
              variant={guestPending.length > 0 ? 'outline' : 'default'}
              onClick={() => {
                setPendingOpen(false);
                setLocation(redirect || '/home');
              }}
              className="h-12 w-full rounded-xl text-sm font-semibold"
              data-testid="button-pending-home"
            >
              {guestPending.length > 0 ? 'Later, take me home' : 'Go to home'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AuthShell>
  );
}
