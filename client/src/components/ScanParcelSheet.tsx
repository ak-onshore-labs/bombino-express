/**
 * Scan a parcel: point the camera at the QR on a guest's box label, or type the
 * order number off it, and land on that order in your own app.
 *
 * Either way it opens the parcel's details (`/p/:token`), which staff see in
 * full. It never redirects into a workflow and never refuses: the details page
 * offers "Open pickup" / "Open in ops console" when that applies.
 *
 * Decoding is `qr-scanner`: a web worker, the native BarcodeDetector where the
 * browser has one, and cheap on a budget Android. The camera only runs while
 * this sheet is open. Typing is always offered, because a camera can be
 * refused, missing, or (in the app shell) not yet permitted.
 */

import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import QrScanner from 'qr-scanner';
import { Flashlight, Loader2, ScanLine, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ParcelScanResult } from '@shared/parcelTag';

type Surface = 'agent' | 'ops';

type Problem = { kind: 'camera' | 'lookup'; message: string };

async function resolveScan(q: string): Promise<ParcelScanResult> {
  const res = await fetch(`/api/parcel-tag/resolve?q=${encodeURIComponent(q)}`, {
    credentials: 'include',
  });
  const body = (await res.json().catch(() => ({}))) as { message?: string };
  if (!res.ok) throw new Error(body.message ?? 'Could not look that up. Try again.');
  return body as ParcelScanResult;
}

function cameraMessage(err: unknown): string {
  const text = String(err instanceof Error ? err.message : err);
  if (/permission|denied|notallowed/i.test(text)) {
    return 'Camera access is blocked. Allow the camera for this site, or type the order number below.';
  }
  if (/no camera|notfound|not found/i.test(text)) {
    return 'No camera found. Type the order number below.';
  }
  return 'The camera could not start. Type the order number below.';
}

export function ScanParcelSheet({
  surface,
  onClose,
}: {
  surface: Surface;
  onClose: () => void;
}) {
  const [, setLocation] = useLocation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const handlingRef = useRef(false);
  const [starting, setStarting] = useState(true);
  const [hasFlash, setHasFlash] = useState(false);
  const [flashOn, setFlashOn] = useState(false);
  const [typed, setTyped] = useState('');
  const [looking, setLooking] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  const big = surface === 'agent';

  const handle = async (raw: string): Promise<void> => {
    const q = raw.trim();
    if (!q || handlingRef.current) return;
    handlingRef.current = true;
    setLooking(true);
    setProblem(null);
    try {
      const hit = await resolveScan(q);
      onClose();
      setLocation(`/p/${hit.token}`);
    } catch (err) {
      setProblem({
        kind: 'lookup',
        message: err instanceof Error ? err.message : 'Could not look that up. Try again.',
      });
    } finally {
      setLooking(false);
      // Let the same code be scanned again only after a beat, so one QR held
      // in front of the lens is not looked up thirty times a second.
      setTimeout(() => {
        handlingRef.current = false;
      }, 1200);
    }
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const scanner = new QrScanner(video, (result) => void handle(result.data), {
      preferredCamera: 'environment',
      maxScansPerSecond: 8,
      returnDetailedScanResult: true,
    });
    scannerRef.current = scanner;
    scanner
      .start()
      .then(async () => {
        setStarting(false);
        setHasFlash(await scanner.hasFlash().catch(() => false));
      })
      .catch((err: unknown) => {
        setStarting(false);
        setProblem({ kind: 'camera', message: cameraMessage(err) });
      });
    return () => {
      scanner.destroy();
      scannerRef.current = null;
    };
    // `handle` reads state through refs and setters only; the scanner is
    // created once per open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggleFlash = async (): Promise<void> => {
    const scanner = scannerRef.current;
    if (!scanner) return;
    await scanner.toggleFlash().catch(() => undefined);
    setFlashOn(scanner.isFlashOn());
  };

  return (
    <div
      className="fixed inset-0 z-[120] bg-[#0B1620] text-white flex flex-col safe-top"
      role="dialog"
      aria-modal="true"
      aria-label="Scan parcel"
      data-testid="sheet-scan-parcel"
    >
      <div className="flex items-center justify-between px-4 h-14 shrink-0">
        <p className={cn('font-semibold', big ? 'text-lg' : 'text-base')}>Scan parcel</p>
        <button
          type="button"
          onClick={onClose}
          className={cn('grid place-items-center rounded-lg hover:bg-white/10', big ? 'w-14 h-14 -mr-3' : 'w-10 h-10 -mr-2')}
          aria-label="Close scanner"
          data-testid="button-close-scanner"
        >
          <X className={big ? 'w-6 h-6' : 'w-5 h-5'} />
        </button>
      </div>

      <div className="relative flex-1 min-h-0 overflow-hidden bg-black">
        <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" muted playsInline />
        {/* Aim box. Square, centred, the same on every screen. */}
        <div className="absolute inset-0 grid place-items-center pointer-events-none" aria-hidden>
          <div className="w-[min(70vw,280px)] aspect-square rounded-lg border-2 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
        </div>
        {starting && (
          <div className="absolute inset-0 grid place-items-center">
            <Loader2 className="w-6 h-6 animate-spin text-white/80" aria-label="Starting camera" />
          </div>
        )}
        {hasFlash && (
          <button
            type="button"
            onClick={() => void toggleFlash()}
            className={cn(
              'absolute bottom-4 right-4 grid place-items-center rounded-full transition-colors',
              big ? 'w-14 h-14' : 'w-11 h-11',
              flashOn ? 'bg-white text-[#0B1620]' : 'bg-black/50 text-white'
            )}
            aria-label={flashOn ? 'Turn torch off' : 'Turn torch on'}
            aria-pressed={flashOn}
          >
            <Flashlight className="w-5 h-5" />
          </button>
        )}
      </div>

      <div className="shrink-0 bg-white text-foreground px-4 pt-4 pb-6 safe-bottom">
        {problem && (
          <div
            className="mb-3 rounded-lg px-3.5 py-3 text-sm leading-snug bg-red-50 text-red-900"
            role="alert"
            data-testid="scan-problem"
          >
            <p>{problem.message}</p>
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handle(typed);
          }}
          className="flex gap-2"
        >
          <label htmlFor="scan-typed" className="sr-only">
            Order number
          </label>
          <input
            id="scan-typed"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Or type the order number, e.g. BOM-100329"
            autoCapitalize="characters"
            autoComplete="off"
            className={cn(
              'flex-1 min-w-0 rounded-lg border border-[#CBD5E1] px-3.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#2F4468]/40',
              big ? 'h-14 text-base' : 'h-11 text-sm'
            )}
            data-testid="input-scan-order-no"
          />
          <button
            type="submit"
            disabled={looking || !typed.trim()}
            className={cn(
              'shrink-0 inline-flex items-center justify-center gap-1.5 rounded-lg bg-[lab(34.0831_-9.57756_-27.7093)] text-white font-semibold disabled:opacity-50',
              big ? 'h-14 px-5 text-base' : 'h-11 px-4 text-sm'
            )}
            data-testid="button-scan-lookup"
          >
            {looking ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Open'}
          </button>
        </form>
      </div>
    </div>
  );
}

/** The button that opens the scanner, sized for its surface. */
export function ScanParcelButton({
  surface,
  variant = 'full',
  className,
}: {
  surface: Surface;
  /** `full`: labelled button. `icon`: a top-bar glyph. */
  variant?: 'full' | 'icon';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {variant === 'icon' ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn('grid place-items-center w-10 h-10 rounded-md hover:bg-muted transition-colors', className)}
          aria-label="Scan parcel"
          data-testid="button-scan-parcel"
        >
          <ScanLine className="w-5 h-5 text-foreground" />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            'inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors',
            surface === 'agent'
              ? 'w-full h-14 text-[17px] bg-[#1B2A41] text-white active:bg-[#0F1A2B]'
              : 'h-10 px-4 text-sm border border-border bg-white text-foreground hover:bg-muted/50',
            className
          )}
          data-testid="button-scan-parcel"
        >
          <ScanLine className={surface === 'agent' ? 'w-5 h-5' : 'w-4 h-4'} />
          Scan parcel
        </button>
      )}
      {open && <ScanParcelSheet surface={surface} onClose={() => setOpen(false)} />}
    </>
  );
}
