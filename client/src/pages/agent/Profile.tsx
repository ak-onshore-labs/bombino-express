import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { Check, Loader2, Pencil, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AgentShell, useLogout } from '@/components/agent/AgentShell';
import { BandHeader } from '@/components/agent/BandHeader';
import { JobCard, money } from '@/components/agent/PickupCard';
import { PressableButton } from '@/components/motion/Pressable';
import { StaggerItem } from '@/components/motion/Stagger';
import { useCollections } from '@/hooks/useAgentPickups';
import { useAppStore } from '@/lib/store';
import { formatCutoffHour } from '@shared/pickupPincodes';

/**
 * Who the agent is, what they are carrying, and the way out.
 *
 * Still not an account settings screen. An agent's record is ops-managed — the
 * name, the number and the beats are all theirs to set, not the rider's. The
 * one exception is email, which is optional everywhere, belongs to nobody else,
 * and is blank on every account ops create; a rider who wants the office to
 * have one can add it here and take it off again.
 *
 * What the screen is for, on a shift: check the app has the right person signed
 * in, check where you are meant to be and how late you work, check what is owed
 * at the end of it, and get a phone number when something has gone wrong.
 *
 * The agent code and the role are deliberately absent. The code is an ITD
 * identifier — a uuid on locally created accounts — that a rider can do nothing
 * with, and the role is the same word for every person who can open this screen.
 * Both were noise on a panel whose job is to be scanned in a second.
 *
 * Reached from the person icon in the top bar, which is where the sign-out
 * button used to be — not from `AgentNav`, which is reserved for the surfaces
 * an agent moves between during a shift.
 */

/** The profile as `GET /api/user/profile` returns it. */
interface AgentProfile {
  full_name: string | null;
  email: string | null;
  phone: string | null;
  username: string | null;
  role: string | null;
  itd_customer_code: string | null;
}

/** One round, as `GET /api/agent/beats` returns it. */
interface AgentBeat {
  slug: string;
  name: string;
  hub: string;
  cutoff_hour: number;
  pincodes: string[];
}

/** One label/value line: the label small and grey, the value plain and dark. */
function DetailRow({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-4 px-4 py-[15px]',
        !last && 'border-b border-[#E8EDF2]!',
      )}
      data-testid={`detail-${label.toLowerCase().replace(/\s+/g, '-')}`}
    >
      <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#94A3B8] shrink-0">
        {label}
      </span>
      {/* Truncated, not wrapped. `itd_customer_code` is a short code on real
          accounts and a 40-character uuid on seeded ones, and a value that
          wraps to a second line turns a five-row panel into a seven-row one. */}
      <span className="min-w-0 truncate text-[17px] font-semibold text-right text-[#1B2A41]">
        {value}
      </span>
    </div>
  );
}

/**
 * The email row, which is the only editable thing on this screen.
 *
 * Reads as a plain `DetailRow` until tapped, so the panel still scans as five
 * facts rather than a form. Blank shows "Add" rather than an em dash: an empty
 * value the rider can do something about should say so, where a phone number
 * they cannot change should not.
 */
function EmailRow({ value, onSave }: { value: string; onSave: (email: string) => Promise<string | null> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // A save elsewhere, or the profile arriving after first paint.
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const commit = async (): Promise<void> => {
    setSaving(true);
    setError('');
    const message = await onSave(draft.trim());
    setSaving(false);
    if (message) {
      setError(message);
      return;
    }
    setEditing(false);
  };

  if (!editing) {
    return (
      <div
        className="flex items-baseline justify-between gap-4 px-4 py-[15px] border-b border-[#E8EDF2]!"
        data-testid="detail-email"
      >
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#94A3B8] shrink-0">
          Email
        </span>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="flex min-w-0 items-center gap-2 text-right"
          data-testid="button-edit-email"
        >
          <span
            className={cn(
              'min-w-0 truncate text-[17px] font-semibold',
              value ? 'text-[#1B2A41]' : 'text-[#94A3B8]',
            )}
          >
            {value || 'Add'}
          </span>
          <Pencil className="w-4 h-4 shrink-0 text-[#94A3B8]" strokeWidth={2} />
        </button>
      </div>
    );
  }

  return (
    <div className="px-4 py-[13px] border-b border-[#E8EDF2]!" data-testid="detail-email-editing">
      <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#94A3B8]">
        Email · optional
      </span>
      <div className="mt-2 flex items-center gap-2">
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          autoFocus
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError('');
          }}
          placeholder="you@example.com"
          className="h-11 min-w-0 flex-1 rounded-xl border border-[#E2E8F0] bg-[#F3F4F6] px-3 text-[17px] font-semibold text-[#1B2A41]"
          data-testid="input-agent-email"
        />
        <button
          type="button"
          onClick={() => void commit()}
          disabled={saving}
          aria-label="Save email"
          className="h-11 w-11 shrink-0 grid place-items-center rounded-xl bg-[#1B2A41] text-white"
          data-testid="button-save-email"
        >
          {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setDraft(value);
            setError('');
          }}
          aria-label="Cancel"
          className="h-11 w-11 shrink-0 grid place-items-center rounded-xl border border-[#E2E8F0] text-[#64748B]"
          data-testid="button-cancel-email"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
      {/* Clearing it is a real action, not a mistake — say so rather than
          letting an empty box look like an unfinished edit. */}
      <p className="mt-2 text-[13px] text-[#64748B]">
        {error ? (
          <span className="font-semibold text-red-600" data-testid="error-agent-email">
            {error}
          </span>
        ) : (
          'Leave it empty to remove it.'
        )}
      </p>
    </div>
  );
}

/**
 * A round's pincodes, wrapped.
 *
 * Long lists are collapsed because they really are long — Chennai is one beat
 * of 120 codes and Delhi 97 — and a profile that opens two screens below its
 * own sign-out button is worse than one that asks for a tap. Short rounds
 * (Fort's are six or seven) show whole, since a "show all" on seven items is
 * only ceremony.
 */
function PincodeList({ pincodes }: { pincodes: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const LIMIT = 24;
  const truncated = pincodes.length > LIMIT;
  const shown = truncated && !expanded ? pincodes.slice(0, LIMIT) : pincodes;

  return (
    <div className="px-4 pb-4">
      <div className="flex flex-wrap gap-1.5" data-testid="list-agent-pincodes">
        {shown.map((pincode) => (
          <span
            key={pincode}
            className="rounded-md bg-[#F1F5F9] px-2 py-1 text-[13px] font-semibold tabular-nums text-[#1B2A41]"
          >
            {pincode}
          </span>
        ))}
      </div>
      {truncated && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2.5 text-[13px] font-bold uppercase tracking-[0.1em] text-[#64748B]"
          data-testid="button-toggle-pincodes"
        >
          {expanded ? 'Show fewer' : `Show all ${pincodes.length}`}
        </button>
      )}
    </div>
  );
}

export default function Profile() {
  const { user } = useAppStore();
  const logout = useLogout();
  const { data: collections } = useCollections();

  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [beats, setBeats] = useState<AgentBeat[] | null>(null);
  const [email, setEmail] = useState('');

  /**
   * Same shape as the customer profile's fetch: try the server, fall back to the
   * store in silence. The store already holds a name and a role, so a failed
   * request should leave the agent looking at slightly less detail, not at an
   * error screen for a page that is mostly a sign-out button.
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/user/profile', {
          credentials: 'include',
          cache: 'no-store',
        });
        if (!res.ok) return;
        const data = (await res.json()) as AgentProfile;
        if (!cancelled) {
          setProfile(data);
          setEmail(data.email ?? '');
        }
      } catch {
        // Silent fallback to the store.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * The rounds this agent runs.
   *
   * Its own request rather than part of the profile fetch: it is the one thing
   * here that needs the beat tables, and a rider whose profile loads but whose
   * area does not should still see their name, their money and the office
   * number. `null` means "not answered" and renders nothing; `[]` means "on no
   * beat", which is a real state worth saying out loud.
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/agent/beats', {
          credentials: 'include',
          cache: 'no-store',
        });
        if (!res.ok) return;
        const data = (await res.json()) as { beats: AgentBeat[] };
        if (!cancelled) setBeats(data.beats);
      } catch {
        // Leave it null — the section simply does not render.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const name = profile?.full_name ?? user?.fullName ?? 'Pickup agent';

  /**
   * The hour the rider actually works until.
   *
   * The latest across their rounds, matching how `resolveCoverage` answers a
   * customer: if any beat they run is open until 7, so are they.
   */
  const cutoff = useMemo(() => {
    if (!beats || beats.length === 0) return null;
    return beats.reduce((latest, b) => Math.max(latest, b.cutoff_hour), 0);
  }, [beats]);

  const saveEmail = async (next: string): Promise<string | null> => {
    try {
      const res = await fetch('/api/user/profile', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: next }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        return body?.message ?? 'Could not save your email.';
      }
      setEmail(next);
      return null;
    } catch {
      return 'Could not save your email.';
    }
  };

  return (
    // The code is in the card below, not beside the title: it can be a uuid,
    // and a meta that long would wrap the title row.
    <AgentShell title="You" meta="Agent">
      {loading ? (
        <div className="flex items-center justify-center gap-2.5 py-20 text-[#64748B]">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-[17px] font-semibold">Loading…</span>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <StaggerItem index={0}>
            <section>
              <BandHeader label="Your details" testId="band-your-details" />
              <JobCard>
                <DetailRow label="Name" value={name} />
                <DetailRow label="Phone" value={profile?.phone ?? '—'} />
                <EmailRow value={email} onSave={saveEmail} />
                <DetailRow
                  label="Works until"
                  value={cutoff === null ? '—' : formatCutoffHour(cutoff)}
                  last
                />
              </JobCard>
            </section>
          </StaggerItem>

          {beats !== null && (
            <StaggerItem index={1}>
              <section>
                <BandHeader label="Your pickup area" testId="band-your-area" />
                {beats.length === 0 ? (
                  <JobCard>
                    {/* Not an error and not a warning. An unassigned rider works
                        normally — they see every unclaimed job like everyone
                        else — so this says what is true rather than implying
                        something is broken. */}
                    <p
                      className="px-4 py-[15px] text-[15px] text-[#64748B]"
                      data-testid="text-no-beat"
                    >
                      You're not on a round yet, so you'll hear about jobs
                      anywhere. Ops can set your area.
                    </p>
                  </JobCard>
                ) : (
                  <div className="flex flex-col gap-3">
                    {beats.map((beat) => (
                      <JobCard key={beat.slug}>
                        <div
                          className="flex items-baseline justify-between gap-4 px-4 py-[15px] border-b border-[#E8EDF2]!"
                          data-testid={`beat-${beat.slug}`}
                        >
                          <span className="min-w-0 text-[17px] font-semibold text-[#1B2A41]">
                            {beat.name}
                          </span>
                          <span className="shrink-0 text-[11px] font-bold uppercase tracking-[0.12em] text-[#94A3B8]">
                            until {formatCutoffHour(beat.cutoff_hour)}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between gap-4 px-4 pt-[13px] pb-2.5">
                          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#94A3B8]">
                            Pincodes you collect from
                          </span>
                          <span className="text-[17px] font-semibold tabular-nums text-[#1B2A41]">
                            {beat.pincodes.length}
                          </span>
                        </div>
                        <PincodeList pincodes={beat.pincodes} />
                      </JobCard>
                    ))}
                    {/* The pool is national on purpose — cover has to work when
                        somebody is off — and a rider seeing a job two cities
                        away would otherwise read as a bug. */}
                    <p className="px-1 text-[13px] leading-snug text-[#64748B]">
                      These are the pincodes you're told about. You can still
                      claim any job you see.
                    </p>
                  </div>
                )}
              </section>
            </StaggerItem>
          )}

          <StaggerItem index={2}>
            <section>
              <BandHeader label="Your shift" testId="band-your-shift" />
              <JobCard>
                <Link
                  href="/agent/collections"
                  className="flex items-baseline justify-between gap-4 px-4 py-[15px] border-b border-[#E8EDF2]!"
                  data-testid="link-profile-collections"
                >
                  <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#94A3B8]">
                    Cash in your bag
                  </span>
                  <span className="text-xl font-bold text-[#1B2A41]">
                    ₹{money(collections?.totals.cash ?? 0)}
                  </span>
                </Link>
                <Link
                  href="/agent/collections"
                  className="flex items-baseline justify-between gap-4 px-4 py-[15px]"
                  data-testid="link-profile-count"
                >
                  <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#94A3B8]">
                    Money taken today
                  </span>
                  <span className="text-xl font-bold text-[#1B2A41]">
                    {collections?.totals.count ?? 0}
                  </span>
                </Link>
              </JobCard>
            </section>
          </StaggerItem>

          <StaggerItem index={3}>
            <section>
              <BandHeader label="If something is wrong" testId="band-help" />
              <JobCard>
                <a
                  href="tel:+912266400000"
                  className="flex items-center justify-between gap-4 h-[64px] px-4 border-b border-[#E8EDF2]!"
                  data-testid="link-profile-call-office"
                >
                  <span className="text-[17px] font-semibold text-[#1B2A41]">Call the office</span>
                  <span className="text-[15px] font-medium text-[#64748B]">022 6640 0000</span>
                </a>
                <a
                  href="https://api.whatsapp.com/send?phone=917045999553"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between gap-4 h-[64px] px-4"
                  data-testid="link-profile-whatsapp"
                >
                  <span className="text-[17px] font-semibold text-[#1B2A41]">WhatsApp support</span>
                  <span className="text-[15px] font-medium text-[#64748B]">+91 70459 99553</span>
                </a>
              </JobCard>
            </section>
          </StaggerItem>

          <StaggerItem index={4}>
            <PressableButton
              type="button"
              onClick={() => void logout()}
              className="h-[60px] w-full bg-[#1B2A41] text-xl font-bold text-white"
              data-testid="button-agent-logout"
            >
              Sign out
            </PressableButton>
          </StaggerItem>

          <p className="border-t border-[#D8DFE7]! pt-4 text-[13px] font-bold uppercase tracking-[0.1em] text-[#94A3B8]">
            Bombino Express · Agent
          </p>
        </div>
      )}
    </AgentShell>
  );
}
