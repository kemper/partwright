// localStorage-backed filament library for the Relief Studio optical preview.
// Deliberately separate from the IndexedDB session schema so it needs no
// migration — the filament palette is a cross-session user preference.

import type { Filament } from './types';

export type { Filament };

const STORAGE_KEY = 'partwright.filaments';

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
  return [...DEFAULT_FILAMENTS.filter(f => !seen.has(f.id)), ...user];
}

export function addFilament(f: Omit<Filament, 'id'>): Filament {
  const filament: Filament = { ...f, id: `fil-${Date.now()}-${Math.floor(Math.random() * 1e6)}` };
  writeUser([...readUser(), filament]);
  return filament;
}

export function removeFilament(id: string): void {
  writeUser(readUser().filter(f => f.id !== id));
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
