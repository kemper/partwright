// Per-session relief settings, persisted in localStorage under ONE KEY PER
// SESSION (`partwright.relief.settings:<sessionId>`).
//
// Kept out of the IndexedDB session schema deliberately: the relief mesh itself
// already persists via the Version's `importedMeshes`, and these few knobs
// (layer height, preview mode) don't warrant a schema migration.
//
// History: these used to live in a SINGLE shared map under
// `partwright.relief.settings`, written read-modify-write with no cross-tab
// coordination. Two tabs editing different sessions would clobber each other —
// the second writer's whole-map write would resurrect or drop the first's
// session entry (a lost update, violating the cross-tab "no data bleed" rule).
// Per-session keys make concurrent writers touch DISJOINT keys, so a tab can
// only ever overwrite the session it actually owns. The old shared map is still
// read as a back-compat fallback (never written), so pre-split settings survive.

import type { ReliefSettings, PreviewMode } from './types';

const LEGACY_MAP_KEY = 'partwright.relief.settings';
const KEY_PREFIX = 'partwright.relief.settings:';

function keyFor(sessionId: string): string {
  return KEY_PREFIX + sessionId;
}

/** The pre-split shared map — read-only fallback for sessions whose settings
 *  were persisted before the per-session-key migration. Never written anymore. */
function readLegacyMap(): Record<string, ReliefSettings> {
  try {
    const raw = localStorage.getItem(LEGACY_MAP_KEY);
    return raw ? (JSON.parse(raw) as Record<string, ReliefSettings>) : {};
  } catch {
    return {};
  }
}

function readOne(sessionId: string): ReliefSettings | null {
  try {
    const raw = localStorage.getItem(keyFor(sessionId));
    if (raw) return JSON.parse(raw) as ReliefSettings;
  } catch {
    /* fall through to legacy fallback */
  }
  return readLegacyMap()[sessionId] ?? null;
}

function writeOne(sessionId: string, settings: ReliefSettings): void {
  try {
    localStorage.setItem(keyFor(sessionId), JSON.stringify(settings));
  } catch {
    /* storage unavailable — settings are best-effort */
  }
}

const DEFAULTS: ReliefSettings = {
  isRelief: false,
  layerHeight: 0.08,
  baseThickness: 0.6,
  previewMode: 'flat',
};

export function getReliefSettings(sessionId: string): ReliefSettings | null {
  return readOne(sessionId);
}

export function setReliefSettings(sessionId: string, settings: ReliefSettings): void {
  writeOne(sessionId, settings);
}

export function updateReliefSettings(sessionId: string, patch: Partial<ReliefSettings>): ReliefSettings {
  const next: ReliefSettings = { ...DEFAULTS, ...readOne(sessionId), ...patch };
  writeOne(sessionId, next);
  return next;
}

/** Drop a session's persisted relief settings. Called from the session-delete
 *  cascade so a removed session doesn't leak a stale localStorage entry — the
 *  IndexedDB-side reliefSources blob is cascade-deleted alongside it (db.ts). */
export function clearReliefSettings(sessionId: string): void {
  try {
    localStorage.removeItem(keyFor(sessionId));
  } catch {
    /* best-effort */
  }
  // Also evict a pre-split legacy entry if one exists. This is a guarded
  // read-modify-write, but session-delete is rare and never races a write to
  // the same (now-deleted) session, so it can't reintroduce the lost update.
  try {
    const legacy = readLegacyMap();
    if (sessionId in legacy) {
      delete legacy[sessionId];
      localStorage.setItem(LEGACY_MAP_KEY, JSON.stringify(legacy));
    }
  } catch {
    /* best-effort */
  }
}

export function isReliefSession(sessionId: string | null | undefined): boolean {
  if (!sessionId) return false;
  return getReliefSettings(sessionId)?.isRelief === true;
}

export function getPreviewModeFor(sessionId: string | null | undefined): PreviewMode {
  if (!sessionId) return 'flat';
  return getReliefSettings(sessionId)?.previewMode ?? 'flat';
}
