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

export function listFilaments(): Filament[] {
  const user = readUser();
  const seen = new Set(user.map(f => f.id));
  const hidden = new Set(readHidden());
  return [
    ...DEFAULT_FILAMENTS.filter(f => !seen.has(f.id) && !hidden.has(f.id)),
    ...user,
  ];
}

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  if (h.length !== 6 || Number.isNaN(n)) return [0, 0, 0];
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

