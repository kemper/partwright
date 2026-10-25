// Main-thread half of lockdownRefusal.ts: put an engine Worker's fail-closed
// lockdown refusal into the Diagnostic Log, with the names that couldn't be
// removed, so a browser whose Worker global the allowlist doesn't cover yet is
// diagnosable from the app (toolbar ⚠) and not only from the Worker console.
// Used by engine.ts (editor Worker) and enginePool.ts (Assembly/export pool).

import { errorLog } from '../diagnostics/errorLog';
import { parseLockdownRefusal } from './lockdownRefusal';

// A refusal is deterministic for this browser, so every respawned Worker
// repeats it — log each distinct one once per page.
const logged = new Set<string>();

/** If `message` is a lockdown refusal, record it (once) and return true. */
export function reportLockdownRefusal(message: unknown, worker: 'geometry' | 'assembly'): boolean {
  const detail = parseLockdownRefusal(message);
  if (detail === null) return false;
  const key = `${worker}\0${detail}`;
  if (!logged.has(key)) {
    logged.add(key);
    errorLog.capture({
      level: 'error',
      source: 'engine',
      message: `${worker === 'geometry' ? 'Geometry' : 'Assembly build'} engine refused to start for security reasons: the model-code sandbox could not be locked down in this browser (${detail})`,
      detail: `${String(message)}\n\nThese globals are neither removable nor on the allowlist in src/geometry/workerGlobalAllowlist.ts. If they grant no network, storage or cross-context capability, an allowlist entry fixes it (docs/architecture-notes.md → "Allowlist audit").`,
    });
  }
  return true;
}
