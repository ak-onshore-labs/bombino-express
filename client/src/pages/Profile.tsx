import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  User,
  Mail,
  Phone,
  LogOut,
  Phone as PhoneIcon,
  UserCircle,
  Shield,
  Calendar,
} from 'lucide-react';
import { useLocation } from 'wouter';
import { useAppStore } from '@/lib/store';
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
import { AccountSignOutDialog } from '@/components/AccountSignOutDialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { parseApiErrorMessage } from '@/lib/apiError';
import bombinoLogo from '@/assets/bombino-logo.png';
import whatsAppLogo from '@/assets/WhatsApp.svg.png';
import { SignedOutState } from '@/components/StateBlock';
import { BottomNav } from '@/components/BottomNav';
import { KycUpload } from '@/components/KycUpload';
import { KycOnFileCard } from '@/components/KycOnFileCard';
import { useKycOnFile } from '@/hooks/useKycOnFile';
import { AccountDocuments } from '@/components/AccountDocuments';
import {
  publishVerificationState,
  useVerificationState,
  type VerificationState,
} from '@/hooks/useVerificationState';
import { useQueryClient } from '@tanstack/react-query';
import type { CompanyCategory, DocSlot } from '@shared/accountSpec';

function formatMemberSince(iso: string | undefined | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export default function Profile() {
  const [, setLocation] = useLocation();
  const { isLoggedIn, user, login } = useAppStore();
  const { toast } = useToast();
  const [profile, setProfile] = useState<any>(null);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const [isUnlinking, setIsUnlinking] = useState(false);

  // Change-number flow: collect the new number, prove it by OTP, and — where
  // the account has one — confirm with the password before moving it.
  const [changeOpen, setChangeOpen] = useState(false);
  const [changeStep, setChangeStep] = useState<'phone' | 'confirm'>('phone');
  const [newPhone, setNewPhone] = useState('');
  const [changeOtp, setChangeOtp] = useState('');
  const [changePassword, setChangePassword] = useState('');
  const [changeError, setChangeError] = useState('');
  const [isChanging, setIsChanging] = useState(false);

  const [usernameOpen, setUsernameOpen] = useState(false);
  const [usernameDraft, setUsernameDraft] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [isSavingUsername, setIsSavingUsername] = useState(false);

  const { data: kycOnFile } = useKycOnFile({ enabled: isLoggedIn });

  // The document centre. The only surface that can complete a whole document
  // set — /api/kyc/upload takes one document and writes one row, which cannot
  // express a two-to-six slot matrix. Used to replace a document that expired
  // or was rejected.
  const queryClient = useQueryClient();
  const { data: verification } = useVerificationState({ enabled: isLoggedIn });
  const [, setOutstandingDocs] = useState<DocSlot[]>([]);

  useEffect(() => {
    if (!isLoggedIn) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/user/profile', { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setProfile(data);
      } catch {
        // silent fallback to Zustand
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn]);

  if (!isLoggedIn) {
    return (
      <div className="min-h-[100dvh] bg-background pb-nav" data-testid="screen-profile-login-required">
        <header className="sticky top-0 z-50 bg-white border-b border-border safe-top md:hidden">
          <div className="flex items-center h-14 px-4 max-w-md mx-auto">
            <button
              onClick={() => setLocation('/home')}
              className="p-2 -ml-2 rounded-lg hover:bg-muted transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="ml-2 font-semibold text-sm">Profile</h1>
          </div>
        </header>

        <main className="max-w-md mx-auto">
          <SignedOutState
            icon={User}
            title="Sign in to view your profile"
            description="Your details, identity document and saved addresses live here."
            redirectTo="/profile"
            testId="state-profile-signed-out"
          />
        </main>

        <BottomNav />
      </div>
    );
  }

  const displayName = profile?.full_name ?? user?.fullName ?? '';
  const displayEmail = profile?.email ?? user?.email ?? '';
  const displayPhone =
    profile != null
      ? profile.phone && String(profile.phone).trim()
        ? String(profile.phone)
        : 'Not set'
      : 'Not set';
  const displayUsername = profile?.username ?? user?.username ?? '';
  const displayRole = profile?.role ?? user?.role ?? '';
  const memberSince = profile?.created_at ? formatMemberSince(profile.created_at) : null;

  const hasLinkedPhone = Boolean(profile?.phone && String(profile.phone).trim());
  // Accounts created in this app carry a synthetic id and have no password
  // anywhere, so their number is the only way back in — the server refuses to
  // unlink those, and offering the button would just surface that refusal.
  const isLocalAccount = String(profile?.itd_customer_id ?? '').startsWith('local-');
  const canUnlinkPhone = hasLinkedPhone && !isLocalAccount;

  const handleUnlinkPhone = async () => {
    setIsUnlinking(true);
    try {
      await apiRequest('POST', '/api/user/phone/unlink', {});
      setProfile((prev: any) => (prev ? { ...prev, phone: null } : prev));
      setUnlinkOpen(false);
      toast({
        title: 'Mobile number unlinked',
        description: 'Sign in with your email and password to link a number again.',
      });
    } catch (err) {
      toast({
        title: 'Could not unlink',
        description: parseApiErrorMessage(err, 'Please try again.'),
        variant: 'destructive',
      });
    } finally {
      setIsUnlinking(false);
    }
  };

  // Set by the server from the credential column without exposing it.
  const requiresPassword = Boolean(profile?.has_password);

  const openChangeDialog = () => {
    setNewPhone('');
    setChangeOtp('');
    setChangePassword('');
    setChangeError('');
    setChangeStep('phone');
    setChangeOpen(true);
  };

  const handleSendChangeOtp = async () => {
    if (!/^\d{10}$/.test(newPhone.trim())) {
      setChangeError('Enter a valid 10-digit phone number');
      return;
    }
    if (newPhone.trim() === String(profile?.phone ?? '')) {
      setChangeError('That is already your number.');
      return;
    }
    setIsChanging(true);
    setChangeError('');
    try {
      // Verifying the NEW number, not the old one — the point is to prove the
      // customer can receive codes where sign-in is about to move.
      await apiRequest('POST', '/api/auth/otp/request', {
        phone: newPhone.trim(),
        purpose: 'auth',
      });
      setChangeStep('confirm');
      // The dialog's next step already says "Enter the code we sent to …".
    } catch (err) {
      setChangeError(parseApiErrorMessage(err, 'Could not send OTP'));
    } finally {
      setIsChanging(false);
    }
  };

  const handleConfirmChange = async () => {
    if (!/^\d{6}$/.test(changeOtp)) {
      setChangeError('Enter the 6-digit code');
      return;
    }
    if (requiresPassword && !changePassword.trim()) {
      setChangeError('Enter your password to confirm');
      return;
    }
    setIsChanging(true);
    setChangeError('');
    try {
      await apiRequest('POST', '/api/auth/otp/verify', {
        phone: newPhone.trim(),
        purpose: 'auth',
        code: changeOtp,
      });
      await apiRequest('POST', '/api/user/phone/change', {
        phone: newPhone.trim(),
        ...(requiresPassword ? { password: changePassword } : {}),
      });
      setProfile((prev: any) => (prev ? { ...prev, phone: newPhone.trim() } : prev));
      setChangeOpen(false);
      toast({
        title: 'Mobile number updated',
        description: `You now sign in with ${newPhone.trim()}.`,
      });
    } catch (err) {
      setChangeError(parseApiErrorMessage(err, 'Could not change your number'));
    } finally {
      setIsChanging(false);
    }
  };

  const openUsernameDialog = () => {
    setUsernameDraft(displayUsername);
    setUsernameError('');
    setUsernameOpen(true);
  };

  const handleSaveUsername = async () => {
    const next = usernameDraft.trim();
    if (next.length < 2) {
      setUsernameError('Username must be at least 2 characters');
      return;
    }
    if (next === displayUsername) {
      setUsernameOpen(false);
      return;
    }
    setIsSavingUsername(true);
    setUsernameError('');
    try {
      await apiRequest('PATCH', '/api/user/profile', { username: next });
      setProfile((prev: any) => (prev ? { ...prev, username: next } : prev));
      // The store feeds the header and anything else reading the session user,
      // so it has to move with the profile response.
      if (user) login({ ...user, username: next });
      setUsernameOpen(false);
      toast({ title: 'Username updated' });
    } catch (err) {
      setUsernameError(parseApiErrorMessage(err, 'Could not save your username'));
    } finally {
      setIsSavingUsername(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-background pb-nav" data-testid="screen-profile">
      <header className="sticky top-0 z-50 bg-white border-b border-border safe-top md:hidden">
        <div className="flex items-center h-14 px-4 max-w-md mx-auto">
          <button
            onClick={() => window.history.back()}
            className="p-2 -ml-2 rounded-lg hover:bg-muted transition-colors"
            data-testid="button-back-profile"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="ml-2 font-semibold text-sm">My Profile</h1>
        </div>
      </header>

      <main className="max-w-5xl mx-auto w-full px-4 md:px-8 py-6">
        <div className="md:grid md:grid-cols-12 gap-8 items-start">

          {/* LEFT — avatar + identity */}
          <div className="md:col-span-5 flex flex-col items-center text-center md:text-left md:items-start mb-6 md:mb-0 md:sticky md:top-6">
            <div className="w-20 h-20 bg-primary/8 rounded-2xl flex items-center justify-center mb-4 shadow-[0_2px_12px_oklch(17%_0.048_248_/_0.06)]">
              <User className="w-10 h-10 text-foreground" />
            </div>
            <h2 className="text-xl font-bold text-foreground leading-tight">
              {displayName || 'User'}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">{displayEmail}</p>
            {memberSince && (
              <span className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-medium text-secondary bg-[#2F4468]/8 px-3 py-1 rounded-full">
                <Calendar className="w-3 h-3" />
                Member since {memberSince}
              </span>
            )}
            <div className="mt-8 hidden md:block">
              <img src={bombinoLogo} alt="Bombino" className="h-6 w-auto mb-1 opacity-30" />
              <p className="text-[10px] text-muted-foreground">Bombino Express v1.0</p>
            </div>
          </div>

          {/* RIGHT — details + support + sign out */}
          <div className="md:col-span-7 space-y-5">
            {/* Details card */}
            <div className="bg-white rounded-2xl border border-border divide-y divide-[#E2E8F0] shadow-[0_2px_12px_oklch(17%_0.048_248_/_0.06),_0_1px_3px_oklch(17%_0.048_248_/_0.04)]">
              <div className="flex items-center gap-3 p-4">
                <div className="w-9 h-9 bg-muted rounded-xl flex items-center justify-center shrink-0">
                  <Mail className="w-4 h-4 text-secondary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Email</p>
                  <p className="font-medium text-sm truncate text-foreground">{displayEmail}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-4">
                <div className="w-9 h-9 bg-muted rounded-xl flex items-center justify-center shrink-0">
                  <Phone className="w-4 h-4 text-secondary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Phone</p>
                  <p className="font-medium text-sm truncate text-foreground">{displayPhone}</p>
                  {hasLinkedPhone && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      You sign in with this number.
                    </p>
                  )}
                </div>
                {hasLinkedPhone && (
                  <div className="shrink-0 flex items-center gap-1">
                    <button
                      type="button"
                      onClick={openChangeDialog}
                      className="text-xs font-semibold text-secondary hover:underline px-2 py-1 rounded-lg"
                      data-testid="button-change-phone"
                    >
                      Change
                    </button>
                    {/* Unlink only where it can be undone. An account created
                        here has no password anywhere, so removing its number
                        would shut it permanently — those get Change instead. */}
                    {canUnlinkPhone && (
                      <button
                        type="button"
                        onClick={() => setUnlinkOpen(true)}
                        className="text-xs font-semibold text-red-600 hover:text-red-700 hover:underline px-2 py-1 rounded-lg"
                        data-testid="button-unlink-phone"
                      >
                        Unlink
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-3 p-4">
                <div className="w-9 h-9 bg-muted rounded-xl flex items-center justify-center shrink-0">
                  <UserCircle className="w-4 h-4 text-secondary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Username</p>
                  <p className="font-medium text-sm truncate text-foreground">{displayUsername}</p>
                </div>
                <button
                  type="button"
                  onClick={openUsernameDialog}
                  className="shrink-0 text-xs font-semibold text-secondary hover:underline px-2 py-1 rounded-lg"
                  data-testid="button-edit-username"
                >
                  Edit
                </button>
              </div>
              <div className="flex items-center gap-3 p-4">
                <div className="w-9 h-9 bg-muted rounded-xl flex items-center justify-center shrink-0">
                  <Shield className="w-4 h-4 text-secondary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Role</p>
                  <p className="font-medium text-sm truncate text-foreground">{displayRole}</p>
                </div>
              </div>
            </div>

            {/* Account documents — the completion path for a skipped signup.
                Rendered only while something is outstanding: a verified account
                has no business being shown an upload form it does not need. */}
            {verification && !verification.verified && (
              <div
                id="documents"
                className="bg-white rounded-2xl border border-amber-200 p-4 shadow-[0_2px_12px_oklch(17%_0.048_248_/_0.06),_0_1px_3px_oklch(17%_0.048_248_/_0.04)] space-y-3"
                data-testid="profile-documents-section"
              >
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    Finish verifying your account
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Indian customs requires these before we can dispatch a parcel.
                  </p>
                </div>

                <AccountDocuments
                  accountType={verification.account_type}
                  category={(verification.company_category as CompanyCategory | null) ?? null}
                  endpoint="account"
                  onMissingChange={setOutstandingDocs}
                  onUploaded={(body) => {
                    // The endpoint returns the recomputed state, so the banner
                    // clears on this round trip instead of after a refetch.
                    const state = (body as { verification?: VerificationState })?.verification;
                    if (state) publishVerificationState(queryClient, state);
                  }}
                />

                <p className="text-xs text-muted-foreground">
                  Would rather hand these over in person?{' '}
                  <a
                    href="https://api.whatsapp.com/send?phone=917045999553"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-primary underline underline-offset-2"
                    data-testid="link-documents-contact-team"
                  >
                    Message the Bombino team
                  </a>{' '}
                  and we will take them from there.
                </p>
              </div>
            )}

            {/* Identity document (KYC)
                Replaces the document already on file. An account that has none
                has nothing to replace — its path is the checklist above, whose
                Aadhaar is mirrored into kyc_documents on upload — so the card
                simply is not drawn. Company accounts never hold one either. */}
            {kycOnFile && (
              <div
                id="kyc"
                className="bg-white rounded-2xl border border-border p-4 shadow-[0_2px_12px_oklch(17%_0.048_248_/_0.06),_0_1px_3px_oklch(17%_0.048_248_/_0.04)] space-y-3"
                data-testid="profile-kyc-section"
              >
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Identity document</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    On file and sent with every shipment for Indian customs. Replace it
                    below only if your details have changed.
                  </p>
                </div>
                <KycOnFileCard kyc={kycOnFile} />
                <KycUpload />
              </div>
            )}

            {/* Support card */}
            <div className="bg-white rounded-2xl border border-border divide-y divide-[#E2E8F0] shadow-[0_2px_12px_oklch(17%_0.048_248_/_0.06),_0_1px_3px_oklch(17%_0.048_248_/_0.04)]">
              <a
                href="https://api.whatsapp.com/send?phone=917045999553"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 p-4 hover:bg-background transition-colors rounded-t-2xl"
                data-testid="link-profile-whatsapp"
              >
                <div className="w-9 h-9 bg-green-50 rounded-xl flex items-center justify-center shrink-0">
                  <img src={whatsAppLogo} alt="WhatsApp" className="w-4 h-4 object-contain" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-sm text-foreground">WhatsApp Support</p>
                  <p className="text-xs text-muted-foreground">Chat with us instantly</p>
                </div>
              </a>
              <a
                href="tel:+912266400000"
                className="flex items-center gap-3 p-4 hover:bg-background transition-colors rounded-b-2xl"
                data-testid="link-profile-call"
              >
                <div className="w-9 h-9 bg-[#2F4468]/8 rounded-xl flex items-center justify-center shrink-0">
                  <PhoneIcon className="w-4 h-4 text-secondary" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-sm text-foreground">Call Support</p>
                  <p className="text-xs text-muted-foreground">+91 22 6640 0000</p>
                </div>
              </a>
            </div>

            {/* Sign out */}
            <Button
              onClick={() => setSignOutOpen(true)}
              variant="outline"
              className="w-full h-10 text-red-600 border-red-200 hover:bg-red-50 text-sm rounded-xl"
              data-testid="button-profile-logout"
            >
              <LogOut className="w-4 h-4 mr-2" />
              Sign Out
            </Button>

            {/* Footer (mobile only) */}
            <div className="mt-4 text-center md:hidden">
              <img src={bombinoLogo} alt="Bombino" className="h-5 w-auto mx-auto mb-1 opacity-30" />
              <p className="text-[10px] text-muted-foreground">Bombino Express v1.0</p>
            </div>
          </div>
        </div>
      </main>

      <Dialog open={usernameOpen} onOpenChange={setUsernameOpen}>
        <DialogContent data-testid="dialog-edit-username">
          <DialogHeader>
            <DialogTitle>Edit username</DialogTitle>
            <DialogDescription>
              This is a display name only — you still sign in with your mobile number.
            </DialogDescription>
          </DialogHeader>

          <div>
            <Label className="text-sm font-medium">Username</Label>
            <Input
              value={usernameDraft}
              onChange={(e) => {
                setUsernameDraft(e.target.value.slice(0, 50));
                setUsernameError('');
              }}
              onKeyDown={(e) => e.key === 'Enter' && void handleSaveUsername()}
              placeholder="Your username"
              className="mt-2 h-11 bg-muted border border-border rounded-xl"
              maxLength={50}
              data-testid="input-username"
            />
            <p className="text-[11px] text-muted-foreground mt-1.5">
              2–50 characters.
            </p>
          </div>

          {usernameError && (
            <p className="text-sm text-red-500" data-testid="text-username-error">
              {usernameError}
            </p>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setUsernameOpen(false)}
              disabled={isSavingUsername}
              className="rounded-xl"
              data-testid="button-username-cancel"
            >
              Cancel
            </Button>
            <Button
              onClick={() => void handleSaveUsername()}
              disabled={isSavingUsername}
              className="bg-accent hover:bg-accent/90 text-accent-foreground font-semibold rounded-xl shadow-[var(--shadow-hover)]"
              data-testid="button-username-save"
            >
              {isSavingUsername ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={changeOpen} onOpenChange={setChangeOpen}>
        <DialogContent data-testid="dialog-change-phone">
          <DialogHeader>
            <DialogTitle>Change mobile number</DialogTitle>
            <DialogDescription>
              {changeStep === 'phone'
                ? 'Enter the number you want to sign in with. We’ll send it a code to confirm it’s yours.'
                : `Enter the code we sent to ${newPhone}${
                    requiresPassword ? ', and your password to confirm the change.' : '.'
                  }`}
            </DialogDescription>
          </DialogHeader>

          {changeStep === 'phone' ? (
            <div>
              <Label className="text-sm font-medium">New mobile number</Label>
              <Input
                type="tel"
                inputMode="numeric"
                value={newPhone}
                onChange={(e) => {
                  setNewPhone(e.target.value.replace(/\D/g, '').slice(0, 10));
                  setChangeError('');
                }}
                onKeyDown={(e) => e.key === 'Enter' && void handleSendChangeOtp()}
                placeholder="10-digit mobile number"
                className="mt-2 h-11 bg-muted border border-border rounded-xl"
                autoComplete="tel"
                data-testid="input-new-phone"
              />
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <Label className="text-sm font-medium">Verification code</Label>
                <div className="mt-2 flex justify-center">
                  <InputOTP
                    maxLength={6}
                    value={changeOtp}
                    onChange={(v) => {
                      setChangeOtp(v);
                      setChangeError('');
                    }}
                  >
                    <InputOTPGroup>
                      {[0, 1, 2, 3, 4, 5].map((i) => (
                        <InputOTPSlot
                          key={i}
                          index={i}
                          className="h-11 w-10 text-base"
                          data-testid={`input-change-otp-slot-${i}`}
                        />
                      ))}
                    </InputOTPGroup>
                  </InputOTP>
                </div>
              </div>

              {requiresPassword && (
                <div>
                  <Label className="text-sm font-medium">Your password</Label>
                  <Input
                    type="password"
                    value={changePassword}
                    onChange={(e) => {
                      setChangePassword(e.target.value);
                      setChangeError('');
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && void handleConfirmChange()}
                    placeholder="Enter your password"
                    className="mt-2 h-11 bg-muted border border-border rounded-xl"
                    autoComplete="current-password"
                    data-testid="input-change-password"
                  />
                </div>
              )}
            </div>
          )}

          {changeError && (
            <p className="text-sm text-red-500" data-testid="text-change-phone-error">
              {changeError}
            </p>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setChangeOpen(false)}
              disabled={isChanging}
              className="rounded-xl"
              data-testid="button-change-cancel"
            >
              Cancel
            </Button>
            <Button
              onClick={() =>
                changeStep === 'phone' ? void handleSendChangeOtp() : void handleConfirmChange()
              }
              disabled={isChanging}
              className="bg-accent hover:bg-accent/90 text-accent-foreground font-semibold rounded-xl shadow-[var(--shadow-hover)]"
              data-testid="button-change-submit"
            >
              {isChanging
                ? 'Working…'
                : changeStep === 'phone'
                  ? 'Send code'
                  : 'Change number'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AccountSignOutDialog open={signOutOpen} onOpenChange={setSignOutOpen} />

      <AlertDialog open={unlinkOpen} onOpenChange={setUnlinkOpen}>
        <AlertDialogContent data-testid="dialog-unlink-phone">
          <AlertDialogHeader>
            <AlertDialogTitle>Unlink {displayPhone}?</AlertDialogTitle>
            <AlertDialogDescription>
              You will no longer be able to sign in with this number. To get back in, choose
              &ldquo;I have an account&rdquo; on the sign-in screen and enter your email and
              password — you can link a number again from there.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isUnlinking} data-testid="button-unlink-cancel">
              Keep it
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // Confirming runs a request; letting the dialog close on click
                // would drop the pending/error state before it can be shown.
                e.preventDefault();
                void handleUnlinkPhone();
              }}
              disabled={isUnlinking}
              className="bg-red-600 hover:bg-red-700 text-white"
              data-testid="button-unlink-confirm"
            >
              {isUnlinking ? 'Unlinking…' : 'Unlink number'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <BottomNav />
    </div>
  );
}

