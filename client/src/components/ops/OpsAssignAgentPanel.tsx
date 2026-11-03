import { useMemo, useState } from 'react';
import { Bike, Check, Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import {
  useOpsAssign,
  useOpsAssignableAgents,
  type OpsActionError,
} from '@/hooks/useOpsOrders';
import { getOrderStatusLabel } from '@/lib/orderStatus';
import { cn } from '@/lib/utils';

/**
 * Assign a waiting pickup to an agent — the first thing on the order page
 * while a pickup has no one, because it is the only thing holding it up.
 *
 * A list, not a dropdown: the branch sees every agent in the pickup's city at
 * once, filters by typing a name or number, taps one, assigns.
 */
export function OpsAssignAgentPanel({ orderId }: { orderId: string }) {
  const { toast } = useToast();
  const agents = useOpsAssignableAgents(orderId, true);
  const assign = useOpsAssign(orderId);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const list = agents.data?.agents ?? [];
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    const digits = q.replace(/\D/g, '');
    return list.filter(
      (a) =>
        a.full_name.toLowerCase().includes(q) ||
        (digits.length > 0 && (a.phone ?? '').replace(/\D/g, '').includes(digits)),
    );
  }, [list, query]);
  const selected = list.find((a) => a.id === selectedId) ?? null;

  const confirm = (): void => {
    if (!selected) return;
    assign.mutate(
      { agentId: selected.id },
      {
        onSuccess: (result) => {
          setSelectedId(null);
          toast({
            title: `Assigned to ${selected.full_name}`,
            description: `${result.order.order_no} — ${getOrderStatusLabel(result.order.status)}`,
          });
        },
        onError: (err: OpsActionError) => {
          toast({
            title: err.status === 409 ? 'Pickup already taken' : 'Could not assign',
            description:
              err.status === 409 ? 'This pickup was just taken or assigned.' : err.message,
            variant: 'destructive',
          });
        },
      },
    );
  };

  return (
    <section
      className="mb-4 rounded-md border-2 border-foreground bg-white"
      data-testid="ops-assign-agent"
    >
      <div className="flex items-start justify-between gap-3 px-4 pt-4">
        <div className="min-w-0">
          <h2 className="text-base font-extrabold text-foreground">Assign a pickup agent</h2>
          <p className="mt-0.5 text-xs text-muted-foreground" data-testid="ops-assign-agent-scope">
            {!agents.data
              ? 'Loading agents…'
              : agents.data.scoped
                ? `${list.length} agent${list.length === 1 ? '' : 's'} in ${agents.data.city}`
                : agents.data.city
                  ? `No agents set up for ${agents.data.city} yet. Showing all agents.`
                  : "Couldn't tell the pickup city. Showing all agents."}
          </p>
        </div>
        <Bike className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />
      </div>

      <div className="px-4 pt-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or phone"
            aria-label="Search agents"
            className="h-11 rounded-md pl-9"
            data-testid="input-ops-assign-search"
          />
        </div>
      </div>

      <div className="mt-2 max-h-64 overflow-y-auto px-2" role="listbox" aria-label="Agents">
        {agents.isLoading && (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {agents.isError && (
          <p className="px-2 py-4 text-sm text-destructive">Could not load agents.</p>
        )}
        {!agents.isLoading && !agents.isError && visible.length === 0 && (
          <p className="px-2 py-4 text-sm text-muted-foreground">
            {list.length === 0 ? 'No agents available.' : 'No agent matches that search.'}
          </p>
        )}
        {visible.map((agent) => {
          const active = agent.id === selectedId;
          return (
            <button
              key={agent.id}
              type="button"
              role="option"
              aria-selected={active}
              onClick={() => setSelectedId(active ? null : agent.id)}
              className={cn(
                'flex w-full min-h-12 items-center gap-3 rounded-md px-2 py-2 text-left transition-colors',
                active ? 'bg-foreground text-background' : 'hover:bg-muted active:bg-muted',
              )}
              data-testid={`ops-assign-option-${agent.id}`}
            >
              <span
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold',
                  active ? 'bg-background text-foreground' : 'bg-muted text-foreground',
                )}
                aria-hidden
              >
                {active ? <Check className="h-4 w-4" /> : agent.full_name.trim().charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">{agent.full_name}</span>
                {agent.phone && (
                  <span
                    className={cn(
                      'block text-xs tabular-nums',
                      active ? 'text-background/80' : 'text-muted-foreground',
                    )}
                  >
                    {agent.phone}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      <div className="border-t border-border p-4">
        <Button
          type="button"
          disabled={!selected || assign.isPending}
          onClick={confirm}
          className="h-12 w-full rounded-md bg-primary font-bold text-white"
          data-testid="button-ops-assign-agent"
        >
          {assign.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : selected ? (
            `Assign to ${selected.full_name}`
          ) : (
            'Pick an agent above'
          )}
        </Button>
      </div>
    </section>
  );
}
