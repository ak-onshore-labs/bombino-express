import { useState, useEffect, useRef } from 'react';
import { User, Mail, Phone, Building2, Loader2, ShieldCheck, UserRound, MapPin } from 'lucide-react';
import { useLocation, Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AccountDocuments } from '@/components/AccountDocuments';
import { ContractSignature } from '@/components/ContractSignature';
import { AuthShell } from '@/components/auth/AuthShell';
import { useAppStore, type AuthUser } from '@/lib/store';
import { apiRequest } from '@/lib/queryClient';
import { parseApiErrorCode, parseApiErrorMessage } from '@/lib/apiError';
import { usePincodeLookup } from '@/hooks/usePincodeLookup';
import { validateGstin } from '@shared/gstin';
import { INDIA_HUBS } from '@shared/hubs';
import { SIGNATURE_ERROR, isValidSignature } from '@shared/contract';
import {
  COMPANY_CATEGORIES,
  COMPANY_CATEGORY_SPECS,
  DOC_SLOT_SPECS,
  EXTRA_FIELD_SPECS,
  requiredExtraFields,
  type CompanyCategory,
  type DocSlot,
  type ExtraField,
} from '@shared/accountSpec';
import { cn } from '@/lib/utils';

const RESEND_COOLDOWN_SECONDS = 30;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type AccountType = 'personal' | 'company';
/** Order here is the visual order, which the arrow-key handler relies on. */
const ACCOUNT_TYPES = ['personal', 'company'] as const satisfies readonly AccountType[];

/**
 * Documents are compulsory *before* the account opens (accounts dept, 14 Aug
 * 2026), so `documents` sits ahead of creation rather than after it. Uploads
 * are staged server-side against the session and claimed when the account is
 * written — see POST /api/signup/documents.
 *
 * The numbers those documents carry are collected in the same step, on the
 * same card as the document itself. They used to have a step of their own
 * ahead of this one, which meant a customer typed an Aadhaar, moved on, and
 * only discovered a screen later that the card they had did not match it.
 * Within a card the order still holds — the number is recorded first, so the
 * upload has something fixed to be judged against. See AccountDocuments and
 * server/cashfreeIdentity.ts.
 */
type Step = 'details' | 'otp' | 'documents' | 'preview';

const TOTAL_STEPS = 4;

export default function Signup() {
  const [, setLocation] = useLocation();
  const { login } = useAppStore();

  const [accountType, setAccountType] = useState<AccountType>('personal');
  const [step, setStep] = useState<Step>('details');
  const [isLoading, setIsLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Personal
  const [fullName, setFullName] = useState('');

  // Company
  const [category, setCategory] = useState<CompanyCategory>('corporate');
  const [companyName, setCompanyName] = useState('');
  const [gstin, setGstin] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [extras, setExtras] = useState<Record<ExtraField, string>>({
    lut_no: '',
    iec_branch_code: '',
    bank_account_no: '',
    bank_ad_code: '',
  });
  const [address, setAddress] = useState('');
  const [pincode, setPincode] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [hubId, setHubId] = useState('');
  const { hint: pincodeHint, lookup: lookupPincode } = usePincodeLookup();

  // Both paths
  const [email, setEmail] = useState('');
  const [missingDocs, setMissingDocs] = useState<DocSlot[]>([]);
  const [flaggedDocs, setFlaggedDocs] = useState<readonly DocSlot[]>([]);

  // The contract is signed by typing, at the last step. `contractSignedName`
  // is seeded from the name already on the form — the customer can correct it,
  // since the signatory and the day-to-day contact are not always the same
  // person on a company account.
  const [contractAccepted, setContractAccepted] = useState(false);
  const [contractSignedName, setContractSignedName] = useState('');
  const [contractError, setContractError] = useState('');

  // Shared
  const searchParams = new URLSearchParams(window.location.search);
  // /login verifies the number before sending anyone here, so the OTP round
  // trip is already spent. Re-sending a second code to the same phone would
  // burn the hourly ceiling and read as a bug to the customer.
  const preVerified = searchParams.get('verified') === '1';
  const [phone, setPhone] = useState(searchParams.get('phone') ?? '');
  const [otp, setOtp] = useState('');

  const redirect = searchParams.get('redirect');
  // One purpose for the whole entry flow — /login issues the code without yet
  // knowing whether it ends in a sign-in, a link, or this screen.
  const purpose = 'auth';

  const categorySpec = COMPANY_CATEGORY_SPECS[category];
  const activeExtras = accountType === 'company' ? requiredExtraFields(category) : [];
  /** The name this account is for: the individual's on a personal account,
   *  the company's on a corporate one. Only the GSTIN check reads it — the
   *  server refuses to open a company account under a name the GSTIN was not
   *  verified against, so the two must be the same string. Nothing reads it
   *  on a personal account, since neither Aadhaar nor PAN is checked. */
  const accountName = accountType === 'personal' ? fullName.trim() : companyName.trim();

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  /**
   * Make each step a history entry, so the browser's back button walks the
   * flow instead of leaving it.
   *
   * The four steps all live at /signup, so without this the only entry in
   * history is the page the customer arrived from — and back from *any* step
   * dropped them out of signup entirely, usually onto /login. The in-app
   * arrow always moved a step at a time; the browser's did not, and on a
   * phone the browser's is the one people reach for.
   *
   * `poppingBack` is what keeps the two directions apart. Without it, a
   * popstate sets the step, the effect below sees the step change and pushes
   * a fresh entry, and the customer can never actually go back.
   */
  const poppingBack = useRef(false);
  const historySeeded = useRef(false);

  useEffect(() => {
    const onPop = (event: PopStateEvent): void => {
      const state = event.state as { signupStep?: Step } | null;
      // Only entries this page wrote. Anything else is a real navigation out
      // of signup — let wouter handle it rather than trapping them here.
      if (!state?.signupStep) return;
      poppingBack.current = true;
      setStep(state.signupStep);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    if (poppingBack.current) {
      poppingBack.current = false;
      return;
    }
    // The first step replaces the entry the customer arrived on rather than
    // adding one, so a single back from the first step leaves signup instead
    // of appearing to do nothing.
    if (!historySeeded.current) {
      historySeeded.current = true;
      window.history.replaceState({ signupStep: step }, '');
      return;
    }
    window.history.pushState({ signupStep: step }, '');
  }, [step]);

  /** Left/Right (and Home/End) move between tabs, per the WAI-ARIA tabs
   *  pattern. Selection follows focus, which is correct here — switching is
   *  cheap and reversible, and it saves a second keypress. */
  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>): void => {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    e.preventDefault();

    const current = ACCOUNT_TYPES.indexOf(accountType);
    const next =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? ACCOUNT_TYPES.length - 1
          : e.key === 'ArrowLeft'
            ? (current - 1 + ACCOUNT_TYPES.length) % ACCOUNT_TYPES.length
            : (current + 1) % ACCOUNT_TYPES.length;

    switchAccountType(ACCOUNT_TYPES[next]);
    const tabs = e.currentTarget.parentElement?.querySelectorAll('[role="tab"]');
    (tabs?.[next] as HTMLButtonElement | undefined)?.focus();
  };

  const switchAccountType = (next: AccountType): void => {
    setAccountType(next);
    setStep('details');
    setErrors({});
    setOtp('');
    setCooldown(0);
    setFlaggedDocs([]);
    // A tick made against one account shape does not carry to the other —
    // the documents and the signatory both differ.
    setContractAccepted(false);
    setContractSignedName('');
    setContractError('');
  };

  const requestOtp = async (): Promise<void> => {
    setIsLoading(true);
    try {
      await apiRequest('POST', '/api/auth/otp/request', { phone, purpose });
      setStep('otp');
      setOtp('');
      setCooldown(RESEND_COOLDOWN_SECONDS);
      // Redundant with the OTP step subtitle; see Login.tsx.
    } catch (err) {
      setErrors({ form: parseApiErrorMessage(err, 'Could not send OTP') });
    } finally {
      setIsLoading(false);
    }
  };

  const validateDetails = (): boolean => {
    const nextErrors: Record<string, string> = {};
    if (!/^\d{10}$/.test(phone.trim())) nextErrors.phone = 'Enter a valid 10-digit phone number';
    if (!EMAIL_PATTERN.test(email.trim())) nextErrors.email = 'Enter a valid email';

    if (accountType === 'personal') {
      if (!fullName.trim()) nextErrors.fullName = 'Full name is required';
    } else {
      if (!companyName.trim()) nextErrors.companyName = 'Company name is required';
      if (!contactPerson.trim()) nextErrors.contactPerson = 'Contact person is required';
      const gstinCheck = validateGstin(gstin);
      if (!gstinCheck.valid) nextErrors.gstin = gstinCheck.message ?? 'Invalid GST number';
      if (!address.trim()) nextErrors.address = 'Address is required';
      else if (address.trim().length > 200) nextErrors.address = 'Address must be 200 characters or less';
      if (!/^\d{6}$/.test(pincode.trim())) nextErrors.pincode = 'Enter a 6-digit pincode';
      if (!city.trim()) nextErrors.city = 'City is required';
      else if (city.trim().length > 80) nextErrors.city = 'City must be 80 characters or less';
      if (!state.trim()) nextErrors.state = 'State is required';
      else if (state.trim().length > 80) nextErrors.state = 'State must be 80 characters or less';
      if (!hubId) nextErrors.hubId = 'Select a hub';
      for (const field of activeExtras) {
        const spec = EXTRA_FIELD_SPECS[field];
        if (!spec.pattern.test(extras[field].trim())) nextErrors[field] = spec.error;
      }
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmitDetails = (): void => {
    if (!validateDetails()) return;
    // Already verified upstream at /login — go straight to the documents.
    if (preVerified) {
      setStep('documents');
      return;
    }
    void requestOtp();
  };

  const handleResendOtp = (): void => {
    if (cooldown > 0) return;
    void requestOtp();
  };

  const handleVerifyOtp = async (): Promise<void> => {
    if (!/^\d{6}$/.test(otp)) {
      setErrors({ otp: 'Enter the 6-digit code' });
      return;
    }
    setIsLoading(true);
    setErrors({});
    try {
      await apiRequest('POST', '/api/auth/otp/verify', { phone, purpose, code: otp });
      setStep('documents');
    } catch (err) {
      setErrors({ otp: parseApiErrorMessage(err, 'Incorrect code') });
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * The OTP that authorised this signup ran out.
   *
   * Nothing on this page can succeed once that happens — every signup
   * endpoint is authorised by a recent verification of the phone rather than
   * by a session, because the account does not exist yet — so leaving the
   * customer here means every button failing with the same message.
   *
   * Sent to /login rather than back to the details step. The details step
   * cannot fix this: when the customer arrived from /login the form is in its
   * `preVerified` state, where the primary action reads "Continue" and jumps
   * straight to the documents — so pressing it would walk them back into the
   * identical failure. /login is the screen that actually issues a code.
   *
   * The number goes with them so they do not retype it, and `reason` tells
   * that screen to say why they are there. Once the code checks out it routes
   * a number with no account back to /signup on its own.
   *
   * What they typed on the details step is lost, which is the cost of leaving
   * the page. Everything the server was holding was discarded when the
   * verification lapsed anyway.
   */
  const handlePhoneVerificationExpired = (): void => {
    const search = new URLSearchParams({ reason: 'signup_otp' });
    if (/^\d{10}$/.test(phone.trim())) search.set('phone', phone.trim());
    if (redirect) search.set('redirect', redirect);
    setLocation(`/login?${search.toString()}`);
  };

  const handleSubmitDocuments = (): void => {
    if (missingDocs.length > 0) {
      setFlaggedDocs(missingDocs);
      setErrors({
        form: `Still needed: ${missingDocs.map((s) => DOC_SLOT_SPECS[s].label).join(', ')}`,
      });
      return;
    }
    setFlaggedDocs([]);
    setErrors({});
    if (!contractSignedName.trim()) {
      setContractSignedName(accountType === 'personal' ? fullName.trim() : contactPerson.trim());
    }
    setStep('preview');
  };

  const handleCreateAccount = async (): Promise<void> => {
    if (!contractAccepted) {
      setContractError('Please accept the contract to continue');
      return;
    }
    if (!isValidSignature(contractSignedName)) {
      setContractError(SIGNATURE_ERROR);
      return;
    }
    setContractError('');
    setIsLoading(true);
    setErrors({});
    try {
      const res =
        accountType === 'personal'
          ? await apiRequest('POST', '/api/auth/signup/personal', {
              full_name: fullName.trim(),
              email: email.trim(),
              phone,
              contract_accepted: true,
              contract_signed_name: contractSignedName.trim(),
            })
          : await apiRequest('POST', '/api/auth/signup/company', {
              phone,
              company_name: companyName.trim(),
              gstin,
              company_category: category,
              contact_person: contactPerson.trim(),
              email: email.trim(),
              address: address.trim(),
              pincode: pincode.trim(),
              city: city.trim(),
              state: state.trim(),
              hub_id: Number(hubId),
              ...Object.fromEntries(activeExtras.map((f) => [f, extras[f].trim()])),
              contract_accepted: true,
              contract_signed_name: contractSignedName.trim(),
            });
      const user = (await res.json()) as AuthUser;
      login(user);
      setLocation(redirect || '/home');
    } catch (err) {
      // The one failure that is not a detail to correct here: the OTP that
      // authorised the whole signup has run out, and no amount of editing
      // this screen fixes it.
      if (parseApiErrorCode(err) === 'phone_unverified') {
        handlePhoneVerificationExpired();
        return;
      }
      // Otherwise stay on the review step: the signature and the tick are
      // here, and a failure is nearly always a detail to correct rather than
      // a missing file. `missing_documents` in the body says otherwise when
      // it is.
      setErrors({ form: parseApiErrorMessage(err, 'Could not create account') });
    } finally {
      setIsLoading(false);
    }
  };

  /** The step behind each one, for both the arrow and the browser. */
  const PREVIOUS_STEP: Partial<Record<Step, Step>> = {
    otp: 'details',
    documents: 'details',
    preview: 'documents',
  };

  const handleBack = (): void => {
    const previous = PREVIOUS_STEP[step];
    if (previous) {
      setStep(previous);
      return;
    }
    // Off the front of the flow. /login rather than /home: nobody on this
    // screen is signed in, so /home would only bounce them there anyway, and
    // going somewhere that immediately redirects reads as a glitch.
    setLocation('/login');
  };

  const primaryAction =
    step === 'details'
      ? handleSubmitDetails
      : step === 'otp'
        ? () => void handleVerifyOtp()
        : step === 'documents'
          ? () => handleSubmitDocuments()
          : () => void handleCreateAccount();

  const primaryLabel =
    step === 'details'
      ? preVerified
        ? 'Continue'
        : 'Send code'
      : step === 'otp'
        ? 'Verify & continue'
        : step === 'documents'
          ? 'Continue'
          : 'Confirm & create account';

  const stepIndex =
    step === 'details'
      ? 1
      : step === 'otp'
        ? 2
        : step === 'documents'
          ? 3
          : 4;

  const stepSubtitle =
    step === 'details' ? (
      'Tell us who the account is for.'
    ) : step === 'otp' ? (
      <>
        We sent a 6-digit code to{' '}
        <span className="font-mono font-semibold text-foreground whitespace-nowrap">
          +91 {phone}
        </span>
        .
      </>
    ) : step === 'documents' ? (
      // Deliberately not "verify": of the numbers on this screen only the GST
      // one is checked with an authority. The rest are matched against the
      // document uploaded beside them. See server/cashfreeIdentity.ts.
      'Enter each number and upload the document that carries it.'
    ) : (
      'Check your details, then sign the contract to open the account.'
    );

  const fieldLabelClass = 'text-sm font-medium text-[lab(34.0831_-9.57756_-27.7093)]';
  const fieldClass = 'pl-10 h-12 bg-[#F3F4F6] border border-[#E2E8F0] rounded-xl';

  return (
    <AuthShell
      title="Create account"
      subtitle={stepSubtitle}
      onBack={handleBack}
      step={stepIndex}
      totalSteps={TOTAL_STEPS}
      testId="screen-signup"
      beforeCard={
        step === 'details' ? (
          <div className="flex bg-muted rounded-xl p-1 mb-5" role="tablist" aria-label="Account type">
            {ACCOUNT_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                role="tab"
                aria-selected={accountType === type}
                // Roving tabindex: a tablist is one stop in the tab order, and
                // the arrow keys move between its tabs (WAI-ARIA tabs pattern).
                tabIndex={accountType === type ? 0 : -1}
                onKeyDown={handleTabKeyDown}
                onClick={() => switchAccountType(type)}
                className={cn(
                  'flex-1 py-2 text-sm font-medium rounded-lg transition-colors capitalize',
                  accountType === type
                    ? 'bg-white text-primary shadow-sm'
                    : 'text-muted-foreground'
                )}
                data-testid={`button-account-type-${type}`}
              >
                {type}
              </button>
            ))}
          </div>
        ) : null
      }
      footer={
        step === 'details' ? (
          <p className="text-center text-sm text-muted-foreground mt-5">
            Already registered?{' '}
            <Link
              href={redirect ? `/login?redirect=${encodeURIComponent(redirect)}` : '/login'}
              className="text-[#F2A123] font-semibold hover:underline"
            >
              Sign in
            </Link>
          </p>
        ) : null
      }
    >
            {step === 'details' && accountType === 'personal' && (
              <>
                <div>
                  <Label className={fieldLabelClass}>Full name</Label>
                  <div className="relative mt-2">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                    <Input
                      value={fullName}
                      onChange={(e) => { setFullName(e.target.value); setErrors((prev) => ({ ...prev, fullName: '' })); }}
                      placeholder="Full name"
                      className={fieldClass}
                      autoComplete="name"
                      data-testid="input-full-name"
                    />
                  </div>
                  {errors.fullName && <p role="alert" className="text-sm text-red-500 mt-1.5">{errors.fullName}</p>}
                </div>

                <EmailField
                  value={email}
                  onChange={(v) => { setEmail(v); setErrors((prev) => ({ ...prev, email: '' })); }}
                  error={errors.email}
                  labelClass={fieldLabelClass}
                  inputClass={fieldClass}
                />

                <PhoneField
                  value={phone}
                  onChange={(v) => { setPhone(v); setErrors((prev) => ({ ...prev, phone: '' })); }}
                  disabled={preVerified}
                  onEnter={handleSubmitDetails}
                  error={errors.phone}
                  labelClass={fieldLabelClass}
                  inputClass={fieldClass}
                />
              </>
            )}

            {step === 'details' && accountType === 'company' && (
              <>
                <div>
                  <Label className={fieldLabelClass}>Account category</Label>
                  <Select
                    value={category}
                    onValueChange={(v) => {
                      setCategory(v as CompanyCategory);
                      // The required documents and fields differ per category;
                      // anything already flagged refers to the old set.
                      setFlaggedDocs([]);
                      setErrors({});
                    }}
                  >
                    <SelectTrigger
                      className="mt-2 h-12 bg-[#F3F4F6] border border-[#E2E8F0] rounded-xl"
                      data-testid="select-company-category"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {COMPANY_CATEGORIES.map((key) => (
                        <SelectItem key={key} value={key} data-testid={`option-category-${key}`}>
                          {COMPANY_CATEGORY_SPECS[key].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">
                    {categorySpec.description} · contract head {categorySpec.contractHead}
                    {categorySpec.groupCode ? ` · group ${categorySpec.groupCode}` : ''}
                  </p>
                </div>

                <PhoneField
                  value={phone}
                  onChange={(v) => { setPhone(v); setErrors((prev) => ({ ...prev, phone: '' })); }}
                  disabled={preVerified}
                  error={errors.phone}
                  labelClass={fieldLabelClass}
                  inputClass={fieldClass}
                />

                <div>
                  <Label className={fieldLabelClass}>Company name</Label>
                  <div className="relative mt-2">
                    <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                    <Input
                      value={companyName}
                      onChange={(e) => { setCompanyName(e.target.value); setErrors((prev) => ({ ...prev, companyName: '' })); }}
                      placeholder="Company name"
                      className={fieldClass}
                      autoComplete="organization"
                      data-testid="input-company-name"
                    />
                  </div>
                  {errors.companyName && <p role="alert" className="text-sm text-red-500 mt-1.5">{errors.companyName}</p>}
                </div>

                <div>
                  <Label className={fieldLabelClass}>GST number</Label>
                  <div className="relative mt-2">
                    <Input
                      value={gstin}
                      onChange={(e) => {
                        setGstin(e.target.value.toUpperCase().slice(0, 15));
                        setErrors((prev) => ({ ...prev, gstin: '' }));
                      }}
                      placeholder="22AAAAA0000A1Z5"
                      maxLength={15}
                      className="h-12 bg-[#F3F4F6] border border-[#E2E8F0] rounded-xl font-mono tracking-wide"
                      data-testid="input-gstin"
                    />
                  </div>
                  {errors.gstin ? (
                    <p role="alert" className="text-sm text-red-500 mt-1.5">{errors.gstin}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-1">Format-validated only — not looked up live.</p>
                  )}
                </div>

                <div>
                  <Label className={fieldLabelClass}>Contact person</Label>
                  <div className="relative mt-2">
                    <UserRound className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                    <Input
                      value={contactPerson}
                      onChange={(e) => { setContactPerson(e.target.value); setErrors((prev) => ({ ...prev, contactPerson: '' })); }}
                      placeholder="Who we speak to"
                      className={fieldClass}
                      autoComplete="name"
                      data-testid="input-contact-person"
                    />
                  </div>
                  {errors.contactPerson && <p role="alert" className="text-sm text-red-500 mt-1.5">{errors.contactPerson}</p>}
                </div>

                <EmailField
                  value={email}
                  onChange={(v) => { setEmail(v); setErrors((prev) => ({ ...prev, email: '' })); }}
                  error={errors.email}
                  labelClass={fieldLabelClass}
                  inputClass={fieldClass}
                />

                <div>
                  <Label className={fieldLabelClass}>Address</Label>
                  <div className="relative mt-2">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                    <Input
                      value={address}
                      onChange={(e) => { setAddress(e.target.value); setErrors((prev) => ({ ...prev, address: '' })); }}
                      placeholder="Street address"
                      maxLength={200}
                      className={fieldClass}
                      autoComplete="street-address"
                      data-testid="input-company-address"
                    />
                  </div>
                  {errors.address && <p role="alert" className="text-sm text-red-500 mt-1.5">{errors.address}</p>}
                </div>

                <div>
                  <Label className={fieldLabelClass}>Pincode</Label>
                  <Input
                    value={pincode}
                    onChange={(e) => {
                      setPincode(e.target.value.replace(/\D/g, '').slice(0, 6));
                      setErrors((prev) => ({ ...prev, pincode: '' }));
                    }}
                    onBlur={() => {
                      void lookupPincode(pincode, 'IN', ({ city: nextCity, state: nextState }) => {
                        setCity(nextCity);
                        setState(nextState);
                        setErrors((prev) => ({ ...prev, city: '', state: '' }));
                      });
                    }}
                    placeholder="6-digit pincode"
                    inputMode="numeric"
                    maxLength={6}
                    className="mt-2 h-12 bg-[#F3F4F6] border border-[#E2E8F0] rounded-xl"
                    autoComplete="postal-code"
                    data-testid="input-company-pincode"
                  />
                  {pincodeHint && (
                    <p className="text-xs text-muted-foreground mt-1">{pincodeHint}</p>
                  )}
                  {errors.pincode && <p role="alert" className="text-sm text-red-500 mt-1.5">{errors.pincode}</p>}
                </div>

                <div>
                  <Label className={fieldLabelClass}>City</Label>
                  <Input
                    value={city}
                    onChange={(e) => { setCity(e.target.value); setErrors((prev) => ({ ...prev, city: '' })); }}
                    placeholder="City"
                    maxLength={80}
                    className="mt-2 h-12 bg-[#F3F4F6] border border-[#E2E8F0] rounded-xl"
                    autoComplete="address-level2"
                    data-testid="input-company-city"
                  />
                  {errors.city && <p role="alert" className="text-sm text-red-500 mt-1.5">{errors.city}</p>}
                </div>

                <div>
                  <Label className={fieldLabelClass}>State</Label>
                  <Input
                    value={state}
                    onChange={(e) => { setState(e.target.value); setErrors((prev) => ({ ...prev, state: '' })); }}
                    placeholder="State"
                    maxLength={80}
                    className="mt-2 h-12 bg-[#F3F4F6] border border-[#E2E8F0] rounded-xl"
                    autoComplete="address-level1"
                    data-testid="input-company-state"
                  />
                  {errors.state && <p role="alert" className="text-sm text-red-500 mt-1.5">{errors.state}</p>}
                </div>

                <div>
                  <Label className={fieldLabelClass}>Hub</Label>
                  <Select
                    value={hubId || undefined}
                    onValueChange={(value) => {
                      setHubId(value);
                      setErrors((prev) => ({ ...prev, hubId: '' }));
                    }}
                  >
                    <SelectTrigger
                      className="mt-2 h-12 bg-[#F3F4F6] border border-[#E2E8F0] rounded-xl"
                      data-testid="select-company-hub"
                    >
                      <SelectValue placeholder="Select a hub" />
                    </SelectTrigger>
                    <SelectContent>
                      {INDIA_HUBS.map((hub) => (
                        <SelectItem key={hub.id} value={String(hub.id)}>
                          {hub.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.hubId && <p role="alert" className="text-sm text-red-500 mt-1.5">{errors.hubId}</p>}
                </div>

                {activeExtras.map((field) => {
                  const spec = EXTRA_FIELD_SPECS[field];
                  return (
                    <div key={field}>
                      <Label className={fieldLabelClass}>{spec.label}</Label>
                      <Input
                        value={extras[field]}
                        onChange={(e) => {
                          const raw = e.target.value.slice(0, spec.maxLength);
                          setExtras((prev) => ({
                            ...prev,
                            [field]: spec.uppercase ? raw.toUpperCase() : raw,
                          }));
                          setErrors((prev) => ({ ...prev, [field]: '' }));
                        }}
                        placeholder={spec.placeholder}
                        maxLength={spec.maxLength}
                        inputMode={spec.uppercase ? 'text' : 'numeric'}
                        className="mt-2 h-12 bg-[#F3F4F6] border border-[#E2E8F0] rounded-xl font-mono tracking-wide"
                        data-testid={`input-${field}`}
                      />
                      {errors[field] && <p role="alert" className="text-sm text-red-500 mt-1.5">{errors[field]}</p>}
                    </div>
                  );
                })}
              </>
            )}

            {step === 'otp' && (
              <div>
                <Label className={fieldLabelClass}>Enter OTP</Label>
                <p className="text-xs text-muted-foreground mt-1">Sent to {phone}</p>
                <div className="mt-3 flex justify-center">
                  <InputOTP maxLength={6} value={otp} onChange={setOtp}>
                    <InputOTPGroup>
                      {[0, 1, 2, 3, 4, 5].map((i) => (
                        <InputOTPSlot key={i} index={i} className="h-12 w-11 text-base" data-testid={`input-otp-slot-${i}`} />
                      ))}
                    </InputOTPGroup>
                  </InputOTP>
                </div>
                {errors.otp && <p role="alert" className="text-sm text-red-500 mt-2">{errors.otp}</p>}
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

            {step === 'documents' && (
              <AccountDocuments
                accountType={accountType}
                category={accountType === 'company' ? category : null}
                phone={phone}
                accountName={accountName}
                gstin={accountType === 'company' ? gstin.trim().toUpperCase() : ''}
                onMissingChange={setMissingDocs}
                highlight={flaggedDocs}
                onPhoneUnverified={handlePhoneVerificationExpired}
              />
            )}

            {step === 'preview' && (
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <ShieldCheck className="w-5 h-5 text-[#F2A123]" />
                  <Label className={fieldLabelClass}>Review your details</Label>
                </div>
                <div className="mt-3 space-y-3 text-sm">
                  {accountType === 'company' && (
                    <PreviewRow label="Account category" value={categorySpec.label} />
                  )}
                  <PreviewRow label="Phone" value={phone} />
                  {accountType === 'personal' ? (
                    <PreviewRow label="Full name" value={fullName} />
                  ) : (
                    <>
                      <PreviewRow label="Company name" value={companyName} />
                      <PreviewRow label="GST number" value={gstin} mono />
                      <PreviewRow label="Contact person" value={contactPerson} />
                      <PreviewRow label="Address" value={address} />
                      <PreviewRow label="Pincode" value={pincode} />
                      <PreviewRow label="City" value={city} />
                      <PreviewRow label="State" value={state} />
                      <PreviewRow
                        label="Hub"
                        value={INDIA_HUBS.find((h) => String(h.id) === hubId)?.name ?? hubId}
                      />
                    </>
                  )}
                  <PreviewRow label="Email" value={email} />
                  {accountType === 'company' && (
                    <>
                      <PreviewRow label="Address" value={address} />
                      <PreviewRow label="Pincode" value={pincode} />
                      <PreviewRow label="City" value={city} />
                      <PreviewRow label="State" value={state} />
                      <PreviewRow
                        label="Hub"
                        value={INDIA_HUBS.find((h) => String(h.id) === hubId)?.name ?? hubId}
                      />
                    </>
                  )}
                  {activeExtras.map((field) => (
                    <PreviewRow
                      key={field}
                      label={EXTRA_FIELD_SPECS[field].label}
                      value={extras[field]}
                      mono
                    />
                  ))}
                  <PreviewRow
                    label="Documents"
                    value={`${
                      accountType === 'company' ? categorySpec.documents.length : 2
                    } uploaded`}
                    last
                  />
                </div>

                <div className="mt-5">
                  <ContractSignature
                    phone={phone}
                    accountName={accountName}
                    accepted={contractAccepted}
                    onAcceptedChange={(v) => {
                      setContractAccepted(v);
                      setContractError('');
                    }}
                    signedName={contractSignedName}
                    onSignedNameChange={(v) => {
                      setContractSignedName(v);
                      setContractError('');
                    }}
                    error={contractError}
                  />
                </div>
              </div>
            )}

            {errors.form && (
              <p role="alert" className="text-sm text-red-500">{errors.form}</p>
            )}

            <Button
              onClick={primaryAction}
              disabled={isLoading}
              className="w-full h-12 text-base font-semibold bg-[#F2A123] hover:bg-[#F2A123]/90 text-[lab(34.0831_-9.57756_-27.7093)] rounded-xl shadow-[0_4px_20px_oklch(17%_0.048_248_/_0.10)] disabled:opacity-70 mt-1"
              data-testid="button-create-account"
            >
              {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : primaryLabel}
            </Button>

    </AuthShell>
  );
}

function PreviewRow({
  label,
  value,
  mono,
  last,
}: {
  label: string;
  value: string;
  mono?: boolean;
  last?: boolean;
}) {
  return (
    <div className={cn('flex justify-between gap-3', !last && 'pb-3 border-b border-border')}>
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          'font-medium text-foreground text-right break-all',
          mono && 'font-mono',
        )}
      >
        {value}
      </span>
    </div>
  );
}

function EmailField({
  value,
  onChange,
  error,
  labelClass,
  inputClass,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string;
  labelClass: string;
  inputClass: string;
}) {
  return (
    <div>
      <Label className={labelClass}>Email</Label>
      <div className="relative mt-2">
        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
        <Input
          type="email"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Enter your email"
          className={inputClass}
          autoComplete="email"
          data-testid="input-email"
        />
      </div>
      {error && <p role="alert" className="text-sm text-red-500 mt-1.5">{error}</p>}
    </div>
  );
}

function PhoneField({
  value,
  onChange,
  disabled,
  onEnter,
  error,
  labelClass,
  inputClass,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  onEnter?: () => void;
  error?: string;
  labelClass: string;
  inputClass: string;
}) {
  return (
    <div>
      <Label className={labelClass}>Phone number</Label>
      <div className="relative mt-2">
        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
        <Input
          type="tel"
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 10))}
          // Already verified upstream — editing it here would silently detach
          // the code from the number being saved.
          disabled={disabled}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && onEnter) onEnter();
          }}
          placeholder="10-digit mobile number"
          className={inputClass}
          autoComplete="tel"
          data-testid="input-phone"
        />
      </div>
      {error && <p role="alert" className="text-sm text-red-500 mt-1.5">{error}</p>}
    </div>
  );
}
