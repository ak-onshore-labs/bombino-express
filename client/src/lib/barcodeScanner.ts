/**
 * Reading parcel labels with the camera: our QR box label, and ITD's labels,
 * which carry only 1-D barcodes (the AWB, and "AWB / box no." per parcel).
 *
 * ZXing reads both. It replaced qr-scanner, which reads QR only, so an ITD
 * box could only ever be typed in. Loaded on first use, not with the app: only
 * agents and the hub ever open a scanner.
 *
 * TRY_HARDER is on because ITD prints the AWB barcode sideways on the box
 * label; with it the 1-D readers also try the image rotated.
 */

import type { IScannerControls } from '@zxing/browser';

export interface CameraControls {
  stop: () => void;
  /** Present only where the camera has a torch the browser can switch. */
  switchTorch?: (on: boolean) => Promise<void>;
}

async function reader() {
  const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
    import('@zxing/browser'),
    import('@zxing/library'),
  ]);
  const hints = new Map<unknown, unknown>([
    [
      DecodeHintType.POSSIBLE_FORMATS,
      [
        BarcodeFormat.QR_CODE,
        BarcodeFormat.CODE_128,
        BarcodeFormat.CODE_39,
        BarcodeFormat.CODE_93,
        BarcodeFormat.ITF,
        BarcodeFormat.EAN_13,
      ],
    ],
    [DecodeHintType.TRY_HARDER, true],
  ]);
  // Hints are typed loosely by the library; the map above is what it reads.
  return new BrowserMultiFormatReader(hints as never, { delayBetweenScanAttempts: 150 });
}

/**
 * Start the back camera in `video` and call `onText` for each code read.
 * Throws when there is no camera to start (no API, refused, none present).
 */
export async function startCamera(
  video: HTMLVideoElement,
  onText: (text: string) => void
): Promise<CameraControls> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('Camera not found.');
  }
  const r = await reader();
  const controls: IScannerControls = await r.decodeFromConstraints(
    {
      video: {
        facingMode: { ideal: 'environment' },
        // Enough detail for a 1-D barcode at arm's length.
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    },
    video,
    (result) => {
      if (result) onText(result.getText());
    }
  );
  return {
    stop: () => controls.stop(),
    switchTorch: controls.switchTorch ? (on: boolean) => controls.switchTorch!(on) : undefined,
  };
}

/** Read a code from a photo (the "Take a photo of the code" path). */
export async function decodeImageFile(file: File): Promise<string> {
  const r = await reader();
  const url = URL.createObjectURL(file);
  try {
    const result = await r.decodeFromImageUrl(url);
    return result.getText();
  } finally {
    URL.revokeObjectURL(url);
  }
}
