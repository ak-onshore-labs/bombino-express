import { useEffect } from 'react';
import { create } from 'zustand';
import type { BiaScreen } from '@shared/biaScreen';

/**
 * Whether the BIA sheet is open, and what it was opened for.
 *
 * Anything in the app can open BIA over the current screen with `openBia`:
 * the support button, an "Ask BIA" link beside an error, the order page.
 * `requestId` goes up on every open, so the chat can tell a fresh request
 * (whose seed it must send) from the same one re-rendering.
 */

export interface BiaOpenRequest {
  /** Where the customer is. Only known values survive on the server. */
  screen: BiaScreen;
  /** A first message to send for them, e.g. about the error they just saw. */
  seed?: string;
}

interface BiaState {
  open: boolean;
  screen: BiaScreen;
  seed: string | null;
  requestId: number;
  /**
   * What the page on screen knows about itself beyond its path — the signup
   * step and account, the booking step — for the support button to open BIA
   * with. Null when the page publishes nothing.
   */
  pageScreen: BiaScreen | null;
  openBia: (request: BiaOpenRequest) => void;
  closeBia: () => void;
  setPageScreen: (screen: BiaScreen | null) => void;
}

export const useBiaStore = create<BiaState>()((set) => ({
  open: false,
  screen: { surface: 'help' },
  seed: null,
  requestId: 0,
  pageScreen: null,
  openBia: ({ screen, seed }) =>
    set((state) => ({ open: true, screen, seed: seed ?? null, requestId: state.requestId + 1 })),
  closeBia: () => set({ open: false }),
  setPageScreen: (pageScreen) => set({ pageScreen }),
}));

/** Open BIA over the current screen. Safe to call from anywhere. */
export function openBia(request: BiaOpenRequest): void {
  useBiaStore.getState().openBia(request);
}

/**
 * A page telling BIA where the customer is within it, for as long as it is
 * mounted. While BIA is open, a change (the next signup step, say) also
 * reaches the open chat, so the next question is answered for the new step.
 */
export function usePublishBiaScreen(screen: BiaScreen): void {
  const key = JSON.stringify(screen);
  useEffect(() => {
    const next = JSON.parse(key) as BiaScreen;
    useBiaStore.getState().setPageScreen(next);
    const { open, screen: current } = useBiaStore.getState();
    // Keep an error the chat was opened about: it's still the subject.
    if (open && current.surface === next.surface) {
      useBiaStore.setState({ screen: { ...next, ...(current.errorCode ? { errorCode: current.errorCode } : {}) } });
    }
  }, [key]);
  useEffect(() => () => useBiaStore.getState().setPageScreen(null), []);
}
