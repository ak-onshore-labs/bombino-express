/**
 * Pickup beats — the ops console over rider coverage.
 *
 * The form is deliberately ops' own hand-over block, in their order: the round,
 * its cut-off, its serviceable pincodes, and the pickup boys who run it.
 *
 * The pincode table is the source of truth for this round: city, area, and the
 * out-of-city flag are edited per row. Paste only appends new codes. Nothing
 * here saves implicitly — Add stages rows locally; Save posts the complete
 * table. Riders have their own save.
 */

import { useEffect, useMemo, useState } from 'react';
import { OpsAccessRequired } from '@/components/ops/OpsAccessRequired';
import { isForbiddenError } from '@/lib/apiError';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Trash2 } from 'lucide-react';
import { OpsMobileField, OpsMobileItem, OpsMobileList } from '@/components/ops/OpsMobileList';
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
import { OPS_PINCODES_KEY } from '@/hooks/useOpsPincodeLookup';
import { PICKUP_COVERAGE_KEY } from '@/hooks/usePickupCoverage';
import { parseApiErrorMessage } from '@/lib/apiError';
import { apiRequest } from '@/lib/queryClient';
import { cn } from '@/lib/utils';
import { formatCutoffHour } from '@shared/pickupPincodes';
import { OPS_USERS_KEY } from '@/hooks/useOpsOrders';
import { useCan } from '@/lib/opsAccess';

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

const inputClass = 'h-12 bg-[#F3F4F6] border border-[#E2E8F0] rounded-md mt-2';
const cellInputClass = 'h-9 bg-[#F3F4F6] border border-[#E2E8F0] rounded-md px-2 text-sm w-full';

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
  // A branch manager sees their city's beats but does not change them.
  const canManage = useCan('beats.manage');
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formError, setFormError] = useState('');
  const [creating, setCreating] = useState(false);
  const [pincodeFilter, setPincodeFilter] = useState('');

  // Create form
  const [name, setName] = useState('');
  const [hub, setHub] = useState('');
  const [cutoff, setCutoff] = useState('17');

  // Editor — the table is the list; the textarea only stages codes to add.
  const [rows, setRows] = useState<BeatPincode[]>([]);
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

  // On a wide screen the right-hand panel would otherwise open empty: show the
  // first round straight away. On a phone the list comes first.
  useEffect(() => {
    if (selectedId !== null || !beats.data?.length) return;
    if (window.matchMedia('(min-width: 1024px)').matches) setSelectedId(beats.data[0].id);
  }, [beats.data, selectedId]);

  const agents = useMemo(
    () => (staff.data ?? []).filter((u) => u.role === 'agent' && u.is_active),
    [staff.data]
  );

  // Load the selected beat into the editor. Keyed on the beat's own id so
  // switching beats replaces the table rather than appending to it.
  useEffect(() => {
    if (!detail.data) return;
    setRows(detail.data.pincodes.map((p) => ({ ...p })));
    setPincodeText('');
    setPincodeCity(detail.data.pincodes[0]?.city ?? '');
    setEditorError('');
    setSavedNote('');
    setPincodeFilter('');
    // On a narrow screen the round opens below the whole list: bring it into view.
    if (!window.matchMedia('(min-width: 1024px)').matches) {
      document.querySelector('[data-testid="ops-beat-editor"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [detail.data]);

  const parsed = useMemo(() => parsePincodes(pincodeText), [pincodeText]);

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
      setCreating(false);
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
      void queryClient.invalidateQueries({ queryKey: [...BEATS_KEY, selectedId] });
      void queryClient.invalidateQueries({ queryKey: PICKUP_COVERAGE_KEY });
      void queryClient.invalidateQueries({ queryKey: OPS_PINCODES_KEY });
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

  const patchRow = (pincode: string, patch: Partial<BeatPincode>): void => {
    setRows((prev) => prev.map((row) => (row.pincode === pincode ? { ...row, ...patch } : row)));
    if (editorError) setEditorError('');
    if (savedNote) setSavedNote('');
  };

  const removeRow = (pincode: string): void => {
    setRows((prev) => prev.filter((row) => row.pincode !== pincode));
    if (editorError) setEditorError('');
    if (savedNote) setSavedNote('');
  };

  const addPincodes = (): void => {
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

    if (parsed.valid.length === 0) {
      setEditorError('Paste at least one six-digit pincode.');
      return;
    }

    const city = pincodeCity.trim();
    if (!city) {
      setEditorError('Name the city a customer here would give — it is what they are shown.');
      return;
    }

    const have = new Set(rows.map((row) => row.pincode));
    const added: BeatPincode[] = [];
    for (const pincode of parsed.valid) {
      if (have.has(pincode)) continue;
      have.add(pincode);
      added.push({ pincode, city, area: '', remark: 'ok' });
    }

    if (added.length === 0) {
      setEditorError('Those pincodes are already on this round.');
      return;
    }

    setRows((prev) => [...prev, ...added]);
    setPincodeText('');
  };

  const submitPincodes = (): void => {
    if (!selectedId) return;
    setEditorError('');
    setSavedNote('');

    const payload = rows.map((row) => ({
      pincode: row.pincode,
      city: row.city.trim(),
      area: row.area.trim(),
      remark: row.remark,
    }));

    const missingCity = payload.find((row) => !row.city);
    if (missingCity) {
      setEditorError(
        `${missingCity.pincode} needs the city a customer there would give — it is what they are shown.`
      );
      return;
    }

    if (payload.length === 0) {
      const confirmed = window.confirm(
        'This takes every pincode off this round. Customers here will no longer be offered pickup.'
      );
      if (!confirmed) return;
    }

    savePincodes.mutate(payload);
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

  // Unsaved pincode edits: what is in the table differs from what was loaded.
  const dirty = useMemo(() => {
    if (!detail.data) return false;
    const norm = (list: BeatPincode[]) =>
      JSON.stringify(list.map((r) => [r.pincode, r.city.trim(), r.area.trim(), r.remark]));
    return norm(rows) !== norm(detail.data.pincodes);
  }, [rows, detail.data]);

  const filterNeedle = pincodeFilter.trim().toLowerCase();
  const shownRows = filterNeedle
    ? rows.filter((r) =>
        [r.pincode, r.city, r.area].some((v) => v.toLowerCase().includes(filterNeedle)),
      )
    : rows;

  const outOfCity = rows.filter((r) => r.remark === 'out_of_city').length;

  return (
    <OpsShell
      title="Beats"
      subtitle="Each round's pincodes, riders and pickup cut-off time"
      wide
      actions={
        canManage ? (
          <Button
            type="button"
            onClick={() => setCreating((v) => !v)}
            variant={creating ? 'outline' : 'default'}
            className="h-10 rounded-md font-semibold"
            data-testid="button-ops-new-beat"
          >
            {creating ? 'Close' : 'New beat'}
          </Button>
        ) : undefined
      }
    >
      {!canManage && (
        <p className="mb-4 text-sm text-muted-foreground">
          View only. Ask head office to change a round.
        </p>
      )}

      {canManage && creating && (
        <form
          onSubmit={submitCreate}
          className="rounded-md border border-border bg-white p-4 mb-6"
          data-testid="ops-add-beat-form"
        >
          <h2 className="text-base font-bold text-foreground mb-3">New beat</h2>
          <div className="grid gap-4 md:grid-cols-[2fr_1.4fr_1fr]">
            <div>
              <Label className="text-sm font-medium">Round name</Label>
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
            <div>
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
              <p className="text-xs text-muted-foreground mt-1.5">
                The office the riders work from. Customers never see it.
              </p>
            </div>
            <div>
              <Label className="text-sm font-medium">Pickup cut-off</Label>
              <Select value={cutoff} onValueChange={setCutoff}>
                <SelectTrigger className={cn(inputClass, 'w-full')} data-testid="select-ops-beat-cutoff">
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
              <p className="text-xs text-muted-foreground mt-1.5">
                Booked after this, the pickup happens the next day.
              </p>
            </div>
          </div>
          {formError && (
            <p className="text-sm font-semibold text-red-700 mt-3" data-testid="error-ops-add-beat">
              {formError}
            </p>
          )}
          <div className="mt-4 flex justify-end">
            <Button
              type="submit"
              disabled={create.isPending}
              className="h-10 rounded-md px-6 font-semibold"
              data-testid="button-ops-add-beat"
            >
              {create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create beat'}
            </Button>
          </div>
        </form>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] items-start">
        {/* ── All beats ─────────────────────────────────────────────────── */}
        <section data-testid="ops-beats-list">
          {beats.isLoading && (
            <div className="ops-table-frame p-4 space-y-3">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-10 rounded-md bg-muted animate-pulse" />
              ))}
            </div>
          )}
          {beats.isError && isForbiddenError(beats.error) && <OpsAccessRequired what="beats" />}
          {beats.isError && !isForbiddenError(beats.error) && (
            <p className="text-sm text-red-700 py-6" data-testid="ops-beats-error">
              Could not load beats. Refresh the page to try again.
            </p>
          )}
          {!beats.isLoading && !beats.isError && (beats.data?.length ?? 0) === 0 && (
            <p className="text-sm text-muted-foreground py-6">
              No beats yet. Until one is added, pickup coverage uses the list built into this release.
            </p>
          )}
          {!beats.isLoading && !beats.isError && (beats.data?.length ?? 0) > 0 && (
            <OpsMobileList testId="ops-beats-mobile">
              {beats.data!.map((beat) => (
                <li key={beat.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(beat.id === selectedId ? null : beat.id)}
                    aria-expanded={beat.id === selectedId}
                    className={cn('w-full text-left px-4 py-3', beat.id === selectedId && 'bg-[#EEF2F7]')}
                    data-testid={`ops-beat-card-${beat.id}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-semibold text-foreground">{beat.name}</p>
                      {!beat.is_active && (
                        <span className="shrink-0 text-xs font-semibold text-[#B45309]">Retired</span>
                      )}
                    </div>
                    <dl className="mt-1.5 space-y-1">
                      <OpsMobileField label="Hub">{beat.hub}</OpsMobileField>
                      <OpsMobileField label="Cut-off">{formatCutoffHour(beat.cutoff_hour)}</OpsMobileField>
                      <OpsMobileField label="Pincodes">{beat.pincode_count}</OpsMobileField>
                      <OpsMobileField label="Riders">
                        {beat.agents.length > 0 ? (
                          beat.agents.map((a) => a.full_name ?? 'Unnamed').join(', ')
                        ) : (
                          <span className="font-semibold text-[#B45309]">No rider</span>
                        )}
                      </OpsMobileField>
                    </dl>
                  </button>
                </li>
              ))}
            </OpsMobileList>
          )}
          {!beats.isLoading && !beats.isError && (beats.data?.length ?? 0) > 0 && (
            <div className="hidden md:block ops-table-frame">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>Round and riders</th>
                    <th>Cut-off</th>
                    <th className="num">Pincodes</th>
                  </tr>
                </thead>
                <tbody>
                  {beats.data!.map((beat) => {
                    const on = beat.id === selectedId;
                    return (
                      <tr
                        key={beat.id}
                        data-href="#"
                        onClick={() => setSelectedId(beat.id)}
                        aria-selected={on}
                        className={cn(on && '[&>td]:!bg-[#EEF2F7]')}
                        data-testid={`ops-beat-row-${beat.id}`}
                      >
                        <td>
                          <button
                            type="button"
                            onClick={() => setSelectedId(beat.id)}
                            className="text-left font-semibold text-foreground hover:underline"
                          >
                            {beat.name}
                          </button>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {beat.hub}
                            {!beat.is_active && (
                              <span className="ml-2 font-semibold text-[#B45309]">Retired</span>
                            )}
                          </p>
                          <p className="text-xs mt-1">
                            {beat.agents.length > 0 ? (
                              <span className="text-foreground/80">
                                {beat.agents.map((a) => a.full_name ?? 'Unnamed').join(', ')}
                              </span>
                            ) : (
                              <span className="text-[#B45309] font-semibold">No rider</span>
                            )}
                          </p>
                        </td>
                        <td className="nowrap">{formatCutoffHour(beat.cutoff_hour)}</td>
                        <td className="num">{beat.pincode_count}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── The selected beat ─────────────────────────────────────────── */}
        <section className="lg:sticky lg:top-6" data-testid="ops-beat-editor-slot">
          {selectedId === null && (
            <div className="rounded-md border border-dashed border-border bg-white px-5 py-10 text-center">
              <p className="text-sm font-semibold text-foreground">Pick a round from the list</p>
              <p className="text-xs text-muted-foreground mt-1">
                Its riders and every pincode it covers open here.
              </p>
            </div>
          )}

          {selectedId !== null && detail.isLoading && (
            <div className="rounded-md border border-border bg-white p-5 space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-9 rounded-md bg-muted animate-pulse" />
              ))}
            </div>
          )}

          {selected && (
            <div className="rounded-md border border-border bg-white" data-testid="ops-beat-editor">
              <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 pb-4 border-b border-border">
                <div className="min-w-0">
                  <h2 className="text-lg font-bold text-foreground leading-snug">{selected.name}</h2>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {selected.hub} · pickups booked by {formatCutoffHour(selected.cutoff_hour)} go the
                    same day
                    {!selected.is_active && (
                      <span className="ml-2 font-semibold text-[#B45309]">Retired</span>
                    )}
                  </p>
                </div>
                {canManage && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setActive.mutate(!selected.is_active)}
                    disabled={setActive.isPending}
                    className="h-9 rounded-md text-sm"
                    data-testid="button-ops-beat-toggle-active"
                  >
                    {selected.is_active ? 'Retire beat' : 'Put back in service'}
                  </Button>
                )}
              </header>

              <fieldset disabled={!canManage} className="min-w-0">
                {/* Riders */}
                <div className="px-5 py-4 border-b border-border">
                  <h3 className="text-sm font-bold text-foreground">Riders</h3>
                  <p className="text-xs text-muted-foreground mt-0.5 mb-3">
                    Who usually covers this round. Changes save straight away.
                  </p>
                  {selected.agents.length === 0 ? (
                    <p className="text-sm font-semibold text-[#B45309] mb-3">No rider on this round yet.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2 mb-3">
                      {selected.agents.map((agent) => (
                        <span
                          key={agent.id}
                          className="inline-flex items-center gap-1.5 h-9 rounded-md border border-border bg-[#F3F4F6] pl-3 pr-1 text-sm font-medium text-foreground"
                          data-testid={`ops-beat-rider-${agent.id}`}
                        >
                          {agent.full_name ?? 'Unnamed'}
                          {canManage && (
                            <button
                              type="button"
                              onClick={() => toggleAgent(agent.id)}
                              disabled={saveAgents.isPending}
                              aria-label={`Take ${agent.full_name ?? 'this rider'} off this round`}
                              className="grid place-items-center w-7 h-7 rounded-md text-muted-foreground hover:bg-white hover:text-red-700"
                              data-testid={`button-ops-beat-agent-${agent.id}`}
                            >
                              ×
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                  {canManage && (
                    <Select
                      value=""
                      onValueChange={(id) => toggleAgent(id)}
                      disabled={saveAgents.isPending || agents.length === 0}
                    >
                      <SelectTrigger className="h-9 w-64 rounded-md bg-white" data-testid="select-ops-beat-add-rider">
                        <SelectValue placeholder={agents.length === 0 ? 'No active agents yet' : 'Add a rider'} />
                      </SelectTrigger>
                      <SelectContent>
                        {agents
                          .filter((agent) => !selected.agents.some((a) => a.id === agent.id))
                          .sort((x, y) => x.full_name.localeCompare(y.full_name))
                          .map((agent) => (
                            <SelectItem key={agent.id} value={agent.id}>
                              {agent.full_name}
                              {agent.phone ? ` · ${agent.phone}` : ''}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                {/* Pincodes */}
                <div className="px-5 py-4">
                  <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
                    <div>
                      <h3 className="text-sm font-bold text-foreground">
                        Pincodes <span className="font-normal text-muted-foreground">({rows.length})</span>
                      </h3>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Customers in these pincodes are offered pickup.
                        {outOfCity > 0 && ` ${outOfCity} marked out of city (extra charge, confirmed at weighing).`}
                      </p>
                    </div>
                    {rows.length > 8 && (
                      <Input
                        type="search"
                        value={pincodeFilter}
                        onChange={(e) => setPincodeFilter(e.target.value)}
                        placeholder="Find a pincode or area"
                        className="h-9 w-56 rounded-md bg-white"
                        aria-label="Filter pincodes"
                        data-testid="input-ops-beat-pincode-filter"
                      />
                    )}
                  </div>

                  {rows.length > 0 && (
                    <ul className="md:hidden rounded-md border border-border divide-y divide-border" data-testid="ops-beat-pincode-cards">
                      {shownRows.map((row) => (
                        <li key={row.pincode} className="px-3 py-3 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono tabular-nums font-semibold">{row.pincode}</span>
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                role="switch"
                                aria-checked={row.remark === 'out_of_city'}
                                onClick={() =>
                                  patchRow(row.pincode, {
                                    remark: row.remark === 'out_of_city' ? 'ok' : 'out_of_city',
                                  })
                                }
                                className={cn(
                                  'h-9 rounded-md border text-xs font-semibold px-3',
                                  row.remark === 'out_of_city'
                                    ? 'border-amber-300 bg-amber-50 text-amber-900'
                                    : 'border-border bg-white text-foreground',
                                )}
                              >
                                {row.remark === 'out_of_city' ? 'Out of city' : 'Normal'}
                              </button>
                              {canManage && (
                                <button
                                  type="button"
                                  onClick={() => removeRow(row.pincode)}
                                  aria-label={`Remove ${row.pincode}`}
                                  className="grid place-items-center w-9 h-9 rounded-md text-muted-foreground hover:bg-red-50 hover:text-red-700"
                                >
                                  <Trash2 className="w-4 h-4" aria-hidden />
                                </button>
                              )}
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <label className="text-xs text-muted-foreground">
                              City shown
                              <Input
                                value={row.city}
                                onChange={(e) => patchRow(row.pincode, { city: e.target.value })}
                                className={cn(cellInputClass, 'mt-1')}
                              />
                            </label>
                            <label className="text-xs text-muted-foreground">
                              Area
                              <Input
                                value={row.area}
                                onChange={(e) => patchRow(row.pincode, { area: e.target.value })}
                                className={cn(cellInputClass, 'mt-1')}
                              />
                            </label>
                          </div>
                        </li>
                      ))}
                      {shownRows.length === 0 && (
                        <li className="px-3 py-3 text-sm text-muted-foreground">No pincode matches “{pincodeFilter}”.</li>
                      )}
                    </ul>
                  )}
                  {rows.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4" data-testid="ops-beat-pincode-empty">
                      No pincodes on this round yet. Add some below.
                    </p>
                  ) : (
                    <div className="hidden md:block ops-table-frame max-h-[26rem] overflow-y-auto" data-testid="ops-beat-pincode-table">
                      <table className="ops-table [&_tbody_td]:!py-1.5 [&_tbody_td]:!px-2.5 [&_thead_th]:!px-2.5">
                        <thead className="sticky top-0 z-10">
                          <tr>
                            <th>Pincode</th>
                            <th className="w-[36%]">City shown to customer</th>
                            <th className="w-[36%]">Area</th>
                            <th>Charge</th>
                            {canManage && <th aria-label="Remove" />}
                          </tr>
                        </thead>
                        <tbody>
                          {shownRows.map((row) => (
                            <tr key={row.pincode} data-testid={`ops-beat-pincode-row-${row.pincode}`}>
                              <td className="font-mono tabular-nums nowrap !align-middle">{row.pincode}</td>
                              <td>
                                <Input
                                  value={row.city}
                                  onChange={(e) => patchRow(row.pincode, { city: e.target.value })}
                                  className={cellInputClass}
                                  aria-label={`City for ${row.pincode}`}
                                  data-testid={`input-ops-beat-city-${row.pincode}`}
                                />
                              </td>
                              <td>
                                <Input
                                  value={row.area}
                                  onChange={(e) => patchRow(row.pincode, { area: e.target.value })}
                                  className={cellInputClass}
                                  aria-label={`Area for ${row.pincode}`}
                                  data-testid={`input-ops-beat-area-${row.pincode}`}
                                />
                              </td>
                              <td className="nowrap">
                                <button
                                  type="button"
                                  role="switch"
                                  aria-checked={row.remark === 'out_of_city'}
                                  onClick={() =>
                                    patchRow(row.pincode, {
                                      remark: row.remark === 'out_of_city' ? 'ok' : 'out_of_city',
                                    })
                                  }
                                  className={cn(
                                    'h-9 rounded-md border text-xs font-semibold px-3 whitespace-nowrap',
                                    row.remark === 'out_of_city'
                                      ? 'border-amber-300 bg-amber-50 text-amber-900'
                                      : 'border-border bg-white text-foreground',
                                  )}
                                  title="Tap to switch between normal and out of city"
                                  data-testid={`button-ops-beat-remark-${row.pincode}`}
                                >
                                  {row.remark === 'out_of_city' ? 'Out of city' : 'Normal'}
                                </button>
                              </td>
                              {canManage && (
                                <td className="nowrap align-middle">
                                  <button
                                    type="button"
                                    onClick={() => removeRow(row.pincode)}
                                    aria-label={`Remove ${row.pincode}`}
                                    title="Remove from this round"
                                    className="grid place-items-center w-8 h-8 rounded-md text-muted-foreground hover:bg-red-50 hover:text-red-700"
                                    data-testid={`button-ops-beat-remove-${row.pincode}`}
                                  >
                                    <Trash2 className="w-4 h-4" aria-hidden />
                                  </button>
                                </td>
                              )}
                            </tr>
                          ))}
                          {shownRows.length === 0 && (
                            <tr>
                              <td colSpan={5} className="text-muted-foreground">
                                No pincode matches “{pincodeFilter}”.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {canManage && (
                    <details className="mt-4 rounded-md border border-border group" open={rows.length === 0}>
                      <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-foreground">
                        Add pincodes
                      </summary>
                      <div className="px-4 pb-4 grid gap-4 md:grid-cols-[3fr_2fr]">
                        <div>
                          <Label className="text-sm font-medium">Pincodes</Label>
                          <Textarea
                            value={pincodeText}
                            onChange={(e) => {
                              setPincodeText(e.target.value);
                              if (editorError) setEditorError('');
                              if (savedNote) setSavedNote('');
                            }}
                            rows={4}
                            placeholder={'400060\n400062, 400063'}
                            className="mt-2 bg-[#F3F4F6] border border-[#E2E8F0] rounded-md font-mono text-sm"
                            data-testid="input-ops-beat-pincodes"
                          />
                          <p className="text-xs text-muted-foreground mt-1.5">
                            Paste them however they came: commas, spaces or one per line.{' '}
                            {parsed.valid.length} found
                            {parsed.invalid.length > 0 && `, ${parsed.invalid.length} not recognised`}.
                          </p>
                        </div>
                        <div>
                          <Label className="text-sm font-medium">City shown to customer</Label>
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
                          <p className="text-xs text-muted-foreground mt-1.5">
                            The city a customer there would say. A round from Andheri that reaches
                            Thane should say Thane.
                          </p>
                          <Button
                            type="button"
                            onClick={addPincodes}
                            variant="outline"
                            className="mt-3 w-full h-10 rounded-md font-semibold"
                            data-testid="button-ops-add-pincodes"
                          >
                            Add to the list
                          </Button>
                        </div>
                      </div>
                    </details>
                  )}

                  {editorError && (
                    <p className="text-sm font-semibold text-red-700 mt-4" data-testid="error-ops-beat-editor">
                      {editorError}
                    </p>
                  )}
                  {savedNote && !dirty && (
                    <p className="text-sm font-semibold text-emerald-700 mt-4" data-testid="note-ops-beat-saved">
                      {savedNote}
                    </p>
                  )}
                </div>

                {canManage && dirty && (
                  <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-t border-border bg-[#FFFBEB]">
                    <p className="text-sm font-semibold text-[#92400E]">Unsaved pincode changes</p>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setRows(selected.pincodes.map((p) => ({ ...p })))}
                        className="h-9 rounded-md"
                        data-testid="button-ops-discard-pincodes"
                      >
                        Discard
                      </Button>
                      <Button
                        type="button"
                        onClick={submitPincodes}
                        disabled={savePincodes.isPending}
                        className="h-9 rounded-md px-5 font-semibold"
                        data-testid="button-ops-save-pincodes"
                      >
                        {savePincodes.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save pincodes'}
                      </Button>
                    </div>
                  </div>
                )}
              </fieldset>
            </div>
          )}
        </section>
      </div>
    </OpsShell>
  );
}
