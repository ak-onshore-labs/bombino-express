import { useQuery } from '@tanstack/react-query';

export type OpsPincodeFanoutMode = 'listed' | 'all';
export type OpsPincodeFanoutReason = 'uncovered' | 'unstaffed' | 'unreachable';
export type OpsPincodeRemark = 'ok' | 'out_of_city';

export type OpsPincodeRound = {
  beat_id: string;
  name: string;
  hub: string;
  cutoff_hour: number;
  city: string;
  area: string;
  remark: OpsPincodeRemark;
};

export type OpsPincodeResolved = {
  city: string;
  area: string;
  remark: OpsPincodeRemark;
  cutoff_hour: number;
};

export type OpsPincodeReport = {
  pincode: string;
  serviceable: boolean;
  source: 'db' | 'static';
  rounds: OpsPincodeRound[];
  resolved: OpsPincodeResolved | null;
  riders: {
    mode: OpsPincodeFanoutMode;
    reason: OpsPincodeFanoutReason | null;
    agents: { name: string | null; phone: string | null }[];
  };
};

export const OPS_PINCODES_KEY = ['ops', 'pincodes'] as const;

const SIX_DIGITS = /^\d{6}$/;

export function useOpsPincodeLookup(pincode: string | null) {
  const enabled = pincode !== null && SIX_DIGITS.test(pincode);

  return useQuery({
    queryKey: [...OPS_PINCODES_KEY, pincode ?? ''],
    enabled,
    queryFn: async (): Promise<OpsPincodeReport> => {
      const res = await fetch(`/api/ops/pincodes/${pincode}`, { credentials: 'include' });
      if (!res.ok) {
        const text = (await res.text()) || res.statusText;
        throw new Error(`${res.status}: ${text}`);
      }
      return (await res.json()) as OpsPincodeReport;
    },
    retry: false,
  });
}
