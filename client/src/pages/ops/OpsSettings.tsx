import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { OpsShell } from '@/components/ops/OpsShell';
import { BuildVersion } from '@/components/BuildVersion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { parseApiErrorMessage } from '@/lib/apiError';
import { formatIst } from '@/lib/orderDetail';
import { apiRequest } from '@/lib/queryClient';
import { useAppStore } from '@/lib/store';
import {
  OPS_SETTINGS_KEY,
  SETTINGS_PUBLIC_KEY,
} from '@/hooks/useSupportContacts';

const inputClass = 'h-12 bg-[#F3F4F6] border border-[#E2E8F0] rounded-md mt-2';

type OpsSettingRow = {
  key: string;
  value: unknown;
  updated_at: string | null;
  updated_by: string | null;
  updated_by_name: string | null;
};

function asDigits(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function lastChangedLine(row: OpsSettingRow | undefined): string | null {
  if (!row?.updated_at) return null;
  const when = formatIst(row.updated_at);
  if (row.updated_by_name) return `Last changed ${when} by ${row.updated_by_name}`;
  return `Last changed ${when}`;
}

export default function OpsSettings() {
  const role = useAppStore((s) => s.user?.role);
  const isSuperAdmin = role === 'super_admin';
  const queryClient = useQueryClient();

  const list = useQuery({
    queryKey: OPS_SETTINGS_KEY,
    queryFn: async () => {
      const res = await fetch('/api/ops/settings', { credentials: 'include' });
      if (!res.ok) {
        const text = (await res.text()) || res.statusText;
        throw new Error(`${res.status}: ${text}`);
      }
      const data = (await res.json()) as { settings: OpsSettingRow[] };
      return data.settings;
    },
    enabled: isSuperAdmin,
    retry: false,
    refetchOnMount: 'always',
  });

  const officeRow = list.data?.find((row) => row.key === 'support_office_phone');
  const whatsappRow = list.data?.find((row) => row.key === 'support_whatsapp');

  const [officePhone, setOfficePhone] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [formError, setFormError] = useState('');
  const [formNote, setFormNote] = useState('');

  useEffect(() => {
    if (!list.data) return;
    setOfficePhone(asDigits(officeRow?.value));
    setWhatsapp(asDigits(whatsappRow?.value));
    setFormError('');
    setFormNote('');
  }, [list.data, officeRow?.value, whatsappRow?.value]);

  const save = useMutation({
    mutationFn: async (body: { key: string; value: string }) => {
      const res = await apiRequest('PATCH', '/api/ops/settings', body);
      return (await res.json()) as { setting: OpsSettingRow };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SETTINGS_PUBLIC_KEY });
      void queryClient.invalidateQueries({ queryKey: OPS_SETTINGS_KEY });
    },
  });

  const saveContacts = async (): Promise<void> => {
    setFormError('');
    setFormNote('');
    const office = officePhone.trim();
    const wa = whatsapp.trim();
    if (!/^\d{10,15}$/.test(office) || !/^\d{10,15}$/.test(wa)) {
      setFormError('Enter a valid phone number (digits only)');
      return;
    }

    const patches: { key: string; value: string }[] = [];
    if (office !== asDigits(officeRow?.value)) {
      patches.push({ key: 'support_office_phone', value: office });
    }
    if (wa !== asDigits(whatsappRow?.value)) {
      patches.push({ key: 'support_whatsapp', value: wa });
    }
    if (patches.length === 0) {
      setFormNote('Nothing to change.');
      return;
    }

    try {
      for (const patch of patches) {
        await save.mutateAsync(patch);
      }
      setFormNote('Saved.');
    } catch (err) {
      setFormError(parseApiErrorMessage(err, 'Could not save settings'));
    }
  };

  if (!isSuperAdmin) {
    return (
      <OpsShell title="Settings" subtitle="App settings">
        <p
          className="text-sm text-muted-foreground"
          data-testid="ops-settings-admin-note"
        >
          Editing settings needs a super-admin account.
        </p>
        <BuildVersion className="mt-6 text-[11px]" />
      </OpsShell>
    );
  }

  return (
    <OpsShell title="Settings" subtitle="Support contacts">
      <section
        className="rounded-md border border-border bg-white p-4 mb-6"
        data-testid="ops-settings-contacts"
      >
        <h2 className="text-[11px] uppercase tracking-[0.14em] font-bold text-muted-foreground mb-1">
          Support contacts
        </h2>
        <p className="text-[11px] text-muted-foreground mb-4">
          Shown on the customer app and the rider app. Digits only.
        </p>

        {list.isLoading && (
          <div className="flex justify-center py-6">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}
        {list.isError && (
          <p className="text-sm text-red-600 mb-4">Could not load settings.</p>
        )}

        {!list.isLoading && !list.isError && (
          <>
            <div className="mb-4">
              <Label className="text-sm font-medium">Office phone</Label>
              <Input
                value={officePhone}
                onChange={(e) => {
                  setOfficePhone(e.target.value.replace(/\D/g, '').slice(0, 15));
                  if (formError) setFormError('');
                }}
                inputMode="numeric"
                className={inputClass}
                data-testid="input-ops-office-phone"
              />
              {lastChangedLine(officeRow) && (
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  {lastChangedLine(officeRow)}
                </p>
              )}
            </div>

            <div className="mb-4">
              <Label className="text-sm font-medium">Support WhatsApp</Label>
              <Input
                value={whatsapp}
                onChange={(e) => {
                  setWhatsapp(e.target.value.replace(/\D/g, '').slice(0, 15));
                  if (formError) setFormError('');
                }}
                inputMode="numeric"
                className={inputClass}
                data-testid="input-ops-whatsapp"
              />
              {lastChangedLine(whatsappRow) && (
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  {lastChangedLine(whatsappRow)}
                </p>
              )}
            </div>

            {formError && (
              <p
                className="text-sm font-semibold text-red-600 mb-3"
                data-testid="error-ops-settings"
              >
                {formError}
              </p>
            )}
            {formNote && (
              <p
                className="text-sm font-semibold text-emerald-700 mb-3"
                data-testid="note-ops-settings"
              >
                {formNote}
              </p>
            )}

            <Button
              type="button"
              onClick={() => void saveContacts()}
              disabled={save.isPending}
              className="w-full h-12 rounded-md bg-primary text-white font-bold"
              data-testid="button-ops-save-settings"
            >
              {save.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                'Save contacts'
              )}
            </Button>
          </>
        )}
      </section>

      {/* S2: guest_booking, cashfree_id_check, labels_at_booking, payments_test_mode
          drop here — same GET /api/ops/settings and PATCH /api/ops/settings. */}
      <section
        className="rounded-md border border-border bg-white p-4 mb-6"
        data-testid="ops-settings-switches"
      >
        <h2 className="text-[11px] uppercase tracking-[0.14em] font-bold text-muted-foreground mb-1">
          Switches
        </h2>
        <p className="text-[11px] text-muted-foreground">
          On/off switches for guest booking, Cashfree, labels at booking and
          payments test mode will live here.
        </p>
      </section>

      <AppUpdateEditor
        title="iOS app update"
        settingKey="app_update_ios"
        row={list.data?.find((row) => row.key === 'app_update_ios')}
        disabled={list.isLoading || list.isError}
        onSaved={() => {
          void queryClient.invalidateQueries({ queryKey: SETTINGS_PUBLIC_KEY });
          void queryClient.invalidateQueries({ queryKey: OPS_SETTINGS_KEY });
        }}
      />

      <AppUpdateEditor
        title="Android app update"
        settingKey="app_update_android"
        row={list.data?.find((row) => row.key === 'app_update_android')}
        disabled={list.isLoading || list.isError}
        onSaved={() => {
          void queryClient.invalidateQueries({ queryKey: SETTINGS_PUBLIC_KEY });
          void queryClient.invalidateQueries({ queryKey: OPS_SETTINGS_KEY });
        }}
      />

      <BuildVersion className="mt-6 text-[11px]" />
    </OpsShell>
  );
}

type AppUpdateValue = {
  mode: 'off' | 'soft' | 'force';
  min_shell: number;
  store_url: string;
  message?: string;
};

function asAppUpdate(value: unknown): AppUpdateValue {
  if (!value || typeof value !== 'object') {
    return { mode: 'off', min_shell: 2, store_url: '', message: '' };
  }
  const v = value as Record<string, unknown>;
  return {
    mode: v.mode === 'soft' || v.mode === 'force' || v.mode === 'off' ? v.mode : 'off',
    min_shell: typeof v.min_shell === 'number' && Number.isFinite(v.min_shell) ? v.min_shell : 2,
    store_url: typeof v.store_url === 'string' ? v.store_url : '',
    message: typeof v.message === 'string' ? v.message : '',
  };
}

function AppUpdateEditor({
  title,
  settingKey,
  row,
  disabled,
  onSaved,
}: {
  title: string;
  settingKey: 'app_update_ios' | 'app_update_android';
  row: OpsSettingRow | undefined;
  disabled: boolean;
  onSaved: () => void;
}) {
  const initial = asAppUpdate(row?.value);
  const [mode, setMode] = useState<AppUpdateValue['mode']>(initial.mode);
  const [minShell, setMinShell] = useState(String(initial.min_shell));
  const [storeUrl, setStoreUrl] = useState(initial.store_url);
  const [message, setMessage] = useState(initial.message ?? '');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    const next = asAppUpdate(row?.value);
    setMode(next.mode);
    setMinShell(String(next.min_shell));
    setStoreUrl(next.store_url);
    setMessage(next.message ?? '');
    setError('');
    setNote('');
  }, [row?.value]);

  const save = useMutation({
    mutationFn: async (value: AppUpdateValue) => {
      const res = await apiRequest('PATCH', '/api/ops/settings', {
        key: settingKey,
        value,
      });
      return res.json();
    },
    onSuccess: () => onSaved(),
  });

  const onSave = async (): Promise<void> => {
    setError('');
    setNote('');
    const min = Number(minShell);
    if (!Number.isInteger(min) || min < 0) {
      setError('Minimum shell version must be a whole number (0 or more).');
      return;
    }
    if (mode !== 'off' && !storeUrl.trim()) {
      setError('Store link is required when mode is soft or force.');
      return;
    }
    const value: AppUpdateValue = {
      mode,
      min_shell: min,
      store_url: storeUrl.trim() || 'https://apps.apple.com',
      ...(message.trim() ? { message: message.trim() } : {}),
    };
    // When mode is off, still need a valid URL for the Zod schema.
    if (mode === 'off' && !storeUrl.trim()) {
      value.store_url =
        settingKey === 'app_update_ios'
          ? 'https://apps.apple.com'
          : 'https://play.google.com/store';
    }
    try {
      await save.mutateAsync(value);
      setNote('Saved.');
    } catch (err) {
      setError(parseApiErrorMessage(err, 'Could not save setting'));
    }
  };

  return (
    <section
      className="rounded-md border border-border bg-white p-4 mb-6"
      data-testid={`ops-settings-${settingKey}`}
    >
      <h2 className="text-[11px] uppercase tracking-[0.14em] font-bold text-muted-foreground mb-1">
        {title}
      </h2>
      <p className="text-[11px] text-muted-foreground mb-4">
        Ships off. Soft shows a dismissible banner; force blocks the app until they update.
        Minimum shell is the BombinoShell/N marker (store builds report 0).
      </p>

      <div className="mb-4">
        <Label className="text-sm font-medium">Mode</Label>
        <select
          className={`${inputClass} w-full`}
          value={mode}
          disabled={disabled || save.isPending}
          onChange={(e) => setMode(e.target.value as AppUpdateValue['mode'])}
          data-testid={`select-${settingKey}-mode`}
        >
          <option value="off">Off</option>
          <option value="soft">Soft banner</option>
          <option value="force">Force update</option>
        </select>
      </div>

      <div className="mb-4">
        <Label className="text-sm font-medium">Minimum shell version</Label>
        <Input
          value={minShell}
          onChange={(e) => setMinShell(e.target.value.replace(/\D/g, '').slice(0, 4))}
          inputMode="numeric"
          className={inputClass}
          disabled={disabled || save.isPending}
          data-testid={`input-${settingKey}-min-shell`}
        />
      </div>

      <div className="mb-4">
        <Label className="text-sm font-medium">Store link (https)</Label>
        <Input
          value={storeUrl}
          onChange={(e) => setStoreUrl(e.target.value)}
          className={inputClass}
          placeholder={
            settingKey === 'app_update_ios'
              ? 'https://apps.apple.com/app/…'
              : 'https://play.google.com/store/apps/…'
          }
          disabled={disabled || save.isPending}
          data-testid={`input-${settingKey}-store-url`}
        />
      </div>

      <div className="mb-4">
        <Label className="text-sm font-medium">Message (optional)</Label>
        <Input
          value={message}
          onChange={(e) => setMessage(e.target.value.slice(0, 200))}
          className={inputClass}
          disabled={disabled || save.isPending}
          data-testid={`input-${settingKey}-message`}
        />
      </div>

      {lastChangedLine(row) && (
        <p className="text-[11px] text-muted-foreground mb-3">{lastChangedLine(row)}</p>
      )}
      {error && (
        <p className="text-sm font-semibold text-red-600 mb-3" data-testid={`error-${settingKey}`}>
          {error}
        </p>
      )}
      {note && (
        <p className="text-sm font-semibold text-emerald-700 mb-3">{note}</p>
      )}

      <Button
        type="button"
        onClick={() => void onSave()}
        disabled={disabled || save.isPending}
        className="w-full h-12 rounded-md bg-primary text-white font-bold"
        data-testid={`button-save-${settingKey}`}
      >
        {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
      </Button>
    </section>
  );
}
