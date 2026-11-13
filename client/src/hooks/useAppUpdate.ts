/**
 * Whether this native shell should show a soft or force update prompt.
 * Always none on the web, on fetch failure, or when the setting is off/null.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SETTINGS_PUBLIC_KEY } from '@/hooks/useSupportContacts';
import { nativePlatform, shellVersion } from '@/lib/platform';

export type AppUpdateSetting = {
  mode: 'off' | 'soft' | 'force';
  min_shell: number;
  store_url: string;
  message?: string;
};

export type AppUpdateDecision =
  | { kind: 'none' }
  | { kind: 'soft' | 'force'; setting: AppUpdateSetting };

type PublicSettings = {
  support_office_phone?: unknown;
  support_whatsapp?: unknown;
  app_update_ios?: AppUpdateSetting | null;
  app_update_android?: AppUpdateSetting | null;
};

function parseSetting(value: unknown): AppUpdateSetting | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (v.mode !== 'off' && v.mode !== 'soft' && v.mode !== 'force') return null;
  if (typeof v.min_shell !== 'number' || !Number.isFinite(v.min_shell)) return null;
  if (typeof v.store_url !== 'string' || !v.store_url) return null;
  return {
    mode: v.mode,
    min_shell: v.min_shell,
    store_url: v.store_url,
    message: typeof v.message === 'string' ? v.message : undefined,
  };
}

function decide(data: PublicSettings | undefined): AppUpdateDecision {
  const platform = nativePlatform();
  if (!platform) return { kind: 'none' };
  const raw = platform === 'ios' ? data?.app_update_ios : data?.app_update_android;
  const setting = parseSetting(raw);
  if (!setting || setting.mode === 'off') return { kind: 'none' };
  if (shellVersion() >= setting.min_shell) return { kind: 'none' };
  return { kind: setting.mode, setting };
}

function razorpayOpen(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.classList.contains('rzp-open');
}

export function useAppUpdate(): AppUpdateDecision {
  const queryClient = useQueryClient();
  const held = useRef<AppUpdateDecision | null>(null);
  const [decision, setDecision] = useState<AppUpdateDecision>({ kind: 'none' });

  const query = useQuery({
    queryKey: SETTINGS_PUBLIC_KEY,
    queryFn: async (): Promise<PublicSettings> => {
      const res = await fetch('/api/settings');
      if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
      return (await res.json()) as PublicSettings;
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const recompute = useCallback(() => {
    if (razorpayOpen()) {
      if (held.current) setDecision(held.current);
      return;
    }
    if (query.isError || !query.data) {
      held.current = { kind: 'none' };
      setDecision({ kind: 'none' });
      return;
    }
    const next = decide(query.data);
    held.current = next;
    setDecision(next);
  }, [query.data, query.isError]);

  useEffect(() => {
    recompute();
  }, [recompute]);

  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState !== 'visible') return;
      if (razorpayOpen()) return;
      void queryClient.invalidateQueries({ queryKey: SETTINGS_PUBLIC_KEY });
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [queryClient]);

  return decision;
}
