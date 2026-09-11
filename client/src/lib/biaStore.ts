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
  openBia: (request: BiaOpenRequest) => void;
  closeBia: () => void;
}

export const useBiaStore = create<BiaState>()((set) => ({
  open: false,
  screen: { surface: 'help' },
  seed: null,
  requestId: 0,
  openBia: ({ screen, seed }) =>
    set((state) => ({ open: true, screen, seed: seed ?? null, requestId: state.requestId + 1 })),
  closeBia: () => set({ open: false }),
}));

/** Open BIA over the current screen. Safe to call from anywhere. */
export function openBia(request: BiaOpenRequest): void {
  useBiaStore.getState().openBia(request);
}
