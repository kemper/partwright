// The engine Worker's fail-closed lockdown error (#1090), shared by the Worker
// (which formats it) and the main-thread engine clients (which recognise it
// and record it in the Diagnostic Log). When workerLockdown.ts can't strip a
// capability — typically a browser other than the Chromium CI runs exposing a
// global that can't be deleted and isn't on workerGlobalAllowlist.ts — the
// Worker refuses to run any model code. That has to be diagnosable from the
// app, not just from the Worker's DevTools console, so the message carries the
// offending names and says plainly why nothing renders.
//
// Pure — no DOM — so it runs in the unit tier.

export const LOCKDOWN_REFUSAL_PREFIX = 'Geometry engine refused to start for security reasons';

/** The error text the Worker sends for a failed lockdown. `detail` names what
 *  couldn't be removed (`still reachable: A, B`) or the exception. */
export function formatLockdownRefusal(detail: string): string {
  return `${LOCKDOWN_REFUSAL_PREFIX}: its model-code sandbox could not be locked down in this browser (${detail}). Model code will not run; please report your browser and version.`;
}

/** The `detail` of a lockdown-refusal message, or null for any other error. */
export function parseLockdownRefusal(message: unknown): string | null {
  if (typeof message !== 'string' || !message.startsWith(LOCKDOWN_REFUSAL_PREFIX)) return null;
  const open = message.indexOf('(');
  const close = message.lastIndexOf(')');
  return open >= 0 && close > open ? message.slice(open + 1, close) : '';
}
