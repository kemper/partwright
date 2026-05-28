// localStorage-backed filament library for the Relief Studio optical preview.
// Deliberately separate from the IndexedDB session schema so it needs no
// migration — the filament palette is a cross-session user preference.

import type { Filament } from './types';

export type { Filament };

const STORAGE_KEY = 'partwright.filaments';
const HIDDEN_KEY = 'partwright.filaments.hidden';

export const DEFAULT_FILAMENTS: Filament[] = [
  { id: 'def-white', name: 'White', hex: '#f5f5f0', td: 3 },
  { id: 'def-black', name: 'Black', hex: '#181818', td: 0.4 },
  { id: 'def-red', name: 'Red', hex: '#c02525', td: 1.2 },
  { id: 'def-yellow', name: 'Yellow', hex: '#e8c024', td: 2 },
  { id: 'def-blue', name: 'Blue', hex: '#2452c0', td: 1 },
  { id: 'def-gray', name: 'Gray', hex: '#808080', td: 0.8 },
];

// In-memory fallback when localStorage is unavailable (SSR / private mode / tests).
let memoryStore: Filament[] = [];
let memoryHidden: string[] = [];

function readHidden(): string[] {
  if (memoryHidden.length > 0) return memoryHidden;
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

function writeHidden(list: string[]): void {
  memoryHidden = list;
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(list));
    memoryHidden = [];
  } catch {
    /* keep the in-memory copy */
  }
}

function readUser(): Filament[] {
  if (memoryStore.length > 0) return memoryStore;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (f): f is Filament =>
        f && typeof f.id === 'string' && typeof f.name === 'string' && typeof f.hex === 'string' && typeof f.td === 'number',
    );
  } catch {
    return [];
  }
}

function writeUser(list: Filament[]): void {
  memoryStore = list;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    // Persisted successfully — localStorage is the source of truth, so the
    // memory copy is only a fallback and can be released.
    memoryStore = [];
  } catch {
    // Keep memoryStore as the live copy for this session.
  }
}

export function listFilaments(): Filament[] {
  const user = readUser();
  const seen = new Set(user.map(f => f.id));
  const hidden = new Set(readHidden());
  return [
    ...DEFAULT_FILAMENTS.filter(f => !seen.has(f.id) && !hidden.has(f.id)),
    ...user,
  ];
}

export function addFilament(f: Omit<Filament, 'id'>): Filament {
  const filament: Filament = { ...f, id: `fil-${Date.now()}-${Math.floor(Math.random() * 1e6)}` };
  writeUser([...readUser(), filament]);
  return filament;
}

export function removeFilament(id: string): void {
  // Default filaments aren't "in" the user list — removing one from the user
  // store would do nothing visible (the default re-prepends every render).
  // Persist hidden defaults in a parallel list so the × actually sticks.
  const defaultIds = new Set(DEFAULT_FILAMENTS.map(f => f.id));
  if (defaultIds.has(id)) {
    const hidden = readHidden();
    if (!hidden.includes(id)) writeHidden([...hidden, id]);
    return;
  }
  writeUser(readUser().filter(f => f.id !== id));
}

/** Restore a previously-hidden default filament. */
export function restoreDefaultFilament(id: string): void {
  const hidden = readHidden();
  if (hidden.includes(id)) writeHidden(hidden.filter(s => s !== id));
}

/** Apply a partial update to a colour. Default colours are promoted to user
 *  entries (keeping the same id), so their listFilaments slot is replaced by
 *  the edited version on next render. */
export function updateFilament(id: string, patch: Partial<Omit<Filament, 'id'>>): void {
  const user = readUser();
  const userIdx = user.findIndex(f => f.id === id);
  if (userIdx >= 0) {
    user[userIdx] = { ...user[userIdx], ...patch };
    writeUser(user);
    return;
  }
  const def = DEFAULT_FILAMENTS.find(f => f.id === id);
  if (def) writeUser([...user, { ...def, ...patch }]);
}

/** Reorder the visible palette by promoting every default to a user entry in
 *  the requested order, replacing the user list. Hides any unlisted defaults.
 *  Called by the studio's up/down reorder controls. */
export function reorderFilaments(orderedIds: string[]): void {
  const all = listFilaments();
  const byId = new Map(all.map(f => [f.id, f]));
  const next: Filament[] = [];
  for (const id of orderedIds) {
    const f = byId.get(id);
    if (f) next.push(f);
  }
  writeUser(next);
  // Hide any defaults not present in the new order so they don't re-prepend.
  const presentDefaults = new Set(next.map(f => f.id));
  const defaultIds = DEFAULT_FILAMENTS.map(f => f.id);
  const newHidden = defaultIds.filter(id => !presentDefaults.has(id));
  writeHidden(newHidden);
}

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  if (h.length !== 6 || Number.isNaN(n)) return [0, 0, 0];
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
  const c = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
