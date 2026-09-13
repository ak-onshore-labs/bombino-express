import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { OpsShell } from '@/components/ops/OpsShell';
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

const inputClass = 'h-12 bg-[#F3F4F6] border border-[#E2E8F0] rounded-xl mt-2';

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
      </OpsShell>
    );
  }

  return (
    <OpsShell title="Settings" subtitle="Support contacts">
      <section
        className="rounded-2xl border border-border bg-white p-4 mb-6"
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
              className="w-full h-12 rounded-xl bg-primary text-white font-bold"
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
        className="rounded-2xl border border-border bg-white p-4"
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
    </OpsShell>
  );
}
