// Working-copy autosave for the editor.
//
// Persists the in-progress editor state (code + paint regions + annotations)
// for the active session so a refresh or crash can't discard unsaved edits
// before the user commits a version with Mod+S.
//
// This is deliberately separate from version history: `saveVersion()` mints a
// new immutable version on every call, so it can't double as continuous
// autosave. Drafts live in localStorage — small, and synchronous so the
// `beforeunload` write path stays reliable (async IndexedDB writes can't be
// guaranteed to flush during unload) — keyed per session, and reconciled
// against the loaded version on resume.

import type { SerializedColorRegion } from '../color/regions';
import type { SerializedAnnotation } from '../annotations/annotations';

export interface SessionDraft {
  code: string;
  colorRegions: SerializedColorRegion[];
  annotations: SerializedAnnotation[];
  savedAt: number;
}

/** The mutable slice of a draft — everything except the stamped `savedAt`. */
export type DraftSnapshot = Omit<SessionDraft, 'savedAt'>;

const PREFIX = 'partwright-draft-v1:';

function keyFor(sessionId: string): string {
  return PREFIX + sessionId;
}

/** Persist the current working copy for a session. Best-effort: a failed write
 *  (quota, private mode) must never break the editor. */
export function saveDraft(sessionId: string, snapshot: DraftSnapshot): void {
  try {
    const draft: SessionDraft = { ...snapshot, savedAt: Date.now() };
    localStorage.setItem(keyFor(sessionId), JSON.stringify(draft));
  } catch {
    /* best-effort — autosave never throws into the edit path */
  }
}

/** Read the working copy for a session, or null if none exists / is malformed. */
export function loadDraft(sessionId: string): SessionDraft | null {
  try {
    const raw = localStorage.getItem(keyFor(sessionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SessionDraft>;
    if (typeof parsed.code !== 'string') return null;
    return {
      code: parsed.code,
      colorRegions: Array.isArray(parsed.colorRegions) ? parsed.colorRegions : [],
      annotations: Array.isArray(parsed.annotations) ? parsed.annotations : [],
      savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : 0,
    };
  } catch {
    return null;
  }
}

/** Drop the working copy for a session (e.g. after it's committed to a version
 *  or the session is deleted). */
export function clearDraft(sessionId: string): void {
  try {
    localStorage.removeItem(keyFor(sessionId));
  } catch {
    /* best-effort */
  }
}

/** Drop every session draft (used when clearing all data). */
export function clearAllDrafts(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
  } catch {
    /* best-effort */
  }
}

/** True when a draft holds work not yet captured in the given saved baseline
 *  (the version it was loaded from). Order is meaningful for both regions and
 *  annotations — they're appended — so a structural JSON compare is exact. */
export function draftHasUnsavedWork(draft: SessionDraft, baseline: DraftSnapshot): boolean {
  if (draft.code !== baseline.code) return true;
  if (JSON.stringify(draft.colorRegions) !== JSON.stringify(baseline.colorRegions)) return true;
  if (JSON.stringify(draft.annotations) !== JSON.stringify(baseline.annotations)) return true;
  return false;
}
