import { useEffect, useMemo, useState } from 'react';
import { Redirect, useLocation } from 'wouter';
import { Loader2, ShieldCheck, UserRound, Building2 } from 'lucide-react';
import { AuthShell } from '@/components/auth/AuthShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useAppStore } from '@/lib/store';
import { useGuestProfile, useSaveGuestProfile, invalidateGuestProfile } from '@/hooks/useGuestProfile';
import { useQueryClient } from '@tanstack/react-query';
import { KycUpload } from '@/components/KycUpload';
import { KycOnFileCard } from '@/components/KycOnFileCard';
import { useKycOnFile } from '@/hooks/useKycOnFile';
import { usePincodeLookup } from '@/hooks/usePincodeLookup';
import { apiRequest } from '@/lib/queryClient';
import { parseApiErrorMessage } from '@/lib/apiError';
import { formatGuestPhone, type GuestAccountType } from '@/lib/shadowProfile';
import { validateGstin } from '@shared/gstin';
import {
  COMPANY_CATEGORY_SPECS,
  COMPANY_CATEGORIES,
  EXTRA_FIELD_SPECS,
  requiredExtraFields,
  type CompanyCategory,
  type ExtraField,
} from '@shared/accountSpec';
import { INDIA_HUBS } from '@shared/hubs';

/**
 * Setting up an account, for someone who is already a customer.
 *
 * The same information the signup form collects, on a screen that knows it is
 * not talking to a stranger: the number is already verified, the orders are
 * already theirs, and nothing here is a gate in front of shipping. So the copy
 * carries none of signup's "create your account" framing, and the screen never
 * pretends this is step one of anything.
 *
 * It exists because the profile screen was collecting this a row at a time,
 * which is right for correcting one detail and wrong for finishing a set of
 * twelve. The profile keeps the summary and sends people here; this fills the
 * form in one sitting.
 *
 * Everything saves in a single PATCH at the end. The exception is the GST
 * number, which has to clear the registry first — see `verifyGstin` below.
 */
export default function GuestAccountSetup(): React.JSX.Element {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const isLoggedIn = useAppStore((s) => s.isLoggedIn);
  const { data: profile, isLoading } = useGuestProfile({ enabled: !isLoggedIn });
  const save = useSaveGuestProfile();
  const { lookup, hint: pincodeHint } = usePincodeLookup();
  const queryClient = useQueryClient();
  /**
   * The document already on file, if any.
   *
   * Enabled once we know who is asking: /api/kyc/me resolves a guest by the
   * session's ref, which only exists after the number was proved.
   */
  const { data: kycOnFile } = useKycOnFile({ enabled: !!profile });

  const [accountType, setAccountType] = useState<GuestAccountType | null>(null);
  const [category, setCategory] = useState<CompanyCategory>('corporate');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [gstin, setGstin] = useState('');
  const [gstinVerified, setGstinVerified] = useState(false);
  const [contactPerson, setContactPerson] = useState('');
  const [address, setAddress] = useState('');
  const [pincode, setPincode] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [hubId, setHubId] = useState('');
  const [extras, setExtras] = useState<Partial<Record<ExtraField, string>>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [checkingGstin, setCheckingGstin] = useState(false);

  // Seed from whatever is already on file. Someone who answered two rows on
  // the profile last week should find those two answered here.
  useEffect(() => {
    if (!profile) return;
    setAccountType((current) => current ?? profile.account_type);
    if (profile.company_category) setCategory(profile.company_category);
    setFullName((v) => v || profile.full_name || '');
    setEmail((v) => v || profile.email || '');
    setCompanyName((v) => v || profile.company_name || '');
    setGstin((v) => v || profile.gstin || '');
    setGstinVerified((v) => v || !!profile.gstin);
    setContactPerson((v) => v || profile.contact_person || '');
    setAddress((v) => v || profile.address_line_1 || '');
    setPincode((v) => v || profile.pincode || '');
    setCity((v) => v || profile.city || '');
    setState((v) => v || profile.state || '');
    setHubId((v) => v || profile.hub_id || '');
    setExtras((current) => ({ ...profile.extras, ...current }));
  }, [profile]);

  const activeExtras = useMemo(
    () => (accountType === 'company' ? requiredExtraFields(category) : []),
    [accountType, category]
  );

  const setError = (key: string, message: string): void =>
    setErrors((prev) => ({ ...prev, [key]: message }));
  const clearError = (key: string): void =>
    setErrors((prev) => ({ ...prev, [key]: '' }));

  /**
   * The GST number is the one value somebody else has to agree with, so it is
   * checked on the spot rather than at submit: finding out at the end that the
   * number belongs to a different company means re-reading a form you thought
   * you had finished. The registry's answer is written straight onto the
   * profile by the endpoint.
   */
  const verifyGstinNow = async (): Promise<void> => {
    const shape = validateGstin(gstin.trim().toUpperCase());
    if (!shape.valid) {
      setError('gstin', shape.message ?? 'Enter a valid 15-character GST number');
      return;
    }
    if (!companyName.trim()) {
      setError('companyName', 'We check the GST number against this name.');
      return;
    }

    setCheckingGstin(true);
    clearError('gstin');
    try {
      await apiRequest('POST', '/api/signup/identity/gstin', {
        phone: profile?.phone,
        gstin: gstin.trim().toUpperCase(),
        name: companyName.trim(),
      });
      setGstinVerified(true);
      toast({ title: 'GST number confirmed', description: 'Checked with the GST registry.' });
    } catch (err) {
      setGstinVerified(false);
      setError('gstin', parseApiErrorMessage(err, 'Could not confirm that GST number.'));
    } finally {
      setCheckingGstin(false);
    }
  };

  const validateAll = (): boolean => {
    const next: Record<string, string> = {};

    if (!accountType) next.accountType = 'Choose personal or company.';

    if (accountType === 'personal') {
      if (fullName.trim().length < 2) next.fullName = 'Enter your full name.';
    }

    if (accountType === 'company') {
      if (companyName.trim().length < 2) next.companyName = 'Enter the company name.';
      if (!gstinVerified) next.gstin = 'Confirm the GST number before saving.';
      if (contactPerson.trim().length < 2) next.contactPerson = 'Who should we speak to?';
      if (address.trim().length < 4) next.address = 'Enter the street address.';
      if (!/^\d{6}$/.test(pincode.trim())) next.pincode = 'Enter a 6-digit pincode.';
      if (city.trim().length < 2) next.city = 'Enter the city.';
      if (state.trim().length < 2) next.state = 'Enter the state.';
      if (!hubId) next.hubId = 'Choose the hub nearest you.';
      for (const field of activeExtras) {
        const spec = EXTRA_FIELD_SPECS[field];
        const value = (extras[field] ?? '').trim();
        const candidate = spec.uppercase ? value.toUpperCase() : value;
        if (!spec.pattern.test(candidate)) next[field] = spec.error;
      }
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      next.email = 'Enter a valid email address.';
    }

    setErrors(next);
    return Object.values(next).every((message) => !message);
  };

  const handleSave = (): void => {
    if (!validateAll() || !accountType) return;

    save.mutate(
      accountType === 'personal'
        ? { account_type: 'personal', full_name: fullName.trim(), email: email.trim() }
        : {
            account_type: 'company',
            company_category: category,
            company_name: companyName.trim(),
            contact_person: contactPerson.trim(),
            email: email.trim(),
            address_line_1: address.trim(),
            pincode: pincode.trim(),
            city: city.trim(),
            state: state.trim(),
            hub_id: hubId,
            extras: Object.fromEntries(
              activeExtras.map((field) => [
                field,
                EXTRA_FIELD_SPECS[field].uppercase
                  ? (extras[field] ?? '').trim().toUpperCase()
                  : (extras[field] ?? '').trim(),
              ])
            ),
          },
      {
        onSuccess: () => {
          toast({
            title: 'Saved',
            description: 'Your details are filed against your number.',
          });
          setLocation('/guest-profile');
        },
        onError: (err) =>
          setError('form', parseApiErrorMessage(err, 'Could not save. Please try again.')),
      }
    );
  };

  // An account holder has a profile screen of their own, and this one collects
  // what signup already asked them for. `Redirect` rather than an effect: the
  // effect version has to render something for the frame in between, and an
  // empty tree from a mounted screen tears the DOM out from under React.
  if (isLoggedIn) return <Redirect to="/profile" replace />;

  if (isLoading) {
    return (
      <AuthShell title="Your details" onBack={() => setLocation('/guest-profile')}>
        <div className="grid place-items-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
        </div>
      </AuthShell>
    );
  }

  if (!profile) {
    return (
      <AuthShell
        title="Your details"
        subtitle="Verify your number first, and this is where the rest goes."
        onBack={() => setLocation('/home')}
      >
        <Button
          onClick={() => setLocation('/login')}
          className="h-12 w-full rounded-xl text-sm font-semibold"
        >
          Verify my number
        </Button>
      </AuthShell>
    );
  }

  const labelClass = 'text-sm font-medium text-[lab(34.0831_-9.57756_-27.7093)]';
  const fieldClass = 'h-12 rounded-xl bg-[#F3F4F6] border border-[#E2E8F0] mt-2';

  return (
    <AuthShell
      title="Your details"
      // Not "create your account". They are already a customer, and the number
      // at the top is the proof of it.
      subtitle={
        <>
          We already have{' '}
          <span className="font-semibold text-foreground">
            {formatGuestPhone(profile.phone)}
          </span>
          . Fill in the rest once and your next booking is mostly done.
        </>
      }
      onBack={() => setLocation('/guest-profile')}
      testId="screen-guest-setup"
    >
      <div className="space-y-5">
        <div>
          <p className={labelClass}>Who are you shipping as?</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {(
              [
                { value: 'personal', label: 'Myself', icon: UserRound },
                { value: 'company', label: 'A business', icon: Building2 },
              ] as const
            ).map((option) => {
              const Icon = option.icon;
              const selected = accountType === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    setAccountType(option.value);
                    clearError('accountType');
                  }}
                  className={`flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition-colors ${
                    selected
                      ? 'border-[#F2A123] bg-[#F2A123]/5'
                      : 'border-[#E2E8F0] bg-[#F3F4F6] hover:border-[#F2A123]/50'
                  }`}
                  data-testid={`button-setup-type-${option.value}`}
                >
                  <Icon className="h-5 w-5 text-[#2F4468]" aria-hidden />
                  <span className="text-sm font-semibold text-foreground">{option.label}</span>
                </button>
              );
            })}
          </div>
          {errors.accountType && (
            <p role="alert" className="mt-1.5 text-sm text-red-500">
              {errors.accountType}
            </p>
          )}
        </div>

        {accountType === 'personal' && (
          <Field
            id="setup-full-name"
            label="Your name"
            hint="Goes on the shipping docket, so use the name on your ID."
            value={fullName}
            onChange={(v) => {
              setFullName(v);
              clearError('fullName');
            }}
            error={errors.fullName}
            placeholder="Full name"
            autoComplete="name"
            labelClass={labelClass}
            fieldClass={fieldClass}
          />
        )}

        {accountType === 'company' && (
          <>
            <div>
              <Label className={labelClass}>What kind of business?</Label>
              <Select
                value={category}
                onValueChange={(v) => setCategory(v as CompanyCategory)}
              >
                <SelectTrigger className={fieldClass} data-testid="select-setup-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMPANY_CATEGORIES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {COMPANY_CATEGORY_SPECS[value].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                {COMPANY_CATEGORY_SPECS[category].description}. It decides which documents
                we ask for later.
              </p>
            </div>

            <Field
              id="setup-company-name"
              label="Company name"
              hint="Exactly as it appears on your GST registration."
              value={companyName}
              onChange={(v) => {
                setCompanyName(v);
                setGstinVerified(false);
                clearError('companyName');
              }}
              error={errors.companyName}
              placeholder="Registered company name"
              labelClass={labelClass}
              fieldClass={fieldClass}
            />

            <div>
              <Label htmlFor="setup-gstin" className={labelClass}>
                GST number
              </Label>
              <div className="mt-2 flex gap-2">
                <Input
                  id="setup-gstin"
                  value={gstin}
                  onChange={(e) => {
                    setGstin(e.target.value.toUpperCase());
                    setGstinVerified(false);
                    clearError('gstin');
                  }}
                  maxLength={15}
                  placeholder="22AAAAA0000A1Z5"
                  aria-invalid={!!errors.gstin}
                  disabled={checkingGstin}
                  className="h-12 flex-1 rounded-xl border border-[#E2E8F0] bg-[#F3F4F6]"
                  data-testid="input-setup-gstin"
                />
                <Button
                  type="button"
                  onClick={() => void verifyGstinNow()}
                  disabled={checkingGstin || gstinVerified || !gstin.trim()}
                  className="h-12 shrink-0 rounded-xl px-4 text-sm font-semibold"
                  data-testid="button-setup-verify-gstin"
                >
                  {checkingGstin ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : gstinVerified ? (
                    'Confirmed'
                  ) : (
                    'Check'
                  )}
                </Button>
              </div>
              <p
                role={errors.gstin ? 'alert' : undefined}
                className={`mt-1.5 flex items-center gap-1.5 text-xs leading-relaxed ${
                  errors.gstin ? 'text-red-500' : 'text-muted-foreground'
                }`}
              >
                {gstinVerified && !errors.gstin && (
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-green-600" aria-hidden />
                )}
                {errors.gstin ??
                  (gstinVerified
                    ? 'Confirmed with the GST registry.'
                    : 'We check this with the GST registry before saving.')}
              </p>
            </div>

            <Field
              id="setup-contact-person"
              label="Who should we call?"
              hint="The person we reach about a shipment."
              value={contactPerson}
              onChange={(v) => {
                setContactPerson(v);
                clearError('contactPerson');
              }}
              error={errors.contactPerson}
              placeholder="Contact person"
              labelClass={labelClass}
              fieldClass={fieldClass}
            />
          </>
        )}

        {accountType && (
          <Field
            id="setup-email"
            label="Email"
            hint="Where receipts and delivery updates go."
            value={email}
            onChange={(v) => {
              setEmail(v);
              clearError('email');
            }}
            error={errors.email}
            placeholder="you@example.com"
            type="email"
            autoComplete="email"
            labelClass={labelClass}
            fieldClass={fieldClass}
          />
        )}

        {accountType === 'company' && (
          <>
            <Field
              id="setup-address"
              label="Pickup address"
              value={address}
              onChange={(v) => {
                setAddress(v);
                clearError('address');
              }}
              error={errors.address}
              placeholder="Street address"
              labelClass={labelClass}
              fieldClass={fieldClass}
            />

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="setup-pincode" className={labelClass}>
                  Pincode
                </Label>
                <Input
                  id="setup-pincode"
                  value={pincode}
                  inputMode="numeric"
                  maxLength={6}
                  onChange={(e) => {
                    const value = e.target.value.replace(/\D/g, '').slice(0, 6);
                    setPincode(value);
                    clearError('pincode');
                    // Fills the two boxes beside it, so nobody types their own
                    // city and state for a pincode we can already read.
                    if (value.length === 6) {
                      void lookup(value, 'IN', (result) => {
                        setCity(result.city);
                        setState(result.state);
                        clearError('city');
                        clearError('state');
                      });
                    }
                  }}
                  placeholder="400069"
                  aria-invalid={!!errors.pincode}
                  className={fieldClass}
                  data-testid="input-setup-pincode"
                />
                <p
                  role={errors.pincode ? 'alert' : undefined}
                  className={`mt-1.5 text-xs ${errors.pincode ? 'text-red-500' : 'text-muted-foreground'}`}
                >
                  {errors.pincode ?? pincodeHint ?? 'Fills the city and state.'}
                </p>
              </div>

              <div>
                <Label className={labelClass}>Hub</Label>
                <Select value={hubId} onValueChange={(v) => { setHubId(v); clearError('hubId'); }}>
                  <SelectTrigger className={fieldClass} data-testid="select-setup-hub">
                    <SelectValue placeholder="Nearest hub" />
                  </SelectTrigger>
                  <SelectContent>
                    {INDIA_HUBS.map((hub) => (
                      <SelectItem key={hub.id} value={String(hub.id)}>
                        {hub.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.hubId && (
                  <p role="alert" className="mt-1.5 text-xs text-red-500">
                    {errors.hubId}
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field
                id="setup-city"
                label="City"
                value={city}
                onChange={(v) => {
                  setCity(v);
                  clearError('city');
                }}
                error={errors.city}
                placeholder="City"
                labelClass={labelClass}
                fieldClass={fieldClass}
              />
              <Field
                id="setup-state"
                label="State"
                value={state}
                onChange={(v) => {
                  setState(v);
                  clearError('state');
                }}
                error={errors.state}
                placeholder="State"
                labelClass={labelClass}
                fieldClass={fieldClass}
              />
            </div>

            {activeExtras.length > 0 && (
              <div className="space-y-4 rounded-xl border border-[#E2E8F0] bg-[#F3F4F6]/60 p-4">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {COMPANY_CATEGORY_SPECS[category].label} accounts need a few more
                  references. Copy them from your paperwork.
                </p>
                {activeExtras.map((field) => {
                  const spec = EXTRA_FIELD_SPECS[field];
                  return (
                    <Field
                      key={field}
                      id={`setup-${field}`}
                      label={spec.label}
                      value={extras[field] ?? ''}
                      onChange={(v) => {
                        setExtras((prev) => ({
                          ...prev,
                          [field]: spec.uppercase ? v.toUpperCase() : v,
                        }));
                        clearError(field);
                      }}
                      error={errors[field]}
                      placeholder={spec.placeholder}
                      maxLength={spec.maxLength}
                      labelClass={labelClass}
                      fieldClass="h-12 rounded-xl bg-white border border-[#E2E8F0] mt-2"
                    />
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* The identity document, here rather than behind a booking.
            Customs needs it whoever you are, and it used to be reachable only
            by starting a shipment — a form to fill in order to answer a
            question the profile was already asking. */}
        {accountType && (
          <div className="space-y-2 border-t border-border pt-5">
            <p className={labelClass}>Identity document</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Customs will not clear an India to USA parcel without one. Aadhaar, PAN,
              passport or driving licence — whichever you have to hand.
            </p>
            {kycOnFile ? (
              <KycOnFileCard kyc={kycOnFile} className="mt-1" />
            ) : (
              <KycUpload
                guestPhone={profile.phone}
                onValidChange={(result) => {
                  // The profile screen reads the document through its own
                  // endpoint, so its cached copy is stale the moment this
                  // lands.
                  if (result) invalidateGuestProfile(queryClient);
                }}
              />
            )}
          </div>
        )}

        {errors.form && (
          <p role="alert" className="text-sm text-red-500">
            {errors.form}
          </p>
        )}

        <Button
          onClick={handleSave}
          disabled={save.isPending || !accountType}
          className="h-12 w-full rounded-xl bg-[#F2A123] text-base font-semibold text-[lab(34.0831_-9.57756_-27.7093)] hover:bg-[#F2A123]/90 disabled:opacity-70"
          data-testid="button-setup-save"
        >
          {save.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Save my details'}
        </Button>

        <p className="text-center text-xs leading-relaxed text-muted-foreground">
          Nothing here stops you shipping. You can leave and come back, and what you have
          filled in stays.
        </p>
      </div>
    </AuthShell>
  );
}

/** One labelled input, hint underneath, error in the hint's place. */
function Field({
  id,
  label,
  hint,
  value,
  onChange,
  error,
  placeholder,
  type = 'text',
  autoComplete,
  maxLength,
  labelClass,
  fieldClass,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  placeholder?: string;
  type?: string;
  autoComplete?: string;
  maxLength?: number;
  labelClass: string;
  fieldClass: string;
}): React.JSX.Element {
  return (
    <div>
      <Label htmlFor={id} className={labelClass}>
        {label}
      </Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        type={type}
        autoComplete={autoComplete}
        maxLength={maxLength}
        aria-invalid={!!error}
        className={fieldClass}
        data-testid={`input-${id}`}
      />
      {(error || hint) && (
        <p
          role={error ? 'alert' : undefined}
          className={`mt-1.5 text-xs leading-relaxed ${error ? 'text-red-500' : 'text-muted-foreground'}`}
        >
          {error ?? hint}
        </p>
      )}
    </div>
  );
}
