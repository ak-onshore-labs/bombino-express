import { useState } from 'react';
import { AlertTriangle, Loader2, Mail, Settings, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  useOpsApplicationAlerts,
  useSaveOpsApplicationAlerts,
  useTestOpsApplicationAlerts,
} from '@/hooks/useOpsApplications';
import { parseApiErrorMessage } from '@/lib/apiError';
import { formatIst } from '@/lib/orderDetail';

/** Same bounds as the server (server/opsSettings.ts); the server has the last word. */
const MAX_RECIPIENTS = 5;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The Applications page's Settings button, and the panel it opens. The dot on
 * the button means nobody would hear about a new application: no address yet,
 * or the server can't send mail.
 */
export function OpsApplicationSettings() {
  const [open, setOpen] = useState(false);
  const alerts = useOpsApplicationAlerts();
  const needsSetup = Boolean(alerts.data && (alerts.data.emails.length === 0 || !alerts.data.sender));

  return (
    <>
      <Button
        variant="outline"
        className="relative h-9 gap-1.5 rounded-lg text-xs font-semibold"
        onClick={() => setOpen(true)}
        aria-label={needsSetup ? 'Settings (needs setting up)' : 'Settings'}
        data-testid="button-application-settings"
      >
        <Settings className="h-4 w-4" aria-hidden />
        Settings
        {needsSetup && (
          <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-[#F2A123] ring-2 ring-white" aria-hidden />
        )}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md" data-testid="ops-application-settings">
          <SheetHeader className="text-left">
            <SheetTitle>Application settings</SheetTitle>
            <SheetDescription>How the Bombino team hears about new account applications.</SheetDescription>
          </SheetHeader>
          <div className="mt-6">
            <AlertEmailsSettings />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function AlertEmailsSettings() {
  const alerts = useOpsApplicationAlerts();
  const save = useSaveOpsApplicationAlerts();
  const test = useTestOpsApplicationAlerts();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  if (alerts.isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }
  if (alerts.isError || !alerts.data) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
        <p>Couldn't load these settings. If the server was just updated, restart it, then try again.</p>
        <Button variant="outline" className="mt-2 h-9 rounded-lg text-xs" onClick={() => void alerts.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  const { emails, editable, sender, source, updated_at } = alerts.data;
  const busy = save.isPending;

  const persist = async (next: string[], done: string): Promise<boolean> => {
    setError('');
    setNotice('');
    try {
      await save.mutateAsync(next);
      setNotice(done);
      return true;
    } catch (err) {
      setError(parseApiErrorMessage(err, "Couldn't save. Try again."));
      return false;
    }
  };

  const add = async (): Promise<void> => {
    const address = draft.trim().toLowerCase();
    if (!address) return;
    if (!EMAIL_RE.test(address)) {
      setError(`"${address}" isn't an email address.`);
      return;
    }
    if (emails.includes(address)) {
      setError('That address is already on the list.');
      return;
    }
    if (emails.length >= MAX_RECIPIENTS) {
      setError(`Up to ${MAX_RECIPIENTS} addresses.`);
      return;
    }
    if (await persist([...emails, address], `Added ${address}.`)) setDraft('');
  };

  const remove = (address: string): void => {
    const next = emails.filter((e) => e !== address);
    void persist(next, next.length > 0 ? `Removed ${address}.` : 'Removed. Nobody gets these emails now.');
  };

  const sendTest = async (): Promise<void> => {
    setError('');
    setNotice('');
    try {
      const result = await test.mutateAsync();
      setNotice(`Test sent to ${result.sent_to.join(', ')}. Check the inbox, and spam.`);
    } catch (err) {
      setError(parseApiErrorMessage(err, 'The test email was not sent.'));
    }
  };

  return (
    <section aria-labelledby="alert-emails-title" data-testid="ops-application-alerts">
      <h3 id="alert-emails-title" className="flex items-center gap-2 text-sm font-extrabold text-foreground">
        <Mail className="h-4 w-4 text-muted-foreground" aria-hidden />
        New-application emails
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Sent when a customer sends an application, or sends back the changes you asked for.
      </p>

      {/* Who it comes from, or why nothing goes out. */}
      <div className="mt-4 rounded-lg border border-border bg-[#F8F9FA] px-3 py-2.5 text-xs">
        {sender ? (
          <p>
            <span className="text-muted-foreground">Sent from </span>
            <span className="font-semibold text-foreground">{sender}</span>
          </p>
        ) : (
          <p className="flex items-start gap-1.5 text-amber-900">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
            Email sending isn't set up on the server, so nothing goes out yet. It needs MAIL_FROM and
            GOOGLE_APP_PASS in the server's .env, then a restart.
          </p>
        )}
      </div>

      <h4 className="mt-5 text-xs font-bold uppercase tracking-wider text-muted-foreground">Send to</h4>
      {emails.length === 0 ? (
        <p className="mt-2 text-sm text-foreground">Nobody yet. Add the team inbox below.</p>
      ) : (
        <ul className="mt-2 divide-y divide-border rounded-lg border border-border" data-testid="ops-application-alerts-list">
          {emails.map((address) => (
            <li key={address} className="flex items-center justify-between gap-2 py-1.5 pl-3 pr-1.5">
              <span className="min-w-0 break-all text-sm font-semibold text-foreground">{address}</span>
              {editable && (
                <button
                  type="button"
                  onClick={() => remove(address)}
                  disabled={busy}
                  aria-label={`Remove ${address}`}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {editable ? (
        emails.length < MAX_RECIPIENTS && (
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <label htmlFor="alert-email-new" className="sr-only">
              Email address to add
            </label>
            <Input
              id="alert-email-new"
              type="email"
              inputMode="email"
              autoComplete="off"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setError('');
              }}
              placeholder="ops@bombinoexp.com"
              className="h-10 flex-1 rounded-lg"
              data-testid="input-application-alert-email"
            />
            <Button
              type="submit"
              className="h-10 rounded-lg text-xs font-semibold"
              disabled={busy || !draft.trim()}
              data-testid="button-application-alerts-add"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : 'Add'}
            </Button>
          </form>
        )
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          {source === 'env'
            ? 'Set in the server settings (APPLICATION_ALERT_EMAILS). '
            : ''}
          To change it here, run migrations/add_ops_settings.sql.
        </p>
      )}

      {error && (
        <p className="mt-2 text-xs text-red-700" role="alert">
          {error}
        </p>
      )}
      {notice && !error && (
        <p className="mt-2 text-xs text-emerald-800" role="status">
          {notice}
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
        <p className="text-xs text-muted-foreground">
          {updated_at ? `Last changed ${formatIst(updated_at)}` : `Up to ${MAX_RECIPIENTS} addresses.`}
        </p>
        <Button
          variant="outline"
          className="h-9 rounded-lg text-xs font-semibold"
          disabled={test.isPending || emails.length === 0 || !sender}
          onClick={() => void sendTest()}
          data-testid="button-application-alerts-test"
        >
          {test.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : 'Send a test'}
        </Button>
      </div>
    </section>
  );
}
