// Per-session relief settings, persisted in localStorage (keyed by session id).
// Kept out of the IndexedDB session schema deliberately: the relief mesh itself
// already persists via the Version's `importedMeshes`, and these few knobs
// (layer height, preview mode) don't warrant a schema migration.

import type { ReliefSettings, PreviewMode } from './types';

const KEY = 'partwright.relief.settings';

type Store = Record<string, ReliefSettings>;

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    return {};
  }
}

function write(store: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
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
  return read()[sessionId] ?? null;
}

export function setReliefSettings(sessionId: string, settings: ReliefSettings): void {
  const store = read();
  store[sessionId] = settings;
  write(store);
}

export function updateReliefSettings(sessionId: string, patch: Partial<ReliefSettings>): ReliefSettings {
  const store = read();
  const next: ReliefSettings = { ...DEFAULTS, ...store[sessionId], ...patch };
  store[sessionId] = next;
  write(store);
  return next;
}

export function isReliefSession(sessionId: string | null | undefined): boolean {
  if (!sessionId) return false;
  return getReliefSettings(sessionId)?.isRelief === true;
}

export function getPreviewModeFor(sessionId: string | null | undefined): PreviewMode {
  if (!sessionId) return 'flat';
  return getReliefSettings(sessionId)?.previewMode ?? 'flat';
}
