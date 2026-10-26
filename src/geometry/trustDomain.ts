// Engine trust domain (#1090) — which session's model code the geometry
// Workers may currently run. A leaf module: main.ts sets it on every session
// change; engine.ts (the editor's engine Worker) and enginePool.ts (the
// parallel build pool) read it to keep one session's code from ever sharing a
// Worker realm with another session's runs.

/** Domain in effect before the app has opened (or decided on) a session. Runs
 *  during boot are tagged with it, so the first request after a real session
 *  is chosen recycles that Worker instead of treating it as unused. */
const STARTUP_DOMAIN = '(startup)';

let current: string = STARTUP_DOMAIN;
const listeners = new Set<(domain: string) => void>();

/** The domain new engine requests belong to. */
export function getEngineTrustDomain(): string {
  return current;
}

/** Switch the active domain (main.ts: the open session). Listeners (the build
 *  pool) are told so they can drop Workers that belong to the old domain. */
export function setEngineTrustDomain(domain: string): void {
  if (domain === current) return;
  current = domain;
  for (const fn of listeners) fn(domain);
}

export function onEngineTrustDomainChange(fn: (domain: string) => void): void {
  listeners.add(fn);
}
