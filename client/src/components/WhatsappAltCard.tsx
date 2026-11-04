import { useEffect, useState, type MutableRefObject } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Check, Loader2, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { AccountPhoneInput } from '@/components/AccountPhoneInput';
import { apiRequest } from '@/lib/queryClient';
import { parseApiErrorMessage } from '@/lib/apiError';
import { cn } from '@/lib/utils';
import { formatAccountPhone, isAccountPhone } from '@shared/contact';

export const WHATSAPP_ALT_QUERY_KEY = ['/api/whatsapp/alt'] as const;

export interface WhatsappAltStatus {
  /** The sign-in number, as stored. */
  phone: string;
  international: boolean;
  whatsapp: 'on_whatsapp' | 'not_on_whatsapp' | 'unknown' | null;
  alt_phone: string | null;
  /** Whether the customer chose the second number for updates. */
  use_alt: boolean;
  /** Where updates go right now. `none`: the sign-in number has no WhatsApp and there is no second number. */
  sends_to: 'own' | 'alt' | 'none';
  needs_alt: boolean;
}

/** The status, for screens that only need to know whether to show the card. */
export function useWhatsappAltStatus(enabled = true) {
  return useQuery<WhatsappAltStatus>({
    queryKey: WHATSAPP_ALT_QUERY_KEY,
    enabled,
    staleTime: 60_000,
    retry: false,
  });
}

/**
 * Right after an OTP: does this number need a second WhatsApp number?
 *
 * The login code goes out on SMS and WhatsApp together, and Meta's verdict on
 * the WhatsApp one usually lands before the customer has typed the code. When
 * it has not yet, wait up to two seconds for it rather than guess. Still unknown
 * after that: don't ask; the profile and Home ask later if it turns out so.
 * Never throws.
 */
export async function checkNeedsWhatsappAlt(): Promise<WhatsappAltStatus | null> {
  // At most ~2 s: sign-in must never feel stuck on this.
  const attempts = 3;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await apiRequest('GET', '/api/whatsapp/alt');
      const status = (await res.json()) as WhatsappAltStatus;
      if (status.whatsapp !== 'unknown' || attempt === attempts - 1) return status.needs_alt ? status : null;
    } catch {
      return null;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return null;
}

/** What a screen's own main button drives when the form puts its action there. */
export interface WhatsappAltFormHandle {
  /** Send the code (number stage) or check it (code stage). */
  submit: () => void;
}

export interface WhatsappAltFormState {
  stage: 'phone' | 'otp';
  busy: boolean;
  /** Whether `submit` has something to do right now. */
  canSubmit: boolean;
}

/**
 * Add a second WhatsApp number: type it (any country), get a code on WhatsApp,
 * type it back. Saving it also chooses it for updates.
 *
 * With `handle`, the screen's own main button sends and checks the code, and
 * the small button under the number is `secondary` (signup's "Skip for now").
 */
export function WhatsappAltForm({
  ownPhone,
  onSaved,
  onCancel,
  handle,
  onStateChange,
  secondary,
}: {
  ownPhone: string;
  onSaved: () => void | Promise<void>;
  onCancel?: () => void;
  handle?: MutableRefObject<WhatsappAltFormHandle | null>;
  onStateChange?: (state: WhatsappAltFormState) => void;
  secondary?: { label: string; onClick: () => void };
}) {
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [altPhone, setAltPhone] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const sendCode = async (): Promise<void> => {
    if (!isAccountPhone(altPhone)) {
      setError('Enter a valid mobile number');
      return;
    }
    if (altPhone === ownPhone) {
      setError('That is the number you signed in with. Enter a different one.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await apiRequest('POST', '/api/whatsapp/alt/request', { alt_phone: altPhone });
      setCode('');
      setStep('otp');
    } catch (err) {
      setError(parseApiErrorMessage(err, 'Could not send the code'));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (value: string): Promise<void> => {
    if (value.length !== 6) return;
    setBusy(true);
    setError('');
    try {
      await apiRequest('POST', '/api/whatsapp/alt/confirm', { alt_phone: altPhone, code: value });
      await onSaved();
    } catch (err) {
      setError(parseApiErrorMessage(err, 'That code didn’t work'));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  if (handle) {
    handle.current = {
      submit: () => {
        if (step === 'phone') void sendCode();
        else void confirm(code);
      },
    };
  }
  const canSubmit = step === 'phone' ? !!altPhone : code.length === 6;
  useEffect(() => {
    onStateChange?.({ stage: step, busy, canSubmit });
  }, [step, busy, canSubmit, onStateChange]);

  return (
    <div className="space-y-2">
      {step === 'phone' ? (
        <>
          <AccountPhoneInput
            value={altPhone}
            onChange={(stored) => {
              setAltPhone(stored);
              setError('');
            }}
            onEnter={() => void sendCode()}
            disabled={busy}
            className="h-11 bg-white"
            aria-invalid={!!error || undefined}
            data-testid="input-whatsapp-alt-phone"
          />
          <div className="flex gap-2">
            {secondary ? (
              <Button
                type="button"
                size="sm"
                onClick={secondary.onClick}
                disabled={busy}
                data-testid="button-whatsapp-alt-skip"
              >
                {secondary.label}
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                onClick={() => void sendCode()}
                disabled={busy || !altPhone}
                data-testid="button-whatsapp-alt-send"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send code on WhatsApp'}
              </Button>
            )}
            {onCancel && (
              <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
                Cancel
              </Button>
            )}
          </div>
        </>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Enter the code we sent on WhatsApp to {formatAccountPhone(altPhone)}.
          </p>
          <InputOTP
            maxLength={6}
            value={code}
            onChange={(value) => {
              setCode(value);
              setError('');
              if (value.length === 6) void confirm(value);
            }}
            disabled={busy}
            data-testid="input-whatsapp-alt-otp"
          >
            <InputOTPGroup>
              {Array.from({ length: 6 }, (_, i) => (
                <InputOTPSlot key={i} index={i} />
              ))}
            </InputOTPGroup>
          </InputOTP>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setStep('phone')} disabled={busy}>
              Use a different number
            </Button>
            {secondary && (
              <Button type="button" size="sm" variant="ghost" onClick={secondary.onClick} disabled={busy}>
                {secondary.label}
              </Button>
            )}
          </div>
        </>
      )}
      {error && (
        <p className="text-xs text-red-600" role="alert" data-testid="text-whatsapp-alt-error">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The step signup and sign-in show when the number just verified is not on
 * WhatsApp: add one that is, or skip. Skipping is allowed; Home and the
 * profile keep asking.
 */
export function WhatsappAltPrompt({
  status,
  onDone,
  handle,
  onStateChange,
}: {
  status: WhatsappAltStatus;
  /** Called once a number is saved or the customer skips. */
  onDone: () => void;
  /**
   * Given: the screen's main button sends and checks the code ("Send code on
   * WhatsApp" / "Verify code"), and the small button is "Skip for now".
   * Not given: the small button sends the code and a link skips.
   */
  handle?: MutableRefObject<WhatsappAltFormHandle | null>;
  onStateChange?: (state: WhatsappAltFormState) => void;
}) {
  const showSkip = !handle;
  const queryClient = useQueryClient();
  return (
    <div className="space-y-4" data-testid="prompt-whatsapp-alt">
      <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden />
        <p className="text-xs leading-relaxed text-amber-900">
          {formatAccountPhone(status.phone)} isn’t on WhatsApp, so we can’t send you parcel updates there. Add a
          number that has WhatsApp, from any country, and updates will go to it.
        </p>
      </div>
      <WhatsappAltForm
        ownPhone={status.phone}
        handle={handle}
        onStateChange={onStateChange}
        secondary={handle ? { label: 'Skip for now', onClick: onDone } : undefined}
        onSaved={async () => {
          await queryClient.invalidateQueries({ queryKey: WHATSAPP_ALT_QUERY_KEY });
          onDone();
        }}
      />
      {showSkip && (
        <button
          type="button"
          onClick={onDone}
          className="w-full text-center text-xs font-semibold text-muted-foreground underline underline-offset-2"
          data-testid="button-whatsapp-alt-skip"
        >
          Skip for now
        </button>
      )}
    </div>
  );
}

/**
 * Where WhatsApp updates go, for any customer.
 *
 *   - sign-in number not on WhatsApp, no second number → an amber prompt to add one
 *   - otherwise, no second number → a quiet, optional "add another WhatsApp number"
 *   - second number saved → which of the two gets updates, with Change / Remove
 *
 * Which number a message goes to is decided on the server (server/whatsappAlt.ts).
 */
export function WhatsappAltCard({
  className,
  onlyWhenNeeded = false,
  onVerifyOwn,
}: {
  className?: string;
  /** Home: show only when updates would otherwise reach nobody. */
  onlyWhenNeeded?: boolean;
  /** Profile: re-check the sign-in number on WhatsApp ("it has WhatsApp now"). */
  onVerifyOwn?: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: status } = useWhatsappAltStatus();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!status) return null;
  // Kept on screen while they are part-way through adding one.
  if (onlyWhenNeeded && !status.needs_alt && !adding) return null;

  const refresh = (): Promise<void> => queryClient.invalidateQueries({ queryKey: WHATSAPP_ALT_QUERY_KEY });

  const run = async (action: () => Promise<unknown>, fallback: string): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      await action();
      await refresh();
    } catch (err) {
      setError(parseApiErrorMessage(err, fallback));
    } finally {
      setBusy(false);
    }
  };

  const remove = (): Promise<void> => run(() => apiRequest('DELETE', '/api/whatsapp/alt'), 'Could not remove it');
  const choose = (useAlt: boolean): Promise<void> =>
    run(() => apiRequest('PATCH', '/api/whatsapp/alt', { use_alt: useAlt }), 'Could not change that');

  const urgent = status.needs_alt;
  const own = formatAccountPhone(status.phone);
  const ownNotOnWhatsapp = status.whatsapp === 'not_on_whatsapp';

  let summary: string;
  if (status.alt_phone) summary = 'WhatsApp updates go to:';
  else if (urgent) summary = `${own} isn’t on WhatsApp. Add a number that has WhatsApp to get your parcel updates.`;
  else summary = `Updates go to ${own} on WhatsApp. You can add another WhatsApp number (optional).`;

  const option = (label: string, sub: string | null, selected: boolean, onPick: () => void, testId: string) => (
    <button
      type="button"
      onClick={onPick}
      disabled={busy || selected}
      className={cn(
        'flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition-colors',
        selected ? 'border-[#2F4468] bg-white' : 'border-border bg-transparent hover:bg-white/60'
      )}
      aria-pressed={selected}
      data-testid={testId}
    >
      <span
        className={cn(
          'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
          selected ? 'border-[#2F4468] bg-[#2F4468] text-white' : 'border-muted-foreground/40'
        )}
        aria-hidden
      >
        {selected && <Check className="h-3 w-3" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold tabular-nums text-foreground">{label}</span>
        {sub && <span className="block text-[11px] text-muted-foreground">{sub}</span>}
      </span>
    </button>
  );

  return (
    <div
      className={cn(
        'rounded-xl border px-3 py-2.5',
        urgent ? 'border-amber-200 bg-amber-50' : 'border-border bg-muted/40',
        className
      )}
      data-testid="card-whatsapp-alt"
    >
      <div className="flex items-start gap-2.5">
        {urgent ? (
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden />
        ) : (
          <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <p className={cn('text-xs leading-relaxed', urgent ? 'text-amber-900' : 'text-foreground')}>{summary}</p>

          {status.alt_phone && !adding && (
            <div className="mt-2 space-y-1.5">
              {option(
                own,
                ownNotOnWhatsapp ? 'Sign-in number · not on WhatsApp' : 'Sign-in number',
                status.sends_to === 'own',
                () => void choose(false),
                'option-whatsapp-own'
              )}
              {option(
                formatAccountPhone(status.alt_phone),
                ownNotOnWhatsapp && !status.use_alt ? 'Used anyway: your sign-in number isn’t on WhatsApp' : null,
                status.sends_to === 'alt',
                () => void choose(true),
                'option-whatsapp-alt'
              )}
            </div>
          )}

          {adding ? (
            <div className="mt-2">
              <WhatsappAltForm
                ownPhone={status.phone}
                onSaved={async () => {
                  setAdding(false);
                  await refresh();
                }}
                onCancel={() => setAdding(false)}
              />
            </div>
          ) : (
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
              <button
                type="button"
                onClick={() => {
                  setError('');
                  setAdding(true);
                }}
                disabled={busy}
                className={cn(
                  'text-xs font-semibold underline underline-offset-2',
                  urgent ? 'text-amber-900' : 'text-[#2F4468]'
                )}
                data-testid="button-whatsapp-alt-add"
              >
                {status.alt_phone ? 'Change number' : 'Add WhatsApp number'}
              </button>
              {status.alt_phone && (
                <button
                  type="button"
                  onClick={() => void remove()}
                  disabled={busy}
                  className="text-xs font-semibold text-red-600 underline underline-offset-2"
                  data-testid="button-whatsapp-alt-remove"
                >
                  Remove
                </button>
              )}
              {ownNotOnWhatsapp && onVerifyOwn && (
                <button
                  type="button"
                  onClick={onVerifyOwn}
                  disabled={busy}
                  className={cn(
                    'text-xs font-semibold underline underline-offset-2',
                    urgent ? 'text-amber-900' : 'text-[#2F4468]'
                  )}
                  data-testid="button-verify-whatsapp"
                >
                  {own} has WhatsApp now
                </button>
              )}
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />}
            </div>
          )}

          {error && (
            <p className="mt-1.5 text-xs text-red-600" role="alert" data-testid="text-whatsapp-alt-error">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
