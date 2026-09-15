import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import type { ApplicationStatus, OpsApplicationAction, RequestedChanges } from '@shared/applicationStatus';

/** One row of the queue — server/routes/accountApplications.ts §queueItem. */
export type OpsApplicationRow = {
  id: string;
  phone: string;
  name: string | null;
  email: string;
  account_type: 'personal' | 'company';
  company_category: string | null;
  category_label: string;
  status: ApplicationStatus;
  reviewer_id: string | null;
  claimed_at: string | null;
  resubmission_count: number;
  submitted_at: string;
  /** Last change of any kind; a `submitted` row newer than your last look is new to you. */
  updated_at: string;
  decided_at: string | null;
  finalize_error: string | null;
  email_error: string | null;
  email_sent_at: string | null;
};

export type OpsApplicationDocument = {
  slot: string;
  label: string;
  provided: boolean;
  /** Last four only. */
  number: string | null;
  /** Cashfree's first-layer verdict: advice, not an approval. */
  ocr_status: string | null;
  /** When a reviewer verified it by hand. Every document needs this before approval. */
  verified_at: string | null;
};

export type OpsApplicationDuplicate = {
  kind: 'account' | 'application';
  field: 'gstin' | 'email';
  id: string;
  label: string;
  status: string | null;
};

export type OpsApplicationEvent = {
  id: string;
  event: string;
  actor_id: string | null;
  /** The staff member, when there was one. Null for the customer and for automatic steps. */
  actor_name: string | null;
  note: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type OpsApplicationDetail = {
  application: OpsApplicationRow & {
    details: Record<string, string | number | null | undefined>;
    contract: { signed_name: string; version: string; accepted_at: string };
    requested_changes: RequestedChanges | null;
    decision_note: string | null;
    user_id: string | null;
    itd_customer_id: string | null;
    finalized_at: string | null;
    reviewer_name: string | null;
  };
  itd_setup: { contract_head: string; group_code: string | null } | null;
  documents: OpsApplicationDocument[];
  duplicates: OpsApplicationDuplicate[];
  events: OpsApplicationEvent[];
  allowed_actions: OpsApplicationAction[];
};

/** What the queue's filter chips ask for. */
export type OpsApplicationFilter = 'open' | 'all' | ApplicationStatus;

export const OPS_APPLICATIONS_KEY = ['/api/ops/applications'] as const;

async function readJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

export function useOpsApplications(filter: OpsApplicationFilter) {
  return useQuery({
    queryKey: [...OPS_APPLICATIONS_KEY, filter],
    queryFn: async () => {
      const res = await fetch(`/api/ops/applications?status=${encodeURIComponent(filter)}`, {
        credentials: 'include',
      });
      return readJson<{ enabled: boolean; applications: OpsApplicationRow[] }>(res);
    },
    retry: false,
    refetchOnMount: 'always',
    // Someone else may pick one up; a queue that never moves reads as stuck.
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useOpsApplicationDetail(id: string | undefined) {
  return useQuery({
    queryKey: id ? [...OPS_APPLICATIONS_KEY, 'detail', id] : [...OPS_APPLICATIONS_KEY, 'detail', 'missing'],
    queryFn: async () => {
      if (!id) throw new Error('404: Application not found');
      const res = await fetch(`/api/ops/applications/${encodeURIComponent(id)}`, { credentials: 'include' });
      return readJson<OpsApplicationDetail>(res);
    },
    enabled: Boolean(id),
    retry: false,
    refetchOnMount: 'always',
  });
}

export type OpsApplicationActionInput =
  | { action: 'claim' | 'release' | 'retry_finalize' | 'resend_email' }
  | { action: 'request_changes'; fields: string[]; slots: string[]; note: string }
  | { action: 'reject'; reason: string }
  | { action: 'approve'; itd_email: string; itd_password: string };

export type OpsApplicationActionResult = {
  application: OpsApplicationRow;
  finalized?: boolean;
  email_sent?: boolean;
  error?: string | null;
};

/**
 * Every button on the detail page. On success, and on a 409 (someone acted
 * first), the page and the queue are read again so what is on screen is true.
 */
export function useOpsApplicationAction(id: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: OpsApplicationActionInput): Promise<OpsApplicationActionResult> => {
      if (!id) throw new Error('404: Application not found');
      const res = await apiRequest('POST', `/api/ops/applications/${encodeURIComponent(id)}/actions`, input);
      return (await res.json()) as OpsApplicationActionResult;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: OPS_APPLICATIONS_KEY });
    },
  });
}

/** A reviewer vouches for a document Cashfree couldn't confirm. Logged in the history. */
export function useVerifyOpsApplicationDocument(id: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (slot: string): Promise<{ verified: true; slot: string }> => {
      if (!id) throw new Error('404: Application not found');
      const res = await apiRequest(
        'POST',
        `/api/ops/applications/${encodeURIComponent(id)}/documents/${encodeURIComponent(slot)}/verify`,
      );
      return (await res.json()) as { verified: true; slot: string };
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: OPS_APPLICATIONS_KEY });
    },
  });
}

// ── Who hears about new applications ────────────────────────────────────────

/** server/opsSettings.ts §AlertRecipients, plus who mail goes out as. */
export type OpsApplicationAlerts = {
  emails: string[];
  source: 'console' | 'env' | 'none';
  /** False until migrations/add_ops_settings.sql has run. */
  editable: boolean;
  updated_at: string | null;
  /** "Bombino Express <x@y>", or null when the server can't send mail. */
  sender: string | null;
};

export const OPS_APPLICATION_ALERTS_KEY = ['/api/ops/settings/application-alerts'] as const;

export function useOpsApplicationAlerts() {
  return useQuery({
    queryKey: OPS_APPLICATION_ALERTS_KEY,
    queryFn: async () => {
      const res = await fetch('/api/ops/settings/application-alerts', { credentials: 'include' });
      return readJson<OpsApplicationAlerts>(res);
    },
    retry: false,
  });
}

export function useSaveOpsApplicationAlerts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (emails: string[]): Promise<OpsApplicationAlerts> => {
      const res = await apiRequest('PUT', '/api/ops/settings/application-alerts', { emails });
      return (await res.json()) as OpsApplicationAlerts;
    },
    onSuccess: (data) => queryClient.setQueryData(OPS_APPLICATION_ALERTS_KEY, data),
  });
}

export function useTestOpsApplicationAlerts() {
  return useMutation({
    mutationFn: async (): Promise<{ sent_to: string[] }> => {
      const res = await apiRequest('POST', '/api/ops/settings/application-alerts/test');
      return (await res.json()) as { sent_to: string[] };
    },
  });
}

/** One logged GET — do not cache the blob. */
export async function fetchOpsApplicationDocumentFile(id: string, slot: string): Promise<Blob> {
  const res = await fetch(
    `/api/ops/applications/${encodeURIComponent(id)}/documents/${encodeURIComponent(slot)}/file`,
    { credentials: 'include', cache: 'no-store' },
  );
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
  return res.blob();
}
