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

// In-memory mirror — the live copy when localStorage is unavailable (SSR /
// private mode / tests), and a cache otherwise so reads don't re-parse JSON.
let slotsMem: Filament[] | null = null;

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

/** Load the ordered slot list, migrating legacy relief data on first access. */
function load(): Filament[] {
  if (slotsMem) return slotsMem;
  const stored = readJSON<unknown[]>(PALETTE_KEY);
  if (stored && Array.isArray(stored)) {
    slotsMem = stored.filter(isValidFilament);
    return slotsMem;
  }
  // First run (or unavailable storage): seed from legacy relief data, else
  // the built-in defaults, and persist so order is stable from here on.
  const seed = legacyEffective();
  slotsMem = seed.length > 0 ? seed : DEFAULT_FILAMENTS.map(f => ({ ...f }));
  save(slotsMem);
  return slotsMem;
}

function save(list: Filament[]): void {
  slotsMem = list;
  try {
    localStorage.setItem(PALETTE_KEY, JSON.stringify(list));
  } catch {
    /* keep the in-memory copy as the live source */
  }
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

// ── Active-palette indirection (forward-compat for collections, Phase 3) ─────

export interface Palette {
  id: string;
  name: string;
  capacity: number;
  slots: Filament[];
}

/** The active palette. PR 1 ships exactly one ("Default"); the indirection lets
 *  Phase 3 add named collections without touching callers or region data. */
export function getActivePalette(): Palette {
  return { id: 'default', name: 'Default', capacity: getPaletteCapacity(), slots: listFilaments() };
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

/** @internal Reset the in-memory cache so tests can re-read storage. */
export function __resetPaletteCacheForTests(): void {
  slotsMem = null;
}
