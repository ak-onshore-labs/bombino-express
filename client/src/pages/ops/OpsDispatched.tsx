import { OpsSectionBoard } from '@/components/ops/OpsSectionBoard';
import { DISPATCHED_FILTER_CONFIG } from '@/hooks/useOpsBoardFilters';

export default function OpsDispatched() {
  return (
    <OpsSectionBoard
      title="Dispatched"
      subtitle="AWB generated"
      section="dispatched"
      mode="flat"
      filterConfig={DISPATCHED_FILTER_CONFIG}
    />
  );
}
