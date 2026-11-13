import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  AtSign,
  BadgeCheck,
  Clock,
  FileWarning,
  Mail,
  Phone,
  User,
  UserCircle,
} from 'lucide-react';
import { useLocation } from 'wouter';
import { useRefreshUserProfile, useUserProfile } from '@/hooks/useUserProfile';
import { isAccountPhone } from '@shared/contact';
import { WHATSAPP_ALT_QUERY_KEY, WhatsappAltCard } from '@/components/WhatsappAltCard';
import { AccountPhoneInput } from '@/components/AccountPhoneInput';
import { formatGuestPhone } from '@/lib/shadowProfile';
import { useAppStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
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
import { SignedOutState } from '@/components/StateBlock';
import { BottomNav } from '@/components/BottomNav';
import { IdentityDocumentSection } from '@/components/IdentityDocumentSection';
import { useKycOnFile } from '@/hooks/useKycOnFile';
import { useSupportContacts } from '@/hooks/useSupportContacts';
import { AccountDocuments } from '@/components/AccountDocuments';
import { NudgePrefs } from '@/components/bia/NudgePrefs';
import {
  publishVerificationState,
  useVerificationState,
  type VerificationState,
} from '@/hooks/useVerificationState';
import { useQueryClient } from '@tanstack/react-query';
import type { CompanyCategory, DocSlot } from '@shared/accountSpec';
import { AskBiaTopButton } from '@/components/bia/AskBiaTopButton';
import {
  ProfileFooter,
  ProfileHero,
  ProfileRow,
  ProfileRows,
  ProfileSection,
  ProfileSupportSection,
  RowAction,
} from '@/components/profile/ProfileBlocks';

function formatMemberSince(iso: string | undefined | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export default function Profile() {
  const [, setLocation] = useLocation();
  const { isLoggedIn, user, login } = useAppStore();
  const { toast } = useToast();
  const { waHref, telHref, officeLabel } = useSupportContacts();
  const { data: profile } = useUserProfile(isLoggedIn);
  const refreshProfile = useRefreshUserProfile();
  const [signOutOpen, setSignOutOpen] = useState(false);

  // Change-number flow: collect the new number, prove it by OTP, and — where
  // the account has one — confirm with the password before moving it.
  const [changeOpen, setChangeOpen] = useState(false);
  const [changeStep, setChangeStep] = useState<'phone' | 'confirm'>('phone');
  const [newPhone, setNewPhone] = useState('');
  const [changeOtp, setChangeOtp] = useState('');
  const [changePassword, setChangePassword] = useState('');
  const [changeError, setChangeError] = useState('');
  const [isChanging, setIsChanging] = useState(false);

  // Verify-WhatsApp flow: for a number Meta says is not on WhatsApp. The code
  // goes out on WhatsApp only, so typing it back proves WhatsApp is there now.
  const [waOpen, setWaOpen] = useState(false);
  const [waStep, setWaStep] = useState<'send' | 'confirm'>('send');
  const [waOtp, setWaOtp] = useState('');
  const [waError, setWaError] = useState('');
  const [isWaBusy, setIsWaBusy] = useState(false);

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

  if (!isLoggedIn) {
    return (
      <div className="min-h-[100dvh] bg-background pb-nav safe-x" data-testid="screen-profile-login-required">
        <header className="sticky top-0 z-50 bg-white border-b border-border safe-top md:hidden">
          <div className="flex items-center h-14 px-4 max-w-md mx-auto">
            <button
              onClick={() => setLocation('/home')}
              className="p-2 -ml-2 rounded-lg hover:bg-muted transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="ml-2 font-semibold text-sm">Profile</h1>
            <AskBiaTopButton withLabel className="ml-auto" />
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
  // "customer" -> "Customer". Staff never land here (their surface is ops).
  const roleLabel = displayRole
    ? displayRole.charAt(0).toUpperCase() + displayRole.slice(1).replace(/_/g, ' ')
    : '';

  const hasLinkedPhone = Boolean(profile?.phone && String(profile.phone).trim());

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
    if (!isAccountPhone(newPhone.trim())) {
      setChangeError('Enter a valid mobile number');
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
      void refreshProfile();
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


  const openWhatsappDialog = () => {
    setWaOtp('');
    setWaError('');
    setWaStep('send');
    setWaOpen(true);
  };

  const handleSendWhatsappOtp = async () => {
    setIsWaBusy(true);
    setWaError('');
    try {
      await apiRequest('POST', '/api/user/whatsapp/verify/request', {});
      setWaStep('confirm');
    } catch (err) {
      setWaError(parseApiErrorMessage(err, 'Could not send the code'));
    } finally {
      setIsWaBusy(false);
    }
  };

  const handleConfirmWhatsapp = async () => {
    if (!/^\d{6}$/.test(waOtp)) {
      setWaError('Enter the 6-digit code');
      return;
    }
    setIsWaBusy(true);
    setWaError('');
    try {
      await apiRequest('POST', '/api/user/whatsapp/verify/confirm', { code: waOtp });
      void refreshProfile();
      void queryClient.invalidateQueries({ queryKey: WHATSAPP_ALT_QUERY_KEY });
      setWaOpen(false);
      toast({
        title: 'WhatsApp verified',
        description: 'We’ll send your order updates on WhatsApp again.',
      });
    } catch (err) {
      setWaError(parseApiErrorMessage(err, 'Could not verify the code'));
    } finally {
      setIsWaBusy(false);
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
      void refreshProfile();
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
    <div className="min-h-[100dvh] bg-background pb-nav safe-x" data-testid="screen-profile">
      <header className="sticky top-0 z-50 bg-white border-b border-border safe-top md:hidden">
        <div className="flex items-center h-14 px-4 max-w-md mx-auto">
          <button
            onClick={() => window.history.back()}
            aria-label="Back"
            className="p-2 -ml-2 rounded-lg hover:bg-muted transition-colors"
            data-testid="button-back-profile"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="ml-2 font-semibold text-sm">My Profile</h1>
          <AskBiaTopButton withLabel className="ml-auto" />
        </div>
      </header>

      <main className="max-w-md md:max-w-5xl mx-auto w-full px-4 md:px-8 py-5 md:py-6">
        <div className="md:grid md:grid-cols-12 md:gap-6 md:items-start">
          {/* LEFT — who you are. Sticky on desktop so it stays beside the
              section being edited. */}
          <div className="md:col-span-5 md:sticky md:top-6 space-y-4 mb-4 md:mb-0">
            <ProfileHero
              name={displayName || 'Your account'}
              lines={[
                ...(hasLinkedPhone
                  ? [{ icon: Phone, text: formatGuestPhone(displayPhone), verified: true }]
                  : []),
                ...(displayEmail ? [{ icon: Mail, text: displayEmail }] : []),
              ]}
              stats={[
                { label: 'Account', value: roleLabel || 'Customer' },
                ...(memberSince ? [{ label: 'Member since', value: memberSince }] : []),
                ...(verification
                  ? [
                      verification.verified
                        ? { label: 'Status', value: 'Verified', icon: BadgeCheck, tone: 'good' as const }
                        : { label: 'Status', value: 'Pending', icon: Clock, tone: 'pending' as const },
                    ]
                  : []),
              ]}
            />
            <div className="hidden md:block">
              <ProfileSupportSection waHref={waHref} telHref={telHref} officeLabel={officeLabel} />
            </div>
          </div>

          {/* RIGHT — what you can look at and change. */}
          <div className="md:col-span-7 space-y-4">
            {/* Account documents — the completion path for a skipped signup.
                Rendered only while something is outstanding: a verified account
                has no business being shown an upload form it does not need.
                First, because it is the one thing here that holds parcels. */}
            {verification && !verification.verified && (
              <ProfileSection
                id="documents"
                icon={FileWarning}
                tone="attention"
                title="Finish verifying your account"
                description="Indian customs needs these before we can dispatch a parcel."
                bodyClassName="space-y-3 px-4 pb-4"
                testId="profile-documents-section"
              >
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
                    href={waHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-primary underline underline-offset-2"
                    data-testid="link-documents-contact-team"
                  >
                    Message the Bombino team
                  </a>{' '}
                  and we will take them from there.
                </p>
              </ProfileSection>
            )}

            {/* Account details */}
            <ProfileSection
              icon={UserCircle}
              title="Account details"
              description="How you sign in and how we reach you."
              testId="profile-details-section"
            >
              <ProfileRows>
                <ProfileRow icon={Mail} label="Email" value={displayEmail || 'Not set'} />
                <ProfileRow
                  id="phone"
                  icon={Phone}
                  label="Mobile number"
                  value={displayPhone}
                  note={hasLinkedPhone ? 'You sign in with this number.' : undefined}
                  actions={
                    hasLinkedPhone ? (
                      <>
                        {/* No Unlink: a number only leaves an account by being
                            replaced with a new one. */}
                        <RowAction onClick={openChangeDialog} testId="button-change-phone">
                          Change
                        </RowAction>
                      </>
                    ) : undefined
                  }
                >
                  {/* Every number: where WhatsApp updates go, a second number,
                      and the "has WhatsApp now" re-check when Meta says it isn't. */}
                  {hasLinkedPhone && <WhatsappAltCard onVerifyOwn={openWhatsappDialog} />}
                </ProfileRow>
                <ProfileRow
                  icon={AtSign}
                  label="Username"
                  value={displayUsername || 'Not set'}
                  actions={
                    <RowAction onClick={openUsernameDialog} testId="button-edit-username">
                      Edit
                    </RowAction>
                  }
                />
              </ProfileRows>
            </ProfileSection>

            {/* Identity document (KYC)
                Replaces the document already on file. An account that has none
                has nothing to replace — its path is the checklist above, whose
                Aadhaar is mirrored into kyc_documents on upload — so the card
                simply is not drawn. Company accounts never hold one either. */}
            {kycOnFile && <IdentityDocumentSection kyc={kycOnFile} />}

            {/* BIA's reminders, each one switchable (BIA 3.0, 5.1). */}
            <NudgePrefs />

            <div className="md:hidden">
              <ProfileSupportSection waHref={waHref} telHref={telHref} officeLabel={officeLabel} />
            </div>

            <ProfileFooter
              signOutLabel="Sign out"
              onSignOut={() => setSignOutOpen(true)}
              testId="button-profile-logout"
            />
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
              className="bg-accent hover:bg-accent/90 text-accent-foreground font-semibold rounded-xl shadow-card-hover"
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
                : `Enter the code we sent to ${formatGuestPhone(newPhone)}${
                    requiresPassword ? ', and your password to confirm the change.' : '.'
                  }`}
            </DialogDescription>
          </DialogHeader>

          {changeStep === 'phone' ? (
            <div>
              <Label className="text-sm font-medium">New mobile number</Label>
              <div className="mt-2">
                <AccountPhoneInput
                  value={newPhone}
                  onChange={(next) => {
                    setNewPhone(next);
                    setChangeError('');
                  }}
                  onEnter={() => void handleSendChangeOtp()}
                  className="h-11 bg-muted border border-border rounded-xl"
                  data-testid="input-new-phone"
                />
              </div>
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
              className="bg-accent hover:bg-accent/90 text-accent-foreground font-semibold rounded-xl shadow-card-hover"
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

      <Dialog open={waOpen} onOpenChange={setWaOpen}>
        <DialogContent data-testid="dialog-verify-whatsapp">
          <DialogHeader>
            <DialogTitle>Verify WhatsApp</DialogTitle>
            <DialogDescription>
              {waStep === 'send'
                ? `We’ll send a code to ${displayPhone} on WhatsApp. Make sure WhatsApp is set up on this number first.`
                : `Enter the code we sent to ${displayPhone} on WhatsApp.`}
            </DialogDescription>
          </DialogHeader>

          {waStep === 'confirm' && (
            <div className="flex justify-center">
              <InputOTP
                maxLength={6}
                value={waOtp}
                onChange={(v) => {
                  setWaOtp(v);
                  setWaError('');
                }}
              >
                <InputOTPGroup>
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <InputOTPSlot
                      key={i}
                      index={i}
                      className="h-11 w-10 text-base"
                      data-testid={`input-wa-otp-slot-${i}`}
                    />
                  ))}
                </InputOTPGroup>
              </InputOTP>
            </div>
          )}

          {waError && (
            <p className="text-sm text-red-500" data-testid="text-verify-whatsapp-error">
              {waError}
            </p>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setWaOpen(false)}
              disabled={isWaBusy}
              className="rounded-xl"
            >
              Cancel
            </Button>
            <Button
              onClick={() =>
                waStep === 'send' ? void handleSendWhatsappOtp() : void handleConfirmWhatsapp()
              }
              disabled={isWaBusy}
              className="bg-accent hover:bg-accent/90 text-accent-foreground font-semibold rounded-xl shadow-card-hover"
              data-testid="button-verify-whatsapp-submit"
            >
              {isWaBusy ? 'Working…' : waStep === 'send' ? 'Send code' : 'Verify'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AccountSignOutDialog open={signOutOpen} onOpenChange={setSignOutOpen} />

      <BottomNav />
    </div>
  );
}

