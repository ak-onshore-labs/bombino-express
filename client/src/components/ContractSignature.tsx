import React, { useState } from 'react';
import { Link } from 'wouter';
import { ScrollText, FileText, ChevronRight } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ContractPreview } from '@/components/ContractPreview';
import {
  CONTRACT_PAGE_COUNT,
  CONTRACT_TITLE,
  CONTRACT_VERSION,
  SIGNATURE_MAX_LENGTH,
  isValidSignature,
} from '@shared/contract';
import { cn } from '@/lib/utils';

interface ContractSignatureProps {
  accepted: boolean;
  onAcceptedChange: (accepted: boolean) => void;
  signedName: string;
  onSignedNameChange: (name: string) => void;
  /** The verified phone — the server's authorisation for the preview call. */
  phone: string;
  /** Whose account it is; goes on the "For M/s" line of the contract. */
  accountName: string;
  /** Set after a blocked submit, so the gaps are marked rather than hunted for. */
  error?: string;
}

/**
 * The contract, and the signature that closes signup.
 *
 * What is signed is the document itself — client/public/contract-2026.pdf,
 * opened from here. It used to be six summary clauses written into
 * shared/contract.ts, which were never the operative text; they are gone,
 * because a customer signing a summary of a contract has not signed the
 * contract.
 *
 * The document opens in its own tab rather than an embedded viewer: it is
 * four pages, mobile browsers render PDFs natively far more reliably than in
 * an iframe, and a new tab leaves the half-finished signup untouched behind
 * it.
 *
 * Signing is typing: the customer ticks acceptance and types their name. The
 * server stamps it with CONTRACT_VERSION, so an acceptance stays readable
 * later as the document that was actually on offer.
 */
export function ContractSignature({
  accepted,
  onAcceptedChange,
  signedName,
  onSignedNameChange,
  phone,
  accountName,
  error,
}: ContractSignatureProps): React.JSX.Element {
  const [previewOpen, setPreviewOpen] = useState(false);
  const signatureValid = isValidSignature(signedName);
  const signedOn = new Date().toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div
      className={cn(
        'bg-card rounded-xl border p-4 shadow-sm space-y-3',
        error ? 'border-primary border-2' : 'border-border',
      )}
      data-testid="contract-signature"
    >
      <div className="flex items-start gap-2">
        <ScrollText className="w-5 h-5 text-[#F2A123] shrink-0 mt-0.5" />
        <div>
          <Label className="text-sm font-semibold">{CONTRACT_TITLE}</Label>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Version {CONTRACT_VERSION} · read before you sign
          </p>
        </div>
      </div>

      {/* The document, not a description of it, and shown in the app rather
          than handed to a new tab — the customer is mid-signup and should not
          have to find their way back. Disabled until the signature is valid,
          because the whole point is that the name is already on the page: an
          empty signature block would show them the wrong document. */}
      <button
        type="button"
        onClick={() => setPreviewOpen(true)}
        disabled={!signatureValid}
        className={cn(
          'w-full flex items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors',
          signatureValid
            ? 'border-border bg-muted/40 hover:border-[#F2A123]'
            : 'border-border bg-muted/20 opacity-60 cursor-not-allowed',
        )}
        data-testid="contract-view-document"
      >
        <FileText className="w-5 h-5 text-[#F2A123] shrink-0" />
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-foreground">
            {signatureValid ? 'Read the contract you are signing' : 'Read the contract'}
          </span>
          <span className="block text-[11px] text-muted-foreground mt-0.5">
            {signatureValid
              ? `${CONTRACT_PAGE_COUNT} pages · your name is on the last page`
              : 'Type your name below to see it signed'}
          </span>
        </span>
        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
      </button>

      {previewOpen && (
        <ContractPreview
          phone={phone}
          signedName={signedName}
          accountName={accountName}
          onClose={() => setPreviewOpen(false)}
        />
      )}

      <p className="text-[11px] text-muted-foreground">
        Read the document before you sign. Personal data is handled as described in our{' '}
        <Link href="/privacy" className="text-[#F2A123] underline">
          Privacy Policy
        </Link>
        .
      </p>

      <label className="flex items-start gap-2.5 cursor-pointer">
        <Checkbox
          checked={accepted}
          onCheckedChange={(v) => onAcceptedChange(v === true)}
          className="mt-0.5"
          data-testid="checkbox-accept-contract"
        />
        <span className="text-xs text-foreground leading-snug">
          I have read this document and agree to it, and I am authorised to sign it for this
          account.
        </span>
      </label>

      <div>
        <Label className="text-xs text-muted-foreground">
          Signature <span className="text-red-400">*</span>
        </Label>
        <Input
          value={signedName}
          onChange={(e) => onSignedNameChange(e.target.value.slice(0, SIGNATURE_MAX_LENGTH))}
          placeholder="Type your full name"
          maxLength={SIGNATURE_MAX_LENGTH}
          autoComplete="name"
          className="h-11 mt-1 text-sm bg-muted/30 border-border rounded-xl"
          data-testid="input-contract-signature"
        />
        <p className="text-[11px] text-muted-foreground mt-1">
          Typing your name here signs the contract, the same as signing it by hand.
        </p>
      </div>

      {/* The signature as it will stand on the contract — what they typed,
          dated, so it reads as a signature rather than one more form field.
          The date is the browser's, for display only; the moment of signing
          that counts is contract_accepted_at, written server-side from the
          server's own clock when the account is created. */}
      <div className="rounded-lg border border-dashed border-border px-3 py-2.5">
        <p
          className={cn(
            'text-lg italic leading-tight break-all',
            signatureValid && accepted ? 'text-foreground' : 'text-muted-foreground/50',
          )}
          style={{ fontFamily: '"Segoe Script", "Brush Script MT", cursive' }}
          data-testid="contract-signature-preview"
        >
          {signedName.trim() || 'Your name'}
        </p>
        <p className="text-[10px] text-muted-foreground mt-1">Signed on {signedOn}</p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-500">
          {error}
        </p>
      )}
    </div>
  );
}
