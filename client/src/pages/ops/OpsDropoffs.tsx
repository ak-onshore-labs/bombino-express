import { OpsSectionBoard } from '@/components/ops/OpsSectionBoard';
import { DROPOFFS_FILTER_CONFIG } from '@/hooks/useOpsBoardFilters';

export default function OpsDropoffs() {
  return (
    <OpsSectionBoard
      title="Drop-offs"
      subtitle="Active drop-off orders"
      section="dropoffs"
      mode="stages"
      filterConfig={DROPOFFS_FILTER_CONFIG}
    />
  );
}
