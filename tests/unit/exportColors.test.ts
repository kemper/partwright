import { describe, it, expect } from 'vitest';
import type { MeshData } from '../../src/geometry/types';
import {
  collectExportColors, suggestColorMerges, applyColorRemap, normalizeColorRemap,
  composeColorRemaps, countRemappedColors, colorDistance, normalizeHex,
} from '../../src/export/exportColors';
import { isPainted } from '../../src/color/regions';
import { DEFAULT_COLOR_HEX, triColorHex } from '../../src/export/meshClean';

/** A mesh of `hexes.length` disjoint triangles, one colour each (null = unpainted). */
function mesh(hexes: (string | null)[]): MeshData {
  const n = hexes.length;
  const vertProperties = new Float32Array(n * 9);
  const triVerts = new Uint32Array(n * 3);
  for (let t = 0; t < n; t++) {
    vertProperties.set([t, 0, 0, t + 1, 0, 0, t, 1, 0], t * 9);
    triVerts.set([t * 3, t * 3 + 1, t * 3 + 2], t * 3);
  }
  const tc = new Uint8Array(n * 3);
  const painted = new Uint8Array(n);
  hexes.forEach((h, t) => {
    if (!h) return;
    const v = h.replace('#', '');
    tc.set([parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)], t * 3);
    painted[t] = 1;
  });
  (tc as Uint8Array & { _painted?: Uint8Array })._painted = painted;
  return { vertProperties, triVerts, numVert: n * 3, numTri: n, numProp: 3, triColors: tc } as MeshData;
}

const rep = (h: string, k: number) => Array<string>(k).fill(h);

// The Tsubasa figure that motivated this: 11 painted colours, ~5 visible ones.
const TSUBASA = [
  ...rep('#1f1712', 30), // hair
  ...rep('#f7c095', 20), // skin
  ...rep('#f7f7f4', 9),  // shirt + socks
  ...rep('#1b1b1b', 8),  // shoes
  ...rep('#f2f2ef', 5),  // shorts
  ...rep('#f7f7f7', 4),  // ball
  ...rep('#1d2b63', 2),  // logo + sockband
  ...rep('#2a1d15', 1),  // brows
  ...rep('#3f7a3a', 6),  // base
  ...rep('#0f0f0f', 1),  // ball panels
  ...rep('#0d0d0d', 1),  // eyes
];

describe('exportColors', () => {
  it('normalizes hex strings', () => {
    expect(normalizeHex('#AABBCC')).toBe('#aabbcc');
    expect(normalizeHex('aabbcc')).toBe('#aabbcc');
    expect(normalizeHex('#abc')).toBeNull();
    expect(normalizeHex('red')).toBeNull();
  });

  it('collects distinct colours most-used first, with shares', () => {
    const colors = collectExportColors([mesh(TSUBASA)]);
    expect(colors).toHaveLength(11);
    expect(colors[0]).toMatchObject({ hex: '#1f1712', triangles: 30 });
    expect(colors.reduce((s, c) => s + c.share, 0)).toBeCloseTo(1, 6);
  });

  it('returns [] for an unpainted model and flags unpainted faces on a painted one', () => {
    expect(collectExportColors([mesh([null, null])])).toEqual([]);
    const colors = collectExportColors([mesh(['#ff0000', null, null])]);
    const def = colors.find(c => c.hex === DEFAULT_COLOR_HEX);
    expect(def).toMatchObject({ triangles: 2, unpainted: true });
    expect(colors.find(c => c.hex === '#ff0000')?.unpainted).toBeUndefined();
  });

  it('sums across meshes and skips meshes without colour data', () => {
    const plain = mesh(['#000000']);
    delete (plain as { triColors?: Uint8Array }).triColors;
    const colors = collectExportColors([mesh(['#ff0000']), mesh(['#ff0000', '#00ff00']), plain]);
    expect(colors).toEqual([
      { hex: '#ff0000', triangles: 2, share: 2 / 3 },
      { hex: '#00ff00', triangles: 1, share: 1 / 3 },
    ]);
  });

  it('colorDistance is ~0 for equal colours and large for black vs white', () => {
    expect(colorDistance('#123456', '#123456')).toBeCloseTo(0, 6);
    expect(colorDistance('#000000', '#ffffff')).toBeGreaterThan(99);
  });

  it('tolerance 0 suggests no merges', () => {
    expect(suggestColorMerges(collectExportColors([mesh(TSUBASA)]), { tolerance: 0 })).toEqual({});
  });

  it('collapses near-identical blacks and whites into the most-used shade', () => {
    const colors = collectExportColors([mesh(TSUBASA)]);
    const remap = suggestColorMerges(colors, { tolerance: 10 });
    for (const dark of ['#1b1b1b', '#2a1d15', '#0f0f0f', '#0d0d0d']) expect(remap[dark]).toBe('#1f1712');
    for (const white of ['#f2f2ef', '#f7f7f7']) expect(remap[white]).toBe('#f7f7f4');
    // Hue-distinct colours survive: dark, skin, white, navy, green.
    expect(countRemappedColors(colors, remap)).toBe(5);
    expect(remap['#1d2b63']).toBeUndefined();
    expect(remap['#3f7a3a']).toBeUndefined();
  });

  it('maxColors folds the least-used colours into their nearest kept colour', () => {
    const colors = collectExportColors([mesh(TSUBASA)]);
    const remap = suggestColorMerges(colors, { tolerance: 10, maxColors: 4 });
    expect(countRemappedColors(colors, remap)).toBe(4);
    // Navy (least used after merging) is the one folded away.
    expect(remap['#1d2b63']).toBeDefined();
    expect(remap['#1d2b63']).not.toBe('#1d2b63');
    const one = suggestColorMerges(colors, { maxColors: 1 });
    expect(countRemappedColors(colors, one)).toBe(1);
  });

  it('normalizeColorRemap validates, lowercases and collapses chains', () => {
    expect(normalizeColorRemap({ '#AA0000': '#BB0000', '#bb0000': '#cc0000', '#dd0000': '#DD0000' }))
      .toEqual({ '#aa0000': '#cc0000', '#bb0000': '#cc0000' });
    expect(normalizeColorRemap({ red: '#000000' })).toHaveProperty('error');
    expect(normalizeColorRemap({ '#000000': 'nope' })).toHaveProperty('error');
    expect(normalizeColorRemap({ '#000000': '#ffffff', '#ffffff': '#000000' })).toHaveProperty('error');
  });

  it('composeColorRemaps applies the second remap after the first', () => {
    expect(composeColorRemaps({ '#000001': '#000002' }, { '#000002': '#000003', '#000004': '#000005' }))
      .toEqual({ '#000001': '#000003', '#000002': '#000003', '#000004': '#000005' });
  });

  it('composeColorRemaps lets an explicit entry override where the auto-merge sent a colour', () => {
    // #1b1b1b was auto-merged into #1f1712, but the caller recolours #1b1b1b itself.
    expect(composeColorRemaps({ '#1b1b1b': '#1f1712' }, { '#1b1b1b': '#ff0000' }))
      .toEqual({ '#1b1b1b': '#ff0000' });
  });

  it('applyColorRemap rewrites the copy, keeps the source, and paints remapped defaults', () => {
    const src = mesh(['#0d0d0d', '#1f1712', null]);
    const before = Uint8Array.from(src.triColors!);
    const out = applyColorRemap(src, { '#0d0d0d': '#1f1712', [DEFAULT_COLOR_HEX]: '#ff0000' });
    expect(out).not.toBe(src);
    expect(Array.from(src.triColors!)).toEqual(Array.from(before));
    expect([0, 1, 2].map(t => triColorHex(out.triColors!, t))).toEqual(['#1f1712', '#1f1712', '#ff0000']);
    expect(isPainted(out.triColors!, 2)).toBe(true);
    expect(collectExportColors([out]).map(c => c.hex)).toEqual(['#1f1712', '#ff0000']);
  });

  it('applyColorRemap is a no-op without a remap or colours', () => {
    const src = mesh(['#ff0000']);
    expect(applyColorRemap(src, {})).toBe(src);
    expect(applyColorRemap(src, { '#00ff00': '#0000ff' })).toBe(src);
  });
});
