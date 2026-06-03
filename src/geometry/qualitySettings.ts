// Per-tab modeling quality settings. Controls the default circular
// segment count applied to every Manifold / OpenSCAD run. Scripts can
// still override per-call (segment arg to sphere/cylinder/etc., or an
// explicit setCircularSegments() / $fn assignment) — this is just the
// starting default that primitives fall back to when no override is
// given. Quality is session-scoped (not persisted across page reloads)
// so each load starts from the configured default. The default segment
// count is set in Settings (Advanced) and persisted via appConfig.

import { getConfig } from '../config/appConfig';

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
/** Round + clamp an arbitrary number to a valid integer segment count. */
export function clampCustomSegments(n: number): number {
  if (!Number.isFinite(n)) return MAX_CUSTOM_SEGMENTS;
  return Math.min(MAX_CUSTOM_SEGMENTS, Math.max(MIN_CUSTOM_SEGMENTS, Math.round(n)));
}

/** Return the nearest named preset for a segment count, or 'custom'. */
export function segmentsToPreset(segments: number): QualityLevel {
  for (const [preset, count] of Object.entries(QUALITY_SEGMENTS)) {
    if (count === segments) return preset as QualityPreset;
  }
  return 'custom';
}

function getDefaultSettings(): QualitySettings {
  const segs = clampCustomSegments(getConfig().ui.defaultQuality);
  const preset = segmentsToPreset(segs);
  return { quality: preset, customSegments: segs };
}

let cached: QualitySettings | null = null;
const listeners = new Set<(s: QualitySettings) => void>();

export function loadQualitySettings(): QualitySettings {
  if (cached) return cached;
  cached = getDefaultSettings();
  return cached;
}

export function saveQualitySettings(next: QualitySettings): void {
  cached = next;
  for (const fn of listeners) fn(next);
}

/** Write settings without notifying listeners. Used when quality must switch
 *  atomically with a language change so only the language-switch re-run fires,
 *  not an extra one from the quality listener. */
export function saveQualitySettingsSilent(next: QualitySettings): void {
  cached = next;
}

export function onQualitySettingsChange(fn: (s: QualitySettings) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Override applied by the geometry Worker so it uses the main-thread
 *  quality setting rather than the Worker's in-memory default (which
 *  can't see the main-thread cache). Null means use local defaults. */
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

