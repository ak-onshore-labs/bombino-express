import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AgentShell, useLogout } from '@/components/agent/AgentShell';
import { BandHeader } from '@/components/agent/BandHeader';
import { JobCard, money } from '@/components/agent/PickupCard';
import { useCollections } from '@/hooks/useAgentPickups';
import { useAppStore } from '@/lib/store';

/**
 * Who the agent is, what they are carrying, and the way out.
 *
 * Deliberately not an account settings screen. An agent's record is ops-managed
 * — there is no username to edit, no number to change, no KYC to upload here.
 * What is left is the three things worth opening a profile for on a shift: check
 * the app has the right person signed in, check what is owed at the end of it,
 * and get a phone number when something has gone wrong.
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

export default function Profile() {
  const { user } = useAppStore();
  const logout = useLogout();
  const { data: collections } = useCollections();

  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [loading, setLoading] = useState(true);

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
        if (!cancelled) setProfile(data);
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

  const name = profile?.full_name ?? user?.fullName ?? 'Pickup agent';
  const code = profile?.itd_customer_code ?? user?.code ?? null;

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
          <section>
            <BandHeader label="Your details" testId="band-your-details" />
            <JobCard>
              <DetailRow label="Name" value={name} />
              <DetailRow label="Phone" value={profile?.phone ?? '—'} />
              <DetailRow label="Email" value={profile?.email ?? user?.email ?? '—'} />
              <DetailRow label="Agent code" value={code ?? '—'} />
              <DetailRow label="Role" value={(profile?.role ?? user?.role ?? '—').toUpperCase()} last />
            </JobCard>
          </section>

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

          <button
            type="button"
            onClick={() => void logout()}
            className="h-[60px] w-full bg-[#1B2A41] text-xl font-bold text-white active:scale-[0.98] transition-transform"
            data-testid="button-agent-logout"
          >
            Sign out
          </button>

          <p className="border-t border-[#D8DFE7]! pt-4 text-[13px] font-bold uppercase tracking-[0.1em] text-[#94A3B8]">
            Bombino Express · Agent
          </p>
        </div>
      )}
    </AgentShell>
  );
}
