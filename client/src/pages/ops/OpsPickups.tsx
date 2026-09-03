import { OpsSectionBoard } from '@/components/ops/OpsSectionBoard';
import { PICKUPS_FILTER_CONFIG } from '@/hooks/useOpsBoardFilters';

export default function OpsPickups() {
  return (
    <OpsSectionBoard
      title="Pickups"
      subtitle="Active pickup orders"
      section="pickups"
      mode="stages"
      filterConfig={PICKUPS_FILTER_CONFIG}
    />
  );
}
