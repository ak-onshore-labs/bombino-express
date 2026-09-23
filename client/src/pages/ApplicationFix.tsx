import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
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
import { AuthShell } from '@/components/auth/AuthShell';
import { AccountDocuments } from '@/components/AccountDocuments';
import { AskBiaTopButton } from '@/components/bia/AskBiaTopButton';
import { invalidateGuestProfile, useGuestProfile } from '@/hooks/useGuestProfile';
import { apiRequest } from '@/lib/queryClient';
import { parseApiErrorMessage } from '@/lib/apiError';
import type { GuestProfile } from '@/lib/shadowProfile';
import { validateGstin } from '@shared/gstin';
import { INDIA_HUBS } from '@shared/hubs';
import {
  EXTRA_FIELD_SPECS,
  isCompanyCategory,
  isDocSlot,
  type DocSlot,
  type ExtraField,
} from '@shared/accountSpec';
import { APPLICATION_FIELD_LABELS, isApplicationField, type ApplicationField } from '@shared/applicationStatus';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FIELD_CLASS = 'h-12 bg-[#F3F4F6] border border-[#E2E8F0] rounded-xl';
const LABEL_CLASS = 'text-sm font-medium text-[lab(34.0831_-9.57756_-27.7093)]';

/** What the guest profile already holds for a field, to start the input from. */
function startingValue(profile: GuestProfile, field: ApplicationField): string {
  switch (field) {
    case 'address':
      return profile.address_line_1 ?? '';
    case 'lut_no':
    case 'iec_branch_code':
    case 'bank_account_no':
    case 'bank_ad_code':
      return profile.extras?.[field] ?? '';
    case 'account_type':
      return profile.account_type ?? '';
    default:
      return (profile[field] as string | null | undefined) ?? '';
  }
}

/** The customer's words when a value won't do. Null when it's fine. */
function fieldError(field: ApplicationField, value: string): string | null {
  const v = value.trim();
  if (!v) return `${APPLICATION_FIELD_LABELS[field]} is required`;
  switch (field) {
    case 'email':
      return EMAIL_PATTERN.test(v) ? null : 'Enter a valid email';
    case 'gstin': {
      const check = validateGstin(v.toUpperCase());
      return check.valid ? null : check.message ?? 'Invalid GST number';
    }
    case 'pincode':
      return /^\d{6}$/.test(v) ? null : 'Enter a 6-digit pincode';
    case 'lut_no':
    case 'iec_branch_code':
    case 'bank_account_no':
    case 'bank_ad_code': {
      const spec = EXTRA_FIELD_SPECS[field as ExtraField];
      return spec.pattern.test(spec.uppercase ? v.toUpperCase() : v) ? null : spec.error;
    }
    default:
      return null;
  }
}

/**
 * Fixing an application the Bombino team sent back.
 *
 * Only what they ticked is asked for: the fields to correct and the documents
 * to upload again. The rest of the application, and the contract already
 * signed, stay as they are, and the guest session on this number is the proof
 * it's theirs, so there is no code to type. The server enforces the same
 * (server/applicationFix.ts); this screen just doesn't ask for anything else.
 */
export default function ApplicationFix(): React.JSX.Element | null {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: profile, isLoading } = useGuestProfile();
  const application = profile?.application ?? null;
  const changes = application?.status === 'changes_requested' ? application.requested_changes : null;

  const fields = useMemo(
    () => (changes?.fields ?? []).filter(isApplicationField).filter((f) => f !== 'account_type'),
    [changes],
  );
  const accountTypeAsked = (changes?.fields ?? []).includes('account_type');
  /**
   * The documents to upload again. A new GST number also needs the
   * certificate that carries it, since the two are checked against each other.
   */
  const slots = useMemo<DocSlot[]>(() => {
    const asked = (changes?.slots ?? []).filter(isDocSlot);
    if (fields.includes('gstin') && !asked.includes('gst_certificate')) asked.push('gst_certificate');
    return asked;
  }, [changes, fields]);

  const [values, setValues] = useState<Partial<Record<ApplicationField, string>>>({});
  const [errors, setErrors] = useState<Partial<Record<ApplicationField, string>>>({});
  const [missingDocs, setMissingDocs] = useState<DocSlot[]>(slots);
  const [flagged, setFlagged] = useState<readonly DocSlot[]>([]);
  const [formError, setFormError] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  // Start each field from what the profile already holds, once it loads.
  useEffect(() => {
    if (!profile) return;
    setValues((current) => {
      const next = { ...current };
      for (const field of fields) {
        if (next[field] === undefined) next[field] = startingValue(profile, field);
      }
      return next;
    });
  }, [profile, fields]);

  if (isLoading) return null;

  const back = (): void => setLocation('/guest-profile');

  if (sent) {
    return (
      <AuthShell
        title="Changes sent"
        subtitle="The Bombino team will look at your application again."
        onBack={back}
        testId="screen-application-fix-sent"
        headerAction={<AskBiaTopButton className="md:inline-flex" />}
      >
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-muted-foreground">
            We'll email you when your account is open. Until then you can keep booking as a guest.
          </p>
          <Button onClick={back} className="h-12 w-full rounded-xl text-base font-semibold" data-testid="button-fix-done">
            Back to my profile
          </Button>
        </div>
      </AuthShell>
    );
  }

  // Nothing to fix here: not a guest, or the application moved on.
  if (!profile || !application || !changes) {
    return (
      <AuthShell title="Update your application" subtitle="There's nothing to change right now." onBack={back}>
        <Button onClick={back} className="h-12 w-full rounded-xl text-base font-semibold">
          Back to my profile
        </Button>
      </AuthShell>
    );
  }

  // Changing between personal and company is a different application, with
  // different documents. That one really is signup again.
  if (accountTypeAsked) {
    const params = new URLSearchParams({ phone: profile.phone, redirect: '/guest-profile' });
    return (
      <AuthShell
        title="Update your application"
        subtitle="The Bombino team asked you to change the account type."
        onBack={back}
      >
        <div className="space-y-4">
          {changes.note && (
            <blockquote className="border-l-2 border-amber-400 pl-3 text-sm text-foreground">{changes.note}</blockquote>
          )}
          <p className="text-sm leading-relaxed text-muted-foreground">
            A different account type asks for different details and documents, so it starts from the beginning.
          </p>
          <Button
            onClick={() => setLocation(`/signup?${params.toString()}`)}
            className="h-12 w-full rounded-xl text-base font-semibold"
          >
            Choose the account type again
          </Button>
        </div>
      </AuthShell>
    );
  }

  const setValue = (field: ApplicationField, value: string): void => {
    setValues((v) => ({ ...v, [field]: value }));
    setErrors((e) => ({ ...e, [field]: undefined }));
    setFormError('');
  };

  const send = async (): Promise<void> => {
    const nextErrors: Partial<Record<ApplicationField, string>> = {};
    for (const field of fields) {
      const message = fieldError(field, values[field] ?? '');
      if (message) nextErrors[field] = message;
    }
    setErrors(nextErrors);
    if (missingDocs.length > 0) {
      setFlagged(missingDocs);
      setFormError('Upload the documents above again before sending.');
      return;
    }
    if (Object.keys(nextErrors).length > 0) return;

    const body: Record<string, unknown> = { fix: true, phone: profile.phone };
    for (const field of fields) {
      const raw = (values[field] ?? '').trim();
      body[field] = field === 'hub_id' ? Number(raw) : field === 'gstin' ? raw.toUpperCase() : raw;
    }

    setSending(true);
    setFormError('');
    try {
      await apiRequest('POST', `/api/auth/signup/${application.account_type}`, body);
      invalidateGuestProfile(queryClient);
      setSent(true);
    } catch (err) {
      setFormError(parseApiErrorMessage(err, 'Could not send your changes'));
    } finally {
      setSending(false);
    }
  };

  const category = isCompanyCategory(application.company_category) ? application.company_category : null;
  const accountName =
    application.account_type === 'personal'
      ? values.full_name ?? profile.full_name ?? ''
      : values.company_name ?? profile.company_name ?? '';

  return (
    <AuthShell
      title="Update your application"
      subtitle="The Bombino team asked for a change before they open your account. Only these need you; everything else stays as you sent it."
      onBack={back}
      testId="screen-application-fix"
      headerAction={<AskBiaTopButton className="md:inline-flex" />}
    >
      <div className="space-y-6">
        {changes.note && (
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">From the Bombino team</p>
            <blockquote className="border-l-2 border-amber-400 pl-3 text-sm text-foreground" data-testid="fix-note">
              {changes.note}
            </blockquote>
          </div>
        )}

        {fields.length > 0 && (
          <section className="space-y-4" data-testid="fix-fields">
            <h2 className="text-sm font-semibold text-foreground">Details to correct</h2>
            {fields.map((field) => (
              <div key={field}>
                <Label className={LABEL_CLASS} htmlFor={`fix-${field}`}>
                  {APPLICATION_FIELD_LABELS[field]}
                </Label>
                <div className="mt-2">
                  {field === 'hub_id' ? (
                    <Select value={values.hub_id ?? ''} onValueChange={(v) => setValue('hub_id', v)}>
                      <SelectTrigger id="fix-hub_id" className={FIELD_CLASS}>
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
                  ) : (
                    <Input
                      id={`fix-${field}`}
                      type={field === 'email' ? 'email' : 'text'}
                      inputMode={field === 'pincode' ? 'numeric' : undefined}
                      value={values[field] ?? ''}
                      onChange={(e) => setValue(field, e.target.value)}
                      className={FIELD_CLASS}
                      aria-invalid={Boolean(errors[field])}
                      data-testid={`input-fix-${field}`}
                    />
                  )}
                </div>
                {errors[field] && <p className="mt-1 text-xs text-red-600">{errors[field]}</p>}
              </div>
            ))}
          </section>
        )}

        {slots.length > 0 && (
          <section className="space-y-3" data-testid="fix-documents">
            <h2 className="text-sm font-semibold text-foreground">Documents to upload again</h2>
            <AccountDocuments
              accountType={application.account_type}
              category={category}
              phone={profile.phone}
              accountName={accountName}
              gstin={(values.gstin ?? profile.gstin ?? '').toUpperCase()}
              replaceOnly={slots}
              onMissingChange={setMissingDocs}
              highlight={flagged}
            />
          </section>
        )}

        {formError && (
          <p role="alert" className="text-sm text-red-600" data-testid="text-fix-error">
            {formError}
          </p>
        )}

        <Button
          onClick={() => void send()}
          disabled={sending}
          className="h-12 w-full rounded-xl text-base font-semibold"
          data-testid="button-fix-send"
        >
          {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Send changes to Bombino'}
        </Button>
      </div>
    </AuthShell>
  );
}
