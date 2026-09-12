import { useLocation } from 'wouter';
import { Sparkles } from 'lucide-react';
import { openBiaHere } from '@/lib/askBia';
import { cn } from '@/lib/utils';

/**
 * BIA's button in a screen's top bar. On every phone screen but Home, BIA
 * lives up here instead of floating over the page, where it covered the
 * screen's own buttons. Home keeps the floating button (SupportFab).
 *
 * A warm gradient that keeps moving (index.css §bia-top-btn), still for anyone
 * who asks for reduced motion. `withLabel` spells out "Ask BIA" where the bar
 * has room; next to the centred logo it stays a circle.
 *
 * Opens BIA about this screen, exactly as the floating button does. Any
 * question it suggests waits in the typing box for the customer to send.
 */
export function AskBiaTopButton({ className, withLabel = false }: { className?: string; withLabel?: boolean }): React.JSX.Element {
  const [location] = useLocation();
  return (
    <button
      type="button"
      onClick={() => openBiaHere(location)}
      className={cn(
        'bia-top-btn relative inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full text-white transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F2A123]/60 focus-visible:ring-offset-2 md:hidden',
        withLabel ? 'px-3.5 text-xs font-bold' : 'w-9',
        className
      )}
      aria-label="Ask BIA"
      data-testid="button-ask-bia-top"
    >
      <Sparkles className="relative z-[1] h-4 w-4" strokeWidth={2.25} aria-hidden />
      {withLabel && <span className="relative z-[1] tracking-wide">Ask BIA</span>}
    </button>
  );
}
