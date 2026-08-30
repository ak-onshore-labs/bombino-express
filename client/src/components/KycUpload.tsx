import React, { useState, useRef } from 'react';
import { CloudUpload, CheckCircle2, XCircle, Loader2, FileText } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { publishKycOnFile, type KycOnFile } from '@/hooks/useKycOnFile';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export const KYC_DOCUMENT_TYPE = 'Aadhaar Number';

export interface KycUploadResult {
  document_type: string;
  last_four: string;
}

type UploadStatus = 'idle' | 'pending' | 'uploading' | 'success' | 'error';

interface KycUploadProps {
  /** Optional — the shared KYC cache is updated regardless of this callback. */
  onValidChange?: (result: KycUploadResult | null) => void;
  fieldErrors?: {
    document_no?: boolean;
    file?: boolean;
  };
}

type DocConfig = {
  label: string;
  placeholder: string;
  hint: string;
  validate: (v: string) => boolean;
  maxLength: number;
};

const DOC_TYPES: Record<string, DocConfig> = {
  'Aadhaar Number': {
    label: 'Aadhaar Number',
    placeholder: 'XXXX XXXX XXXX',
    hint: '12-digit Aadhaar number',
    validate: (v) => /^\d{12}$/.test(v),
    maxLength: 12,
  },
  'PAN Number': {
    label: 'PAN Number',
    placeholder: 'ABCDE1234F',
    hint: '10-character PAN',
    validate: (v) => /^[A-Z]{5}[0-9]{4}[A-Z]$/i.test(v),
    maxLength: 10,
  },
  'Passport Number': {
    label: 'Passport Number',
    placeholder: 'A1234567',
    hint: '7-8 character passport number',
    validate: (v) => /^[A-Z0-9]{7,8}$/i.test(v),
    maxLength: 8,
  },
  'Driving Licence': {
    label: 'Driving Licence',
    placeholder: 'MH01-2000-1234567',
    hint: 'Driving licence number',
    validate: (v) => /^[A-Z0-9-]{5,20}$/i.test(v),
    maxLength: 20,
  },
  'GSTIN (Normal)': {
    label: 'GSTIN',
    placeholder: '22AAAAA0000A1Z5',
    hint: '15-character GST number',
    validate: (v) => v.length === 15,
    maxLength: 15,
  },
};

const DOC_TYPE_KEYS = Object.keys(DOC_TYPES);

/**
 * OCR outcomes worth telling the customer about. A contradicting number, the
 * wrong document or a tamper signal never reaches a successful response — the
 * server refuses those uploads with 422 and the message lands in the error
 * state below. What is left says the document went in *unverified*, which
 * should not look identical to a clean pass.
 */
const OCR_SILENT = new Set(['match', 'skipped', 'bypassed']);

const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

function StatusPill({ status }: { status: UploadStatus }) {
  const config: Record<UploadStatus, { label: string; className: string }> = {
    idle:      { label: 'Required',   className: 'bg-muted text-muted-foreground' },
    pending:   { label: 'Selected',   className: 'bg-sky-100 text-sky-800' },
    uploading: { label: 'Uploading…', className: 'bg-amber-100 text-amber-700' },
    success:   { label: 'Uploaded',   className: 'bg-green-100 text-green-700' },
    error:     { label: 'Failed',     className: 'bg-red-100 text-red-600' },
  };
  const { label, className } = config[status];
  return (
    <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium', className)}>
      {label}
    </span>
  );
}

export function KycUpload({
  onValidChange = () => undefined,
  fieldErrors,
}: KycUploadProps): React.JSX.Element {
  const [selectedDocType, setSelectedDocType] = useState(KYC_DOCUMENT_TYPE);
  const [docNoRaw, setDocNoRaw] = useState('');
  const [docNoDisplay, setDocNoDisplay] = useState('');
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>('idle');
  const [uploadError, setUploadError] = useState('');
  const [ocrNote, setOcrNote] = useState('');
  const [uploadResult, setUploadResult] = useState<KycUploadResult | null>(null);
  const [selectedFileName, setSelectedFileName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  /** File chosen before document number is valid — upload runs once number is complete */
  const pendingFileRef = useRef<File | null>(null);
  /** Document number last successfully uploaded — invalidate if it changes */
  const lastUploadedDocNoRef = useRef<string | null>(null);

  const docConfig = DOC_TYPES[selectedDocType];

  function syncToParent(
    raw: string,
    result: KycUploadResult | null,
    docType: string,
  ): void {
    if (DOC_TYPES[docType].validate(raw) && result) {
      onValidChange({
        document_type: result.document_type,
        last_four: result.last_four,
      });
    } else {
      onValidChange(null);
    }
  }

  const resetForDocTypeChange = (nextType: string): void => {
    setDocNoRaw('');
    setDocNoDisplay('');
    setUploadStatus('idle');
    setUploadError('');
    setOcrNote('');
    setUploadResult(null);
    setSelectedFileName('');
    pendingFileRef.current = null;
    lastUploadedDocNoRef.current = null;
    onValidChange(null);
    setSelectedDocType(nextType);
  };

  async function performUpload(file: File, documentNo: string): Promise<void> {
    setSelectedFileName(file.name);
    setUploadStatus('uploading');
    setUploadError('');
    setOcrNote('');
    setUploadResult(null);
    syncToParent(documentNo, null, selectedDocType);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('document_type', selectedDocType);
    formData.append('document_no', documentNo);

    try {
      const res = await fetch('/api/kyc/upload', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      if (res.status === 401) {
        throw new Error('Please log in to upload your identity document.');
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: 'Upload failed.' })) as { message: string };
        throw new Error(body.message);
      }

      const data = await res.json() as KycOnFile & {
        capability_id: string;
        ocr?: { status?: string; message?: string };
      };
      setOcrNote(
        data.ocr && !OCR_SILENT.has(data.ocr.status ?? '') ? (data.ocr.message ?? '') : '',
      );
      const result: KycUploadResult = {
        document_type: data.document_type,
        last_four: data.last_four,
      };
      // Publish before notifying the parent so every screen reading
      // `useKycOnFile()` reflects the new document without a reload.
      publishKycOnFile(queryClient, {
        document_type: data.document_type,
        last_four: data.last_four,
        original_filename: data.original_filename,
        mime_type: data.mime_type,
        file_size_bytes: data.file_size_bytes,
        updated_at: data.updated_at,
      });
      setUploadResult(result);
      setUploadStatus('success');
      pendingFileRef.current = null;
      lastUploadedDocNoRef.current = documentNo;
      syncToParent(documentNo, result, selectedDocType);
    } catch (err) {
      setUploadStatus('error');
      setUploadError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
    }
  }

  function handleDocNoChange(raw: string): void {
    if (selectedDocType === 'Aadhaar Number') {
      const digits = raw.replace(/\D/g, '').slice(0, 12);
      setDocNoRaw(digits);
      let formatted = '';
      for (let i = 0; i < digits.length; i++) {
        if (i > 0 && i % 4 === 0) formatted += '-';
        formatted += digits[i];
      }
      setDocNoDisplay(formatted);

      if (!/^\d{12}$/.test(digits)) {
        setUploadResult(null);
        lastUploadedDocNoRef.current = null;
        syncToParent(digits, null, selectedDocType);
        if (pendingFileRef.current) {
          setUploadStatus('pending');
        } else {
          setUploadStatus((s) => (s === 'success' || s === 'uploading' ? 'idle' : s));
          setSelectedFileName('');
        }
        return;
      }

      if (pendingFileRef.current) {
        const f = pendingFileRef.current;
        pendingFileRef.current = null;
        void performUpload(f, digits);
        return;
      }

      if (uploadResult && lastUploadedDocNoRef.current !== digits) {
        setUploadResult(null);
        lastUploadedDocNoRef.current = null;
        syncToParent(digits, null, selectedDocType);
        setUploadStatus('idle');
        setSelectedFileName('');
        return;
      }

      syncToParent(digits, uploadResult, selectedDocType);
      return;
    }

    const pattern =
      selectedDocType === 'Driving Licence' ? /[^A-Za-z0-9-]/g : /[^A-Za-z0-9]/g;
    const normalized = raw.replace(pattern, '').toUpperCase().slice(0, docConfig.maxLength);
    setDocNoRaw(normalized);
    setDocNoDisplay(normalized);

    if (!docConfig.validate(normalized)) {
      setUploadResult(null);
      lastUploadedDocNoRef.current = null;
      syncToParent(normalized, null, selectedDocType);
      if (pendingFileRef.current) {
        setUploadStatus('pending');
      } else {
        setUploadStatus((s) => (s === 'success' || s === 'uploading' ? 'idle' : s));
        setSelectedFileName('');
      }
      return;
    }

    if (pendingFileRef.current) {
      const f = pendingFileRef.current;
      pendingFileRef.current = null;
      void performUpload(f, normalized);
      return;
    }

    if (uploadResult && lastUploadedDocNoRef.current !== normalized) {
      setUploadResult(null);
      lastUploadedDocNoRef.current = null;
      syncToParent(normalized, null, selectedDocType);
      setUploadStatus('idle');
      setSelectedFileName('');
      return;
    }

    syncToParent(normalized, uploadResult, selectedDocType);
  }

  async function handleFileSelect(file: File): Promise<void> {
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      setUploadError('Only PDF, JPEG, or PNG files are accepted.');
      setUploadStatus('error');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setUploadError('File must be under 5MB.');
      setUploadStatus('error');
      return;
    }

    if (!DOC_TYPES[selectedDocType].validate(docNoRaw)) {
      pendingFileRef.current = file;
      setSelectedFileName(file.name);
      setUploadStatus('pending');
      setUploadError('');
      setUploadResult(null);
      return;
    }

    await performUpload(file, docNoRaw);
  }

  function handleDragOver(e: React.DragEvent): void {
    e.preventDefault();
    e.stopPropagation();
  }

  function handleDrop(e: React.DragEvent): void {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files[0];
    if (file) void handleFileSelect(file);
  }

  const isDocNoValid = docConfig.validate(docNoRaw);
  const showDocNoError = fieldErrors?.document_no && !isDocNoValid;
  /** Pending = file selected, waiting for valid number — not a missing file for Continue validation */
  const showFileError =
    fieldErrors?.file && uploadStatus !== 'success' && uploadStatus !== 'pending';
  const showIncompleteHint =
    fieldErrors?.document_no &&
    docNoRaw.length > 0 &&
    !isDocNoValid &&
    selectedDocType === 'Aadhaar Number' &&
    docNoRaw.length < 12;

  const fileErrorHighlight =
    showFileError && uploadStatus === 'idle';

  const inputMaxLength =
    selectedDocType === 'Aadhaar Number' ? 14 : docConfig.maxLength;

  return (
    <div className="bg-card rounded-xl border border-border p-4 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-semibold">KYC Details</Label>
        <span className="text-[10px] text-muted-foreground">Required for Indian customs</span>
      </div>

      {/* Document Type */}
      <div>
        <Label className="text-xs text-muted-foreground">
          Document Type <span className="text-red-400">*</span>
        </Label>
        <Select value={selectedDocType} onValueChange={resetForDocTypeChange}>
          <SelectTrigger className="mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DOC_TYPE_KEYS.map((key) => (
              <SelectItem key={key} value={key}>
                {DOC_TYPES[key].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Document Number */}
      <div>
        <Label className="text-xs text-muted-foreground">
          {docConfig.label} <span className="text-red-400">*</span>
        </Label>
        <Input
          value={docNoDisplay}
          onChange={(e) => handleDocNoChange(e.target.value)}
          placeholder={docConfig.placeholder}
          maxLength={inputMaxLength}
          inputMode={selectedDocType === 'Aadhaar Number' ? 'numeric' : 'text'}
          className={cn(
            'h-11 mt-1 text-sm bg-muted/30 border-border rounded-xl',
            selectedDocType === 'Aadhaar Number' && 'font-mono tracking-widest',
            // `field-shake` is what CreateShipment's scroll-to-first-error
            // looks for. Without it a missing KYC number marks itself red and
            // the form scrolls past it to the next invalid field.
            showDocNoError && 'border-2 border-primary field-shake',
          )}
          data-testid="input-aadhaar-number"
        />
        <p className="text-xs text-muted-foreground mt-1">{docConfig.hint}</p>
        {showIncompleteHint && (
          <p className="text-xs text-muted-foreground mt-1">
            {12 - docNoRaw.length} more digit{12 - docNoRaw.length !== 1 ? 's' : ''} required
          </p>
        )}
        {showDocNoError && (
          <p className="text-xs text-red-600 mt-1">Valid {docConfig.hint.toLowerCase()} required</p>
        )}
      </div>

      {/* File Upload */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <Label className="text-xs text-muted-foreground">
            {docConfig.label} Document <span className="text-red-400">*</span>
          </Label>
          <StatusPill status={uploadStatus} />
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFileSelect(file);
            e.target.value = '';
          }}
          data-testid="input-kyc-file"
        />

        <div
          role="button"
          tabIndex={0}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          className={cn(
            'border-2 border-dashed rounded-xl p-5 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors min-h-[96px] select-none',
            uploadStatus === 'idle'      && 'border-border hover:border-primary/50 hover:bg-primary/5',
            uploadStatus === 'pending'   && 'border-sky-300 bg-sky-50/50 hover:border-primary/50',
            uploadStatus === 'uploading' && 'border-amber-300 bg-amber-50 pointer-events-none',
            uploadStatus === 'success'   && 'border-green-300 bg-green-50',
            uploadStatus === 'error'     && 'border-red-300 bg-red-50',
            fileErrorHighlight && 'border-primary field-shake',
          )}
        >
          {uploadStatus === 'idle' && (
            <>
              <CloudUpload className="w-7 h-7 text-muted-foreground" />
              <p className="text-xs text-muted-foreground text-center leading-tight">
                Tap to upload or drag & drop
              </p>
            </>
          )}

          {uploadStatus === 'pending' && (
            <>
              <FileText className="w-7 h-7 text-sky-600" />
              <p className="text-xs text-sky-900 font-medium truncate max-w-[200px]">
                {selectedFileName}
              </p>
              <p className="text-[10px] text-muted-foreground text-center leading-tight px-1">
                Enter a valid {docConfig.label} to upload
              </p>
            </>
          )}

          {uploadStatus === 'uploading' && (
            <>
              <Loader2 className="w-6 h-6 text-amber-600 animate-spin" />
              <p className="text-xs text-amber-700 font-medium truncate max-w-[200px]">
                {selectedFileName}
              </p>
            </>
          )}

          {uploadStatus === 'success' && (
            <>
              <CheckCircle2 className="w-6 h-6 text-green-600" />
              <div className="text-center">
                <p className="text-xs text-green-700 font-medium truncate max-w-[200px]">
                  {selectedFileName}
                </p>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                  className="text-[11px] text-primary underline mt-0.5"
                >
                  Change file
                </button>
              </div>
            </>
          )}

          {uploadStatus === 'error' && (
            <>
              <XCircle className="w-6 h-6 text-red-500" />
              <p className="text-xs text-red-600 text-center leading-tight px-2">
                {uploadError}
              </p>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                className="text-[11px] text-primary underline"
              >
                Try again
              </button>
            </>
          )}
        </div>

        {showFileError && (
          <p className="text-xs text-red-600 mt-1">Please upload your {docConfig.label} document</p>
        )}
        {uploadStatus === 'success' && ocrNote && (
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mt-1.5">
            {ocrNote}
          </p>
        )}
        <div className="flex items-center gap-1 mt-1.5">
          <FileText className="w-3 h-3 text-muted-foreground" />
          <p className="text-[10px] text-muted-foreground">PDF, JPEG, or PNG · Max 5MB</p>
        </div>
      </div>
    </div>
  );
}
