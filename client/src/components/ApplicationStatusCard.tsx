import { useState } from 'react';
import { useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Clock, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiRequest } from '@/lib/queryClient';
import { parseApiErrorMessage } from '@/lib/apiError';
import { invalidateGuestProfile, GUEST_PROFILE_QUERY_KEY } from '@/hooks/useGuestProfile';
import { NOTIFICATIONS_KEY } from '@/hooks/useCustomerOrders';
import { cn } from '@/lib/utils';
import { DOC_SLOT_SPECS, isDocSlot } from '@shared/accountSpec';
import {
  APPLICATION_FIELD_LABELS,
  APPLICATION_STATUS_COPY,
  isApplicationField,
  isOpenApplicationStatus,
  type CustomerApplicationView,
} from '@shared/applicationStatus';

interface ApplicationStatusCardProps {
  application: CustomerApplicationView;
  phone: string;
  /** Home shows the short form; the profile shows everything. */
  compact?: boolean;
}

/**
 * Where the customer's account application stands (account review).
 *
 * While the Bombino team is setting the account up the customer is a guest,
 * and this card is what tells them so, on Home and on their profile. Each
 * status has one thing to do next, and only one: wait, make the change the team
 * asked for, sign in to the new account, or apply again.
 */
export function ApplicationStatusCard({
  application,
  phone,
  compact = false,
}: ApplicationStatusCardProps): React.JSX.Element {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const copy = APPLICATION_STATUS_COPY[application.status];
  const open = isOpenApplicationStatus(application.status);

  /** Signup again, with the shape they chose. Signup prefills from the guest profile. */
  const reopenSignup = (): void => {
    const params = new URLSearchParams({ phone, redirect: '/guest-profile', type: application.account_type });
    if (application.company_category) params.set('category', application.company_category);
    setLocation(`/signup?${params.toString()}`);
  };

  /**
   * Into the account the team just opened. The guest session is ended first:
   * the account is a different identity, and signing in over a live guest
   * session would leave both in one browser.
   */
  const signInToAccount = async (): Promise<void> => {
    setBusy(true);
    try {
      await apiRequest('POST', '/api/auth/logout', {});
    } catch {
      // Already gone server-side is fine; the sign-in below starts clean.
    }
    queryClient.setQueryData(GUEST_PROFILE_QUERY_KEY, null);
    queryClient.removeQueries({ queryKey: NOTIFICATIONS_KEY });
    setBusy(false);
    setLocation(`/login?${new URLSearchParams({ phone, reason: 'account_ready' }).toString()}`);
  };

  const withdraw = async (): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      await apiRequest('POST', '/api/signup/application/withdraw', {});
      invalidateGuestProfile(queryClient);
      setConfirmWithdraw(false);
    } catch (err) {
      setError(parseApiErrorMessage(err, 'Could not withdraw your application'));
    } finally {
      setBusy(false);
    }
  };

  const tone =
    application.status === 'approved'
      ? { box: 'border-emerald-200 bg-emerald-50', icon: 'text-emerald-600', Icon: CheckCircle2 }
      : application.status === 'changes_requested'
        ? { box: 'border-amber-200 bg-amber-50', icon: 'text-amber-600', Icon: AlertCircle }
        : application.status === 'rejected' || application.status === 'withdrawn'
          ? { box: 'border-border bg-card', icon: 'text-muted-foreground', Icon: XCircle }
          : { box: 'border-sky-200 bg-sky-50', icon: 'text-sky-600', Icon: Clock };

  const changes = application.requested_changes;
  const changeItems = changes
    ? [
        ...changes.fields.map((f) => (isApplicationField(f) ? APPLICATION_FIELD_LABELS[f] : f)),
        ...changes.slots.map((s) => `${isDocSlot(s) ? DOC_SLOT_SPECS[s].label : s} (upload again)`),
      ]
    : [];

  return (
    <section
      className={cn('rounded-2xl border p-4', tone.box)}
      data-testid={`application-status-${application.status}`}
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <tone.Icon className={cn('mt-0.5 h-5 w-5 shrink-0', tone.icon)} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{copy.title}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{copy.body}</p>

          {application.status === 'changes_requested' && changes && !compact && (
            <div className="mt-3 space-y-2">
              {changes.note && (
                <blockquote className="border-l-2 border-amber-400 pl-3 text-sm text-foreground">
                  {changes.note}
                </blockquote>
              )}
              {changeItems.length > 0 && (
                <ul className="list-disc pl-5 text-xs text-foreground">
                  {changeItems.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {application.status === 'rejected' && application.decision_note && !compact && (
            <blockquote className="mt-3 border-l-2 border-border pl-3 text-sm text-foreground">
              {application.decision_note}
            </blockquote>
          )}

          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {application.status === 'approved' && (
              <Button
                onClick={() => void signInToAccount()}
                disabled={busy}
                className="h-10 rounded-xl text-sm font-semibold"
                data-testid="button-application-sign-in"
              >
                Sign in to my account
              </Button>
            )}
            {application.status === 'changes_requested' && (
              <Button
                onClick={compact ? () => setLocation('/guest-profile') : reopenSignup}
                className="h-10 rounded-xl text-sm font-semibold"
                data-testid="button-application-fix"
              >
                {compact ? 'See what to change' : 'Make the change'}
              </Button>
            )}
            {(application.status === 'rejected' || application.status === 'withdrawn') && !compact && (
              <Button
                variant="outline"
                onClick={reopenSignup}
                className="h-10 rounded-xl text-sm font-semibold"
                data-testid="button-application-reapply"
              >
                Apply again
              </Button>
            )}
            {open && compact && application.status !== 'changes_requested' && (
              <Button
                variant="outline"
                onClick={() => setLocation('/guest-profile')}
                className="h-10 rounded-xl text-sm font-semibold"
                data-testid="button-application-details"
              >
                Details
              </Button>
            )}

            {open && !compact && !confirmWithdraw && (
              <button
                type="button"
                onClick={() => setConfirmWithdraw(true)}
                className="text-xs font-medium text-muted-foreground underline underline-offset-2"
                data-testid="button-application-withdraw"
              >
                Withdraw application
              </button>
            )}
            {open && !compact && confirmWithdraw && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-foreground">Withdraw it? You can apply again later.</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void withdraw()}
                  className="font-semibold text-red-600"
                  data-testid="button-application-withdraw-confirm"
                >
                  Withdraw
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmWithdraw(false)}
                  className="font-medium text-muted-foreground"
                >
                  Keep it
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
