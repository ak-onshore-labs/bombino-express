import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import bombinoLogo from '@/assets/bombino-logo.png';

interface AuthShellProps {
  /** Sets the header label AND the page heading — they were separate strings
   *  saying the same word ("Sign In" twice, stacked) before this. */
  title: string;
  /** One line of orientation for the current step. Replaces the fixed
   *  "Bringing the world closer" tagline on steps where it said nothing.
   *
   *  ReactNode rather than string so callers can mark up the customer's
   *  number — it is the subject of most of these sentences. */
  subtitle?: ReactNode;
  onBack: () => void;
  /** 1-based position in the flow. Omit for single-step screens. */
  step?: number;
  totalSteps?: number;
  /** Sits above the card, where the account-type toggle belongs. */
  beforeCard?: ReactNode;
  /** Right end of the header bar, after the step counter (e.g. Ask BIA). */
  headerAction?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  testId?: string;
}

/**
 * Common frame for every authentication screen.
 *
 * The app's ordinary treatment: soft white card on a tinted page, centred
 * masthead, amber for the one action that matters. It briefly wore a
 * "Freight Document" language — hairline rules, mono docket counters, content
 * sitting directly on the page — which was reverted everywhere else in
 * 71ca907; these two
 * screens kept it only because that commit was preserving the auth flow that
 * shipped alongside. This puts them back in step with the rest of the app.
 *
 * The multi-step flow itself is untouched: the shell renders whatever step the
 * page is on and knows nothing about which steps exist.
 */
export function AuthShell({
  title,
  subtitle,
  onBack,
  step,
  totalSteps,
  beforeCard,
  headerAction,
  children,
  footer,
  testId,
}: AuthShellProps) {
  const showProgress =
    typeof step === 'number' && typeof totalSteps === 'number' && totalSteps > 1;

  return (
    <div className="min-h-[100dvh] bg-background safe-top safe-bottom" data-testid={testId}>
      <header className="sticky top-0 z-50 bg-white border-b border-border">
        <div className="flex items-center h-14 px-4 max-w-md mx-auto w-full">
          <button
            onClick={onBack}
            className="p-2 -ml-2 rounded-lg hover:bg-muted transition-colors"
            aria-label="Go back"
            data-testid="button-back-auth"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <h1 className="ml-2 font-semibold">{title}</h1>
          {/* The original screens were single-step and had no counter. This
              flow has three, and losing the sense of how far along you are was
              the one thing worth keeping — so it stays, in plain muted text
              rather than the docket-style "01 / 03". */}
          {(showProgress || headerAction) && (
            <div className="ml-auto flex items-center gap-3">
              {showProgress && (
                <span
                  className="text-xs text-muted-foreground tabular-nums"
                  aria-label={`Step ${step} of ${totalSteps}`}
                >
                  Step {step} of {totalSteps}
                </span>
              )}
              {headerAction}
            </div>
          )}
        </div>
      </header>

      <main className="px-4 py-8 flex flex-col items-center">
        <div className="max-w-md mx-auto w-full">
          <div className="flex flex-col items-center mb-8">
            <img
              src={bombinoLogo}
              alt="Bombino Express"
              className="h-auto w-[180px] mb-6 object-contain"
            />
            <h2 className="text-xl font-semibold text-[lab(34.0831_-9.57756_-27.7093)]">
              {title}
            </h2>
            <p className="text-sm text-muted-foreground mt-1 text-center text-balance">
              {subtitle || 'Bringing the world closer'}
            </p>
          </div>

          {beforeCard}

          <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-[0_2px_12px_oklch(17%_0.048_248_/_0.06),_0_1px_3px_oklch(17%_0.048_248_/_0.04)] p-6 space-y-5 animate-fade-in">
            {children}
          </div>

          {footer}

          <p className="text-center text-xs text-muted-foreground mt-3">
            By continuing you agree to our{' '}
            <a href="/privacy" className="text-[#F2A123] underline hover:text-[#F2A123]/80">
              Privacy Policy
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}
