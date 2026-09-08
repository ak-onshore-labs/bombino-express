/**
 * Pickup beats — the ops console over rider coverage.
 *
 * The form is deliberately ops' own hand-over block, in their order: the round,
 * its cut-off, its serviceable pincodes, and the pickup boys who run it. That
 * block has arrived by email a dozen times in the same shape; the spreadsheet
 * attached to it never has, which is why the paste box takes a list on any
 * separator instead of asking for a format.
 *
 * Editing a beat changes what customers are offered at booking, so nothing here
 * saves implicitly: the pincode box and the rider list each have their own
 * save, and each says how many rows it wrote.
 */

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { OpsShell } from '@/components/ops/OpsShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import { formatCutoffHour } from '@shared/pickupPincodes';
import { OPS_USERS_KEY } from '@/hooks/useOpsOrders';

const BEATS_KEY = ['ops', 'beats'] as const;

type BeatAgent = { id: string; full_name: string | null };

type BeatSummary = {
  id: string;
  slug: string;
  name: string;
  hub: string;
  cutoff_hour: number;
  is_active: boolean;
  pincode_count: number;
  agents: BeatAgent[];
};

type BeatPincode = {
  pincode: string;
  city: string;
  area: string;
  remark: 'ok' | 'out_of_city';
};

type BeatDetail = BeatSummary & { pincodes: BeatPincode[] };

type StaffUser = {
  id: string;
  full_name: string;
  phone: string | null;
  role: string;
  is_active: boolean;
};

const inputClass = 'h-12 bg-[#F3F4F6] border border-[#E2E8F0] rounded-xl mt-2';

/** Every hour a rider might plausibly stop. Labelled the way the clock reads. */
const CUTOFF_HOURS = Array.from({ length: 15 }, (_, i) => i + 8);

/**
 * A pasted list, read as generously as possible.
 *
 * Ops send these as anything — a column out of Excel, a comma run, a WhatsApp
 * line with spaces. Any non-digit separates. Anything that is not six digits is
 * handed back by name rather than dropped: a customer being silently refused a
 * pickup because a typo scrolled past is exactly the failure worth being
 * pedantic about, and it is the one place this screen is.
 */
function parsePincodes(raw: string): { valid: string[]; invalid: string[] } {
  const tokens = raw.split(/[^0-9]+/).filter(Boolean);
  const seen: Record<string, true> = {};
  const valid: string[] = [];
  const invalid: string[] = [];

  for (const token of tokens) {
    if (!/^\d{6}$/.test(token)) {
      if (!invalid.includes(token)) invalid.push(token);
      continue;
    }
    if (seen[token]) continue;
    seen[token] = true;
    valid.push(token);
  }
  return { valid, invalid };
}

export default function OpsBeats() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formError, setFormError] = useState('');

  // Create form
  const [name, setName] = useState('');
  const [hub, setHub] = useState('');
  const [cutoff, setCutoff] = useState('17');

  // Editor
  const [pincodeText, setPincodeText] = useState('');
  const [pincodeCity, setPincodeCity] = useState('');
  const [editorError, setEditorError] = useState('');
  const [savedNote, setSavedNote] = useState('');

  const beats = useQuery({
    queryKey: BEATS_KEY,
    queryFn: async () => {
      const res = await fetch('/api/ops/beats', { credentials: 'include' });
      if (!res.ok) {
        const text = (await res.text()) || res.statusText;
        throw new Error(`${res.status}: ${text}`);
      }
      return ((await res.json()) as { beats: BeatSummary[] }).beats;
    },
    retry: false,
    refetchOnMount: 'always',
  });

  const detail = useQuery({
    queryKey: [...BEATS_KEY, selectedId],
    enabled: selectedId !== null,
    queryFn: async () => {
      const res = await fetch(`/api/ops/beats/${selectedId}`, { credentials: 'include' });
      if (!res.ok) {
        const text = (await res.text()) || res.statusText;
        throw new Error(`${res.status}: ${text}`);
      }
      return ((await res.json()) as { beat: BeatDetail }).beat;
    },
    retry: false,
  });

  const staff = useQuery({
    queryKey: OPS_USERS_KEY,
    queryFn: async () => {
      const res = await fetch('/api/ops/users', { credentials: 'include' });
      if (!res.ok) throw new Error('Could not load users');
      return ((await res.json()) as { users: StaffUser[] }).users;
    },
    retry: false,
  });

  const agents = useMemo(
    () => (staff.data ?? []).filter((u) => u.role === 'agent' && u.is_active),
    [staff.data]
  );

  // Load the selected beat into the editor. Keyed on the beat's own id so
  // switching beats replaces the box rather than appending to it.
  useEffect(() => {
    if (!detail.data) return;
    setPincodeText(detail.data.pincodes.map((p) => p.pincode).join('\n'));
    setPincodeCity(detail.data.pincodes[0]?.city ?? '');
    setEditorError('');
    setSavedNote('');
  }, [detail.data]);

  const parsed = useMemo(() => parsePincodes(pincodeText), [pincodeText]);

  /** Keep the city and area a pincode already had; only new codes need filling in. */
  const existingByPincode = useMemo(() => {
    const map = new Map<string, BeatPincode>();
    for (const row of detail.data?.pincodes ?? []) map.set(row.pincode, row);
    return map;
  }, [detail.data]);

  const create = useMutation({
    mutationFn: async (body: { slug: string; name: string; hub: string; cutoff_hour: number }) => {
      const res = await apiRequest('POST', '/api/ops/beats', body);
      return ((await res.json()) as { beat: BeatSummary }).beat;
    },
    onSuccess: (beat) => {
      setName('');
      setHub('');
      setCutoff('17');
      setFormError('');
      setSelectedId(beat.id);
      void queryClient.invalidateQueries({ queryKey: BEATS_KEY });
    },
    onError: (err) => setFormError(parseApiErrorMessage(err, 'Could not create beat')),
  });

  const savePincodes = useMutation({
    mutationFn: async (pincodes: BeatPincode[]) => {
      const res = await apiRequest('PUT', `/api/ops/beats/${selectedId}/pincodes`, { pincodes });
      return ((await res.json()) as { pincode_count: number }).pincode_count;
    },
    onSuccess: (count) => {
      setEditorError('');
      setSavedNote(`Saved ${count} pincode${count === 1 ? '' : 's'}.`);
      void queryClient.invalidateQueries({ queryKey: BEATS_KEY });
    },
    onError: (err) => setEditorError(parseApiErrorMessage(err, 'Could not save the pincodes')),
  });

  const saveAgents = useMutation({
    mutationFn: async (agentIds: string[]) => {
      const res = await apiRequest('PUT', `/api/ops/beats/${selectedId}/agents`, {
        agent_ids: agentIds,
      });
      return ((await res.json()) as { agent_count: number }).agent_count;
    },
    onSuccess: (count) => {
      setEditorError('');
      setSavedNote(`Saved ${count} rider${count === 1 ? '' : 's'}.`);
      void queryClient.invalidateQueries({ queryKey: BEATS_KEY });
      void queryClient.invalidateQueries({ queryKey: [...BEATS_KEY, selectedId] });
      void queryClient.invalidateQueries({ queryKey: OPS_USERS_KEY });
    },
    onError: (err) => setEditorError(parseApiErrorMessage(err, 'Could not save the riders')),
  });

  const setActive = useMutation({
    mutationFn: async (isActive: boolean) => {
      const res = await apiRequest('PATCH', `/api/ops/beats/${selectedId}`, {
        is_active: isActive,
      });
      return ((await res.json()) as { beat: BeatSummary }).beat;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: BEATS_KEY });
      void queryClient.invalidateQueries({ queryKey: [...BEATS_KEY, selectedId] });
    },
    onError: (err) => setEditorError(parseApiErrorMessage(err, 'Could not update the beat')),
  });

  const submitCreate = (e: React.FormEvent): void => {
    e.preventDefault();
    setFormError('');

    const beatName = name.trim();
    const beatHub = hub.trim();
    if (!beatName) {
      setFormError('Name the round as ops describe it');
      return;
    }
    if (!beatHub) {
      setFormError('Name the office the riders run out of');
      return;
    }

    // The slug is the id the seed migration keys on and cannot be changed after,
    // so it is derived rather than typed — one less thing to get wrong, and it
    // stays readable in the SQL.
    const slug = beatName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (!slug) {
      setFormError('That name has no letters or numbers to build an id from');
      return;
    }

    create.mutate({ slug, name: beatName, hub: beatHub, cutoff_hour: Number(cutoff) });
  };

  const submitPincodes = (): void => {
    if (!selectedId) return;
    setEditorError('');
    setSavedNote('');

    if (parsed.invalid.length > 0) {
      setEditorError(
        `Not a pincode: ${parsed.invalid.slice(0, 6).join(', ')}${
          parsed.invalid.length > 6 ? `, and ${parsed.invalid.length - 6} more` : ''
        }. Fix or remove them first.`
      );
      return;
    }

    const city = pincodeCity.trim();
    if (!city) {
      setEditorError('Name the city a customer here would give — it is what they are shown.');
      return;
    }

    savePincodes.mutate(
      parsed.valid.map((pincode) => {
        const existing = existingByPincode.get(pincode);
        return {
          pincode,
          // A code that was already on the beat keeps the locality and the
          // surcharge flag it had; re-pasting a list must not silently clear
          // Kolkata's out-of-city marks.
          city: existing?.city ?? city,
          area: existing?.area ?? '',
          remark: existing?.remark ?? 'ok',
        };
      })
    );
  };

  const toggleAgent = (agentId: string): void => {
    if (!detail.data) return;
    const current = detail.data.agents.map((a) => a.id);
    const next = current.includes(agentId)
      ? current.filter((id) => id !== agentId)
      : [...current, agentId];
    saveAgents.mutate(next);
  };

  const selected = detail.data;

  return (
    <OpsShell title="Beats" subtitle="Rider coverage and cut-off times">
      <form
        onSubmit={submitCreate}
        className="rounded-2xl border border-border bg-white p-4 mb-6"
        data-testid="ops-add-beat-form"
      >
        <h2 className="text-[11px] uppercase tracking-[0.14em] font-bold text-muted-foreground mb-4">
          Add beat
        </h2>

        <div className="mb-4">
          <Label className="text-sm font-medium">Round</Label>
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (formError) setFormError('');
            }}
            placeholder="Jogeshwari to Borivali, east and west"
            className={inputClass}
            data-testid="input-ops-beat-name"
          />
        </div>

        <div className="mb-4">
          <Label className="text-sm font-medium">Hub</Label>
          <Input
            value={hub}
            onChange={(e) => {
              setHub(e.target.value);
              if (formError) setFormError('');
            }}
            placeholder="Mumbai (Andheri)"
            className={inputClass}
            data-testid="input-ops-beat-hub"
          />
          <p className="text-[11px] text-muted-foreground mt-1.5">
            The office the riders run out of. Internal — customers never see it.
          </p>
        </div>

        <div className="mb-4">
          <Label className="text-sm font-medium">Pickup cut-off time</Label>
          <Select value={cutoff} onValueChange={setCutoff}>
            <SelectTrigger
              className={cn(inputClass, 'w-full')}
              data-testid="select-ops-beat-cutoff"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CUTOFF_HOURS.map((hour) => (
                <SelectItem key={hour} value={String(hour)}>
                  {formatCutoffHour(hour)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground mt-1.5">
            Booked after this, a pickup here is collected the next day.
          </p>
        </div>

        {formError && (
          <p className="text-sm font-semibold text-red-600 mb-3" data-testid="error-ops-add-beat">
            {formError}
          </p>
        )}

        <Button
          type="submit"
          disabled={create.isPending}
          className="w-full h-12 rounded-xl bg-primary text-white font-bold"
          data-testid="button-ops-add-beat"
        >
          {create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Add beat'}
        </Button>
      </form>

      <section data-testid="ops-beats-list" className="mb-6">
        <h2 className="text-[11px] uppercase tracking-[0.14em] font-bold text-muted-foreground mb-3">
          Beats
        </h2>

        {beats.isLoading && (
          <div className="flex justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}
        {beats.isError && (
          <p className="text-sm text-red-600 py-6 text-center">
            Could not load beats. Try refreshing.
          </p>
        )}
        {!beats.isLoading && !beats.isError && (beats.data?.length ?? 0) === 0 && (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No beats yet. Coverage is falling back to the list built into this release.
          </p>
        )}
        {!beats.isLoading && !beats.isError && (beats.data?.length ?? 0) > 0 && (
          <ul className="rounded-2xl border border-border bg-white divide-y divide-border">
            {beats.data!.map((beat) => (
              <li key={beat.id} data-testid={`ops-beat-row-${beat.id}`}>
                <button
                  type="button"
                  onClick={() => setSelectedId(beat.id === selectedId ? null : beat.id)}
                  aria-expanded={beat.id === selectedId}
                  className={cn(
                    'w-full text-left px-4 py-3',
                    beat.id === selectedId && 'bg-[#F3F4F6]'
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-extrabold text-foreground truncate">{beat.name}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                        {beat.hub} · {beat.pincode_count} pincode
                        {beat.pincode_count === 1 ? '' : 's'} · until{' '}
                        {formatCutoffHour(beat.cutoff_hour)}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                        {beat.agents.length > 0
                          ? beat.agents.map((a) => a.full_name ?? 'Unnamed').join(' · ')
                          : 'No rider assigned'}
                      </p>
                    </div>
                    {!beat.is_active && (
                      <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide rounded-md bg-[#F3F4F6] px-2 py-1">
                        Retired
                      </span>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selectedId !== null && detail.isLoading && (
        <div className="flex justify-center py-10">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {selected && (
        <section
          className="rounded-2xl border border-border bg-white p-4"
          data-testid="ops-beat-editor"
        >
          <h2 className="text-[11px] uppercase tracking-[0.14em] font-bold text-muted-foreground mb-1">
            {selected.name}
          </h2>
          <p className="text-[11px] text-muted-foreground mb-4">
            {selected.hub} · until {formatCutoffHour(selected.cutoff_hour)}
          </p>

          <div className="mb-4">
            <Label className="text-sm font-medium">Pickup serviceable pincodes</Label>
            <Textarea
              value={pincodeText}
              onChange={(e) => {
                setPincodeText(e.target.value);
                if (editorError) setEditorError('');
                if (savedNote) setSavedNote('');
              }}
              rows={8}
              placeholder={'400060\n400062\n400063'}
              className="mt-2 bg-[#F3F4F6] border border-[#E2E8F0] rounded-xl font-mono text-sm"
              data-testid="input-ops-beat-pincodes"
            />
            <p className="text-[11px] text-muted-foreground mt-1.5">
              Paste them however they arrived — commas, spaces or one per line all work.{' '}
              {parsed.valid.length} pincode{parsed.valid.length === 1 ? '' : 's'}
              {parsed.invalid.length > 0 && `, ${parsed.invalid.length} not recognised`}.
            </p>
          </div>

          <div className="mb-4">
            <Label className="text-sm font-medium">City for new pincodes</Label>
            <Input
              value={pincodeCity}
              onChange={(e) => {
                setPincodeCity(e.target.value);
                if (editorError) setEditorError('');
              }}
              placeholder="Mumbai"
              className={inputClass}
              data-testid="input-ops-beat-city"
            />
            <p className="text-[11px] text-muted-foreground mt-1.5">
              What a customer here would call their city, which is not always the hub's —
              a round out of Andheri that reaches Thane should say Thane. Codes already on
              this beat keep the city they have.
            </p>
          </div>

          <Button
            type="button"
            onClick={submitPincodes}
            disabled={savePincodes.isPending}
            className="w-full h-12 rounded-xl bg-primary text-white font-bold"
            data-testid="button-ops-save-pincodes"
          >
            {savePincodes.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              'Save pincodes'
            )}
          </Button>

          <div className="mt-6">
            <p className="text-sm font-medium mb-2">Pickup boys</p>
            {agents.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No active agents yet. Add them under Users first.
              </p>
            )}
            <div className="grid grid-cols-1 gap-2">
              {agents.map((agent) => {
                const on = selected.agents.some((a) => a.id === agent.id);
                return (
                  <button
                    key={agent.id}
                    type="button"
                    role="switch"
                    aria-checked={on}
                    disabled={saveAgents.isPending}
                    onClick={() => toggleAgent(agent.id)}
                    className={cn(
                      'h-11 rounded-xl border text-sm font-semibold px-3 text-left',
                      on
                        ? 'border-primary bg-primary text-white'
                        : 'border-[#E2E8F0] bg-[#F3F4F6] text-foreground'
                    )}
                    data-testid={`button-ops-beat-agent-${agent.id}`}
                  >
                    {agent.full_name}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              Riders on a beat are the ones WhatsApped when a job comes in here. It does
              not stop anyone else claiming it — cover still works when someone is off.
            </p>
          </div>

          {editorError && (
            <p
              className="text-sm font-semibold text-red-600 mt-4"
              data-testid="error-ops-beat-editor"
            >
              {editorError}
            </p>
          )}
          {savedNote && (
            <p
              className="text-sm font-semibold text-emerald-700 mt-4"
              data-testid="note-ops-beat-saved"
            >
              {savedNote}
            </p>
          )}

          <button
            type="button"
            onClick={() => setActive.mutate(!selected.is_active)}
            disabled={setActive.isPending}
            className="mt-6 text-sm font-semibold text-muted-foreground underline"
            data-testid="button-ops-beat-toggle-active"
          >
            {selected.is_active ? 'Retire this beat' : 'Put this beat back in service'}
          </button>
          <p className="text-[11px] text-muted-foreground mt-1.5">
            A retired beat stops offering its pincodes at booking. It keeps them, so
            putting it back is one tap.
          </p>
        </section>
      )}
    </OpsShell>
  );
}
