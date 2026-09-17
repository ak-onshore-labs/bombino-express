import { TrackingEvent } from '@/lib/trackingTypes';
import { format } from 'date-fns';

interface TrackingTimelineProps {
  events: TrackingEvent[];
  currentStatus: string;
}

export function TrackingTimeline({ events }: TrackingTimelineProps) {
  const sortedEvents = [...events].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  return (
    <div className="relative">
      {sortedEvents.map((event, index) => {
        const isFirst = index === 0;
        const isLast = index === sortedEvents.length - 1;

        return (
          <div
            key={event.id}
            className="relative flex gap-4 pb-6 last:pb-0"
            data-testid={`timeline-event-${event.id}`}
          >
            <div className="flex flex-col items-center pt-0.5">
              <div
                className={`h-4 w-4 rounded-full border-2 ${
                  isFirst ? 'border-primary bg-primary' : 'border-muted-foreground/50 bg-muted'
                }`}
              />
              {!isLast && (
                <div className="mt-1.5 w-0.5 flex-1 bg-border" />
              )}
            </div>

            <div className="flex-1">
              <p className={`text-sm font-semibold ${isFirst ? 'text-primary' : 'text-foreground'}`}>
                {event.status || 'Tracking update'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {event.location || 'Location unavailable'}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {format(new Date(event.timestamp), 'MMM d, yyyy h:mm a')}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}