// Wait until the browser has painted. Blocking main-thread work (a multi-
// million-triangle mesh upload, a thumbnail readback) freezes whatever was on
// screen when it started, so a status line set just before it never shows
// unless a frame is allowed to paint first.

import { getConfig } from '../config/appConfig';

/** Resolves once a frame has been painted. Never waits where no frame is
 *  coming: at once with no document or in a hidden tab (nothing to paint, and
 *  frames are throttled), as soon as the tab is hidden, and after
 *  `ui.paintWaitTimeoutMs` at the latest (frames can stop without the tab
 *  being hidden — a covered window, an embedded view). The work must not wait
 *  for the user to come back. */
export function afterNextPaint(): Promise<void> {
  if (typeof document === 'undefined' || document.hidden) return Promise.resolve();
  return new Promise(resolve => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      clearTimeout(fallback);
      document.removeEventListener('visibilitychange', onHide);
      resolve();
    };
    const onHide = (): void => { if (document.hidden) finish(); };
    document.addEventListener('visibilitychange', onHide);
    const fallback = setTimeout(finish, getConfig().ui.paintWaitTimeoutMs);
    // rAF runs just BEFORE the paint; the macrotask after it runs after.
    requestAnimationFrame(() => setTimeout(finish, 0));
  });
}
