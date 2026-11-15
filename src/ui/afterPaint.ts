// Wait until the browser has painted. Blocking main-thread work (a multi-
// million-triangle mesh upload, a thumbnail readback) freezes whatever was on
// screen when it started, so a status line set just before it never shows
// unless a frame is allowed to paint first.

/** Resolves once a frame has been painted — or at once in a hidden tab, which
 *  has nothing to paint and throttles frames (the work must not wait for the
 *  user to come back). */
export function afterNextPaint(): Promise<void> {
  if (typeof document === 'undefined' || document.hidden) return Promise.resolve();
  return new Promise(resolve => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      document.removeEventListener('visibilitychange', onHide);
      resolve();
    };
    // The tab was hidden while waiting: frames stop, so stop waiting.
    const onHide = (): void => { if (document.hidden) finish(); };
    document.addEventListener('visibilitychange', onHide);
    // rAF runs just BEFORE the paint; the macrotask after it runs after.
    requestAnimationFrame(() => setTimeout(finish, 0));
  });
}
