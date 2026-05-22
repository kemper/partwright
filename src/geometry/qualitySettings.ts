// Per-browser modeling quality settings. Controls the default circular
// segment count applied to every Manifold / OpenSCAD run. Scripts can
// still override per-call (segment arg to sphere/cylinder/etc., or an
// explicit setCircularSegments() / $fn assignment) — this is just the
// starting default that primitives fall back to when no override is
// given. Persisted to localStorage as one JSON blob.

const STORAGE_KEY = 'partwright-quality-settings-v1';

export type QualityPreset = 'low' | 'medium' | 'high' | 'highest' | 'ultra';
export type QualityLevel = QualityPreset | 'custom';

export interface QualitySettings {
  quality: QualityLevel;
  /** Segment count used when `quality === 'custom'`. Persisted even while
   *  a preset is active so toggling back to Custom restores the user's
   *  last value. Always within [MIN_CUSTOM_SEGMENTS, MAX_CUSTOM_SEGMENTS]. */
  customSegments: number;
}

export const QUALITY_SEGMENTS: Record<QualityPreset, number> = {
  low: 16,
  medium: 32,
  high: 64,
  highest: 128,
  ultra: 1024,
};

export const QUALITY_OPTIONS: { id: QualityPreset; label: string; hint: string }[] = [
  { id: 'low', label: 'Low', hint: '16 segments — chunky facets, fastest' },
  { id: 'medium', label: 'Medium', hint: '32 segments — visibly smooth' },
  { id: 'high', label: 'High', hint: '64 segments — smooth curves' },
  { id: 'highest', label: 'Very High', hint: '128 segments — very smooth' },
  { id: 'ultra', label: 'Ultra', hint: '1024 segments — near-perfect curves, slowest on complex models' },
];

/** Bounds for a user-entered custom segment count. Floor is the smallest
 *  polygon (a triangle); the ceiling guards against accidental
 *  browser-freezing values — a sphere costs ~segments² triangles. */
export const MIN_CUSTOM_SEGMENTS = 3;
export const MAX_CUSTOM_SEGMENTS = 4096;
const DEFAULT_CUSTOM_SEGMENTS = 128;

/** Round + clamp an arbitrary number to a valid integer segment count. */
export function clampCustomSegments(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_CUSTOM_SEGMENTS;
  return Math.min(MAX_CUSTOM_SEGMENTS, Math.max(MIN_CUSTOM_SEGMENTS, Math.round(n)));
}

const DEFAULT_SETTINGS: QualitySettings = {
  quality: 'highest',
  customSegments: DEFAULT_CUSTOM_SEGMENTS,
};

let cached: QualitySettings | null = null;
const listeners = new Set<(s: QualitySettings) => void>();

export function loadQualitySettings(): QualitySettings {
  if (cached) return cached;
  // localStorage is unavailable in Worker context; use defaults.
  if (typeof localStorage === 'undefined') {
    cached = { ...DEFAULT_SETTINGS };
    return cached;
  }
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
  cached = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage may be full or disabled (private browsing). Settings
    // remain applied for this session; we don't surface the failure.
  }
  for (const fn of listeners) fn(next);
}

export function onQualitySettingsChange(fn: (s: QualitySettings) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Override applied by the geometry Worker so it uses the main-thread
 *  quality setting (which reads from localStorage) rather than the
 *  Worker's default. Null means "read from localStorage as normal". */
let circularSegmentsOverride: number | null = null;

export function setCircularSegmentsOverride(n: number | null): void {
  circularSegmentsOverride = n;
}

/** Resolve the current segment count from the active quality preset. */
export function getDefaultCircularSegments(): number {
  if (circularSegmentsOverride !== null) return circularSegmentsOverride;
  const s = loadQualitySettings();
  if (s.quality === 'custom') return clampCustomSegments(s.customSegments);
  return QUALITY_SEGMENTS[s.quality];
}

function mergeWithDefaults(partial: Partial<QualitySettings>): QualitySettings {
  const q = partial.quality;
  const quality: QualityLevel =
    q === 'custom' || (q != null && q in QUALITY_SEGMENTS) ? q : DEFAULT_SETTINGS.quality;
  const customSegments =
    typeof partial.customSegments === 'number'
      ? clampCustomSegments(partial.customSegments)
      : DEFAULT_SETTINGS.customSegments;
  return { quality, customSegments };
}
