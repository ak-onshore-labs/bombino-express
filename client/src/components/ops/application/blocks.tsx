/**
 * The atoms the application sheet is built from: headings, the copy button,
 * the two tags, and the "ask the customer to fix this" toggle.
 *
 * Split out of `pages/ops/OpsApplicationDetail.tsx`, which had all 35 of its
 * pieces in one 1,584-line file. Nothing here changed in the move.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Check, Copy, PenLine } from 'lucide-react';

import { cn } from '@/lib/utils';
import { DOC_SLOT_SPECS, isDocSlot } from '@shared/accountSpec';
import { INDIA_HUBS } from '@shared/hubs';
import {
  APPLICATION_FIELD_LABELS,
  isApplicationField,
  type ApplicationField,
} from '@shared/applicationStatus';

/** The form fields, grouped the way a reviewer checks them against ITD. */
export const DETAIL_GROUPS: ReadonlyArray<{ title: string; keys: readonly ApplicationField[] }> = [
  { title: 'Applicant', keys: ['full_name', 'company_name', 'contact_person', 'email'] },
  { title: 'Address', keys: ['address', 'city', 'state', 'pincode', 'hub_id'] },
  { title: 'Export and bank', keys: ['gstin', 'lut_no', 'iec_branch_code', 'bank_account_no', 'bank_ad_code'] },
];

export const DETAIL_ORDER: readonly ApplicationField[] = DETAIL_GROUPS.flatMap((g) => g.keys);

export function detailValue(key: string, value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  if (key === 'hub_id') return INDIA_HUBS.find((h) => h.id === Number(value))?.name ?? String(value);
  return String(value);
}

export function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

export function fieldLabel(key: string): string {
  return isApplicationField(key) ? APPLICATION_FIELD_LABELS[key] : key;
}

export function slotLabel(slot: string): string {
  return isDocSlot(slot) ? DOC_SLOT_SPECS[slot].label : slot;
}

// ── Building blocks ──────────────────────────────────────────────────────────

/** A section's title row inside the application sheet. */
export function SheetHeading({ title, meta, divided = false }: { title: string; meta?: string; divided?: boolean }) {
  return (
    <header className={cn('flex items-baseline justify-between gap-3 px-5 pt-5 pb-3', divided && 'border-t border-border')}>
      <h2 className="text-base font-extrabold text-foreground">{title}</h2>
      {meta && <p className="text-xs font-medium text-muted-foreground">{meta}</p>}
    </header>
  );
}

/** Small uppercase label that opens a block. */
export function Eyebrow({ children, className }: { children: string; className?: string }) {
  return (
    <p className={cn('text-[11px] font-bold uppercase tracking-wider text-muted-foreground', className)}>{children}</p>
  );
}

/** Reviewers retype most of this into ITD; one click saves the typos. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => setCopied(true), () => undefined);
      }}
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      title={copied ? 'Copied' : 'Copy'}
      className={cn(
        'grid place-items-center w-7 h-7 -my-1 rounded-md shrink-0 transition-opacity duration-150',
        'text-muted-foreground hover:bg-[#F3F4F6] hover:text-foreground focus-visible:opacity-100',
        'opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100',
        copied && 'opacity-100 text-emerald-700',
      )}
    >
      {copied ? <Check className="w-3.5 h-3.5" aria-hidden /> : <Copy className="w-3.5 h-3.5" aria-hidden />}
    </button>
  );
}

export function FixTag() {
  return (
    <span className="ml-2 inline-block align-middle rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-800">
      Asked to fix
    </span>
  );
}

export function Quote({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-white px-3 py-2">
      {label && <p className="text-[11px] font-semibold text-muted-foreground mb-0.5">{label}</p>}
      <p className="text-sm text-foreground whitespace-pre-wrap break-words">{children}</p>
    </div>
  );
}

/**
 * Marking something wrong where the reviewer spots it, rather than hunting for
 * it again in the panel's list. It ticks the same box the form shows.
 *
 * Always on screen and always labelled: a control that only appears on hover is
 * a control most reviewers never find.
 */
export function AskButton({
  fieldKey,
  label,
  picked,
  onAsk,
  isDocument = false,
}: {
  fieldKey: string;
  label: string;
  picked: boolean;
  onAsk: () => void;
  isDocument?: boolean;
}) {
  const ask = isDocument ? `Ask the customer to upload ${label} again` : `Ask the customer to fix ${label}`;
  return (
    <button
      type="button"
      onClick={onAsk}
      aria-pressed={picked}
      aria-label={picked ? `Stop asking about ${label}` : ask}
      title={picked ? 'Picked to send back — click to undo' : ask}
      data-testid={`ops-application-ask-${isDocument ? 'document' : 'field'}-${fieldKey}`}
      className={cn(
        'inline-flex items-center gap-1 h-6 -my-0.5 px-2 rounded-md shrink-0 border text-[11px] font-semibold',
        picked
          ? 'border-violet-300 bg-violet-100 text-violet-800 hover:bg-violet-200'
          : 'border-border text-muted-foreground hover:bg-[#F3F4F6] hover:text-foreground',
      )}
    >
      {picked ? (
        <Check className="w-3.5 h-3.5" aria-hidden />
      ) : (
        <PenLine className="w-3.5 h-3.5" aria-hidden />
      )}
      {picked ? 'Picked' : isDocument ? 'Ask again' : 'Ask to fix'}
    </button>
  );
}

/**
 * What the Ask buttons do, said once per section: nothing leaves the office
 * until the reviewer sends the request from the panel.
 */
export function AskHelp({ what, count }: { what: 'details' | 'documents'; count: number }) {
  return (
    <p className="px-5 pb-3 -mt-1 text-xs text-muted-foreground" data-testid={`ops-application-ask-help-${what}`}>
      {what === 'documents'
        ? 'Ask again marks a document for the customer to upload again.'
        : 'Ask to fix marks a value for the customer to correct.'}{' '}
      Picks gather in the decision panel and go out only when you send the request.
      {count > 0 && (
        <span className="font-semibold text-violet-700">
          {' '}
          {count} picked so far.
        </span>
      )}
    </p>
  );
}

