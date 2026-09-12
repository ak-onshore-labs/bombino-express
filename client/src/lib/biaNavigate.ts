/**
 * Following a link from BIA: `/profile#documents` goes to the page and then to
 * that section of it. The router changes the page but, being history-based,
 * never scrolls to a `#section` itself, and the section only exists once the
 * page has rendered — so it is looked for over the next couple of seconds.
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
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (Date.now() - started < 2000) window.requestAnimationFrame(find);
  };
  window.requestAnimationFrame(find);
}
