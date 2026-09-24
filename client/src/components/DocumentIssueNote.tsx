import type { BiaScreen } from '@shared/biaScreen';
import type { DocumentIssue } from '@shared/ocrExplain';
import { AskBiaLink } from '@/components/bia/AskBiaLink';
import { cn } from '@/lib/utils';

/**
 * A document problem, explained under its upload box: what went wrong, why,
 * and what to do (shared/ocrExplain.ts — the same words BIA uses), with "Ask
 * BIA" beside it.
 *
 * `refused` is a file the server turned away (red); otherwise the file was
 * kept and only its check didn't pass (amber). `message` is the server's own
 * line, handed to BIA when asked, since it can name specifics the general
 * explanation doesn't.
 */
export function DocumentIssueNote({
  issue,
  refused,
  screen,
  message,
  className,
}: {
  issue: DocumentIssue;
  refused: boolean;
  screen: Omit<BiaScreen, 'errorCode'>;
  message?: string | null;
  className?: string;
}): React.JSX.Element {
  return (
    <div
      role={refused ? 'alert' : 'status'}
      className={cn(
        'flex flex-col items-start gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] leading-snug',
        refused ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-800',
        className,
      )}
      data-testid={`document-issue-${issue.code}`}
    >
      <p className="font-semibold">{issue.headline}</p>
      <p>
        {issue.why} {issue.fix}
      </p>
      <AskBiaLink screen={screen} code={issue.code} message={message || issue.headline} />
    </div>
  );
}
