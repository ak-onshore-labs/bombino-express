import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AuthUser {
  id: string;
  customerId: string;
  code: string;
  email: string;
  fullName: string;
  username: string;
  role: string;
  /**
   * Absent for legacy ITD password logins and for sessions persisted to
   * localStorage before this field existed. Treat undefined as `personal` —
   * that keeps the stricter KYC path as the default.
   */
  account_type?: 'personal' | 'company';
}

interface AppState {
  hasSeenOnboarding: boolean;
  isLoggedIn: boolean;
  user: AuthUser | null;

  setHasSeenOnboarding: (value: boolean) => void;
  login: (user: AuthUser) => void;
  logout: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      hasSeenOnboarding: false,
      isLoggedIn: false,
      user: null,

      setHasSeenOnboarding: (value) => set({ hasSeenOnboarding: value }),

      login: (user) => set({ isLoggedIn: true, user }),

      logout: () => set({ isLoggedIn: false, user: null }),
    }),
    {
      name: 'bombino-storage',
      partialize: (state) => ({
        hasSeenOnboarding: state.hasSeenOnboarding,
        isLoggedIn: state.isLoggedIn,
        user: state.user,
      }),
    }
  )
);
