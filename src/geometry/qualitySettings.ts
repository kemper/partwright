// Per-browser modeling quality settings. Controls the default circular
// segment count applied to every Manifold / OpenSCAD run. Scripts can
// still override per-call (segment arg to sphere/cylinder/etc., or an
// explicit setCircularSegments() / $fn assignment) — this is just the
// starting default that primitives fall back to when no override is
// given. Persisted to localStorage as one JSON blob.

const STORAGE_KEY = 'partwright-quality-settings-v1';

export type QualityLevel = 'low' | 'medium' | 'high' | 'highest';

export interface QualitySettings {
  quality: QualityLevel;
  /** Global mesh-refinement factor applied to every rendered manifold.
   *  1 = off (native triangle density); n > 1 splits every triangle edge
   *  into n pieces (so triangle count grows ~n²), densifying flat faces too
   *  — not just curves, the way `quality` does. Driven by the editor's
   *  "Detail" slider. */
  refine: number;
}

export const REFINE_MIN = 1;
export const REFINE_MAX = 64;
export const REFINE_DEFAULT = 2;

export const QUALITY_SEGMENTS: Record<QualityLevel, number> = {
  low: 16,
  medium: 32,
  high: 64,
  highest: 128,
};

export const QUALITY_OPTIONS: { id: QualityLevel; label: string; hint: string }[] = [
  { id: 'low', label: 'Low', hint: '16 segments — chunky facets, fastest' },
  { id: 'medium', label: 'Medium', hint: '32 segments — visibly smooth' },
  { id: 'high', label: 'High', hint: '64 segments — smooth curves' },
  { id: 'highest', label: 'Highest', hint: '128 segments — ultra smooth, slower' },
];

const DEFAULT_SETTINGS: QualitySettings = {
  quality: 'highest',
  refine: REFINE_DEFAULT,
};

let cached: QualitySettings | null = null;
const listeners = new Set<(s: QualitySettings) => void>();

export function loadQualitySettings(): QualitySettings {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<QualitySettings>;
      cached = mergeWithDefaults(parsed);
      return cached;
    }
  } catch {
    // Fall through to defaults on parse / storage error.
  }
  cached = { ...DEFAULT_SETTINGS };
  return cached;
}

export function saveQualitySettings(next: QualitySettings): void {
  const merged = mergeWithDefaults(next);
  cached = merged;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // localStorage may be full or disabled (private browsing). Settings
    // remain applied for this session; we don't surface the failure.
  }
  for (const fn of listeners) fn(merged);
}

export function onQualitySettingsChange(fn: (s: QualitySettings) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Resolve the current segment count from the active quality preset. */
export function getDefaultCircularSegments(): number {
  return QUALITY_SEGMENTS[loadQualitySettings().quality];
}

/** Current global mesh-refinement factor (>= 1; 1 means no refinement). */
export function getRefineFactor(): number {
  return loadQualitySettings().refine;
}

function clampRefine(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return REFINE_DEFAULT;
  return Math.min(REFINE_MAX, Math.max(REFINE_MIN, Math.round(value)));
}

function mergeWithDefaults(partial: Partial<QualitySettings>): QualitySettings {
  const q = partial.quality;
  return {
    quality: q && q in QUALITY_SEGMENTS ? q : DEFAULT_SETTINGS.quality,
    refine: clampRefine(partial.refine),
  };
}
