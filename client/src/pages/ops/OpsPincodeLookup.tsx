/**
 * Pincode coverage lookup — type a code, see every round it sits on.
 *
 * Beat-centric editing lives on /ops/beats. This screen answers the other
 * question: for one pincode, is doorstep pickup on, which rounds cover it,
 * who gets the new-job WhatsApp, and where to drop off if nobody collects.
 */

import { useEffect, useState, type FormEvent } from 'react';
import { Loader2, Search } from 'lucide-react';
import { DropoffBranches } from '@/components/DropoffBranches';
import { OpsShell } from '@/components/ops/OpsShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useOpsPincodeLookup, type OpsPincodeReport } from '@/hooks/useOpsPincodeLookup';
import { useIsMobile } from '@/hooks/use-mobile';
import { parseApiErrorMessage } from '@/lib/apiError';
import { cn } from '@/lib/utils';
import { formatCutoffHour } from '@shared/pickupPincodes';

const SIX_DIGITS = /^\d{6}$/;

function DesktopOnlyNotice() {
  return (
    <p
      className="text-sm text-muted-foreground py-10 text-center"
      data-testid="ops-pincode-desktop-only"
    >
      Pincode lookup is available on desktop.
    </p>
  );
}

function sourceLine(source: 'db' | 'static'): string {
  return source === 'db'
    ? 'Showing live DB coverage'
    : 'Showing compiled fallback (DB unavailable)';
}

function ridersCopy(report: OpsPincodeReport): string | null {
  if (report.riders.mode === 'listed') return null;
  if (report.riders.reason === 'unstaffed') {
    return 'No rider assigned to these rounds — all active riders are notified';
  }
  if (report.riders.reason === 'uncovered') {
    return 'No round covers this pincode — a pickup here would notify all active riders';
  }
  return 'Rider list unavailable — all active riders would be notified';
}

function agentLabel(name: string | null, phone: string | null): string {
  const who = name?.trim() || 'Unnamed';
  return phone ? `${who} · ${phone}` : who;
}

export default function OpsPincodeLookup() {
  const isMobile = useIsMobile();
  const [input, setInput] = useState('');
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [formError, setFormError] = useState('');
  const [postalCity, setPostalCity] = useState<string | null>(null);
  const [postalState, setPostalState] = useState<string | null>(null);

  const report = useOpsPincodeLookup(submitted);

  // Same /api/postal-lookup CreateShipment uses. Fetched here (not via
  // usePincodeLookup) so a second look-up of the same uncovered pin still
  // fills city/state after we cleared them.
  useEffect(() => {
    if (!report.data || report.data.serviceable) {
      setPostalCity(null);
      setPostalState(null);
      return;
    }

    const pin = report.data.pincode;
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch(
          `/api/postal-lookup?country=IN&code=${encodeURIComponent(pin)}`,
          { credentials: 'include' }
        );
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { found: boolean; city: string; state: string };
        if (cancelled || !data.found) return;
        setPostalCity(data.city);
        setPostalState(data.state);
      } catch {
        // DropoffBranches still renders without a city/state.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [report.data]);

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const code = input.trim();
    if (!SIX_DIGITS.test(code)) {
      setFormError('Enter a six-digit pincode');
      return;
    }
    setFormError('');
    setSubmitted(code);
  };

  return (
    <OpsShell title="Pincodes" subtitle="Look up pickup coverage for a pincode" wide>
      {isMobile ? (
        <DesktopOnlyNotice />
      ) : (
        <>
          <form onSubmit={submit} className="flex items-start gap-2 mb-4">
            <div className="relative flex-1">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none"
                aria-hidden
              />
              <Input
                type="search"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value.replace(/\D/g, '').slice(0, 6));
                  if (formError) setFormError('');
                }}
                placeholder="Six-digit pincode"
                className="h-12 pl-9 rounded-xl bg-white"
                data-testid="ops-pincode-search"
                aria-label="Pincode"
              />
            </div>
            <Button
              type="submit"
              className="h-12 rounded-xl bg-primary text-white font-bold px-5"
              data-testid="ops-pincode-lookup"
            >
              Lookup
            </Button>
          </form>

          {formError && (
            <p className="text-sm font-semibold text-red-600 mb-4" data-testid="ops-pincode-invalid">
              {formError}
            </p>
          )}

          {submitted === null && !formError && (
            <p className="text-sm text-muted-foreground py-8 text-center" data-testid="ops-pincode-idle">
              Type a six-digit pincode to see coverage.
            </p>
          )}

          {submitted !== null && report.isLoading && (
            <div className="flex justify-center py-16" data-testid="ops-pincode-loading">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {submitted !== null && report.isError && (
            <p className="text-sm text-red-600 py-8 text-center" data-testid="ops-pincode-error">
              {parseApiErrorMessage(report.error, 'Could not look up that pincode')}
            </p>
          )}

          {report.data && (
            <ReportCard
              report={report.data}
              postalCity={postalCity}
              postalState={postalState}
            />
          )}
        </>
      )}
    </OpsShell>
  );
}

function ReportCard({
  report,
  postalCity,
  postalState,
}: {
  report: OpsPincodeReport;
  postalCity: string | null;
  postalState: string | null;
}) {
  const allRiders = ridersCopy(report);
  const roundsUnavailable =
    report.serviceable && report.source === 'static' && report.rounds.length === 0;

  return (
    <section
      className="rounded-2xl border border-border bg-white p-4"
      data-testid="ops-pincode-report"
    >
      <div className="flex items-start justify-between gap-3 mb-1">
        <h2 className="text-sm font-extrabold text-foreground tabular-nums">{report.pincode}</h2>
        <span
          className={cn(
            'shrink-0 text-[11px] font-bold uppercase tracking-wide rounded-md px-2 py-1',
            report.serviceable ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'
          )}
          data-testid="ops-pincode-serviceable"
        >
          {report.serviceable ? 'Serviceable' : 'Not serviceable'}
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground mb-4" data-testid="ops-pincode-source">
        {sourceLine(report.source)}
      </p>

      {report.serviceable && report.resolved && (
        <div className="mb-4 space-y-1">
          <p className="text-sm text-foreground">
            {report.resolved.area ? `${report.resolved.area}, ` : ''}
            {report.resolved.city}
            {' · until '}
            {formatCutoffHour(report.resolved.cutoff_hour)}
          </p>
          {report.resolved.remark === 'out_of_city' && (
            <p
              className="text-[11px] leading-snug text-amber-900 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2"
              data-testid="ops-pincode-out-of-city"
            >
              Out of city — extra charge confirmed at weigh
            </p>
          )}
        </div>
      )}

      {!report.serviceable && (
        <div className="mb-4">
          <p className="text-sm text-foreground mb-2">Doorstep pickup not available</p>
          <DropoffBranches pincode={report.pincode} city={postalCity} state={postalState} />
        </div>
      )}

      <div className="mb-4" data-testid="ops-pincode-rounds">
        <p className="text-[11px] uppercase tracking-[0.14em] font-bold text-muted-foreground mb-2">
          Rounds
        </p>
        {roundsUnavailable && (
          <p className="text-sm text-muted-foreground">
            Rounds unavailable — the database did not answer.
          </p>
        )}
        {!roundsUnavailable && report.rounds.length === 0 && (
          <p className="text-sm text-muted-foreground">No active round covers this pincode.</p>
        )}
        {report.rounds.length > 0 && (
          <div className="rounded-xl border border-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold text-muted-foreground border-b border-border">
                  <th className="px-3 py-2">Round</th>
                  <th className="px-3 py-2">Hub</th>
                  <th className="px-3 py-2">Cut-off</th>
                  <th className="px-3 py-2">City</th>
                  <th className="px-3 py-2">Area</th>
                  <th className="px-3 py-2">Remark</th>
                </tr>
              </thead>
              <tbody>
                {report.rounds.map((round) => (
                  <tr key={round.beat_id} className="border-b border-border last:border-b-0">
                    <td className="px-3 py-2 font-semibold text-foreground">{round.name}</td>
                    <td className="px-3 py-2 text-muted-foreground">{round.hub}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {formatCutoffHour(round.cutoff_hour)}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{round.city}</td>
                    <td className="px-3 py-2 text-muted-foreground">{round.area || '—'}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {round.remark === 'out_of_city' ? 'Out of city' : 'Ok'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div data-testid="ops-pincode-riders">
        <p className="text-[11px] uppercase tracking-[0.14em] font-bold text-muted-foreground mb-2">
          Riders alerted
        </p>
        {report.riders.mode === 'listed' && (
          <ul className="space-y-1">
            {report.riders.agents.map((agent, i) => (
              <li key={`${agent.phone ?? 'none'}-${i}`} className="text-sm text-foreground">
                {agentLabel(agent.name, agent.phone)}
              </li>
            ))}
          </ul>
        )}
        {allRiders && <p className="text-sm text-foreground">{allRiders}</p>}
      </div>
    </section>
  );
}
