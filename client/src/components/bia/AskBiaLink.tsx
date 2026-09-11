import { Sparkles } from 'lucide-react';
import type { BiaScreen } from '@shared/biaScreen';
import { askBiaAbout } from '@/lib/askBia';
import { cn } from '@/lib/utils';

/**
 * "Ask BIA" beside an error. Opens BIA over this screen, already about the
 * error: the code (when catalogued) goes in the screen context, and the
 * customer's first message is sent for them.
 */
export function AskBiaLink({
  screen,
  code,
  message,
  className,
  label = 'Ask BIA about this',
}: {
  screen: Omit<BiaScreen, 'errorCode'>;
  code?: string | null;
  message?: string | null;
  className?: string;
  label?: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        askBiaAbout(screen, code, message);
      }}
      className={cn(
        'inline-flex items-center gap-1 text-[11px] font-semibold text-[#14567C] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#14567C]/40 rounded',
        className
      )}
      data-testid="link-ask-bia-error"
    >
      <Sparkles className="h-3 w-3 text-[#F2A123]" aria-hidden />
      {label}
    </button>
  );
}
