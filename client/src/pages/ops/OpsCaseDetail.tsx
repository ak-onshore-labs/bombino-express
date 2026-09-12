import { useState } from 'react';
import { Link, useParams } from 'wouter';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { OpsShell } from '@/components/ops/OpsShell';
import { Button } from '@/components/ui/button';
import {
  CASE_CATEGORY_LABELS,
  CASE_STATUS_STYLE,
  CasesNotSetUpError,
  OPS_CASES_KEY,
  formatCaseTime,
  useOpsCase,
} from '@/hooks/useOpsCases';
import { parseApiErrorMessage } from '@/lib/apiError';
import { apiRequest } from '@/lib/queryClient';
import { cn } from '@/lib/utils';

const MAX_REPLY = 2000;

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-2.5 border-b border-border last:border-b-0">
      <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{label}</p>
      <div className="text-sm font-semibold text-foreground mt-0.5 break-words">{children}</div>
    </div>
  );
}

/**
 * One support case: BIA's three-line summary first, then the customer and the
 * order, a reply box, and the conversation BIA had with them.
 */
export default function OpsCaseDetail() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useOpsCase(id);
  const [reply, setReply] = useState('');
  const [formError, setFormError] = useState('');
  const [sent, setSent] = useState('');

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: OPS_CASES_KEY });
  };

  const send = useMutation({
    mutationFn: async (text: string) =>
      (await (await apiRequest('POST', `/api/ops/cases/${id}/reply`, { reply: text })).json()) as { notified: boolean },
    onSuccess: (body) => {
      setReply('');
      setSent(body.notified ? 'Reply sent. The customer will see it in their notifications.' : 'Reply saved, but the notification could not be sent.');
      refresh();
    },
    onError: (err) => setFormError(parseApiErrorMessage(err, 'Could not send the reply.')),
  });

  const close = useMutation({
    mutationFn: async () => apiRequest('POST', `/api/ops/cases/${id}/close`, {}),
    onSuccess: refresh,
    onError: (err) => setFormError(parseApiErrorMessage(err, 'Could not close the case.')),
  });

  const notFound = isError && error instanceof Error && error.message.startsWith('404:');
  const notSetUp = error instanceof CasesNotSetUpError;

  return (
    <OpsShell title={data?.caseNo ?? 'Case'} subtitle={data ? CASE_CATEGORY_LABELS[data.category] ?? data.category : 'Support case'} wide>
      <Link href="/ops/cases" className="inline-flex items-center gap-1 text-sm font-semibold text-[#F2A123] mb-4" data-testid="link-ops-back-cases">
        <ArrowLeft className="w-4 h-4" />
        Back to cases
      </Link>

      {isLoading && (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      )}
      {isError && (
        <p className="text-sm text-muted-foreground py-8" data-testid="ops-case-error">
          {notSetUp ? "Cases aren't set up yet." : notFound ? 'That case could not be found.' : 'Could not load this case.'}
        </p>
      )}

      {data && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] items-start">
          <div className="flex flex-col gap-5 min-w-0">
            <section className="rounded-2xl border border-border bg-white p-4" data-testid="ops-case-summary">
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className={cn('text-[11px] font-bold rounded-full px-2 py-0.5', CASE_STATUS_STYLE[data.status].className)}>
                  {CASE_STATUS_STYLE[data.status].label}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">Opened {formatCaseTime(data.createdAt)}</span>
              </div>
              <h2 className="text-[11px] uppercase tracking-[0.14em] font-bold text-muted-foreground mb-2">BIA's summary</h2>
              <ol className="flex flex-col gap-1.5 text-sm leading-relaxed list-decimal pl-5">
                {data.summary.split('\n').filter(Boolean).map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ol>
            </section>

            <section className="rounded-2xl border border-border bg-white p-4" data-testid="ops-case-reply">
              <h2 className="text-base font-extrabold mb-3">Reply to the customer</h2>
              {data.opsReply && (
                <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 mb-3">
                  <p className="text-[11px] font-bold text-emerald-700 mb-1">
                    Sent{data.answeredAt ? ` ${formatCaseTime(data.answeredAt)}` : ''}
                  </p>
                  <p className="text-sm whitespace-pre-wrap">{data.opsReply}</p>
                </div>
              )}
              {data.status === 'closed' ? (
                <p className="text-sm text-muted-foreground">This case is closed.</p>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    setFormError('');
                    setSent('');
                    const text = reply.trim();
                    if (!text) {
                      setFormError('Write a reply first.');
                      return;
                    }
                    send.mutate(text);
                  }}
                  className="flex flex-col gap-2"
                >
                  <label htmlFor="ops-case-reply-text" className="text-xs text-muted-foreground">
                    It reaches their notifications as "Reply on your case {data.caseNo}". Write it as the answer, from their side.
                  </label>
                  <textarea
                    id="ops-case-reply-text"
                    value={reply}
                    onChange={(e) => {
                      setReply(e.target.value.slice(0, MAX_REPLY));
                      if (formError) setFormError('');
                    }}
                    rows={4}
                    className="rounded-xl border border-[#E2E8F0] bg-[#F3F4F6] p-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    placeholder={data.opsReply ? 'Send another reply' : 'Your reply'}
                    data-testid="input-ops-case-reply"
                  />
                  {formError && <p className="text-sm font-semibold text-red-600">{formError}</p>}
                  {sent && <p className="text-sm font-semibold text-emerald-700" data-testid="ops-case-sent">{sent}</p>}
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" disabled={send.isPending} data-testid="button-ops-case-send">
                      {send.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Send reply'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={close.isPending}
                      onClick={() => close.mutate()}
                      data-testid="button-ops-case-close"
                    >
                      Close case
                    </Button>
                  </div>
                </form>
              )}
            </section>

            <section className="rounded-2xl border border-border bg-white p-4" data-testid="ops-case-transcript">
              <h2 className="text-base font-extrabold mb-3">The conversation with BIA</h2>
              {data.transcript.length === 0 ? (
                <p className="text-sm text-muted-foreground">No conversation was kept.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {data.transcript.map((m, i) => (
                    <li key={i} className={cn('max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap', m.role === 'user' ? 'self-end bg-[#FDF3E1]' : 'self-start bg-[#F3F4F6]')}>
                      <span className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">
                        {m.role === 'user' ? 'Customer' : 'BIA'}
                      </span>
                      {m.content}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <aside className="rounded-2xl border border-border bg-white p-4" data-testid="ops-case-facts">
            <Fact label="Customer">{data.customerName ?? (data.owner === 'guest' ? 'Guest (booked without an account)' : '—')}</Fact>
            <Fact label="Phone">{data.customerPhone ?? '—'}</Fact>
            <Fact label="Order">
              {data.orderNo ? (
                data.orderId ? (
                  <Link href={`/ops/orders/${data.orderId}`} className="text-[#14567C] underline underline-offset-2">
                    {data.orderNo}
                  </Link>
                ) : (
                  data.orderNo
                )
              ) : (
                'None named'
              )}
            </Fact>
            <Fact label="Category">{CASE_CATEGORY_LABELS[data.category] ?? data.category}</Fact>
          </aside>
        </div>
      )}
    </OpsShell>
  );
}
