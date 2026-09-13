import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Link, useParams } from 'wouter';
import { OpsShell } from '@/components/ops/OpsShell';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { parseApiErrorMessage } from '@/lib/apiError';
import { cn } from '@/lib/utils';
import { useOpsStaffUsers, type OpsStaffUser } from '@/hooks/useOpsOrders';
import {
  useOpsBeatsList,
  useOpsStaffUser,
  useSetAgentBeats,
  useUpdateStaffUser,
  type OpsBeatSummary,
} from '@/hooks/useOpsStaff';

const inputClass = 'h-12 bg-[#F3F4F6] border border-[#E2E8F0] rounded-xl mt-2';

function beatsLeftEmpty(
  riderId: string,
  previousIds: readonly string[],
  nextIds: readonly string[],
  beats: readonly OpsBeatSummary[],
): string[] {
  const next = new Set(nextIds);
  const names: string[] = [];
  for (const beat of beats) {
    if (!previousIds.includes(beat.id) || next.has(beat.id)) continue;
    const others = beat.agents.filter((agent) => agent.id !== riderId);
    if (others.length === 0) names.push(beat.name);
  }
  return names;
}

/** Beats where every other member is missing from the roster or inactive. */
function beatsLastActiveMember(
  riderId: string,
  beats: readonly OpsBeatSummary[],
  staff: readonly Pick<OpsStaffUser, 'id' | 'is_active'>[],
): string[] {
  const activeIds = new Set(staff.filter((u) => u.is_active).map((u) => u.id));
  const names: string[] = [];
  for (const beat of beats) {
    const memberIds = beat.agents.map((agent) => agent.id);
    if (!memberIds.includes(riderId)) continue;
    const otherActive = memberIds.some((id) => id !== riderId && activeIds.has(id));
    if (!otherActive) names.push(beat.name);
  }
  return names;
}

export default function OpsStaffDetail() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const detail = useOpsStaffUser(id);
  const beatsQuery = useOpsBeatsList();
  const staffList = useOpsStaffUsers();
  const update = useUpdateStaffUser(id ?? '');
  const setBeats = useSetAgentBeats(id ?? '');

  const user = detail.data?.user;
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [formError, setFormError] = useState('');
  const [formNote, setFormNote] = useState('');

  const [selectedBeatIds, setSelectedBeatIds] = useState<string[]>([]);
  const [beatsError, setBeatsError] = useState('');
  const [beatsNote, setBeatsNote] = useState('');
  const [emptyBeatNames, setEmptyBeatNames] = useState<string[]>([]);
  const [warnOpen, setWarnOpen] = useState(false);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [lastActiveBeatNames, setLastActiveBeatNames] = useState<string[]>([]);
  const [toggleError, setToggleError] = useState('');

  useEffect(() => {
    if (!user) return;
    setFullName(user.full_name);
    setPhone(user.phone ?? '');
    setEmail(user.email ?? '');
    setFormError('');
    setFormNote('');
  }, [user]);

  useEffect(() => {
    if (!detail.data) return;
    setSelectedBeatIds(detail.data.beat_ids);
    setBeatsError('');
    setBeatsNote('');
  }, [detail.data]);

  const beats = beatsQuery.data ?? [];

  const emptyBeatLabel = useMemo(() => {
    if (emptyBeatNames.length === 1) return emptyBeatNames[0];
    if (emptyBeatNames.length === 2) {
      return `${emptyBeatNames[0]} and ${emptyBeatNames[1]}`;
    }
    return emptyBeatNames.join(', ');
  }, [emptyBeatNames]);

  const lastActiveBeatLabel = useMemo(() => {
    if (lastActiveBeatNames.length === 1) return lastActiveBeatNames[0];
    if (lastActiveBeatNames.length === 2) {
      return `${lastActiveBeatNames[0]} and ${lastActiveBeatNames[1]}`;
    }
    return lastActiveBeatNames.join(', ');
  }, [lastActiveBeatNames]);

  const saveProfile = (e: React.FormEvent): void => {
    e.preventDefault();
    setFormError('');
    setFormNote('');
    const name = fullName.trim();
    if (!name) {
      setFormError('Full name is required');
      return;
    }
    if (!/^\d{10}$/.test(phone)) {
      setFormError('Enter a valid 10-digit phone number');
      return;
    }
    const trimmedEmail = email.trim();
    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setFormError('Enter a valid email');
      return;
    }
    update.mutate(
      { full_name: name, phone, email: trimmedEmail },
      {
        onSuccess: () => setFormNote('Saved.'),
        onError: (err) => {
          setFormError(parseApiErrorMessage(err, 'Could not save user'));
        },
      },
    );
  };

  const commitBeats = (ids: string[]): void => {
    setBeatsError('');
    setBeatsNote('');
    setBeats.mutate(ids, {
      onSuccess: () => setBeatsNote('Saved beats.'),
      onError: (err) => {
        setBeatsError(parseApiErrorMessage(err, 'Could not save beats'));
      },
    });
  };

  const trySaveBeats = (): void => {
    if (!user) return;
    const emptied = beatsLeftEmpty(
      user.id,
      detail.data?.beat_ids ?? [],
      selectedBeatIds,
      beats,
    );
    if (emptied.length > 0) {
      setEmptyBeatNames(emptied);
      setWarnOpen(true);
      return;
    }
    commitBeats(selectedBeatIds);
  };

  const toggleBeat = (beatId: string): void => {
    setSelectedBeatIds((current) =>
      current.includes(beatId)
        ? current.filter((id) => id !== beatId)
        : [...current, beatId],
    );
    if (beatsError) setBeatsError('');
    if (beatsNote) setBeatsNote('');
  };

  const activateStaff = (): void => {
    setToggleError('');
    update.mutate(
      { is_active: true },
      {
        onError: (err) => {
          setToggleError(parseApiErrorMessage(err, 'Could not activate this account'));
        },
      },
    );
  };

  const tryDeactivate = (): void => {
    if (!user) return;
    setToggleError('');
    setLastActiveBeatNames(
      beatsLastActiveMember(user.id, beats, staffList.data ?? []),
    );
    setDeactivateOpen(true);
  };

  const commitDeactivate = (): void => {
    setToggleError('');
    update.mutate(
      { is_active: false },
      {
        onSuccess: () => setDeactivateOpen(false),
        onError: (err) => {
          setToggleError(parseApiErrorMessage(err, 'Could not deactivate this account'));
        },
      },
    );
  };

  if (!id) {
    return (
      <OpsShell title="User" subtitle="Not found">
        <Link
          href="/ops/users"
          className="inline-flex items-center gap-1 text-sm font-semibold text-[#F2A123] mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to users
        </Link>
      </OpsShell>
    );
  }

  if (detail.isLoading) {
    return (
      <OpsShell title="User" subtitle="Loading">
        <div className="flex justify-center py-10">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </OpsShell>
    );
  }

  if (detail.isError || !user) {
    const notFound =
      detail.error instanceof Error && detail.error.message.startsWith('404:');
    return (
      <OpsShell title="User" subtitle={notFound ? 'Not found' : 'Error'}>
        <Link
          href="/ops/users"
          className="inline-flex items-center gap-1 text-sm font-semibold text-[#F2A123] mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to users
        </Link>
        <p className="text-sm text-muted-foreground">
          {notFound ? 'That user could not be found.' : 'Could not load this user.'}
        </p>
      </OpsShell>
    );
  }

  return (
    <OpsShell title={user.full_name} subtitle={user.role.replace(/_/g, ' ')}>
      <Link
        href="/ops/users"
        className="inline-flex items-center gap-1 text-sm font-semibold text-[#F2A123] mb-4"
        data-testid="link-ops-back-users"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to users
      </Link>

      <div className="flex items-start justify-between gap-3 mb-6">
        <div className="min-w-0">
          <p className="text-lg font-extrabold text-foreground truncate">{user.full_name}</p>
          <p className="text-sm text-muted-foreground tabular-nums mt-0.5">
            {user.phone ?? '—'}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <span className="inline-block text-[11px] font-bold uppercase tracking-wide rounded-md bg-[#F3F4F6] px-2 py-1">
            {user.role.replace(/_/g, ' ')}
          </span>
          <p className="text-[11px] text-muted-foreground mt-1">
            {user.is_active ? 'Active' : 'Inactive'}
          </p>
          {(user.role === 'agent' || user.role === 'admin') && (
            <button
              type="button"
              onClick={user.is_active ? tryDeactivate : activateStaff}
              disabled={update.isPending}
              className="mt-2 text-[11px] font-bold uppercase tracking-wide text-[#C62828]"
              data-testid={
                user.is_active
                  ? 'button-ops-staff-deactivate'
                  : 'button-ops-staff-activate'
              }
            >
              {update.isPending && deactivateOpen === false
                ? 'Saving…'
                : user.is_active
                  ? 'Deactivate'
                  : 'Activate'}
            </button>
          )}
        </div>
      </div>
      {toggleError && (
        <p
          className="text-sm font-semibold text-red-600 mb-4"
          data-testid="error-ops-staff-active"
        >
          {toggleError}
        </p>
      )}

      <form
        onSubmit={saveProfile}
        className="rounded-2xl border border-border bg-white p-4 mb-6"
        data-testid="ops-edit-user-form"
      >
        <h2 className="text-[11px] uppercase tracking-[0.14em] font-bold text-muted-foreground mb-4">
          Details
        </h2>

        <div className="mb-4">
          <Label className="text-sm font-medium">Full name</Label>
          <Input
            value={fullName}
            onChange={(e) => {
              setFullName(e.target.value);
              if (formError) setFormError('');
            }}
            className={inputClass}
            autoComplete="name"
            data-testid="input-ops-staff-name"
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
            data-testid="input-ops-staff-phone"
          />
          <p className="text-[11px] text-muted-foreground mt-1.5">
            This is how they sign in. Changing it moves login to the new number.
          </p>
        </div>

        <div className="mb-4">
          <Label className="text-sm font-medium">Email</Label>
          <Input
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (formError) setFormError('');
            }}
            placeholder="Optional"
            type="email"
            className={inputClass}
            autoComplete="email"
            data-testid="input-ops-staff-email"
          />
        </div>

        {formError && (
          <p className="text-sm font-semibold text-red-600 mb-3" data-testid="error-ops-edit-user">
            {formError}
          </p>
        )}
        {formNote && (
          <p className="text-sm font-semibold text-emerald-700 mb-3" data-testid="note-ops-edit-user">
            {formNote}
          </p>
        )}

        <Button
          type="submit"
          disabled={update.isPending}
          className="w-full h-12 rounded-xl bg-primary text-white font-bold"
          data-testid="button-ops-save-user"
        >
          {update.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save details'}
        </Button>
      </form>

      {user.role === 'agent' && (
        <section
          className="rounded-2xl border border-border bg-white p-4"
          data-testid="ops-staff-beats"
        >
          <h2 className="text-[11px] uppercase tracking-[0.14em] font-bold text-muted-foreground mb-1">
            Pickup areas
          </h2>
          <p className="text-[11px] text-muted-foreground mb-4">
            {user.is_active
              ? 'Rounds they run. New jobs in these pincodes WhatsApp them. Anyone can still claim the job if they are off.'
              : 'This rider must be active to change rounds.'}
          </p>

          {beatsQuery.isLoading && (
            <div className="flex justify-center py-6">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          )}
          {beatsQuery.isError && (
            <p className="text-sm text-red-600">Could not load beats.</p>
          )}
          {!beatsQuery.isLoading && !beatsQuery.isError && beats.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No beats yet. Add them under Beats first.
            </p>
          )}
          {beats.length > 0 && (
            <div className="grid grid-cols-1 gap-2">
              {beats.map((beat) => {
                const on = selectedBeatIds.includes(beat.id);
                return (
                  <button
                    key={beat.id}
                    type="button"
                    role="switch"
                    aria-checked={on}
                    disabled={setBeats.isPending || !user.is_active}
                    onClick={() => toggleBeat(beat.id)}
                    className={cn(
                      'h-11 rounded-xl border text-sm font-semibold px-3 text-left',
                      on
                        ? 'border-primary bg-primary text-white'
                        : 'border-[#E2E8F0] bg-[#F3F4F6] text-foreground',
                      !user.is_active && 'opacity-50',
                    )}
                    data-testid={`button-ops-staff-beat-${beat.id}`}
                  >
                    {beat.name}
                    {!beat.is_active ? ' · retired' : ''}
                  </button>
                );
              })}
            </div>
          )}

          {beatsError && (
            <p
              className="text-sm font-semibold text-red-600 mt-4"
              data-testid="error-ops-staff-beats"
            >
              {beatsError}
            </p>
          )}
          {beatsNote && (
            <p
              className="text-sm font-semibold text-emerald-700 mt-4"
              data-testid="note-ops-staff-beats"
            >
              {beatsNote}
            </p>
          )}

          <Button
            type="button"
            onClick={trySaveBeats}
            disabled={setBeats.isPending || beatsQuery.isLoading || !user.is_active}
            className="mt-4 w-full h-12 rounded-xl bg-primary text-white font-bold"
            data-testid="button-ops-save-staff-beats"
          >
            {setBeats.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              'Save pickup areas'
            )}
          </Button>
        </section>
      )}

      <AlertDialog open={warnOpen} onOpenChange={setWarnOpen}>
        <AlertDialogContent data-testid="dialog-ops-empty-beat">
          <AlertDialogHeader>
            <AlertDialogTitle>Leave this round empty?</AlertDialogTitle>
            <AlertDialogDescription>
              Removing this rider leaves {emptyBeatLabel} with no riders — new jobs
              there will alert all agents. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-ops-empty-beat-cancel">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-ops-empty-beat-confirm"
              onClick={() => commitBeats(selectedBeatIds)}
            >
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deactivateOpen} onOpenChange={setDeactivateOpen}>
        <AlertDialogContent data-testid="dialog-ops-deactivate-staff">
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate this rider?</AlertDialogTitle>
            <AlertDialogDescription>
              They can't log in, lose their live session, and get no job
              alerts. Past jobs and cash stay on their record.
              {lastActiveBeatNames.length > 0
                ? ` This is the last active rider on ${lastActiveBeatLabel} — new jobs there will alert all agents.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={update.isPending}
              data-testid="button-ops-deactivate-cancel"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-ops-deactivate-confirm"
              disabled={update.isPending}
              onClick={(e) => {
                e.preventDefault();
                commitDeactivate();
              }}
            >
              {update.isPending ? 'Deactivating…' : 'Deactivate'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </OpsShell>
  );
}
