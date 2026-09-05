export function getGstinType(documentType: string): string {
  const map: Record<string, string> = {
    "Aadhaar Number": "AADHAAR NUMBER",
    "PAN Number": "PAN NUMBER",
    "Passport Number": "PASSPORT NUMBER",
    "Driving Licence": "DRIVING LICENCE",
    "GSTIN (Normal)": "GSTIN (NORMAL)",
  };
  return map[documentType] ?? "AADHAAR NUMBER";
}

export function maskDocumentNo(documentNo: string): string {
  const trimmed = documentNo.trim();
  if (trimmed.length <= 4) return trimmed;
  return trimmed.slice(-4);
}

export function buildKycFilePath(capabilityId: string, publicUrl?: string): string {
  const base = (publicUrl ?? "").replace(/\/$/, "");
  if (!base) {
    return `/api/kyc/documents/${capabilityId}/file`;
  }
  return `${base}/api/kyc/documents/${capabilityId}/file`;
}

export interface KycRowForItd {
  document_type: string;
  document_no: string;
  capability_id: string;
}

export function buildItdKycPayload(
  kyc: KycRowForItd,
  publicUrl?: string
): {
  kyc_details: Array<{
    document_type: string;
    document_no: string;
    document_sub_type: string;
    document_name: string;
    file_path: string;
  }>;
  shipper_gstin_type: string;
  shipper_gstin_no: string;
} {
  return {
    kyc_details: [
      {
        document_type: kyc.document_type,
        document_no: kyc.document_no,
        document_sub_type: "doc_1",
        document_name: "",
        file_path: buildKycFilePath(kyc.capability_id, publicUrl),
      },
    ],
    shipper_gstin_type: getGstinType(kyc.document_type),
    shipper_gstin_no: kyc.document_no,
  };
}

export interface KycSummary {
  document_type: string;
  last_four: string;
  original_filename: string;
  mime_type: string;
  file_size_bytes: number;
  updated_at: string;
  /**
   * Smart OCR's verdict on the upload (server/cashfreeOcr.ts):
   * `match` is the only one where the number on the document was read and
   * agreed with the number typed. `unreadable`, `unavailable`, `skipped` and
   * `bypassed` all mean nobody confirmed it, and the surfaces that show a
   * document have to say so rather than imply a check that did not happen.
   * Null on rows written before OCR existed.
   */
  ocr_status?: string | null;
}

export function toKycSummary(row: {
  document_type: string;
  document_no: string;
  original_filename: string;
  mime_type: string;
  file_size_bytes: number;
  updated_at: string;
  ocr_status?: string | null;
}): KycSummary {
  return {
    document_type: row.document_type,
    last_four: maskDocumentNo(row.document_no),
    original_filename: row.original_filename,
    mime_type: row.mime_type,
    file_size_bytes: row.file_size_bytes,
    updated_at: row.updated_at,
    ocr_status: row.ocr_status ?? null,
  };
}
