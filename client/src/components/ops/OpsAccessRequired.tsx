import { LogOut } from 'lucide-react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { signOutAndRedirect } from '@/lib/session';

/**
 * What a 403 looks like on an ops screen.
 *
 * Nine of the eleven ops pages used to render a forbidden response as "Could
 * not load … Try refreshing." — so an admin without the right role was told to
 * refresh forever. Refreshing is not the answer; signing in as someone else is.
 */
export function OpsAccessRequired({ what = 'this screen' }: { what?: string }) {
  const [, setLocation] = useLocation();

  return (
    <div
      className="rounded-2xl border border-border bg-white px-6 py-10 text-center"
      data-testid="ops-forbidden"
    >
      <p className="text-base font-semibold text-foreground">Ops access required</p>
      <p className="text-sm text-muted-foreground mt-2">
        This account does not have the role {what} needs. Sign out and use an ops account.
      </p>
      <Button
        type="button"
        onClick={() => void signOutAndRedirect(setLocation)}
        className="mt-5 bg-[#F2A123] hover:bg-[#F2A123]/90 text-[lab(34.0831_-9.57756_-27.7093)] font-semibold"
        data-testid="button-ops-forbidden-logout"
      >
        <LogOut className="w-4 h-4 mr-2" />
        Sign out
      </Button>
    </div>
  );
}
