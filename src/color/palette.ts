// Printer / filament color palette — the real filament colors the user
// physically owns, how many can be loaded at once (AMS slot limit), and
// whether AI sessions must stick to them. Persisted per-browser to
// localStorage as one JSON blob, mirroring `qualitySettings.ts`.
//
// This module is the single source of truth for palette data + the pure
// helpers that turn external input (a manual form entry, or a model's JSON
// reply to a filament photo) into validated `FilamentColor` entries, and that
// render the per-turn enforcement directive the AI sees. Keeping those helpers
// here (only depending on the shared hex normalizer) lets them run in the
// node unit tier without a browser.

import { normalizeHexColor } from '../geometry/params';

const STORAGE_KEY = 'partwright-color-palette-v1';

export interface FilamentColor {
  /** Stable id, used for list keys and in-place edits. */
  id: string;
  /** User-facing name, e.g. "Matte Black". May be empty. */
  name: string;
  /** Normalized lowercase hex, always `#rrggbb`. */
  hex: string;
}

export interface ColorPaletteSettings {
  /** The filaments the user owns. */
  colors: FilamentColor[];
  /** How many distinct colors the printer can load at once (AMS slots). The
   *  AI is told not to exceed this when enforcement is on. */
  maxSimultaneous: number;
  /** When true (and `colors` is non-empty), AI sessions are instructed to use
   *  ONLY these colors and stay within `maxSimultaneous`. */
  enforce: boolean;
}

export const MIN_MAX_SIMULTANEOUS = 1;
/** Generous ceiling — guards a fat-fingered entry, not a real printer limit. */
export const MAX_MAX_SIMULTANEOUS = 64;
const DEFAULT_MAX_SIMULTANEOUS = 4; // a single typical AMS

const DEFAULT_SETTINGS: ColorPaletteSettings = {
  colors: [],
  maxSimultaneous: DEFAULT_MAX_SIMULTANEOUS,
  enforce: false,
};

let cached: ColorPaletteSettings | null = null;
const listeners = new Set<(s: ColorPaletteSettings) => void>();

/** Round + clamp an arbitrary value to a valid simultaneous-color count. */
export function clampMaxSimultaneous(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return DEFAULT_MAX_SIMULTANEOUS;
  return Math.min(MAX_MAX_SIMULTANEOUS, Math.max(MIN_MAX_SIMULTANEOUS, Math.round(n)));
}

function makeId(): string {
  return 'fc_' + Math.random().toString(36).slice(2, 10);
}

/** Build a `FilamentColor` from a name + hex-ish input, or null if the hex is
 *  invalid. Used by the manual add/edit form and the photo-analysis import. */
export function makeFilamentColor(name: unknown, hex: unknown): FilamentColor | null {
  const norm = normalizeHexColor(hex);
  if (!norm) return null;
  const safeName = typeof name === 'string' ? name.trim().slice(0, 80) : '';
  return { id: makeId(), name: safeName, hex: norm };
}

/** Coerce an arbitrary parsed value into a valid `FilamentColor`, or null. */
function sanitizeColor(raw: unknown): FilamentColor | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const norm = normalizeHexColor(r.hex);
  if (!norm) return null;
  const name = typeof r.name === 'string' ? r.name.trim().slice(0, 80) : '';
  const id = typeof r.id === 'string' && r.id.length > 0 ? r.id : makeId();
  return { id, name, hex: norm };
}

/** Drop entries whose hex repeats an earlier one (first occurrence wins). */
export function dedupeColors(colors: FilamentColor[]): FilamentColor[] {
  const seen = new Set<string>();
  const out: FilamentColor[] = [];
  for (const c of colors) {
    if (seen.has(c.hex)) continue;
    seen.add(c.hex);
    out.push(c);
  }
  return out;
}

/** Normalize any partial/untrusted shape into valid settings — used on load
 *  (parsing localStorage) AND on save (so stored data is always clean). */
export function mergeWithDefaults(partial: Partial<ColorPaletteSettings> | null | undefined): ColorPaletteSettings {
  if (!partial || typeof partial !== 'object') return { ...DEFAULT_SETTINGS };
  const colors = Array.isArray(partial.colors)
    ? dedupeColors(partial.colors.map(sanitizeColor).filter((c): c is FilamentColor => c !== null))
    : [];
  return {
    colors,
    maxSimultaneous: clampMaxSimultaneous(partial.maxSimultaneous),
    enforce: partial.enforce === true,
  };
}

export function loadPalette(): ColorPaletteSettings {
  if (cached) return cached;
  // localStorage is unavailable in the Worker / node tier; use defaults.
  if (typeof localStorage === 'undefined') {
    cached = { ...DEFAULT_SETTINGS };
    return cached;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      cached = mergeWithDefaults(JSON.parse(raw) as Partial<ColorPaletteSettings>);
      return cached;
    }
  } catch {
    // Fall through to defaults on parse / storage error.
  }
  cached = { ...DEFAULT_SETTINGS };
  return cached;
}

export function savePalette(next: ColorPaletteSettings): void {
  const sanitized = mergeWithDefaults(next);
  cached = sanitized;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
  } catch {
    // localStorage may be full or disabled (private browsing). Settings
    // remain applied for this session; we don't surface the failure.
  }
  for (const fn of listeners) fn(sanitized);
}

export function onPaletteChange(fn: (s: ColorPaletteSettings) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Test seam: drop the in-memory cache so the next `loadPalette()` re-reads
 *  localStorage. Mirrors the AI-settings reload helper. */
export function reloadPaletteFromStorage(): ColorPaletteSettings {
  cached = null;
  return loadPalette();
}

/**
 * Parse a model's JSON reply to a filament-photo prompt into palette entries.
 * Lenient like `compaction.ts`: strips markdown fences, accepts a few shapes
 * (`{filaments|palette|colors: [...]}` or a bare array), validates each hex,
 * and de-dupes. Returns `[]` on anything unparseable.
 */
export function parseFilamentColors(text: string): FilamentColor[] {
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return [];
  }
  let rawList: unknown;
  if (Array.isArray(parsed)) {
    rawList = parsed;
  } else if (parsed && typeof parsed === 'object') {
    const o = parsed as Record<string, unknown>;
    rawList = o.filaments ?? o.palette ?? o.colors;
  }
  if (!Array.isArray(rawList)) return [];
  const colors = rawList
    .map(entry => {
      if (entry && typeof entry === 'object') {
        const e = entry as Record<string, unknown>;
        return makeFilamentColor(e.name, e.hex);
      }
      // tolerate a bare hex string: ["#ff0000", ...]
      return makeFilamentColor('', entry);
    })
    .filter((c): c is FilamentColor => c !== null);
  return dedupeColors(colors);
}

/**
 * Build the authoritative per-turn instruction the AI gets when palette
 * enforcement is on. Returns null when enforcement is off or the palette is
 * empty (the user tied "respect the palette" to BOTH conditions), so an
 * unconfigured/un-enforced palette adds zero tokens and zero behavior change.
 */
export function buildPaletteDirective(palette: ColorPaletteSettings): string | null {
  if (!palette.enforce || palette.colors.length === 0) return null;
  const n = palette.colors.length;
  const maxN = palette.maxSimultaneous;
  const list = palette.colors
    .map(c => (c.name ? `"${c.name}" ${c.hex}` : c.hex))
    .join(', ');
  return [
    '',
    '## Filament color palette — ENFORCED',
    '',
    'The user has an enforced filament palette: the real spools they can print '
      + 'with. Whenever you assign ANY color — in code via api.label(shape, name, '
      + '{ color }) or voxel colors, or with the paint tools — use ONLY colors '
      + 'from this list. Do not invent or approximate colors outside it; pick the '
      + 'nearest palette entry instead.',
    `Use at most ${maxN} distinct color${maxN === 1 ? '' : 's'} across the model — `
      + `the user's printer can load ${maxN} at once. If a design seems to need `
      + `more, consolidate to the ${maxN} most important and say so briefly.`,
    `Palette (${n} color${n === 1 ? '' : 's'}): ${list}.`,
    'Call getColorPalette() any time to re-read this list (names, hex, and the '
      + 'max-simultaneous limit).',
  ].join('\n');
}
