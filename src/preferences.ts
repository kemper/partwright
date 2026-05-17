// Per-browser user preferences — covers modeling quality, the default
// mesh color for unpainted geometry, and how long the editor waits
// after a keystroke before re-rendering. Persisted to localStorage as
// one JSON blob; the settings modal (src/ui/preferencesModal.ts) is
// the user-facing entry point.

const STORAGE_KEY = 'partwright-preferences-v1';

// ---------- Modeling quality (circular segment count) ----------

export type QualityLevel = 'low' | 'medium' | 'high' | 'highest';

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

// ---------- Default mesh color (unpainted geometry) ----------

export type MeshColorId = 'blue' | 'graphite' | 'emerald' | 'sunset' | 'lavender' | 'rose';

export const MESH_COLORS: Record<MeshColorId, { hex: number; label: string }> = {
  blue:     { hex: 0x4a9eff, label: 'Blue' },
  graphite: { hex: 0x9ca3af, label: 'Graphite' },
  emerald:  { hex: 0x10b981, label: 'Emerald' },
  sunset:   { hex: 0xf59e0b, label: 'Sunset' },
  lavender: { hex: 0xa78bfa, label: 'Lavender' },
  rose:     { hex: 0xfb7185, label: 'Rose' },
};

export const MESH_COLOR_OPTIONS: { id: MeshColorId; label: string; hex: number }[] =
  (Object.entries(MESH_COLORS) as [MeshColorId, (typeof MESH_COLORS)[MeshColorId]][])
    .map(([id, v]) => ({ id, label: v.label, hex: v.hex }));

// ---------- Auto-render delay (editor debounce) ----------

export type RenderDelay = 'fast' | 'normal' | 'relaxed';

export const RENDER_DELAY_MS: Record<RenderDelay, number> = {
  fast: 100,
  normal: 300,
  relaxed: 800,
};

export const RENDER_DELAY_OPTIONS: { id: RenderDelay; label: string; hint: string }[] = [
  { id: 'fast', label: 'Fast', hint: '100ms — re-renders almost immediately' },
  { id: 'normal', label: 'Normal', hint: '300ms — balanced' },
  { id: 'relaxed', label: 'Relaxed', hint: "800ms — kinder to slow machines and heavy models" },
];

// ---------- AI safety: lifetime spend cap ----------

export type LifetimeSpendCap = 'unlimited' | 'cap5' | 'cap20' | 'cap100';

export const LIFETIME_SPEND_CAP_USD: Record<LifetimeSpendCap, number> = {
  unlimited: Number.POSITIVE_INFINITY,
  cap5: 5,
  cap20: 20,
  cap100: 100,
};

export const LIFETIME_SPEND_OPTIONS: { id: LifetimeSpendCap; label: string; hint: string }[] = [
  { id: 'unlimited', label: 'Unlimited', hint: 'No lifetime cap — only the per-turn $ cap applies' },
  { id: 'cap5',  label: '$5',   hint: "Hard stop after $5 of total AI spend" },
  { id: 'cap20', label: '$20',  hint: 'Hard stop after $20 of total AI spend' },
  { id: 'cap100', label: '$100', hint: 'Hard stop after $100 of total AI spend' },
];

// ---------- AI defaults ----------

export type AiPaintDefault = 'off' | 'on';

export const AI_PAINT_DEFAULT_OPTIONS: { id: AiPaintDefault; label: string; hint: string }[] = [
  { id: 'off', label: 'Off', hint: "Paint tools are disabled in new sessions (default — color regions lock the editor)" },
  { id: 'on',  label: 'On',  hint: 'Paint tools are enabled in new sessions' },
];

// ---------- Aggregate preferences ----------

export interface Preferences {
  quality: QualityLevel;
  meshColor: MeshColorId;
  renderDelay: RenderDelay;
  lifetimeSpendCap: LifetimeSpendCap;
  aiPaintDefault: AiPaintDefault;
}

const DEFAULTS: Preferences = {
  quality: 'highest',
  meshColor: 'blue',
  renderDelay: 'normal',
  lifetimeSpendCap: 'unlimited',
  aiPaintDefault: 'off',
};

let cached: Preferences | null = null;
const listeners = new Set<(p: Preferences) => void>();

export function loadPreferences(): Preferences {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Preferences>;
      cached = mergeWithDefaults(parsed);
      return cached;
    }
  } catch {
    // Fall through to defaults on parse / storage error.
  }
  cached = { ...DEFAULTS };
  return cached;
}

export function savePreferences(next: Preferences): void {
  cached = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage may be full or disabled (private browsing); changes
    // remain applied for this session.
  }
  for (const fn of listeners) fn(next);
}

export function onPreferencesChange(fn: (p: Preferences) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Resolve the current segment count from the active quality preset. */
export function getDefaultCircularSegments(): number {
  return QUALITY_SEGMENTS[loadPreferences().quality];
}

/** Resolve the current default mesh-material color (hex int, no alpha). */
export function getDefaultMeshColor(): number {
  return MESH_COLORS[loadPreferences().meshColor].hex;
}

/** Resolve the current editor auto-render debounce in milliseconds. */
export function getRenderDelayMs(): number {
  return RENDER_DELAY_MS[loadPreferences().renderDelay];
}

/** Lifetime AI spend cap in USD (Number.POSITIVE_INFINITY = no cap). */
export function getLifetimeSpendCapUsd(): number {
  return LIFETIME_SPEND_CAP_USD[loadPreferences().lifetimeSpendCap];
}

/** Whether new AI sessions should start with paint tools enabled. */
export function getAiPaintDefault(): boolean {
  return loadPreferences().aiPaintDefault === 'on';
}

function mergeWithDefaults(partial: Partial<Preferences>): Preferences {
  const q = partial.quality;
  const c = partial.meshColor;
  const d = partial.renderDelay;
  const l = partial.lifetimeSpendCap;
  const p = partial.aiPaintDefault;
  return {
    quality: q && q in QUALITY_SEGMENTS ? q : DEFAULTS.quality,
    meshColor: c && c in MESH_COLORS ? c : DEFAULTS.meshColor,
    renderDelay: d && d in RENDER_DELAY_MS ? d : DEFAULTS.renderDelay,
    lifetimeSpendCap: l && l in LIFETIME_SPEND_CAP_USD ? l : DEFAULTS.lifetimeSpendCap,
    aiPaintDefault: p === 'on' || p === 'off' ? p : DEFAULTS.aiPaintDefault,
  };
}
