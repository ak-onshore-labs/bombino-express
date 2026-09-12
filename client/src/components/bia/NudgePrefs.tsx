import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { apiRequest } from '@/lib/queryClient';
import type { NudgeKind } from '@shared/biaNudges';

interface NudgePref {
  kind: NudgeKind;
  label: string;
  hint: string;
  on: boolean;
}

const PREFS_KEY = ['/api/bia/nudges/prefs'] as const;

/**
 * BIA's reminders, one switch per kind (BIA 3.0, 5.1): on Profile for an
 * account, on the guest profile for a guest. Every one is about the
 * customer's own order, document or signup, and each can be switched off.
 * Not drawn until reminders can be saved (migrations/create_bia_nudges.sql).
 */
export function NudgePrefs(): React.JSX.Element | null {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: PREFS_KEY,
    queryFn: async () => {
      const res = await fetch('/api/bia/nudges/prefs', { credentials: 'include', cache: 'no-store' });
      if (!res.ok) return null;
      return (await res.json()) as { available: boolean; kinds: NudgePref[] };
    },
    retry: false,
  });

  const toggle = useMutation({
    mutationFn: async ({ kind, on }: { kind: NudgeKind; on: boolean }) => apiRequest('PUT', '/api/bia/nudges/prefs', { kind, on }),
    onMutate: async ({ kind, on }) => {
      await queryClient.cancelQueries({ queryKey: PREFS_KEY });
      const before = queryClient.getQueryData<{ available: boolean; kinds: NudgePref[] } | null>(PREFS_KEY);
      if (before) {
        queryClient.setQueryData(PREFS_KEY, { ...before, kinds: before.kinds.map((k) => (k.kind === kind ? { ...k, on } : k)) });
      }
      return { before };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.before) queryClient.setQueryData(PREFS_KEY, ctx.before);
    },
  });

  if (!data?.available || data.kinds.length === 0) return null;

  return (
    <section
      className="bg-white rounded-2xl border border-border p-4 shadow-[0_2px_12px_oklch(17%_0.048_248_/_0.06),_0_1px_3px_oklch(17%_0.048_248_/_0.04)]"
      aria-labelledby="nudge-prefs-title"
      data-testid="nudge-prefs"
    >
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 bg-[#FDF3E1] rounded-xl flex items-center justify-center shrink-0">
          <Sparkles className="w-4 h-4 text-[#F2A123]" aria-hidden />
        </div>
        <div className="min-w-0">
          <h3 id="nudge-prefs-title" className="text-sm font-semibold text-foreground">
            Reminders from BIA
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
            In your notifications, at most one a day, only about your own shipments and documents. Never offers.
          </p>
        </div>
      </div>
      <ul className="mt-3 divide-y divide-[#E2E8F0]">
        {data.kinds.map((k) => (
          <li key={k.kind} className="flex items-center gap-3 py-3 first:pt-1 last:pb-0">
            <label htmlFor={`nudge-${k.kind}`} className="flex-1 min-w-0 cursor-pointer">
              <span className="block text-sm font-medium text-foreground">{k.label}</span>
              <span className="block text-xs text-muted-foreground">{k.hint}</span>
            </label>
            <Switch
              id={`nudge-${k.kind}`}
              checked={k.on}
              onCheckedChange={(on) => toggle.mutate({ kind: k.kind, on })}
              data-testid={`switch-nudge-${k.kind}`}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
