import type { ReactNode } from 'react';
import { useLocation } from 'wouter';
import bombinoLogo from '@/assets/bombino-logo.png';
import { useAppUpdate } from '@/hooks/useAppUpdate';
import { UpdateStrip } from '@/components/UpdateBanner';
import { useBackClose } from '@/lib/backButton';
import { surfaceForPath } from '@/lib/surface';

/**
 * Force update screen, and soft strips on agent/ops.
 * Customer soft banner lives in Header / AppLayout (verification banner slot).
 */
export function UpdateGate({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const decision = useAppUpdate();
  // Absorb Android back so we never navigate under a mandatory update.
  useBackClose(decision.kind === 'force', () => {}, 100);

  if (decision.kind === 'force') {
    return (
      <div
        className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-white px-6"
        data-testid="screen-force-update"
      >
        <img src={bombinoLogo} alt="Bombino" className="mb-6 h-10 w-auto" />
        <p className="mb-6 max-w-sm text-center text-base text-foreground">
          {decision.setting.message?.trim() || 'Please update Bombino to continue'}
        </p>
        <button
          type="button"
          className="h-12 min-w-[180px] rounded-xl bg-primary px-6 text-sm font-semibold text-white"
          onClick={() => {
            window.location.href = decision.setting.store_url;
          }}
          data-testid="button-force-update"
        >
          Update
        </button>
      </div>
    );
  }

  const surface = surfaceForPath(location);
  const softOnStaff =
    decision.kind === 'soft' && (surface === 'agent' || surface === 'ops');

  return (
    <>
      {softOnStaff ? <UpdateStrip /> : null}
      {children}
    </>
  );
}
