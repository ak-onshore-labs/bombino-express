import { Phone } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { BRANCH_HEAD } from '@/lib/branchHead';

/**
 * The agent surface's two "are you sure" moments, and the Problem popup.
 *
 * Start journey is one-way: once on the way the agent can no longer hand the
 * pickup back. Cancel pickup gives the job back to the branch. Both are a
 * single tap otherwise, so both ask first.
 */

/** Actions that ask before they fire. */
export const CONFIRMED_ACTIONS = new Set(['start_pickup', 'release_pickup']);

const COPY: Record<string, { title: string; body: string; confirm: string; keep: string }> = {
  start_pickup: {
    title: 'Start your journey?',
    body: 'Confirm to start your journey to this pickup. Once started, you cannot cancel it.',
    confirm: 'Start journey',
    keep: 'Not yet',
  },
  release_pickup: {
    title: 'Cancel this pickup?',
    body: 'It goes back to your branch head, who will give it to someone else.',
    confirm: 'Cancel pickup',
    keep: 'Keep it',
  },
};

const BUTTON = 'h-14 rounded-none text-[17px] font-bold';

export function ConfirmActionDialog({
  action,
  onConfirm,
  onClose,
}: {
  /** The action waiting for a yes, or null when closed. */
  action: string | null;
  onConfirm: (action: string) => void;
  onClose: () => void;
}) {
  const copy = action ? COPY[action] : null;
  return (
    <AlertDialog open={!!copy} onOpenChange={(open) => !open && onClose()}>
      {copy && action && (
        <AlertDialogContent className="rounded-none" data-testid={`confirm-${action}`}>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[21px] text-[#1B2A41]">{copy.title}</AlertDialogTitle>
            <AlertDialogDescription className="text-[16px] text-[#334155]">
              {copy.body}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className={BUTTON} data-testid={`confirm-${action}-keep`}>
              {copy.keep}
            </AlertDialogCancel>
            <AlertDialogAction
              className={
                action === 'release_pickup'
                  ? `${BUTTON} bg-[#B91C1C] hover:bg-[#991B1B] text-white`
                  : `${BUTTON} bg-[#1B2A41] hover:bg-[#1B2A41]/90 text-white`
              }
              onClick={() => onConfirm(action)}
              data-testid={`confirm-${action}-yes`}
            >
              {copy.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      )}
    </AlertDialog>
  );
}

/** "Problem": call the branch head. */
export function ProblemDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onClose()}>
      <AlertDialogContent className="rounded-none" data-testid="problem-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-[21px] text-[#1B2A41]">Problem with this pickup?</AlertDialogTitle>
          <AlertDialogDescription className="text-[16px] text-[#334155]">
            Call your branch head, {BRANCH_HEAD.name}.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <a
          href={`tel:+91${BRANCH_HEAD.phone}`}
          className="h-14 flex items-center justify-center gap-2.5 bg-[#15803D] text-[17px] font-bold text-white"
          data-testid="link-call-branch-head"
        >
          <Phone className="w-5 h-5" strokeWidth={1.75} />
          Call {BRANCH_HEAD.name} · {BRANCH_HEAD.phone.replace(/(\d{5})(\d{5})/, '$1 $2')}
        </a>
        <AlertDialogFooter>
          <AlertDialogCancel className={BUTTON} data-testid="problem-dialog-close">
            Close
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
