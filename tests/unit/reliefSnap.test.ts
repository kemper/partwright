import { describe, it, expect } from 'vitest';
import { sampleImageToGrid } from '../../src/relief/imageToRelief';
import { DEFAULT_RELIEF_OPTIONS, type ReliefOptions } from '../../src/relief/types';
import type { ImageDataLike } from '../../src/import/imageToVoxel';

// Build a tiny ImageData-like from a 2D array of [r,g,b,a] pixels (row-major).
function img(rows: [number, number, number, number][][]): ImageDataLike {
  const h = rows.length;
  const w = rows[0].length;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = rows[y][x];
      const i = (y * w + x) * 4;
      data[i] = p[0]; data[i + 1] = p[1]; data[i + 2] = p[2]; data[i + 3] = p[3];
    }
  }
  return { width: w, height: h, data };
}

const RED: [number, number, number, number] = [220, 20, 20, 255];
const BLUE: [number, number, number, number] = [20, 20, 220, 255];

function quantizedOpts(snap: [number, number, number][] | null): ReliefOptions {
  const opts: ReliefOptions = structuredClone(DEFAULT_RELIEF_OPTIONS);
  opts.mode = 'quantized';
  opts.quantized.clusters = 2;
  opts.quantized.snapPalette = snap;
  return opts;
}

describe('relief quantized — constrain to filament palette', () => {
  it('snaps every cluster colour to the nearest palette entry', () => {
    const image = img([[RED, BLUE], [RED, BLUE]]);
    const grid = sampleImageToGrid(image, quantizedOpts([[0, 0, 0], [255, 255, 255]]));
    expect(grid.colors).toBeTruthy();
    const colors = grid.colors!;
    expect(colors.length).toBeGreaterThan(0);
    for (let i = 0; i < colors.length; i += 3) {
      const c = `${colors[i]},${colors[i + 1]},${colors[i + 2]}`;
      expect(['0,0,0', '255,255,255']).toContain(c); // only palette colours survive
    }
  });

  it('keeps the raw cluster colours when the constraint is off', () => {
    const image = img([[RED, BLUE], [RED, BLUE]]);
    const grid = sampleImageToGrid(image, quantizedOpts(null));
    const colors = grid.colors!;
    // At least one cell keeps a vivid (non black/white) cluster colour.
    let sawVivid = false;
    for (let i = 0; i < colors.length; i += 3) {
      const r = colors[i], g = colors[i + 1], b = colors[i + 2];
      if ((r > 100 || b > 100) && g < 100) sawVivid = true;
    }
    expect(sawVivid).toBe(true);
  });
});
