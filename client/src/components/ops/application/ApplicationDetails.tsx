/**
 * What the customer typed, grouped the way a reviewer checks it against ITD,
 * with each value copyable and sendable back for a fix.
 *
 * Moved verbatim out of `pages/ops/OpsApplicationDetail.tsx`.
 */

import { cn } from '@/lib/utils';
import { formatIst } from '@/lib/orderDetail';
import type { OpsApplicationDetail as Detail } from '@/hooks/useOpsApplications';
import { APPLICATION_FIELD_LABELS } from '@shared/applicationStatus';
import {
  AskButton,
  AskHelp,
  CopyButton,
  DETAIL_GROUPS,
  FixTag,
  SheetHeading,
  detailValue,
} from './blocks';

// ── Details ──────────────────────────────────────────────────────────────────

/**
 * Identifiers read and typed character by character: tabular figures and a
 * little extra tracking so they scan in groups. (No mono face is loaded, and
 * the system fallback clashes with Poppins.)
 */
const ID_FIELDS: ReadonlySet<string> = new Set(['gstin', 'lut_no', 'iec_branch_code', 'bank_account_no', 'bank_ad_code', 'pincode', 'phone']);

type TableRow = {
  key: string;
  label: string;
  value: string;
  copy?: string;
  flagged?: boolean;
  /** Fields the customer can be sent back to fix; the contract rows cannot. */
  askable?: boolean;
};

function Row({ row, picked, onAsk }: { row: TableRow; picked: boolean; onAsk?: (key: string) => void }) {
  return (
    <div className="group grid grid-cols-[minmax(7rem,10rem)_minmax(0,1fr)] gap-x-4 px-5 py-2.5 border-t border-border first:border-t-0 hover:bg-[#F8F9FA]/70">
      <dt className="pt-0.5 text-xs font-medium text-muted-foreground">{row.label}</dt>
      <dd className="flex items-start gap-2 min-w-0">
        <span
          className={cn(
            'flex-1 min-w-0 break-words text-sm font-semibold text-foreground',
            ID_FIELDS.has(row.key) && 'tabular-nums tracking-wide',
          )}
        >
          {row.value}
          {row.flagged && <FixTag />}
        </span>
        {onAsk && row.askable && (
          <AskButton fieldKey={row.key} label={row.label} picked={picked} onAsk={() => onAsk(row.key)} />
        )}
        {row.copy !== undefined && <CopyButton value={row.copy} label={row.label} />}
      </dd>
    </div>
  );
}

function Group({
  title,
  rows,
  picked,
  onAsk,
}: {
  title: string;
  rows: TableRow[];
  picked: ReadonlySet<string>;
  onAsk?: (key: string) => void;
}) {
  return (
    <div className="min-w-0">
      <h3 className="border-y border-border bg-[#F8F9FA] px-5 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <dl>
        {rows.map((row) => (
          <Row key={row.key} row={row} picked={picked.has(row.key)} onAsk={onAsk} />
        ))}
      </dl>
    </div>
  );
}

export function DetailsSection({
  data,
  canAskChanges,
  picked,
  onAsk,
}: {
  data: Detail;
  canAskChanges: boolean;
  picked: readonly string[];
  onAsk: (key: string) => void;
}) {
  const a = data.application;
  const asked = new Set(a.status === 'changes_requested' ? a.requested_changes?.fields ?? [] : []);
  const pickedSet = new Set(picked);

  const groups = DETAIL_GROUPS.map((group) => {
    const rows: TableRow[] = group.keys.flatMap((key) => {
      const value = detailValue(key, a.details[key]);
      return value === null
        ? []
        : [
            {
              key,
              label: APPLICATION_FIELD_LABELS[key],
              value,
              copy: value,
              flagged: asked.has(key),
              askable: true,
            },
          ];
    });
    if (group.title === 'Applicant') rows.push({ key: 'phone', label: 'Phone', value: `+91 ${a.phone}`, copy: a.phone });
    return { title: group.title, rows };
  }).filter((g) => g.rows.length > 0);

  groups.push({
    title: 'Contract',
    rows: [
      { key: 'signed_name', label: 'Signed by', value: a.contract.signed_name },
      { key: 'accepted_at', label: 'Signed on', value: formatIst(a.contract.accepted_at) },
      { key: 'version', label: 'Version', value: a.contract.version },
    ],
  });

  return (
    <div data-testid="ops-application-details">
      <SheetHeading title="Details" meta="Hover a value to copy it" />
      {canAskChanges && <AskHelp what="details" count={picked.length} />}
      {/* Two columns only when the sheet itself is wide (the stacked layout);
          beside the decision panel it is too narrow and values would wrap. */}
      <div className="@container">
        <div className="grid @4xl:grid-cols-2 @4xl:[&>*:nth-child(even)]:border-l @4xl:[&>*]:border-border">
          {groups.map((g) => (
            <Group
              key={g.title}
              title={g.title}
              rows={g.rows}
              picked={pickedSet}
              onAsk={canAskChanges ? onAsk : undefined}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
