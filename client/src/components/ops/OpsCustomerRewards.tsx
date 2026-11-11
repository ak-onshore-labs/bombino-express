import { useState } from 'react';
import { Loader2, Minus, Plus } from 'lucide-react';
import { MIN_REDEEM_POINTS } from '@shared/rewards';
import { can } from '@shared/staffAccess';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useAdjustRewards, useOpsCustomerRewards } from '@/hooks/useOpsRewards';
import { parseApiErrorMessage } from '@/lib/apiError';
import { formatIst } from '@/lib/orderDetail';
import { formatDayLong, formatKg, formatPoints, fyLabel, ledgerLabel } from '@/lib/rewards';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border border-border px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{label}</p>
      <p className="text-lg font-extrabold tabular-nums text-foreground mt-0.5">{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
    </div>
  );
}

/**
 * Reward points on the ops customer page: balance, points on the way, the
 * year's weight milestone and the full history. A super admin can add or take
 * away points with a reason; nothing else in the console writes points.
 */
export function OpsCustomerRewards({ customerId }: { customerId: string }) {
  const role = useAppStore((s) => s.user?.role);
  const canAdjust = can(role, 'rewards.adjust');
  const { data, isLoading, isError } = useOpsCustomerRewards(customerId);

  return (
    <section className="rounded-md border border-border bg-white p-4 mb-6" data-testid="ops-customer-rewards">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h2 className="text-base font-extrabold text-foreground">Reward points</h2>
        {data && (
          <p className="text-xs text-muted-foreground">
            {fyLabel(data.fy)} · use by {formatDayLong(data.fyLastDay)}
          </p>
        )}
      </div>

      {isLoading && (
        <div className="flex justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      )}
      {isError && <p className="text-sm text-muted-foreground">Could not load reward points.</p>}

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat
              label="Balance"
              value={`${formatPoints(data.balance)} pts`}
              hint={data.canRedeem ? 'Can use them' : `Usable from ${MIN_REDEEM_POINTS}`}
            />
            <Stat
              label="On the way"
              value={`${formatPoints(data.pending.points)} pts`}
              hint={`${data.pending.orders.length} open ${data.pending.orders.length === 1 ? 'order' : 'orders'}`}
            />
            <Stat
              label="Shipped this year"
              value={formatKg(data.milestone.shippedKg)}
              hint={`Milestone ${formatKg(data.milestone.targetKg)}`}
            />
            <Stat
              label="Milestone"
              value={data.milestone.reached ? 'Reached' : `${Math.round(data.milestone.progress * 100)}%`}
              hint={data.milestone.reached ? 'Shows "Rewards await you"' : `${formatKg(data.milestone.remainingKg)} to go`}
            />
          </div>

          {canAdjust && <AdjustForm customerId={customerId} balance={data.balance} />}

          <h3 className="text-sm font-semibold text-foreground mt-5 mb-2">History</h3>
          {data.history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No points yet.</p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border" data-testid="ops-rewards-history">
              {data.history.map((row) => (
                <li key={row.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">
                      {row.kind === 'adjust' ? 'Manual adjustment' : ledgerLabel(row.kind, row.note)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5 break-words">
                      {row.orderNo ? `${row.orderNo} · ` : ''}
                      {formatIst(row.createdAt)}
                      {row.kind === 'adjust' && row.createdByName ? ` · by ${row.createdByName}` : ''}
                    </p>
                    {row.kind === 'adjust' && row.note && (
                      <p className="text-xs text-foreground mt-1 break-words">“{row.note}”</p>
                    )}
                  </div>
                  <span
                    className={cn(
                      'shrink-0 text-sm font-bold tabular-nums',
                      row.points > 0 ? 'text-emerald-700' : row.points < 0 ? 'text-red-600' : 'text-muted-foreground',
                    )}
                  >
                    {row.points > 0 ? '+' : row.points < 0 ? '−' : ''}
                    {formatPoints(Math.abs(row.points))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function AdjustForm({ customerId, balance }: { customerId: string; balance: number }) {
  const { toast } = useToast();
  const adjust = useAdjustRewards(customerId);
  const [direction, setDirection] = useState<'add' | 'remove'>('add');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const n = Number(amount);
  const valid = Number.isInteger(n) && n > 0 && note.trim().length >= 5;
  const signed = direction === 'add' ? n : -n;

  const submit = async (): Promise<void> => {
    setError('');
    try {
      await adjust.mutateAsync({ points: signed, note: note.trim() });
      toast({
        title: direction === 'add' ? `Added ${formatPoints(n)} points` : `Took away ${formatPoints(n)} points`,
        description: `New balance ${formatPoints(balance + signed)} pts`,
      });
      setAmount('');
      setNote('');
    } catch (err) {
      setError(parseApiErrorMessage(err, 'Could not save the adjustment.'));
    }
  };

  return (
    <div className="mt-4 rounded-md border border-dashed border-border p-3" data-testid="ops-rewards-adjust">
      <p className="text-sm font-semibold text-foreground">Adjust points</p>
      <p className="text-xs text-muted-foreground mt-0.5">
        Super admin only. The reason is kept with your name and can't be edited; undo a mistake with another adjustment.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border border-border p-0.5" role="radiogroup" aria-label="Add or take away">
          {(['add', 'remove'] as const).map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={direction === d}
              onClick={() => setDirection(d)}
              className={cn(
                'inline-flex h-8 items-center gap-1 rounded px-3 text-xs font-semibold',
                direction === d ? 'bg-foreground text-background' : 'text-muted-foreground',
              )}
              data-testid={`ops-rewards-adjust-${d}`}
            >
              {d === 'add' ? <Plus className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
              {d === 'add' ? 'Add' : 'Take away'}
            </button>
          ))}
        </div>
        <Input
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          placeholder="Points"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="h-9 w-32"
          data-testid="ops-rewards-adjust-points"
        />
      </div>
      <Textarea
        placeholder="Reason (e.g. goodwill for a delayed pickup on BOM-100231)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={300}
        className="mt-2 min-h-[64px] text-sm"
        data-testid="ops-rewards-adjust-note"
      />
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
      <Button
        type="button"
        className="mt-2 h-9"
        disabled={!valid || adjust.isPending}
        onClick={() => void submit()}
        data-testid="ops-rewards-adjust-save"
      >
        {adjust.isPending ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : valid ? (
          `${direction === 'add' ? 'Add' : 'Take away'} ${formatPoints(n)} points`
        ) : (
          'Save adjustment'
        )}
      </Button>
    </div>
  );
}
