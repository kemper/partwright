import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_FILAMENTS,
  listFilaments,
  addFilament,
  updateFilament,
  removeFilament,
  reorderFilaments,
  resetPalette,
  getSlotById,
  slotOrderIndex,
  getPaletteCapacity,
  setPaletteCapacity,
  isPaletteConstrained,
  setPaletteConstrained,
  getActivePalette,
  listPalettes,
  setActivePalette,
  createPalette,
  renamePalette,
  deletePalette,
  getActivePaletteId,
  getActivePaletteName,
  getColorHistory,
  recordColor,
  removeColorHistory,
  clearColorHistory,
  hexToRgb,
  rgbToHex,
  listSlotRgb255,
  nearestSlot,
  __resetPaletteCacheForTests,
} from '../../src/color/palette';

// jsdom isn't configured for the unit tier (node env), so stub a minimal
// localStorage so the module exercises its persistence path rather than the
// in-memory fallback.
function installLocalStorage(): void {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  } as Storage;
}

beforeEach(() => {
  installLocalStorage();
  localStorage.clear();
  __resetPaletteCacheForTests();
});

describe('palette: defaults and migration', () => {
  it('seeds the built-in defaults on first read', () => {
    const slots = listFilaments();
    expect(slots.map(s => s.id)).toEqual(DEFAULT_FILAMENTS.map(s => s.id));
  });

  it('migrates a legacy relief filament library in order', () => {
    localStorage.setItem('partwright.filaments', JSON.stringify([
      { id: 'mine', name: 'Mine', hex: '#123456', td: 2 },
    ]));
    localStorage.setItem('partwright.filaments.hidden', JSON.stringify(['def-gray']));
    __resetPaletteCacheForTests();
    const ids = listFilaments().map(s => s.id);
    // Defaults (minus hidden) first, then the user filament.
    expect(ids).toContain('mine');
    expect(ids).not.toContain('def-gray');
    expect(ids[ids.length - 1]).toBe('mine');
  });
});

describe('palette: CRUD preserves order and identity', () => {
  it('adds a slot with a unique id', () => {
    const before = listFilaments().length;
    const f = addFilament({ name: 'Teal', hex: '#00aabb', td: 1 });
    expect(f.id).toMatch(/^fil-/);
    expect(listFilaments().length).toBe(before + 1);
    expect(getSlotById(f.id)?.name).toBe('Teal');
  });

  it('updates a slot in place without reordering', () => {
    const target = listFilaments()[2];
    updateFilament(target.id, { hex: '#ffffff', name: 'Snow' });
    expect(slotOrderIndex(target.id)).toBe(2);
    expect(getSlotById(target.id)).toMatchObject({ hex: '#ffffff', name: 'Snow' });
  });

  it('removes a slot', () => {
    const target = listFilaments()[0];
    removeFilament(target.id);
    expect(getSlotById(target.id)).toBeNull();
  });

  it('reorders by id and appends any omitted ids', () => {
    const ids = listFilaments().map(s => s.id);
    const reversedFirstTwo = [ids[1], ids[0]];
    reorderFilaments(reversedFirstTwo);
    const after = listFilaments().map(s => s.id);
    expect(after[0]).toBe(ids[1]);
    expect(after[1]).toBe(ids[0]);
    expect(after.length).toBe(ids.length); // omitted ids appended
  });

  it('resets to defaults', () => {
    addFilament({ name: 'Extra', hex: '#010203', td: 1 });
    resetPalette();
    expect(listFilaments().map(s => s.id)).toEqual(DEFAULT_FILAMENTS.map(s => s.id));
  });
});

describe('palette: capacity and constrain prefs', () => {
  it('defaults capacity to the app config value and persists overrides', () => {
    expect(getPaletteCapacity()).toBe(4);
    setPaletteCapacity(8);
    expect(getPaletteCapacity()).toBe(8);
  });

  it('persists the constrain flag (default off)', () => {
    expect(isPaletteConstrained()).toBe(false);
    setPaletteConstrained(true);
    expect(isPaletteConstrained()).toBe(true);
  });
});

describe('palette: active-palette indirection', () => {
  it('exposes the slots + capacity as one Palette', () => {
    setPaletteCapacity(3);
    const p = getActivePalette();
    expect(p.id).toBe('default');
    expect(p.capacity).toBe(3);
    expect(p.slots.length).toBe(DEFAULT_FILAMENTS.length);
  });
});

describe('palette: named collections', () => {
  it('starts with a single active Default palette', () => {
    const pals = listPalettes();
    expect(pals).toHaveLength(1);
    expect(pals[0]).toMatchObject({ name: 'Default', active: true });
    expect(getActivePaletteName()).toBe('Default');
  });

  it('creates a palette (active) with fresh slot ids and isolated edits', () => {
    const defaultIds = listFilaments().map(s => s.id);
    const id = createPalette('Minis', DEFAULT_FILAMENTS.map(f => ({ ...f })));
    expect(getActivePaletteId()).toBe(id);
    expect(listPalettes()).toHaveLength(2);
    // Fresh slot ids — not shared with the Default palette.
    const newIds = listFilaments().map(s => s.id);
    expect(newIds.some(x => defaultIds.includes(x))).toBe(false);
    // Editing the active palette doesn't touch the other.
    addFilament({ name: 'Extra', hex: '#010203', td: 1 });
    expect(listFilaments()).toHaveLength(DEFAULT_FILAMENTS.length + 1);
  });

  it('switches the active palette', () => {
    const first = getActivePaletteId();
    const id = createPalette('Other');
    setActivePalette(first);
    expect(getActivePaletteId()).toBe(first);
    setActivePalette(id);
    expect(getActivePaletteId()).toBe(id);
  });

  it('renames a palette', () => {
    renamePalette(getActivePaletteId(), 'Renamed');
    expect(getActivePaletteName()).toBe('Renamed');
  });

  it('deletes a palette but refuses the last one', () => {
    const id = createPalette('Throwaway');
    deletePalette(id);
    expect(listPalettes().some(p => p.id === id)).toBe(false);
    // Now down to one — deleting it is a no-op.
    const lone = getActivePaletteId();
    deletePalette(lone);
    expect(listPalettes()).toHaveLength(1);
  });
});

describe('palette: colour history', () => {
  beforeEach(() => clearColorHistory());

  it('records colours most-recent-first, normalised and deduped', () => {
    recordColor('#FF0000');
    recordColor('#00ff00');
    recordColor('#abc'); // shorthand expands
    expect(getColorHistory()).toEqual(['#aabbcc', '#00ff00', '#ff0000']);
    // Re-recording moves it to the front without duplicating.
    recordColor('#ff0000');
    expect(getColorHistory()).toEqual(['#ff0000', '#aabbcc', '#00ff00']);
  });

  it('ignores malformed colours', () => {
    recordColor('not-a-color');
    expect(getColorHistory()).toEqual([]);
  });

  it('removes a single entry and clears all', () => {
    recordColor('#111111');
    recordColor('#222222');
    removeColorHistory('#111111');
    expect(getColorHistory()).toEqual(['#222222']);
    clearColorHistory();
    expect(getColorHistory()).toEqual([]);
  });

  it('caps history at the configured maximum', () => {
    for (let i = 0; i < 60; i++) recordColor(`#0000${(i % 100).toString().padStart(2, '0')}`);
    expect(getColorHistory().length).toBeLessThanOrEqual(48);
  });
});

describe('palette: colour helpers', () => {
  it('round-trips rgb <-> hex', () => {
    expect(rgbToHex([1, 0, 0])).toBe('#ff0000');
    expect(hexToRgb('#ff0000')).toEqual([1, 0, 0]);
    // 3-digit shorthand
    expect(hexToRgb('#0f0')).toEqual([0, 1, 0]);
    // round-trip a mid value
    const hex = rgbToHex([0.5, 0.25, 0.75]);
    const back = hexToRgb(hex);
    expect(back[0]).toBeCloseTo(0.5, 1);
    expect(back[2]).toBeCloseTo(0.75, 1);
  });

  it('falls back to black on malformed hex', () => {
    expect(hexToRgb('nope')).toEqual([0, 0, 0]);
  });
});

describe('palette: import-constrain helpers', () => {
  it('listSlotRgb255 returns the active slots as 0–255 triples in order', () => {
    resetPalette();
    const rgb = listSlotRgb255();
    expect(rgb.length).toBe(DEFAULT_FILAMENTS.length);
    // First default is White (#f5f5f0).
    expect(rgb[0]).toEqual([0xf5, 0xf5, 0xf0]);
    // Second is Black (#181818).
    expect(rgb[1]).toEqual([0x18, 0x18, 0x18]);
  });

  it('nearestSlot snaps an RGB (0–1) colour to the closest slot', () => {
    resetPalette();
    // Pure red is closest to the Red slot (#c02525), not White/Black/etc.
    const slot = nearestSlot([1, 0, 0]);
    expect(slot?.id).toBe('def-red');
    // Near-white snaps to White.
    expect(nearestSlot([0.96, 0.96, 0.94])?.id).toBe('def-white');
  });

  it('nearestSlot returns null for an empty palette', () => {
    // Drain every slot (removeFilament refuses nothing here).
    for (const f of listFilaments()) removeFilament(f.id);
    expect(listFilaments().length).toBe(0);
    expect(nearestSlot([0.5, 0.5, 0.5])).toBeNull();
  });
});
