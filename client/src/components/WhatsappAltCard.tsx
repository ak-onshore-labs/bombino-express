import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Loader2, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { apiRequest } from '@/lib/queryClient';
import { parseApiErrorMessage } from '@/lib/apiError';
import { cn } from '@/lib/utils';
import { formatAccountPhone, isIndianMobile, toIndianMobile } from '@shared/contact';

export const WHATSAPP_ALT_QUERY_KEY = ['/api/whatsapp/alt'] as const;

export interface WhatsappAltStatus {
  /** The sign-in number, as stored. */
  phone: string;
  international: boolean;
  whatsapp: 'on_whatsapp' | 'not_on_whatsapp' | 'unknown' | null;
  alt_phone: string | null;
  /** Where updates go right now. `none`: the sign-in number has no WhatsApp and there is no alternate. */
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

type Step = 'idle' | 'phone' | 'otp';

/**
 * The Indian WhatsApp number for a customer who signs in from abroad.
 *
 * Renders nothing for an Indian number. For a number from abroad:
 *   - not on WhatsApp, no alternate → an amber prompt to add one
 *   - on WhatsApp (or not yet known) → a quiet, optional "add an Indian number"
 *   - alternate saved → shows it, with Change / Remove
 *
 * Adding one sends a code on WhatsApp to the Indian number (never SMS); typing
 * it back saves it. Which number a message goes to is decided on the server
 * (server/whatsappAlt.ts).
 */
export function WhatsappAltCard({
  className,
  onlyWhenNeeded = false,
}: {
  className?: string;
  /** Home: show only when updates would otherwise reach nobody. */
  onlyWhenNeeded?: boolean;
}) {
  const queryClient = useQueryClient();
  const { data: status } = useWhatsappAltStatus();
  const [step, setStep] = useState<Step>('idle');
  const [altPhone, setAltPhone] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!status?.international) return null;
  // Kept on screen while they are part-way through adding one.
  if (onlyWhenNeeded && !status.needs_alt && step === 'idle') return null;

  const refresh = (): Promise<void> => queryClient.invalidateQueries({ queryKey: WHATSAPP_ALT_QUERY_KEY });

  const start = (): void => {
    setAltPhone('');
    setCode('');
    setError('');
    setStep('phone');
  };

  const sendCode = async (): Promise<void> => {
    if (!isIndianMobile(altPhone) || !/^[6-9]/.test(altPhone)) {
      setError('Enter a valid 10-digit Indian mobile number');
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
      setStep('idle');
      await refresh();
    } catch (err) {
      setError(parseApiErrorMessage(err, 'That code didn’t work'));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      await apiRequest('DELETE', '/api/whatsapp/alt');
      await refresh();
    } catch (err) {
      setError(parseApiErrorMessage(err, 'Could not remove it'));
    } finally {
      setBusy(false);
    }
  };

  const urgent = status.needs_alt;
  const own = formatAccountPhone(status.phone);

  let summary: string;
  if (status.alt_phone) {
    summary =
      status.sends_to === 'alt'
        ? `${own} isn’t on WhatsApp, so your updates go to ${formatAccountPhone(status.alt_phone)}.`
        : `Updates go to ${own} on WhatsApp. ${formatAccountPhone(status.alt_phone)} is your backup.`;
  } else if (urgent) {
    summary = `${own} isn’t on WhatsApp. Add an Indian number that has WhatsApp to get your parcel updates.`;
  } else {
    summary = `Updates go to ${own} on WhatsApp. You can also add an Indian WhatsApp number (optional).`;
  }

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

          {step === 'idle' && (
            <div className="mt-1 flex gap-3">
              <button
                type="button"
                onClick={start}
                disabled={busy}
                className={cn(
                  'text-xs font-semibold underline underline-offset-2',
                  urgent ? 'text-amber-900' : 'text-[#2F4468]'
                )}
                data-testid="button-whatsapp-alt-add"
              >
                {status.alt_phone ? 'Change' : 'Add Indian WhatsApp number'}
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
            </div>
          )}

          {step === 'phone' && (
            <div className="mt-2 space-y-2">
              <div className="flex items-stretch gap-2">
                <span className="flex items-center rounded-xl border border-[#E2E8F0] bg-[#F3F4F6] px-3 text-sm font-medium">
                  🇮🇳 +91
                </span>
                <Input
                  type="tel"
                  inputMode="numeric"
                  autoFocus
                  value={altPhone}
                  onChange={(e) => {
                    setAltPhone(toIndianMobile(e.target.value));
                    setError('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void sendCode();
                    }
                  }}
                  placeholder="98765 43210"
                  disabled={busy}
                  className="h-10 min-w-0 flex-1 rounded-xl"
                  data-testid="input-whatsapp-alt-phone"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void sendCode()}
                  disabled={busy || altPhone.length !== 10}
                  data-testid="button-whatsapp-alt-send"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send code on WhatsApp'}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setStep('idle')} disabled={busy}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {step === 'otp' && (
            <div className="mt-2 space-y-2">
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
              </div>
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
