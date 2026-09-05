import { useQuery, type QueryClient } from '@tanstack/react-query';

export interface KycOnFile {
  document_type: string;
  last_four: string;
  /**
   * File metadata was added after the first KYC release — a server running the
   * older build returns only the two fields above, so treat these as optional
   * and never dereference them unguarded.
   */
  original_filename?: string;
  mime_type?: string;
  file_size_bytes?: number;
  updated_at?: string;
  /** Smart OCR's verdict. See shared/kyc.ts §KycSummary. */
  ocr_status?: string | null;
}

export const KYC_QUERY_KEY = ['/api/kyc/me'] as const;

async function fetchKycOnFile(): Promise<KycOnFile | null> {
  const res = await fetch('/api/kyc/me', {
    credentials: 'include',
    cache: 'no-store',
  });
  if (res.status === 404 || res.status === 401) return null;
  if (!res.ok) throw new Error('Failed to load KYC status');
  return (await res.json()) as KycOnFile;
}

/**
 * Single source of truth for the logged-in user's KYC status.
 * Every consumer shares one cache entry, so an upload anywhere in the app
 * updates Profile, Home and the shipment form without a page reload.
 */
export function useKycOnFile(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: KYC_QUERY_KEY,
    queryFn: fetchKycOnFile,
    enabled: options?.enabled ?? true,
    // Global default is `staleTime: Infinity`; KYC must re-read on mount so a
    // document saved on another screen shows up straight away.
    staleTime: 0,
    retry: false,
  });
}

/** Write a freshly uploaded document into the shared cache and revalidate. */
export function publishKycOnFile(client: QueryClient, summary: KycOnFile): void {
  client.setQueryData(KYC_QUERY_KEY, summary);
  void client.invalidateQueries({ queryKey: KYC_QUERY_KEY });
}
