import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import { useBiaStore } from '@/lib/biaStore';
import { BiaChat } from './BiaChat';

/**
 * BIA over whatever screen the customer is on: a sheet from the bottom on a
 * phone, from the right on a desktop. Opened with `openBia` (lib/biaStore.ts).
 * Radix gives it the focus trap and Escape-to-close; the chat's own header
 * carries the close button, so the sheet's default one is hidden.
 */
export function BiaSheet(): React.JSX.Element | null {
  const { open, screen, seed, requestId, closeBia } = useBiaStore();
  const [location, setLocation] = useLocation();
  const isMobile = useIsMobile();

  // /help is BIA already; a sheet over it would be the same chat twice.
  const onHelp = location === '/help';
  useEffect(() => {
    if (onHelp && open) closeBia();
  }, [onHelp, open, closeBia]);
  if (onHelp) return null;

  return (
    <Sheet open={open} onOpenChange={(next) => !next && closeBia()}>
      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        className={
          isMobile
            ? 'h-[88dvh] rounded-t-2xl border-white/10 bg-[#080808] p-0 overflow-hidden [&>button:first-child]:hidden'
            : 'w-full sm:max-w-[440px] border-white/10 bg-[#080808] p-0 overflow-hidden [&>button:first-child]:hidden'
        }
        data-testid="bia-sheet"
      >
        <SheetTitle className="sr-only">BIA, Bombino's assistant</SheetTitle>
        <SheetDescription className="sr-only">
          Ask about your orders, pickups, documents and bookings.
        </SheetDescription>
        <BiaChat
          variant="sheet"
          screen={screen}
          seed={seed}
          seedKey={requestId}
          onClose={closeBia}
          onNavigate={(to) => {
            closeBia();
            setLocation(to);
          }}
        />
      </SheetContent>
    </Sheet>
  );
}
