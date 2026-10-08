/**
 * Scan a parcel: point the camera at the QR on a guest's box label or the
 * barcode on an ITD label, or type the order or AWB number off it.
 *
 * Either way it opens the parcel's details (`/p/:token`), which staff see in
 * full. It never redirects into a workflow and never refuses: the details page
 * offers "Open pickup" / "Open in ops console" when that applies.
 *
 * Decoding is ZXing (lib/barcodeScanner.ts): our QR box label and ITD's 1-D
 * barcodes (AWB, and AWB plus box number), loaded only when a scanner opens.
 * The camera only runs while this sheet is open.
 *
 * Two fallbacks are always offered, because a live camera is often not
 * available: iOS gives web pages the camera only on https, an app webview only
 * when the app declares camera permission, and anyone can refuse it.
 *   - "Take a photo of the code" opens the phone's own camera through the
 *     ordinary photo picker and decodes the picture here. Works where the live
 *     camera does not (iOS Safari, app webviews).
 *   - Typing the order number.
 */

import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { decodeImageFile, startCamera, type CameraControls } from '@/lib/barcodeScanner';
import { Camera, Flashlight, Loader2, ScanLine, X } from 'lucide-react';
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

/**
 * Why the live camera did not start, in words that say what to do.
 *
 * The cause is read from the page itself first (secure context, camera API),
 * because a browser's own error for a blocked camera is often just "not found".
 */
function cameraMessage(err: unknown): string {
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return 'The live camera only works on the secure (https) site. Take a photo of the code instead.';
  }
  if (typeof navigator !== 'undefined' && !navigator.mediaDevices) {
    return 'This app is not allowed to use the live camera. Take a photo of the code instead.';
  }
  const text = String(err instanceof Error ? err.message : err);
  if (/permission|denied|notallowed/i.test(text)) {
    return 'Camera access was refused. Allow it in Settings, or take a photo of the code instead.';
  }
  return 'The live camera could not start. Take a photo of the code instead.';
}

export function ScanParcelSheet({
  surface,
  onClose,
  onResolved,
  title = 'Scan parcel',
}: {
  surface: Surface;
  onClose: () => void;
  /**
   * Take the scanned order instead of opening its details page: the agent's
   * "Check box" compares it with the job, the hub's "Scan to receive" opens
   * the order at its receive step.
   */
  onResolved?: (hit: ParcelScanResult) => void;
  title?: string;
}) {
  const [, setLocation] = useLocation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<CameraControls | null>(null);
  const handlingRef = useRef(false);
  const [starting, setStarting] = useState(true);
  const [hasFlash, setHasFlash] = useState(false);
  const [flashOn, setFlashOn] = useState(false);
  const [typed, setTyped] = useState('');
  const [looking, setLooking] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [cameraFailed, setCameraFailed] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);

  /** Decode a photo the phone's own camera took. */
  const scanPhoto = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setProblem(null);
    try {
      await handle(await decodeImageFile(file));
    } catch {
      setProblem({
        kind: 'lookup',
        message: 'No code found in that photo. Hold the phone closer, keep the code flat and in focus, and try again.',
      });
    } finally {
      if (photoRef.current) photoRef.current.value = '';
    }
  };

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
      if (onResolved) onResolved(hit);
      else setLocation(`/p/${hit.token}`);
    } catch (err) {
      setProblem({
        kind: 'lookup',
        message: err instanceof Error ? err.message : 'Could not look that up. Try again.',
      });
    } finally {
      setLooking(false);
      // Let the same code be scanned again only after a beat, so one label
      // held in front of the lens is not looked up several times a second.
      setTimeout(() => {
        handlingRef.current = false;
      }, 1200);
    }
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    startCamera(video, (text) => void handle(text))
      .then((controls) => {
        if (cancelled) {
          controls.stop();
          return;
        }
        scannerRef.current = controls;
        setStarting(false);
        setHasFlash(!!controls.switchTorch);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStarting(false);
        setCameraFailed(true);
        setProblem({ kind: 'camera', message: cameraMessage(err) });
      });
    return () => {
      cancelled = true;
      scannerRef.current?.stop();
      scannerRef.current = null;
    };
    // `handle` reads state through refs and setters only; the camera starts
    // once per open.
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
    const controls = scannerRef.current;
    if (!controls?.switchTorch) return;
    const next = !flashOn;
    await controls.switchTorch(next).then(() => setFlashOn(next)).catch(() => undefined);
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
        <p className={cn('font-semibold', big ? 'text-lg' : 'text-base')}>{title}</p>
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

        {/* The phone's own camera, through the photo picker. First and filled
            when the live camera failed, a quiet extra otherwise. */}
        <input
          ref={photoRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => void scanPhoto(e.target.files?.[0])}
          data-testid="input-scan-photo"
        />
        <button
          type="button"
          onClick={() => photoRef.current?.click()}
          disabled={looking}
          className={cn(
            'mb-3 w-full inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors disabled:opacity-50',
            big ? 'h-14 text-base' : 'h-11 text-sm',
            cameraFailed
              ? 'bg-[lab(34.0831_-9.57756_-27.7093)] text-white'
              : 'border border-[#CBD5E1] text-foreground hover:bg-muted/50'
          )}
          data-testid="button-scan-photo"
        >
          <Camera className={big ? 'w-5 h-5' : 'w-4 h-4'} />
          Take a photo of the code
        </button>

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
            placeholder="Or type the order or AWB number"
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
  label = 'Scan parcel',
  onResolved,
  testId = 'button-scan-parcel',
}: {
  surface: Surface;
  /** `full`: labelled button. `icon`: a top-bar glyph. */
  variant?: 'full' | 'icon';
  className?: string;
  label?: string;
  /** See ScanParcelSheet. Unset: a scan opens the parcel's details page. */
  onResolved?: (hit: ParcelScanResult) => void;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {variant === 'icon' ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn('grid place-items-center w-10 h-10 rounded-md hover:bg-muted transition-colors', className)}
          aria-label={label}
          data-testid={testId}
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
          data-testid={testId}
        >
          <ScanLine className={surface === 'agent' ? 'w-5 h-5' : 'w-4 h-4'} />
          {label}
        </button>
      )}
      {open && (
        <ScanParcelSheet
          surface={surface}
          onClose={() => setOpen(false)}
          onResolved={onResolved}
          title={label}
        />
      )}
    </>
  );
}
