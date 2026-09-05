import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { parseApiErrorMessage } from '@/lib/apiError';

export type OpsPreviewState = {
  title: string;
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
        <Button
          type="button"
          variant="outline"
          className="h-9 rounded-lg shrink-0"
          onClick={onClose}
          data-testid="ops-kyc-preview-close"
        >
          <X className="w-4 h-4 mr-1" />
          Close
        </Button>
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
        return { title, objectUrl, mime: blob.type };
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

  return { preview, closePreview, openBlob, fileBusy, fileErrors };
}
