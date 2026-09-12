import { useLocation } from 'wouter';
import { Sparkles } from 'lucide-react';
import { openBiaHere } from '@/lib/askBia';
import { cn } from '@/lib/utils';

/**
 * BIA's button in a screen's top bar. On every phone screen but Home, BIA
 * lives up here instead of floating over the page, where it covered the
 * screen's own buttons. Home keeps the floating button (SupportFab).
 * Opens BIA about this screen, exactly as the floating button does.
 */
export function AskBiaTopButton({ className }: { className?: string }): React.JSX.Element {
  const [location] = useLocation();
  return (
    <button
      type="button"
      onClick={() => openBiaHere(location)}
      className={cn(
        'inline-flex h-9 w-9 items-center justify-center rounded-xl text-[#F2A123] transition-all hover:bg-[#FDF3E1] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F2A123]/50 md:hidden',
        className
      )}
      aria-label="Ask BIA"
      data-testid="button-ask-bia-top"
    >
      <Sparkles className="h-5 w-5" strokeWidth={2} aria-hidden />
    </button>
  );
}
