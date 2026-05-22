// Modeling quality settings (curve segment count + global mesh-detail factor).
// Controls the default circular segment count applied to every Manifold /
// OpenSCAD run. Scripts can still override per-call (segment arg to
// sphere/cylinder/etc., or an explicit setCircularSegments() / $fn assignment)
// — this is just the starting default that primitives fall back to when no
// override is given.
//
// These are SESSION-scoped, not global: the value lives in memory here (what the
// engine reads), and sessionManager persists it per session and re-hydrates it
// on open. A brand-new session starts at the defaults. There is intentionally no
// localStorage blob — settings do not bleed across sessions.

export type QualityLevel = 'low' | 'medium' | 'high' | 'highest' | 'ultra';

export interface QualitySettings {
  quality: QualityLevel;
  /** Global mesh-refinement factor applied to every rendered manifold.
   *  1 = off (native triangle density); n > 1 splits every triangle edge
   *  into n pieces (so triangle count grows ~n²), densifying flat faces too
   *  — not just curves, the way `quality` does. Driven by the viewport's
   *  Mesh settings popover. Defaults to off; it's an opt-in detail boost
   *  (mainly useful for finer paint regions). */
  refine: number;
}

export const REFINE_MIN = 1;
export const REFINE_MAX = 64;
export const REFINE_DEFAULT = 1;

export const QUALITY_SEGMENTS: Record<QualityLevel, number> = {
  low: 16,
  medium: 32,
  high: 64,
  highest: 128,
  ultra: 1024,
};

export const QUALITY_OPTIONS: { id: QualityLevel; label: string; hint: string }[] = [
  { id: 'low', label: 'Low', hint: '16 segments — chunky facets, fastest' },
  { id: 'medium', label: 'Medium', hint: '32 segments — visibly smooth' },
  { id: 'high', label: 'High', hint: '64 segments — smooth curves' },
  { id: 'highest', label: 'Very High', hint: '128 segments — very smooth' },
  { id: 'ultra', label: 'Ultra', hint: '1024 segments — near-perfect curves, slowest on complex models' },
];

const DEFAULT_SETTINGS: QualitySettings = {
  quality: 'highest',
  refine: REFINE_DEFAULT,
};

// In-memory current settings — what the engine reads each run. Driven by the
// active session (see hydrate/reset below), not by localStorage.
let current: QualitySettings = { ...DEFAULT_SETTINGS };
const listeners = new Set<(s: QualitySettings) => void>();

export function loadQualitySettings(): QualitySettings {
  return { ...current };
}

/** User-initiated change (the Mesh popover). Updates the live value and fires
 *  listeners so the viewport re-renders and sessionManager persists it to the
 *  active session. */
export function saveQualitySettings(next: QualitySettings): void {
  current = mergeWithDefaults(next);
  for (const fn of listeners) fn(current);
}

/** Restore settings from a session on open (or null → defaults). Silent: it
 *  updates the value the engine reads but does NOT fire change-listeners, so it
 *  neither re-renders nor re-persists — the session-load flow handles both. */
export function hydrateQualitySettings(partial: { quality?: string; refine?: number } | null | undefined): void {
  // mergeWithDefaults validates the quality string against QUALITY_SEGMENTS and
  // clamps refine, so a loose stored shape (db structural type) is safe here.
  current = partial ? mergeWithDefaults(partial as Partial<QualitySettings>) : { ...DEFAULT_SETTINGS };
}

/** Back to defaults for a brand-new or closed session (silent, like hydrate). */
export function resetQualitySettings(): void {
  current = { ...DEFAULT_SETTINGS };
}

export function onQualitySettingsChange(fn: (s: QualitySettings) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Resolve the current segment count from the active quality preset. */
export function getDefaultCircularSegments(): number {
  return QUALITY_SEGMENTS[current.quality];
}

/** Current global mesh-refinement factor (>= 1; 1 means no refinement). */
export function getRefineFactor(): number {
  return current.refine;
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
