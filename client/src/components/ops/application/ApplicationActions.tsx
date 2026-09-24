/**
 * The decision: pick up, approve, ask for a change, reject — and what each of
 * those forms needs before it will send.
 *
 * Moved verbatim out of `pages/ops/OpsApplicationDetail.tsx`.
 */

import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { AlertTriangle, CheckCircle2, Eye, EyeOff, Loader2, Mail } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { parseApiErrorMessage } from '@/lib/apiError';
import { formatIst } from '@/lib/orderDetail';
import { StatusPill } from '@/pages/ops/OpsApplications';
import { Checks } from './ApplicationSummary';
import { APPLICATION_FIELD_LABELS } from '@shared/applicationStatus';
import {
  useOpsApplicationAction,
  type OpsApplicationActionInput,
  type OpsApplicationDetail as Detail,
} from '@/hooks/useOpsApplications';
import {
  DETAIL_ORDER,
  Eyebrow,
  Quote,
  detailValue,
  fieldLabel,
  slotLabel,
} from './blocks';

// ── Decision panel ───────────────────────────────────────────────────────────

type Mode = 'approve' | 'changes' | 'reject' | null;
type RunFn = (input: OpsApplicationActionInput, done?: string) => Promise<boolean>;

/** Where the application stands, in a sentence the reviewer can act on. */
function standing(data: Detail): { title: string; body: string } {
  const a = data.application;
  switch (a.status) {
    case 'submitted':
      return { title: 'New, not picked up', body: 'Pick it up so nobody else reviews it at the same time.' };
    case 'in_review':
      return {
        title: `In review with ${a.reviewer_name ?? 'a reviewer'}`,
        body: 'Check the details and documents against ITD, then decide.',
      };
    case 'changes_requested':
      return {
        title: 'Waiting on the customer',
        body: 'They have been told what to change. When they send it back, it returns here as new.',
      };
    case 'approved':
      return {
        title: 'Account opened',
        body: a.decided_at ? `Approved ${formatIst(a.decided_at)}.` : 'Approved.',
      };
    case 'rejected':
      return { title: 'Rejected', body: 'They stay a guest, keep their bookings, and can apply again.' };
    case 'withdrawn':
      return { title: 'Withdrawn', body: 'The customer withdrew this application.' };
  }
}

export function ActionPanel({
  data,
  changeFields,
  onChangeFields,
  changeSlots,
  onChangeSlots,
  openChanges,
}: {
  data: Detail;
  changeFields: string[];
  onChangeFields: (fields: string[]) => void;
  changeSlots: string[];
  onChangeSlots: (slots: string[]) => void;
  /** Bumped when a value in Details was picked: open the form on that pick. */
  openChanges: number;
}) {
  const a = data.application;
  const allowed = new Set(data.allowed_actions);
  const action = useOpsApplicationAction(a.id);
  const [mode, setMode] = useState<Mode>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // A different application, or the same one moved on: start the panel clean.
  useEffect(() => {
    setMode(null);
    setError('');
  }, [a.id, a.status]);

  useEffect(() => {
    if (openChanges === 0) return;
    setMode('changes');
    setError('');
  }, [openChanges]);

  const run: RunFn = async (input, done) => {
    setError('');
    setNotice('');
    try {
      const result = await action.mutateAsync(input);
      if (input.action === 'approve' || input.action === 'retry_finalize' || input.action === 'resend_email') {
        const parts = [
          result.finalized === false ? 'Account opened, but moving documents or orders did not finish. Use Retry.' : null,
          result.email_sent === false ? 'The email was not sent; see below.' : null,
        ].filter(Boolean);
        setNotice(parts.length > 0 ? parts.join(' ') : done ?? 'Done.');
      } else if (done) {
        setNotice(done);
      }
      setMode(null);
      return true;
    } catch (err) {
      setError(parseApiErrorMessage(err, 'That did not go through. Refresh and try again.'));
      return false;
    }
  };

  const busy = action.isPending;
  const { title, body } = standing(data);
  const asked = a.status === 'changes_requested' ? a.requested_changes : null;
  const hasPrimary = allowed.has('claim') || allowed.has('approve') || allowed.has('request_changes');
  const hasFooter = allowed.has('release') || allowed.has('reject');
  // Approval waits on a reviewer's own check of every document (the server enforces it too).
  const docsLeft = data.documents.filter((d) => !d.verified_at).length;
  const rejectedNote = a.status === 'rejected' ? a.decision_note : null;
  const hasBody =
    Boolean(notice || error || asked || rejectedNote) || a.status === 'approved' || mode !== null || hasPrimary;

  return (
    <section className="rounded-2xl border border-border bg-white overflow-hidden" data-testid="ops-application-actions">
      <header className="px-5 pt-4 pb-4">
        <div className="flex items-center justify-between gap-2">
          <Eyebrow>Decision</Eyebrow>
          <StatusPill status={a.status} />
        </div>
        <h2 className="mt-2 text-base font-extrabold leading-snug text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground mt-1">{body}</p>
      </header>

      {allowed.has('approve') && <Checks data={data} />}

      {hasBody && (
      <div className="border-t border-border px-5 py-4 space-y-3">
        {notice && (
          <p
            className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
            role="status"
            data-testid="ops-application-notice"
          >
            {notice}
          </p>
        )}
        {error && (
          <p
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            role="alert"
            data-testid="ops-application-action-error"
          >
            {error}
          </p>
        )}

        {asked && (
          <div className="space-y-1.5">
            {asked.fields.length > 0 && (
              <p className="text-xs">
                <span className="text-muted-foreground">Fix: </span>
                {asked.fields.map(fieldLabel).join(', ')}
              </p>
            )}
            {asked.slots.length > 0 && (
              <p className="text-xs">
                <span className="text-muted-foreground">Upload again: </span>
                {asked.slots.map(slotLabel).join(', ')}
              </p>
            )}
            {asked.note && <Quote label="Note sent to the customer">{asked.note}</Quote>}
          </div>
        )}
        {a.status === 'rejected' && a.decision_note && (
          <Quote label="Reason sent to the customer">{a.decision_note}</Quote>
        )}

        {a.status === 'approved' && <ApprovedBody data={data} busy={busy} run={run} />}

        {mode === 'approve' && <ApproveForm data={data} busy={busy} run={run} onCancel={() => setMode(null)} />}
        {mode === 'changes' && (
          <ChangesForm
            data={data}
            busy={busy}
            run={run}
            fields={changeFields}
            onFields={onChangeFields}
            slots={changeSlots}
            onSlots={onChangeSlots}
            onCancel={() => setMode(null)}
          />
        )}
        {mode === 'reject' && <RejectForm busy={busy} run={run} onCancel={() => setMode(null)} />}

        {mode === null && hasPrimary && (
          <div className="space-y-2">
            {allowed.has('claim') && (
              <Button
                className="w-full h-11 rounded-xl font-semibold"
                disabled={busy}
                onClick={() => void run({ action: 'claim' }, 'Picked up. It is yours to review.')}
                data-testid="button-application-claim"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : 'Pick up for review'}
              </Button>
            )}
            {allowed.has('approve') && (
              <div>
                <Button
                  variant={allowed.has('claim') || docsLeft > 0 ? 'outline' : 'default'}
                  className="w-full h-11 rounded-xl font-semibold"
                  disabled={busy || docsLeft > 0}
                  onClick={() => setMode('approve')}
                  data-testid="ops-application-approve-open"
                >
                  Approve…
                </Button>
                {docsLeft > 0 && (
                  <p className="mt-1.5 text-center text-xs text-muted-foreground" data-testid="ops-application-approve-blocked">
                    Verify every document first ({docsLeft} left).
                  </p>
                )}
              </div>
            )}
            {allowed.has('request_changes') && (
              <Button
                variant="outline"
                className="w-full h-11 rounded-xl font-semibold"
                disabled={busy}
                onClick={() => setMode('changes')}
                data-testid="ops-application-changes-open"
              >
                Request changes…
              </Button>
            )}
          </div>
        )}
      </div>
      )}

      {/* Kept apart from the main buttons: releasing and rejecting are rare, and rejecting is not undone. */}
      {mode === null && hasFooter && (
        <footer className="flex items-center gap-2 px-3 py-2 border-t border-border bg-[#F8F9FA]">
          {allowed.has('release') && (
            <Button
              variant="ghost"
              className="h-9 rounded-lg text-xs font-semibold text-muted-foreground hover:text-foreground"
              disabled={busy}
              onClick={() => void run({ action: 'release' }, 'Put back in the queue.')}
              data-testid="button-application-release"
            >
              Put back in the queue
            </Button>
          )}
          {allowed.has('reject') && (
            <Button
              variant="ghost"
              className="ml-auto h-9 rounded-lg text-xs font-semibold text-red-700 hover:bg-red-50 hover:text-red-800"
              disabled={busy}
              onClick={() => setMode('reject')}
              data-testid="ops-application-reject-open"
            >
              Reject…
            </Button>
          )}
        </footer>
      )}
    </section>
  );
}

function FormHeading({ children }: { children: string }) {
  return <p className="text-sm font-extrabold text-foreground">{children}</p>;
}

function FormButtons({
  label,
  disabled,
  busy,
  destructive = false,
  onSubmit,
  onCancel,
  testId,
}: {
  label: string;
  disabled: boolean;
  busy: boolean;
  destructive?: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  testId: string;
}) {
  return (
    <div className="flex gap-2 pt-1">
      <Button
        variant={destructive ? 'destructive' : 'default'}
        className="flex-1 h-10 rounded-lg font-semibold"
        disabled={busy || disabled}
        onClick={onSubmit}
        data-testid={testId}
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : label}
      </Button>
      <Button variant="outline" className="h-10 rounded-lg" onClick={onCancel} disabled={busy}>
        Cancel
      </Button>
    </div>
  );
}

function ApproveForm({ data, busy, run, onCancel }: { data: Detail; busy: boolean; run: RunFn; onCancel: () => void }) {
  const [email, setEmail] = useState(String(data.application.details.email ?? ''));
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [created, setCreated] = useState(false);

  const submit = async (): Promise<void> => {
    const ok = await run(
      { action: 'approve', itd_email: email.trim(), itd_password: password },
      'Approved. The account is open and the customer has been emailed.',
    );
    // Gone from the page either way: a password left in a field is a password on a shared screen.
    setPassword('');
    if (ok) setCreated(false);
  };

  return (
    <div className="space-y-3" data-testid="ops-application-approve">
      <FormHeading>Approve and open the account</FormHeading>
      <ol className="list-decimal pl-4 text-xs text-muted-foreground space-y-1">
        <li>Create this customer and a login for them in ITD.</li>
        {data.itd_setup && (
          <li>
            Use contract head <span className="font-mono font-semibold text-foreground">{data.itd_setup.contract_head}</span>
            {data.itd_setup.group_code ? (
              <>
                {' '}and group code <span className="font-mono font-semibold text-foreground">{data.itd_setup.group_code}</span>
              </>
            ) : null}
            .
          </li>
        )}
        <li>Enter that login here. ITD checks it before anything is saved, then it is emailed to the customer.</li>
      </ol>
      <div>
        <label className="block text-xs font-semibold mb-1" htmlFor="itd-email">ITD login email</label>
        <Input
          id="itd-email"
          type="email"
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-10 rounded-lg"
          data-testid="input-itd-email"
        />
      </div>
      <div>
        <label className="block text-xs font-semibold mb-1" htmlFor="itd-password">ITD password</label>
        <div className="relative">
          <Input
            id="itd-password"
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-10 rounded-lg pr-10"
            data-testid="input-itd-password"
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? 'Hide password' : 'Show password'}
            className="absolute right-1 top-1/2 -translate-y-1/2 p-2 text-muted-foreground hover:text-foreground"
          >
            {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </div>
      <label className="flex items-start gap-2 text-xs cursor-pointer">
        <Checkbox checked={created} onCheckedChange={(v) => setCreated(v === true)} data-testid="checkbox-itd-created" />
        <span>I have created this customer and login in ITD.</span>
      </label>
      <FormButtons
        label="Approve & open account"
        disabled={!created || !email.trim() || !password}
        busy={busy}
        onSubmit={() => void submit()}
        onCancel={onCancel}
        testId="button-application-approve"
      />
    </div>
  );
}

/**
 * What to send back. The ticks live above this form, so a value picked on the
 * record in Details and a box ticked here are the same choice.
 */
function ChangesForm({
  data,
  busy,
  run,
  fields,
  onFields,
  slots,
  onSlots,
  onCancel,
}: {
  data: Detail;
  busy: boolean;
  run: RunFn;
  fields: string[];
  onFields: (fields: string[]) => void;
  slots: string[];
  onSlots: (slots: string[]) => void;
  onCancel: () => void;
}) {
  const [note, setNote] = useState('');

  const fieldOptions = DETAIL_ORDER.filter((k) => detailValue(k, data.application.details[k]) !== null);
  // The note is optional; asking for nothing at all is not.
  const nothingAsked = fields.length === 0 && slots.length === 0 && note.trim() === '';
  const toggle = (list: string[], set: (v: string[]) => void, key: string): void =>
    set(list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);

  const submit = async (): Promise<void> => {
    const ok = await run(
      { action: 'request_changes', fields, slots, note: note.trim() },
      'Sent. The customer has been told what to change.',
    );
    if (ok) {
      onFields([]);
      onSlots([]);
      setNote('');
    }
  };

  return (
    <div className="space-y-3" data-testid="ops-application-changes">
      <FormHeading>Ask the customer for a change</FormHeading>
      <fieldset>
        <legend className="text-xs font-semibold mb-1.5">Details to fix</legend>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          {fieldOptions.map((key) => (
            <label key={key} className="flex items-center gap-2 text-xs cursor-pointer">
              <Checkbox checked={fields.includes(key)} onCheckedChange={() => toggle(fields, onFields, key)} />
              {APPLICATION_FIELD_LABELS[key]}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="text-xs font-semibold mb-1.5">Documents to upload again</legend>
        <div className="grid gap-1.5">
          {data.documents.map((doc) => (
            <label key={doc.slot} className="flex items-center gap-2 text-xs cursor-pointer">
              <Checkbox checked={slots.includes(doc.slot)} onCheckedChange={() => toggle(slots, onSlots, doc.slot)} />
              {slotLabel(doc.slot)}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label className="block text-xs font-semibold mb-1" htmlFor="changes-note">
          Note to the customer <span className="font-normal text-muted-foreground">(optional, shown word for word)</span>
        </label>
        <Textarea
          id="changes-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={4}
          maxLength={1000}
          placeholder="e.g. Your PAN card photo is blurred. Please upload a clear photo of the original."
          className="rounded-lg"
          data-testid="input-changes-note"
        />
      </div>
      {nothingAsked && (
        <p className="text-xs text-muted-foreground">Tick what they should change, or write them a note.</p>
      )}
      <FormButtons
        label="Send to customer"
        disabled={nothingAsked}
        busy={busy}
        onSubmit={() => void submit()}
        onCancel={onCancel}
        testId="button-application-request-changes"
      />
    </div>
  );
}

function RejectForm({ busy, run, onCancel }: { busy: boolean; run: RunFn; onCancel: () => void }) {
  const [reason, setReason] = useState('');
  return (
    <div className="space-y-3" data-testid="ops-application-reject">
      <FormHeading>Reject this application</FormHeading>
      <div>
        <label className="block text-xs font-semibold mb-1" htmlFor="reject-reason">
          Reason (shown to the customer word for word)
        </label>
        <Textarea
          id="reject-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={1000}
          className="rounded-lg"
          data-testid="input-reject-reason"
        />
      </div>
      <p className="text-xs text-muted-foreground">They stay a guest, keep their bookings, and can apply again.</p>
      <FormButtons
        label="Reject"
        destructive
        disabled={reason.trim().length < 5}
        busy={busy}
        onSubmit={() => void run({ action: 'reject', reason: reason.trim() }, 'Rejected. The customer has been told.')}
        onCancel={onCancel}
        testId="button-application-reject"
      />
    </div>
  );
}

function ApprovedBody({ data, busy, run }: { data: Detail; busy: boolean; run: RunFn }) {
  const a = data.application;
  return (
    <div className="space-y-3" data-testid="ops-application-approved">
      {a.user_id && (
        <Link href={`/ops/customers/${a.user_id}`} className="block text-sm font-semibold text-[#2F4468] hover:underline">
          Open the customer →
        </Link>
      )}

      {a.finalize_error ? (
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
          <p className="flex items-center gap-1.5 text-xs font-bold text-amber-900">
            <AlertTriangle className="w-3.5 h-3.5" aria-hidden />
            Moving to the account didn't finish
          </p>
          <p className="text-xs text-amber-900 mt-1 break-words">{a.finalize_error}</p>
          <Button
            variant="outline"
            className="mt-2 h-9 rounded-lg text-xs font-semibold"
            disabled={busy}
            onClick={() => void run({ action: 'retry_finalize' }, 'Done. Everything is on the account now.')}
            data-testid="button-application-retry"
          >
            Retry
          </Button>
        </div>
      ) : (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0 mt-px" aria-hidden />
          Documents, identity numbers and guest orders are on the account.
        </p>
      )}

      <div className="pt-3 border-t border-border">
        {a.email_sent_at ? (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Mail className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden />
            Email with the login sent {formatIst(a.email_sent_at)}.
          </p>
        ) : (
          <p className="text-xs text-red-700 break-words">Email not sent{a.email_error ? `: ${a.email_error}` : '.'}</p>
        )}
        <Button
          variant="outline"
          className="mt-2 h-9 rounded-lg text-xs font-semibold"
          disabled={busy}
          onClick={() => void run({ action: 'resend_email' }, 'Email sent again.')}
          data-testid="button-application-resend"
        >
          {a.email_sent_at ? 'Send the email again' : 'Send the email'}
        </Button>
      </div>
    </div>
  );
}
