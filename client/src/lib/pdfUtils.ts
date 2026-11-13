import { isAndroid, isEdgeToEdgeShell } from './platform';
import { shareFileViaCapacitor } from './nativeShare';

export function base64ToPdfFile(base64: string, fileName: string): File {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'application/pdf' });
  return new File([blob], fileName, { type: 'application/pdf' });
}

export function canSharePdfFile(file: File): boolean {
  try {
    return (
      typeof navigator.share === 'function' &&
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [file] })
    );
  } catch {
    return false;
  }
}

function browserDownload(blob: Blob, fileName: string): void {
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(blobUrl);
}

/** Saves the PDF. The edge-to-edge app shell, whose web view ignores
 *  `download`, hands it to the share sheet instead. */
export function downloadPdfBlob(blob: Blob, fileName: string): void {
  if (!isEdgeToEdgeShell()) {
    browserDownload(blob, fileName);
    return;
  }
  void shareFileViaCapacitor({ fileName, mimeType: 'application/pdf', data: blob, title: fileName }).then(
    (shared) => {
      if (!shared) browserDownload(blob, fileName);
    }
  );
}

/**
 * Sends a PDF straight to the browser's print dialog.
 *
 * A hidden same-origin iframe on a blob URL is the one arrangement desktop
 * Chrome, Edge and Firefox all let a page call `print()` on — a `data:` URL
 * iframe is cross-origin and refuses. Where even that fails (some Safari
 * builds), the PDF opens in a new tab, whose viewer has its own print button;
 * in the edge-to-edge app shell it goes to the share sheet, which has Print.
 */
export function printPdfBase64(base64: string, fileName: string): void {
  const file = base64ToPdfFile(base64, fileName);
  const blobUrl = URL.createObjectURL(file);
  const frame = document.createElement('iframe');
  frame.style.position = 'fixed';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  frame.src = blobUrl;

  const cleanup = (): void => {
    frame.remove();
    URL.revokeObjectURL(blobUrl);
  };

  const openInTab = (): void => {
    window.open(URL.createObjectURL(file), '_blank', 'noopener');
  };

  frame.onload = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
      // The dialog blocks in some browsers and not others; a minute is long
      // enough for either before the blob is let go.
      setTimeout(cleanup, 60_000);
    } catch {
      cleanup();
      if (!isEdgeToEdgeShell()) {
        openInTab();
        return;
      }
      void shareFileViaCapacitor({ fileName, mimeType: 'application/pdf', data: base64, title: fileName }).then(
        (shared) => {
          if (!shared) openInTab();
        }
      );
    }
  };
  document.body.appendChild(frame);
}

export function openPdfOverlayOrDownload(
  base64: string,
  fileName: string,
  overlayTitle: string,
  setPdfTitle: (t: string) => void,
  setPdfDataUrl: (u: string) => void
): void {
  const file = base64ToPdfFile(base64, fileName);
  if (isAndroid() || canSharePdfFile(file)) {
    setPdfTitle(overlayTitle);
    setPdfDataUrl(`data:application/pdf;base64,${base64}`);
  } else {
    downloadPdfBlob(file, fileName);
  }
}
