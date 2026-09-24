import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { parseApiErrorMessage } from '@/lib/apiError';
import { opsDocumentFilename } from '@/lib/opsDocumentFile';

export type OpsPreviewState = {
  title: string;
  /** What the file is called once it is on the reviewer's disk. */
  filename: string;
  objectUrl: string;
  mime: string;
};

export function OpsDocumentPreviewOverlay({
  preview,
  onClose,
}: {
  preview: OpsPreviewState;
  onClose: () => void;
}) {
  const isPdf = preview.mime === 'application/pdf' || preview.title.toLowerCase().endsWith('.pdf');
  const isImage = preview.mime.startsWith('image/');

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/70"
      data-testid="ops-kyc-document-preview"
      role="dialog"
      aria-modal="true"
      aria-label={preview.title}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 bg-white">
        <p className="text-sm font-semibold truncate">{preview.title}</p>
        <div className="flex items-center gap-2 shrink-0">
          {/* The bytes are already here, so saving a copy costs no second fetch. */}
          <Button asChild type="button" variant="outline" className="h-9 rounded-lg">
            <a
              href={preview.objectUrl}
              download={preview.filename}
              data-testid="ops-kyc-preview-download"
            >
              <Download className="w-4 h-4 mr-1" />
              Download
            </a>
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-9 rounded-lg"
            onClick={onClose}
            data-testid="ops-kyc-preview-close"
          >
            <X className="w-4 h-4 mr-1" />
            Close
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-4 flex justify-center">
        {isImage && (
          <img
            src={preview.objectUrl}
            alt={preview.title}
            className="max-w-full max-h-full object-contain bg-white rounded-lg"
          />
        )}
        {isPdf && !isImage && (
          <iframe
            title={preview.title}
            src={preview.objectUrl}
            className="w-full h-full min-h-[70vh] bg-white rounded-lg"
          />
        )}
        {!isImage && !isPdf && (
          <p className="text-sm text-white self-center">Preview is not available for this file type.</p>
        )}
      </div>
    </div>
  );
}

export function useOpsDocumentPreview() {
  const [preview, setPreview] = useState<OpsPreviewState | null>(null);
  const [fileBusy, setFileBusy] = useState<string | null>(null);
  const [fileErrors, setFileErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    return () => {
      if (preview?.objectUrl) URL.revokeObjectURL(preview.objectUrl);
    };
  }, [preview?.objectUrl]);

  const closePreview = (): void => {
    setPreview((current) => {
      if (current?.objectUrl) URL.revokeObjectURL(current.objectUrl);
      return null;
    });
  };

  const openBlob = async (
    key: string,
    title: string,
    load: () => Promise<Blob>,
  ): Promise<void> => {
    setFileErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setFileBusy(key);
    try {
      const blob = await load();
      const objectUrl = URL.createObjectURL(blob);
      setPreview((current) => {
        if (current?.objectUrl) URL.revokeObjectURL(current.objectUrl);
        return { title, filename: opsDocumentFilename(title, blob.type), objectUrl, mime: blob.type };
      });
    } catch (err) {
      setFileErrors((prev) => ({
        ...prev,
        [key]: parseApiErrorMessage(err, 'Could not load document.'),
      }));
    } finally {
      setFileBusy(null);
    }
  };

  /**
   * Save a copy without opening it first. Shares the busy flag and the error
   * line with the preview, so a row shows one spinner and one message whichever
   * button was pressed.
   */
  const downloadBlob = async (
    key: string,
    title: string,
    load: () => Promise<Blob>,
  ): Promise<void> => {
    setFileErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setFileBusy(key);
    try {
      const blob = await load();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = opsDocumentFilename(title, blob.type);
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Revoking in the same tick can cancel the save in some browsers.
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
    } catch (err) {
      setFileErrors((prev) => ({
        ...prev,
        [key]: parseApiErrorMessage(err, 'Could not download document.'),
      }));
    } finally {
      setFileBusy(null);
    }
  };

  return { preview, closePreview, openBlob, downloadBlob, fileBusy, fileErrors };
}
