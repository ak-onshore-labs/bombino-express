/**
 * Last-resort process handlers, installed once per process.
 *
 * A rejection nobody caught is a bug to fix, not a reason to drop every other
 * request: since Node 15 an unhandled rejection is fatal by default, and on
 * Vercel one of them takes down a container that is serving other customers.
 * Logging it keeps the container alive — the request that caused it still fails
 * (its handler never answered), but nothing else does.
 *
 * `uncaughtException` is different: the process state after one is unknown, so
 * this logs and then exits, which is what Node would have done anyway. The
 * listener exists to make sure the reason is in the logs first.
 *
 * Route-level safety belongs in `asyncRoute` (server/routeGuards.ts); this is
 * only the net under it.
 */

let installed = false;

export function installProcessGuards(): void {
  if (installed) return;
  installed = true;

  process.on("unhandledRejection", (reason: unknown) => {
    console.error("[unhandledRejection]", reason);
  });

  process.on("uncaughtException", (err: Error) => {
    console.error("[uncaughtException]", err);
    process.exit(1);
  });
}
