import React, { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { BUILD_COMMIT, nativeShellLabel, webBuildLabel } from '@/lib/buildInfo';

/**
 * "Bombino Express V1 (Build 81.261013.10)", with the store app's own version on a
 * second line inside the iOS or Android app.
 */
export function BuildVersion({
  className,
  name = 'Bombino Express',
}: {
  className?: string;
  /** Before the build; empty where the screen already names the app. */
  name?: string;
}): React.JSX.Element {
  const [shell, setShell] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void nativeShellLabel().then((label) => {
      if (live) setShell(label);
    });
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className={cn('text-[10px] text-muted-foreground', className)} title={BUILD_COMMIT}
      data-commit={BUILD_COMMIT}
      data-testid="text-build-version"
    >
      <p>{name ? `${name} ${webBuildLabel()}` : webBuildLabel()}</p>
      {shell && <p>App {shell}</p>}
    </div>
  );
}
