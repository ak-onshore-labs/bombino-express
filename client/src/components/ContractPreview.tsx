import React, { Suspense, lazy, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X } from 'lucide-react';
import { CONTRACT_TITLE } from '@shared/contract';

/**
 * The contract, with the signature already on it, shown inside the app.
 *
 * Not a link to a new tab and not an <iframe>. A tab takes the customer out
 * of a half-finished signup into browser chrome they then have to find their
 * way back from, and an iframe hands rendering to whatever PDF plugin the
 * device happens to have — which on mobile is frequently a download prompt.
 *
 * The pages are drawn by PdfCanvasViewer, the same component the KYC card and
 * the shipment label already use. Reused rather than reimplemented: it is on
 * the legacy pdf.js build for Android WebView compatibility, fits pages to the
 * container and accounts for devicePixelRatio, and a second integration here
 * would ship a second copy of pdf.js for no gain.
 *
 * The bytes come from POST /api/signup/contract/preview, which stamps the name
 * into the signature block server-side. Nothing about the document is assembled
 * in the browser: the customer sees the file the server would keep.
 */

// Same lazy shape as the other two callers — pdf.js is ~450kB and nobody who
// declines to read the contract should pay for it.
const PdfCanvasViewer = lazy(() => import('@/components/PdfCanvasViewer'));

interface ContractPreviewProps {
  /** The verified phone — the server's authorisation for a pre-account call. */
  phone: string;
  /** The name typed as the signature, stamped into the block on the last page. */
  signedName: string;
  /** Whose account it is; goes on the "For M/s" line. */
  accountName: string;
  onClose: () => void;
}

/** PdfCanvasViewer takes base64, which is also what every other caller holds. */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  // Chunked: handing 300kB to String.fromCharCode in one call overflows the
  // argument limit on some engines.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(binary);
}

export function ContractPreview({
  phone,
  signedName,
  accountName,
  onClose,
}: ContractPreviewProps): React.JSX.Element {
  const [base64, setBase64] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch('/api/signup/contract/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone, signed_name: signedName, account_name: accountName }),
          credentials: 'include',
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { message?: string };
          throw new Error(body.message ?? 'Could not open the contract.');
        }
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (!cancelled) setBase64(toBase64(bytes));
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not open the contract.');
      }
    })();

    return () => {
      cancelled = true;
    };
    // Re-fetching when the name changes is the point: the stamp has to match it.
  }, [phone, signedName, accountName]);

  // Escape closes, and the overlay owns the scroll while it is up.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const spinner = (
    <div className="flex-1 grid place-items-center bg-neutral-100">
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
    </div>
  );

  // Portalled to <body>. The signing card is several levels down a layout
  // that may one day animate or clip; a fixed overlay inside a transformed or
  // overflow-hidden ancestor is positioned against that ancestor instead of
  // the viewport, and the first thing to disappear is the bar at the top.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-label={CONTRACT_TITLE}
      data-testid="contract-preview"
    >
      {/* shrink-0 is load-bearing. Without it this is a flex item that can be
          compressed by the viewer below, which wants every pixel it can get —
          on a short viewport the bar collapses and the close button goes with
          it, leaving no way out of the overlay. */}
      <div className="shrink-0 flex items-center justify-between gap-3 bg-card px-4 py-3 border-b border-border">
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">{CONTRACT_TITLE}</p>
          <p className="text-[11px] text-muted-foreground truncate">
            Signed by {signedName.trim() || '—'}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 h-10 w-10 grid place-items-center rounded-lg border border-border bg-background hover:bg-muted"
          aria-label="Close the contract"
          data-testid="contract-preview-close"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {error ? (
        <div className="flex-1 grid place-items-center bg-neutral-100 px-6">
          <p role="alert" className="text-sm text-red-600 text-center">
            {error}
          </p>
        </div>
      ) : base64 === null ? (
        spinner
      ) : (
        <Suspense fallback={spinner}>
          <PdfCanvasViewer base64={base64} title={CONTRACT_TITLE} />
        </Suspense>
      )}

      {/* A second way out, at the end of the document where someone who has
          just finished reading four pages already is. Same shrink-0 reasoning
          as the bar above. */}
      <div className="shrink-0 bg-card px-4 py-3 border-t border-border">
        <button
          type="button"
          onClick={onClose}
          className="w-full h-11 rounded-xl border border-border bg-background text-sm font-medium hover:bg-muted"
          data-testid="contract-preview-close-footer"
        >
          Close
        </button>
      </div>
    </div>,
    document.body,
  );
}
