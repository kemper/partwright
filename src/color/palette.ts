// Shared colour palette — the single source of truth for the slots the paint
// tools, the Relief Studio, and the exporters all draw from. Promoted out of
// `src/relief/filaments.ts` (which now re-exports this module) because the
// palette is no longer relief-specific: regular face/voxel painting assigns
// regions to palette *slots* so a multi-colour model maps cleanly onto a
// printer's filament slots (AMS / MMU).
//
// A "slot" is a `Filament` ({ id, name, hex, td }) — the same shape the relief
// optical preview already used. Slot `id` is globally unique and stable, so a
// painted region references its slot by id and resolves regardless of slot
// order or which palette is active later (see Phase 3 / collections).
//
// localStorage-backed, deliberately separate from the IndexedDB session schema
// so it needs no migration — the palette is a cross-session user preference.
// Pure-ish logic (only touches localStorage, guarded) so it unit-tests in the
// vitest tier.

import type { Filament } from '../relief/types';
import { getConfig } from '../config/appConfig';

export type { Filament };

// New, ordered single-source-of-truth key. The legacy keys below are read once
// to migrate an existing relief filament library into the ordered list.
const PALETTE_KEY = 'partwright.palette.slots';
const CAPACITY_KEY = 'partwright.palette.capacity';
const CONSTRAIN_KEY = 'partwright.palette.constrained';
// Legacy relief keys (pre-palette). Read-only now, for one-time migration.
const LEGACY_USER_KEY = 'partwright.filaments';
const LEGACY_HIDDEN_KEY = 'partwright.filaments.hidden';

export const DEFAULT_FILAMENTS: Filament[] = [
  { id: 'def-white', name: 'White', hex: '#f5f5f0', td: 3 },
  { id: 'def-black', name: 'Black', hex: '#181818', td: 0.4 },
  { id: 'def-red', name: 'Red', hex: '#c02525', td: 1.2 },
  { id: 'def-yellow', name: 'Yellow', hex: '#e8c024', td: 2 },
  { id: 'def-blue', name: 'Blue', hex: '#2452c0', td: 1 },
  { id: 'def-gray', name: 'Gray', hex: '#808080', td: 0.8 },
];

// Named palette collections. A user can keep several named palettes (e.g. one
// per spool set) and switch the active one; the active palette's slots are what
// every other API returns. Stored as one blob so switching is atomic.
const COLLECTIONS_KEY = 'partwright.palette.collections';
interface NamedPalette { id: string; name: string; slots: Filament[] }
interface Collections { palettes: NamedPalette[]; activeId: string }
// In-memory mirror — the live copy when localStorage is unavailable (SSR /
// private mode / tests), and a cache otherwise so reads don't re-parse JSON.
let collectionsMem: Collections | null = null;

type Listener = () => void;
const listeners: Listener[] = [];

/** Subscribe to palette changes (CRUD, capacity, constrain). Returns an
 *  unsubscribe. The paint UI uses this to rebuild swatches + the over-budget
 *  badge when the user edits the palette. */
export function onPaletteChange(fn: Listener): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

function notify(): void {
  for (const fn of listeners) fn();
}

function isValidFilament(f: unknown): f is Filament {
  const o = f as Record<string, unknown>;
  return !!o && typeof o.id === 'string' && typeof o.name === 'string'
    && typeof o.hex === 'string' && typeof o.td === 'number';
}

function readJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** Reconstruct the effective list the legacy relief library would have shown,
 *  so the first palette read migrates a user's existing filaments in order. */
function legacyEffective(): Filament[] {
  const user = (readJSON<unknown[]>(LEGACY_USER_KEY) ?? []).filter(isValidFilament);
  const hidden = new Set((readJSON<unknown[]>(LEGACY_HIDDEN_KEY) ?? []).filter((s): s is string => typeof s === 'string'));
  const seen = new Set(user.map(f => f.id));
  return [
    ...DEFAULT_FILAMENTS.filter(f => !seen.has(f.id) && !hidden.has(f.id)),
    ...user,
  ];
}

/** The slot list for a brand-new "Default" palette — the single-palette source
 *  (PALETTE_KEY from before collections), else migrated legacy relief data,
 *  else the built-in defaults. */
function seedSlots(): Filament[] {
  const stored = readJSON<unknown[]>(PALETTE_KEY);
  if (stored && Array.isArray(stored)) {
    const s = stored.filter(isValidFilament);
    if (s.length) return s;
  }
  const legacy = legacyEffective();
  return legacy.length > 0 ? legacy : DEFAULT_FILAMENTS.map(f => ({ ...f }));
}

/** Load the palette collections, migrating the pre-collections single palette
 *  into one "Default" palette on first access. */
function loadCollections(): Collections {
  if (collectionsMem) return collectionsMem;
  const stored = readJSON<Collections>(COLLECTIONS_KEY);
  if (stored && Array.isArray(stored.palettes) && stored.palettes.length > 0 && typeof stored.activeId === 'string') {
    const palettes = stored.palettes
      .filter(p => p && typeof p.id === 'string' && typeof p.name === 'string' && Array.isArray(p.slots))
      .map(p => ({ id: p.id, name: p.name, slots: p.slots.filter(isValidFilament) }));
    if (palettes.length > 0) {
      const activeId = palettes.some(p => p.id === stored.activeId) ? stored.activeId : palettes[0].id;
      collectionsMem = { palettes, activeId };
      return collectionsMem;
    }
  }
  collectionsMem = { palettes: [{ id: 'default', name: 'Default', slots: seedSlots() }], activeId: 'default' };
  saveCollections();
  return collectionsMem;
}

function saveCollections(): void {
  try {
    localStorage.setItem(COLLECTIONS_KEY, JSON.stringify(collectionsMem));
  } catch {
    /* keep the in-memory copy as the live source */
  }
}

function activePalette(): NamedPalette {
  const c = loadCollections();
  return c.palettes.find(p => p.id === c.activeId) ?? c.palettes[0];
}

/** The active palette's ordered slot list. All other slot APIs read this. */
function load(): Filament[] {
  return activePalette().slots;
}

function save(list: Filament[]): void {
  activePalette().slots = list;
  saveCollections();
}

/** The ordered palette slots. Slot index == intended filament/AMS slot. */
export function listFilaments(): Filament[] {
  return load().map(f => ({ ...f }));
}

/** Look up a slot by its stable id, or null if it's no longer in the palette. */
export function getSlotById(id: string): Filament | null {
  return load().find(f => f.id === id) ?? null;
}

/** Index of a slot in palette (= filament/AMS slot) order, or -1 if absent. */
export function slotOrderIndex(id: string): number {
  return load().findIndex(f => f.id === id);
}

function genId(): string {
  return `fil-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/** Append a new slot and return it. */
export function addFilament(f: Omit<Filament, 'id'>): Filament {
  const filament: Filament = { ...f, id: genId() };
  save([...load(), filament]);
  notify();
  return filament;
}

/** Patch a slot's fields in place (order preserved). No-op if id is unknown. */
export function updateFilament(id: string, patch: Partial<Omit<Filament, 'id'>>): void {
  const list = load();
  const idx = list.findIndex(f => f.id === id);
  if (idx < 0) return;
  const next = list.slice();
  next[idx] = { ...next[idx], ...patch };
  save(next);
  notify();
}

/** Remove a slot. */
export function removeFilament(id: string): void {
  const next = load().filter(f => f.id !== id);
  save(next);
  notify();
}

/** Reorder slots to match `orderedIds`. Ids not present are dropped; ids in the
 *  palette but missing from `orderedIds` are appended in their current order. */
export function reorderFilaments(orderedIds: string[]): void {
  const list = load();
  const byId = new Map(list.map(f => [f.id, f]));
  const next: Filament[] = [];
  for (const id of orderedIds) {
    const f = byId.get(id);
    if (f) { next.push(f); byId.delete(id); }
  }
  for (const f of list) if (byId.has(f.id)) next.push(f);
  save(next);
  notify();
}

/** Reset the palette to the built-in defaults. */
export function resetPalette(): void {
  save(DEFAULT_FILAMENTS.map(f => ({ ...f })));
  notify();
}

// ── Capacity (how many filament slots the target printer has) ───────────────

/** The printer's colour-slot capacity (e.g. 4 for one Bambu AMS). Drives the
 *  over-budget warning; never blocks painting or export. */
export function getPaletteCapacity(): number {
  const stored = readJSON<number>(CAPACITY_KEY);
  if (typeof stored === 'number' && Number.isFinite(stored) && stored > 0) return Math.floor(stored);
  return getConfig().ui.defaultPaletteCapacity;
}

export function setPaletteCapacity(n: number): void {
  const v = Math.max(1, Math.floor(n));
  try { localStorage.setItem(CAPACITY_KEY, JSON.stringify(v)); } catch { /* ignore */ }
  notify();
}

// ── Constrain mode (Phase 3 surfaces the UI; the pref lives here now) ────────

/** When constrained, painting must use a palette slot (the custom colour picker
 *  is hidden). Off by default = today's freeform behaviour. */
export function isPaletteConstrained(): boolean {
  return readJSON<boolean>(CONSTRAIN_KEY) === true;
}

export function setPaletteConstrained(on: boolean): void {
  try { localStorage.setItem(CONSTRAIN_KEY, JSON.stringify(!!on)); } catch { /* ignore */ }
  notify();
}

// ── Recent-colour history ────────────────────────────────────────────────────
//
// Every colour committed to a slot (and every colour imported from a photo) is
// remembered here as a hex string, most-recent-first, deduped and capped. The
// palette manager surfaces it so an old colour can be re-added to a slot without
// re-picking it, and individual entries can be deleted.

const HISTORY_KEY = 'partwright.palette.history';

function readHistory(): string[] {
  const raw = readJSON<unknown[]>(HISTORY_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is string => typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s));
}

function writeHistory(list: string[]): void {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

/** Recent colours, most-recent-first. */
export function getColorHistory(): string[] {
  return readHistory();
}

/** Record a colour into history (deduped, most-recent-first, capped). Accepts
 *  any hex form; normalised to lower-case `#rrggbb`. No-op for malformed input. */
export function recordColor(hex: string): void {
  const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return;
  let h = m[1].toLowerCase();
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const norm = `#${h}`;
  const cap = getConfig().ui.paletteHistoryMax;
  const next = [norm, ...readHistory().filter(c => c !== norm)].slice(0, cap);
  writeHistory(next);
  notify();
}

/** Remove a single colour from history. */
export function removeColorHistory(hex: string): void {
  const norm = hex.toLowerCase();
  writeHistory(readHistory().filter(c => c !== norm));
  notify();
}

/** Clear the entire colour history. */
export function clearColorHistory(): void {
  writeHistory([]);
  notify();
}

// ── Active-palette indirection (forward-compat for collections, Phase 3) ─────

export interface Palette {
  id: string;
  name: string;
  capacity: number;
  slots: Filament[];
}

/** The active palette (slots + capacity), via the collections layer. */
export function getActivePalette(): Palette {
  const p = activePalette();
  return { id: p.id, name: p.name, capacity: getPaletteCapacity(), slots: listFilaments() };
}

// ── Named collections ────────────────────────────────────────────────────────

export interface PaletteSummary { id: string; name: string; active: boolean }

/** Give each slot a fresh id — used when creating/duplicating a palette so a
 *  region's `slotId` stays bound to the one palette it was painted under
 *  (switching palettes then surfaces the model's colours as off-palette, which
 *  the reconciliation tools resolve). */
function withFreshSlotIds(slots: Filament[]): Filament[] {
  return slots.map(s => ({ ...s, id: genId() }));
}

/** All palettes, with which one is active. */
export function listPalettes(): PaletteSummary[] {
  const c = loadCollections();
  return c.palettes.map(p => ({ id: p.id, name: p.name, active: p.id === c.activeId }));
}

export function getActivePaletteId(): string { return loadCollections().activeId; }
export function getActivePaletteName(): string { return activePalette().name; }

/** Switch the active palette. Fires a change so the paint swatches rebuild. */
export function setActivePalette(id: string): void {
  const c = loadCollections();
  if (c.activeId === id || !c.palettes.some(p => p.id === id)) return;
  c.activeId = id;
  saveCollections();
  notify();
}

/** Create a new palette and make it active. `slots` defaults to a copy of the
 *  current active palette's slots (a "Save as…"); pass `[]`-free defaults via
 *  the built-ins by passing `DEFAULT_FILAMENTS`. Slot ids are regenerated.
 *  Returns the new palette id. */
export function createPalette(name: string, slots?: Filament[]): string {
  const c = loadCollections();
  const id = `pal-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const src = slots ?? activePalette().slots;
  c.palettes.push({ id, name: name.trim() || 'Palette', slots: withFreshSlotIds(src) });
  c.activeId = id;
  saveCollections();
  notify();
  return id;
}

export function renamePalette(id: string, name: string): void {
  const p = loadCollections().palettes.find(q => q.id === id);
  if (!p) return;
  p.name = name.trim() || p.name;
  saveCollections();
  notify();
}

/** Delete a palette. Refuses to delete the last one; if the active palette is
 *  deleted, the first remaining one becomes active. */
export function deletePalette(id: string): void {
  const c = loadCollections();
  if (c.palettes.length <= 1) return;
  c.palettes = c.palettes.filter(p => p.id !== id);
  if (!c.palettes.some(p => p.id === c.activeId)) c.activeId = c.palettes[0].id;
  saveCollections();
  notify();
}

// ── Colour helpers ──────────────────────────────────────────────────────────

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  if (h.length !== 6 || Number.isNaN(n)) return [0, 0, 0];
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
  const c = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** The active palette's slot colours as 0–255 RGB triples, in slot order.
 *  Shared by the image-import flows ("constrain colours to palette"), which snap
 *  each pixel/cell to the nearest of these. */
export function listSlotRgb255(): [number, number, number][] {
  return load().map(f => {
    const [r, g, b] = hexToRgb(f.hex);
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  });
}

/** The active-palette slot nearest to an RGB (0–1) colour by Euclidean distance,
 *  or null if the palette is empty. Used to snap interactive painting onto the
 *  palette when constrain mode is on (see `setColor` enforcement in paintMode). */
export function nearestSlot(rgb: readonly [number, number, number]): Filament | null {
  const slots = load();
  if (slots.length === 0) return null;
  let best = slots[0];
  let bestD = Infinity;
  for (const s of slots) {
    const [r, g, b] = hexToRgb(s.hex);
    const d = (r - rgb[0]) ** 2 + (g - rgb[1]) ** 2 + (b - rgb[2]) ** 2;
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}

/** @internal Reset the in-memory cache so tests can re-read storage. */
export function __resetPaletteCacheForTests(): void {
  collectionsMem = null;
}
