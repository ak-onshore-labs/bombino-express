import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { Loader2 } from 'lucide-react';
import { OpsShell } from '@/components/ops/OpsShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { parseApiErrorMessage } from '@/lib/apiError';
import { apiRequest } from '@/lib/queryClient';
import { cn } from '@/lib/utils';
import { INDIA_HUBS } from '@shared/hubs';
import { OPS_USERS_KEY } from '@/hooks/useOpsOrders';

type StaffRole = 'agent' | 'admin';

type StaffUser = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  role: string;
  is_active: boolean;
  /** Rounds this agent runs. Read-only here — edited on the rider's page. */
  beats: string[];
};

const inputClass = 'h-12 bg-[#F3F4F6] border border-[#E2E8F0] rounded-xl mt-2';

export default function OpsUsers() {
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  // ITD attribution for the corporate `add_customer` call, and unrelated to
  // pickup beats despite sharing city names with them. A rider's coverage is
  // set on their profile page.
  const [hubId, setHubId] = useState('');
  const [role, setRole] = useState<StaffRole>('agent');
  const [formError, setFormError] = useState('');

  const list = useQuery({
    queryKey: OPS_USERS_KEY,
    queryFn: async () => {
      const res = await fetch('/api/ops/users', { credentials: 'include' });
      if (!res.ok) {
        const text = (await res.text()) || res.statusText;
        throw new Error(`${res.status}: ${text}`);
      }
      const data = (await res.json()) as { users: StaffUser[] };
      return data.users;
    },
    retry: false,
    refetchOnMount: 'always',
  });

  const create = useMutation({
    mutationFn: async (body: {
      full_name: string;
      phone: string;
      role: StaffRole;
      hub_id: number;
    }) => {
      const res = await apiRequest('POST', '/api/ops/users', body);
      return (await res.json()) as {
        id: string;
        phone: string;
        full_name: string;
        role: string;
      };
    },
    onSuccess: () => {
      setFullName('');
      setPhone('');
      setHubId('');
      setRole('agent');
      setFormError('');
      void queryClient.invalidateQueries({ queryKey: OPS_USERS_KEY });
    },
    onError: (err) => {
      setFormError(parseApiErrorMessage(err, 'Could not create user'));
    },
  });

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    setFormError('');
    const name = fullName.trim();
    if (!name) {
      setFormError('Full name is required');
      return;
    }
    if (!/^\d{10}$/.test(phone)) {
      setFormError('Enter a valid 10-digit phone number');
      return;
    }
    const hub = Number(hubId);
    if (!Number.isInteger(hub) || !INDIA_HUBS.some((h) => h.id === hub)) {
      setFormError('Select a valid hub');
      return;
    }
    create.mutate({ full_name: name, phone, role, hub_id: hub });
  };

  return (
    <OpsShell title="Users" subtitle="Add pickup agents and admins">
      <form
        onSubmit={submit}
        className="rounded-2xl border border-border bg-white p-4 mb-6"
        data-testid="ops-add-user-form"
      >
        <h2 className="text-[11px] uppercase tracking-[0.14em] font-bold text-muted-foreground mb-4">
          Add user
        </h2>

        <div className="mb-4">
          <Label className="text-sm font-medium">Full name</Label>
          <Input
            value={fullName}
            onChange={(e) => {
              setFullName(e.target.value);
              if (formError) setFormError('');
            }}
            placeholder="Name"
            className={inputClass}
            autoComplete="name"
            data-testid="input-ops-user-name"
          />
        </div>

        <div className="mb-4">
          <Label className="text-sm font-medium">Phone</Label>
          <Input
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value.replace(/\D/g, '').slice(0, 10));
              if (formError) setFormError('');
            }}
            placeholder="10-digit mobile"
            inputMode="numeric"
            maxLength={10}
            className={inputClass}
            autoComplete="tel"
            data-testid="input-ops-user-phone"
          />
        </div>

        <div className="mb-4">
          <Label className="text-sm font-medium">Hub</Label>
          <Select
            value={hubId || undefined}
            onValueChange={(value) => {
              setHubId(value);
              if (formError) setFormError('');
            }}
          >
            <SelectTrigger
              className={cn(inputClass, 'w-full')}
              data-testid="select-ops-user-hub"
            >
              <SelectValue placeholder="Select a hub" />
            </SelectTrigger>
            <SelectContent>
              {INDIA_HUBS.map((hub) => (
                <SelectItem key={hub.id} value={String(hub.id)}>
                  {hub.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="mb-4">
          <p className="text-sm font-medium mb-2">Role</p>
          <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="Role">
            {(['agent', 'admin'] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={role === value}
                onClick={() => setRole(value)}
                className={cn(
                  'h-11 rounded-xl border text-sm font-semibold capitalize',
                  role === value
                    ? 'border-primary bg-primary text-white'
                    : 'border-[#E2E8F0] bg-[#F3F4F6] text-foreground',
                )}
                data-testid={`button-ops-user-role-${value}`}
              >
                {value === 'agent' ? 'Pickup agent' : 'Admin'}
              </button>
            ))}
          </div>
        </div>

        {formError && (
          <p className="text-sm font-semibold text-red-600 mb-3" data-testid="error-ops-add-user">
            {formError}
          </p>
        )}

        <Button
          type="submit"
          disabled={create.isPending}
          className="w-full h-12 rounded-xl bg-primary text-white font-bold"
          data-testid="button-ops-add-user"
        >
          {create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Add user'}
        </Button>
      </form>

      <section data-testid="ops-staff-list">
        <h2 className="text-[11px] uppercase tracking-[0.14em] font-bold text-muted-foreground mb-3">
          Staff
        </h2>
        {list.isLoading && (
          <div className="flex justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}
        {list.isError && (
          <p className="text-sm text-red-600 py-6 text-center">Could not load users. Try refreshing.</p>
        )}
        {!list.isLoading && !list.isError && (list.data?.length ?? 0) === 0 && (
          <p className="text-sm text-muted-foreground py-8 text-center">No staff yet.</p>
        )}
        {!list.isLoading && !list.isError && (list.data?.length ?? 0) > 0 && (
          <ul className="rounded-2xl border border-border bg-white divide-y divide-border">
            {list.data!.map((user) => (
              <li key={user.id}>
                <Link
                  href={`/ops/users/${user.id}`}
                  className="block px-4 py-3 hover:bg-muted/40 transition-colors"
                  data-testid={`ops-staff-row-${user.id}`}
                >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-extrabold text-foreground truncate">{user.full_name}</p>
                    <p className="text-sm text-muted-foreground tabular-nums mt-0.5">
                      {user.phone ?? '—'}
                    </p>
                    {user.role === 'agent' && (
                      <p
                        className="text-[11px] text-muted-foreground mt-1 truncate"
                        data-testid={`ops-staff-beats-${user.id}`}
                      >
                        {user.beats.length > 0
                          ? user.beats.join(' · ')
                          : 'On no beat — nobody tells them about new jobs'}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="inline-block text-[11px] font-bold uppercase tracking-wide rounded-md bg-[#F3F4F6] px-2 py-1">
                      {user.role.replace(/_/g, ' ')}
                    </span>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {user.is_active ? 'Active' : 'Inactive'}
                    </p>
                  </div>
                </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </OpsShell>
  );
}
