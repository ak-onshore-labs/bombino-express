import { useState } from 'react';
import { OpsAccessRequired } from '@/components/ops/OpsAccessRequired';
import { isForbiddenError } from '@/lib/apiError';
import { isIndianMobile, toIndianMobile } from '@shared/contact';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import { Loader2, Search } from 'lucide-react';
import { OpsMobileField, OpsMobileItem, OpsMobileList } from '@/components/ops/OpsMobileList';
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
import { useAppStore } from '@/lib/store';
import { assignableRoles, roleLabel, type StaffRole } from '@shared/staffAccess';

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

const inputClass = 'h-12 bg-[#F3F4F6] border border-[#E2E8F0] rounded-md mt-2';

export default function OpsUsers() {
  const queryClient = useQueryClient();
  // An admin adds pickup agents; a super admin adds any role. A branch
  // manager sees their city's agents and adds nobody.
  const creatable = assignableRoles(useAppStore((s) => s.user?.role));
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  // ITD attribution for the corporate `add_customer` call, and unrelated to
  // pickup beats despite sharing city names with them. A rider's coverage is
  // set on their profile page.
  const [hubId, setHubId] = useState('');
  const [role, setRole] = useState<StaffRole>('agent');
  const [formError, setFormError] = useState('');
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [, setLocation] = useLocation();

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
      setAdding(false);
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
    if (!isIndianMobile(phone)) {
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

  const needle = search.trim().toLowerCase();
  const staff = (list.data ?? []).filter(
    (user) =>
      (roleFilter === 'all' || user.role === roleFilter) &&
      (!needle ||
        user.full_name.toLowerCase().includes(needle) ||
        (user.phone ?? '').includes(needle) ||
        user.beats.some((b) => b.toLowerCase().includes(needle))),
  );
  const rolesPresent = Array.from(new Set((list.data ?? []).map((u) => u.role)));

  return (
    <OpsShell
      title="Users"
      subtitle={
        creatable.length > 1
          ? 'Everyone with a login: ops staff and pickup agents'
          : creatable.length === 1
            ? 'Staff logins and pickup agents'
            : 'Your city’s pickup agents'
      }
      wide
      actions={
        creatable.length > 0 ? (
          <Button
            type="button"
            onClick={() => setAdding((v) => !v)}
            variant={adding ? 'outline' : 'default'}
            className="h-10 rounded-md font-semibold"
            data-testid="button-ops-open-add-user"
          >
            {adding ? 'Close' : 'Add user'}
          </Button>
        ) : undefined
      }
    >
      {creatable.length > 0 && adding && (
        <form
          onSubmit={submit}
          className="rounded-md border border-border bg-white p-4 mb-6"
          data-testid="ops-add-user-form"
        >
          <h2 className="text-base font-bold text-foreground mb-3">Add user</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div>
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
            <div>
              <Label className="text-sm font-medium">Phone (their login)</Label>
              <Input
                value={phone}
                onChange={(e) => {
                  setPhone(toIndianMobile(e.target.value));
                  if (formError) setFormError('');
                }}
                placeholder="10-digit mobile"
                inputMode="numeric"
                className={inputClass}
                autoComplete="tel"
                data-testid="input-ops-user-phone"
              />
            </div>
            <div>
              <Label className="text-sm font-medium">Hub</Label>
              <Select
                value={hubId || undefined}
                onValueChange={(value) => {
                  setHubId(value);
                  if (formError) setFormError('');
                }}
              >
                <SelectTrigger className={cn(inputClass, 'w-full')} data-testid="select-ops-user-hub">
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
            <div>
              <Label className="text-sm font-medium">Role</Label>
              <Select
                value={role}
                onValueChange={(value) => {
                  setRole(value as StaffRole);
                  if (formError) setFormError('');
                }}
                disabled={creatable.length < 2}
              >
                <SelectTrigger className={cn(inputClass, 'w-full')} data-testid="select-ops-user-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {creatable.map((value) => (
                    <SelectItem key={value} value={value} data-testid={`option-ops-user-role-${value}`}>
                      {roleLabel(value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {role === 'branch_manager' && (
            <p className="text-xs text-muted-foreground mt-3">
              A branch manager sees only this hub’s city: its orders, agents and beats.
            </p>
          )}
          {formError && (
            <p className="text-sm font-semibold text-red-700 mt-3" data-testid="error-ops-add-user">
              {formError}
            </p>
          )}
          <div className="mt-4 flex justify-end">
            <Button
              type="submit"
              disabled={create.isPending}
              className="h-10 rounded-md px-6 font-semibold"
              data-testid="button-ops-add-user"
            >
              {create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create login'}
            </Button>
          </div>
        </form>
      )}

      <section data-testid="ops-staff-list">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <div className="relative flex-1 min-w-[14rem]">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none"
              aria-hidden
            />
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, phone or round"
              className="h-10 pl-9 rounded-md bg-white"
              data-testid="input-ops-users-search"
            />
          </div>
          {rolesPresent.length > 1 && (
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="h-10 w-56 rounded-md bg-white" data-testid="select-ops-users-role-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All roles</SelectItem>
                {rolesPresent.map((value) => (
                  <SelectItem key={value} value={value}>
                    {roleLabel(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {list.isLoading && (
          <div className="ops-table-frame p-4 space-y-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-9 rounded-md bg-muted animate-pulse" />
            ))}
          </div>
        )}
        {list.isError && isForbiddenError(list.error) && <OpsAccessRequired what="staff accounts" />}
        {list.isError && !isForbiddenError(list.error) && (
          <p className="text-sm text-red-700 py-6" data-testid="ops-users-error">
            Could not load users. Refresh the page to try again.
          </p>
        )}
        {!list.isLoading && !list.isError && (list.data?.length ?? 0) === 0 && (
          <p className="text-sm text-muted-foreground py-8">No staff yet.</p>
        )}
        {!list.isLoading && !list.isError && (list.data?.length ?? 0) > 0 && (
          <>
            <p className="text-xs text-muted-foreground mb-2">
              {staff.length === list.data!.length
                ? `${staff.length} people`
                : `${staff.length} of ${list.data!.length} people`}
            </p>
            <OpsMobileList testId="ops-staff-mobile">
              {staff.map((user) => (
                <OpsMobileItem
                  key={user.id}
                  href={`/ops/users/${user.id}`}
                  title={user.full_name}
                  aside={
                    <span className={cn('text-xs', user.is_active ? 'text-emerald-700' : 'text-muted-foreground')}>
                      {user.is_active ? 'Active' : 'Deactivated'}
                    </span>
                  }
                  testId={`ops-staff-card-${user.id}`}
                >
                  <OpsMobileField label="Phone">{user.phone ?? '—'}</OpsMobileField>
                  <OpsMobileField label="Role">{roleLabel(user.role)}</OpsMobileField>
                  {user.role === 'agent' && (
                    <OpsMobileField label="Rounds">
                      {user.beats.length > 0 ? (
                        user.beats.join(', ')
                      ) : (
                        <span className="font-semibold text-[#B45309]">No round yet</span>
                      )}
                    </OpsMobileField>
                  )}
                </OpsMobileItem>
              ))}
              {staff.length === 0 && (
                <li className="px-4 py-3 text-sm text-muted-foreground">Nobody matches that search.</li>
              )}
            </OpsMobileList>
            <div className="hidden md:block ops-table-frame">
              <table className="ops-table min-w-[760px]" data-testid="ops-staff-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Phone (login)</th>
                    <th>Role</th>
                    <th>Rounds</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {staff.map((user) => (
                    <tr
                      key={user.id}
                      data-href={`/ops/users/${user.id}`}
                      onClick={(event) => {
                        if ((event.target as HTMLElement).closest('a,button')) return;
                        setLocation(`/ops/users/${user.id}`);
                      }}
                      data-testid={`ops-staff-row-${user.id}`}
                    >
                      <td>
                        <Link
                          href={`/ops/users/${user.id}`}
                          className="font-semibold text-foreground hover:underline"
                        >
                          {user.full_name}
                        </Link>
                      </td>
                      <td className="nowrap tabular-nums">{user.phone ?? '—'}</td>
                      <td className="nowrap">{roleLabel(user.role)}</td>
                      <td data-testid={`ops-staff-beats-${user.id}`}>
                        {user.role !== 'agent' ? (
                          <span className="text-muted-foreground">—</span>
                        ) : user.beats.length > 0 ? (
                          user.beats.join(', ')
                        ) : (
                          <span className="text-[#B45309] font-semibold">No round yet</span>
                        )}
                      </td>
                      <td className="nowrap">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1.5 text-sm',
                            user.is_active ? 'text-foreground' : 'text-muted-foreground',
                          )}
                        >
                          <span
                            className={cn('w-2 h-2 rounded-full', user.is_active ? 'bg-emerald-600' : 'bg-slate-300')}
                            aria-hidden
                          />
                          {user.is_active ? 'Active' : 'Deactivated'}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {staff.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-muted-foreground">
                        Nobody matches that search.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </OpsShell>
  );
}
