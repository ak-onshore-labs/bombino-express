/**
 * Following a link from BIA: `/profile#documents` goes to the page and then to
 * that section of it. The router changes the page but, being history-based,
 * never scrolls to a `#section` itself, and the section only exists once the
 * page has rendered (the order page waits on its fetch) — so it is looked for
 * over the next few seconds, then briefly outlined so the eye lands on it.
 */
export function navigateInApp(setLocation: (to: string) => void, to: string): void {
  const hashAt = to.indexOf('#');
  const path = hashAt === -1 ? to : to.slice(0, hashAt);
  const id = hashAt === -1 ? '' : to.slice(hashAt + 1);
  setLocation(path);
  if (!id) return;

  const started = Date.now();
  const find = (): void => {
    const target = document.getElementById(id);
    if (target) {
      const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      target.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
      if (!still) {
        target.animate?.(
          [{ boxShadow: '0 0 0 3px rgba(242,161,35,0.55)' }, { boxShadow: '0 0 0 3px rgba(242,161,35,0)' }],
          { duration: 1800, delay: 300, easing: 'ease-out' }
        );
      }
      return;
    }
    if (Date.now() - started < 5000) window.requestAnimationFrame(find);
  };
  window.requestAnimationFrame(find);
}
