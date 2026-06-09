import { describe, it, expect } from 'vitest';
import { sampleImageToGrid } from '../../src/relief/imageToRelief';
import { DEFAULT_RELIEF_OPTIONS, type ReliefOptions } from '../../src/relief/types';

// Minimal ImageData-like from a 2D array of [r,g,b] pixels (alpha forced opaque).
function img(rows: [number, number, number][][]): ImageData {
  const h = rows.length;
  const w = rows[0].length;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = rows[y][x];
      const o = (y * w + x) * 4;
      data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255;
    }
  }
  return { width: w, height: h, data } as ImageData;
}

function quantizedOpts(over: Partial<ReliefOptions['quantized']>): ReliefOptions {
  const o = structuredClone(DEFAULT_RELIEF_OPTIONS);
  o.mode = 'quantized';
  o.common.resolution = 8; // keep the grid tiny + exact
  o.common.smoothing = 0;
  Object.assign(o.quantized, over);
  return o;
}

function distinctColors(grid: { colors?: Uint8Array }): Set<string> {
  const set = new Set<string>();
  const c = grid.colors!;
  for (let i = 0; i < c.length; i += 3) set.add(`${c[i]},${c[i + 1]},${c[i + 2]}`);
  return set;
}

describe('relief "constrain to filament palette" (fixedPalette)', () => {
  // A 4×4 split: left half pure red, right half pure blue.
  const red: [number, number, number] = [220, 30, 30];
  const blue: [number, number, number] = [30, 30, 220];
  const rows = Array.from({ length: 4 }, () =>
    ([red, red, blue, blue] as [number, number, number][]));

  it('snaps every cell to a member of the fixed palette', () => {
    const grid = sampleImageToGrid(img(rows), quantizedOpts({
      fixedPalette: [[255, 0, 0], [0, 0, 255]],
    }));
    const colors = distinctColors(grid);
    // Output colours are exactly palette members — nothing else.
    for (const c of colors) expect(['255,0,0', '0,0,255']).toContain(c);
  });

  it('ignores the cluster count — palette size drives the colour set', () => {
    const grid = sampleImageToGrid(img(rows), quantizedOpts({
      clusters: 12, // would normally try for 12 clusters; fixed palette wins
      fixedPalette: [[255, 0, 0], [0, 0, 255]],
    }));
    expect(distinctColors(grid).size).toBeLessThanOrEqual(2);
  });

  it('keeps both palette colours present (red and blue regions both survive)', () => {
    const grid = sampleImageToGrid(img(rows), quantizedOpts({
      fixedPalette: [[255, 0, 0], [0, 0, 255]],
    }));
    const colors = distinctColors(grid);
    expect(colors.has('255,0,0')).toBe(true);
    expect(colors.has('0,0,255')).toBe(true);
  });

  it('falls back to k-means clustering when no fixed palette is set', () => {
    const grid = sampleImageToGrid(img(rows), quantizedOpts({ clusters: 2 }));
    const colors = distinctColors(grid);
    // Clustered reps are the mean sRGB of members — the actual source colours,
    // NOT the pure primaries the fixed palette would force.
    expect(colors.has('255,0,0')).toBe(false);
    expect(colors.size).toBeGreaterThan(0);
  });
});
