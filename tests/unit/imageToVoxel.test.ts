import { describe, it, expect } from 'vitest';
import {
  imageDataToVoxelGrid,
  computeImageVoxelLayout,
  luminance,
  type ImageDataLike,
} from '../../src/import/imageToVoxel';

// Build a tiny ImageData-like from a 2D array of [r,g,b,a] pixels (row-major).
function img(rows: [number, number, number, number][][]): ImageDataLike {
  const h = rows.length;
  const w = rows[0].length;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const [r, g, b, a] = rows[y][x];
      data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = a;
    }
  }
  return { width: w, height: h, data };
}

const WHITE: [number, number, number, number] = [255, 255, 255, 255];
const BLACK: [number, number, number, number] = [0, 0, 0, 255];
const RED: [number, number, number, number] = [255, 0, 0, 255];
const CLEAR: [number, number, number, number] = [0, 0, 0, 0];

describe('luminance', () => {
  it('is 0 for black and 255 for white', () => {
    expect(luminance(0, 0, 0)).toBe(0);
    expect(luminance(255, 255, 255)).toBeCloseTo(255, 5);
  });
});

describe('imageDataToVoxelGrid — billboard (default / back-compat)', () => {
  it('makes one voxel per opaque pixel at depth 1', () => {
    const grid = imageDataToVoxelGrid(img([[RED, RED], [RED, RED]]));
    expect(grid.size).toBe(4);
    // Single layer along Y.
    expect(grid.bounds()).toEqual({ min: expect.any(Array), max: expect.any(Array) });
    const b = grid.bounds()!;
    expect(b.max[1] - b.min[1]).toBe(0); // depth 1 → flat in Y
  });

  it('drops pixels below the alpha threshold', () => {
    const grid = imageDataToVoxelGrid(img([[RED, CLEAR], [CLEAR, RED]]));
    expect(grid.size).toBe(2);
  });

  it('extrudes `depth` voxels along Y', () => {
    const grid = imageDataToVoxelGrid(img([[RED]]), { depth: 5 });
    expect(grid.size).toBe(5);
    const b = grid.bounds()!;
    expect(b.max[1] - b.min[1] + 1).toBe(5);
  });

  it('preserves the original pixel color', () => {
    const grid = imageDataToVoxelGrid(img([[RED]]));
    const b = grid.bounds()!;
    const c = grid.get(b.min[0], 0, b.min[2]);
    expect(c).toBe(0xff0000);
  });
});

describe('imageDataToVoxelGrid — heightmap', () => {
  it('maps brightness to column height (white tall, black short)', () => {
    // 1×2 image: top white, bottom black. base 0 so black contributes nothing.
    const grid = imageDataToVoxelGrid(img([[WHITE], [BLACK]]), {
      mode: 'heightmap', maxHeight: 10, baseThickness: 0,
    });
    // White column = 10 voxels, black column = 0.
    expect(grid.size).toBe(10);
  });

  it('invert raises dark pixels instead', () => {
    const grid = imageDataToVoxelGrid(img([[WHITE], [BLACK]]), {
      mode: 'heightmap', maxHeight: 10, baseThickness: 0, invert: true,
    });
    // Now black is tall, white is short → still 10 from the black column.
    expect(grid.size).toBe(10);
  });

  it('baseThickness keeps dark pixels present (printable)', () => {
    const grid = imageDataToVoxelGrid(img([[BLACK, BLACK]]), {
      mode: 'heightmap', maxHeight: 10, baseThickness: 2,
    });
    // Two black pixels, each base 2 (height contribution 0).
    expect(grid.size).toBe(4);
  });
});

describe('imageDataToVoxelGrid — color modes', () => {
  it('grayscale replaces color with luminance', () => {
    const grid = imageDataToVoxelGrid(img([[RED]]), { colorMode: 'grayscale' });
    const b = grid.bounds()!;
    const lum = Math.round(luminance(255, 0, 0)); // 76
    expect(grid.get(b.min[0], 0, b.min[2])).toBe((lum << 16) | (lum << 8) | lum);
  });

  it('flat paints every voxel the chosen color', () => {
    const grid = imageDataToVoxelGrid(img([[RED, WHITE]]), {
      colorMode: 'flat', flatColor: [10, 20, 30],
    });
    const want = (10 << 16) | (20 << 8) | 30;
    let allFlat = true;
    grid.forEach((_x, _y, _z, c) => { if (c !== want) allFlat = false; });
    expect(allFlat).toBe(true);
  });
});

describe('image adjustments + posterize + background', () => {
  const GREEN: [number, number, number, number] = [0, 200, 0, 255];

  it('gamma > 1 lowers heightmap heights for a midtone', () => {
    const mid: [number, number, number, number] = [128, 128, 128, 255];
    const linear = imageDataToVoxelGrid(img([[mid]]), { mode: 'heightmap', maxHeight: 100, baseThickness: 0 });
    const gammad = imageDataToVoxelGrid(img([[mid]]), { mode: 'heightmap', maxHeight: 100, baseThickness: 0, gamma: 2 });
    // pow(0.5, 2) = 0.25 → ~25 vs ~50.
    expect(gammad.size).toBeLessThan(linear.size);
  });

  it('brightness raises a pixel above the heightmap floor', () => {
    const dark: [number, number, number, number] = [10, 10, 10, 255];
    const plain = imageDataToVoxelGrid(img([[dark]]), { mode: 'heightmap', maxHeight: 20, baseThickness: 0 });
    const brighter = imageDataToVoxelGrid(img([[dark]]), { mode: 'heightmap', maxHeight: 20, baseThickness: 0, brightness: 0.8 });
    expect(brighter.size).toBeGreaterThan(plain.size);
  });

  it('posterize collapses many colors to a small palette', () => {
    // A row of distinct reddish/greenish shades; posterize to 2 → ≤2 colors.
    const rows: [number, number, number, number][][] = [[
      [200, 0, 0, 255], [210, 10, 0, 255], [0, 200, 0, 255], [0, 210, 10, 255],
    ]];
    const grid = imageDataToVoxelGrid(img(rows), { posterizeColors: 2 });
    const colors = new Set<number>();
    grid.forEach((_x, _y, _z, c) => colors.add(c));
    expect(colors.size).toBeLessThanOrEqual(2);
  });

  it('removeBackground drops a uniform border color', () => {
    // 3×3 white border with a green center pixel.
    const W: [number, number, number, number] = [255, 255, 255, 255];
    const rows: [number, number, number, number][][] = [
      [W, W, W],
      [W, GREEN, W],
      [W, W, W],
    ];
    const grid = imageDataToVoxelGrid(img(rows), { removeBackground: true });
    // Only the non-white center survives.
    expect(grid.size).toBe(1);
  });

  it('default options still reproduce the plain billboard (back-compat)', () => {
    const image = img([[RED, CLEAR], [RED, RED]]);
    const a = imageDataToVoxelGrid(image);
    const b = imageDataToVoxelGrid(image, {
      gamma: 1, brightness: 0, contrast: 0, saturation: 0, posterizeColors: 0, removeBackground: false,
    });
    expect(a.size).toBe(3);
    expect(b.size).toBe(3);
  });
});

describe('computeImageVoxelLayout', () => {
  it('voxelCount equals the sum of column heights (no overlaps)', () => {
    const image = img([[WHITE, BLACK], [RED, WHITE]]);
    const layout = computeImageVoxelLayout(image, { mode: 'heightmap', maxHeight: 8, baseThickness: 1 });
    const grid = imageDataToVoxelGrid(image, { mode: 'heightmap', maxHeight: 8, baseThickness: 1 });
    expect(layout.voxelCount).toBe(grid.size);
    const summed = layout.columns.reduce((n, c) => n + c.height, 0);
    expect(layout.voxelCount).toBe(summed);
  });

  it('reports the bounding-box dims of produced voxels', () => {
    const layout = computeImageVoxelLayout(img([[RED, RED], [RED, RED]]), { depth: 3 });
    expect(layout.dims).toEqual({ x: 2, y: 3, z: 2 });
  });

  it('returns nothing for a fully transparent image', () => {
    const layout = computeImageVoxelLayout(img([[CLEAR, CLEAR]]));
    expect(layout.voxelCount).toBe(0);
    expect(layout.columns).toHaveLength(0);
    expect(layout.dims).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('downsamples so the longest side fits maxSize', () => {
    // 8×4 opaque image, maxSize 4 → 4×2 grid → 8 columns.
    const rows = Array.from({ length: 4 }, () => Array.from({ length: 8 }, () => RED));
    const layout = computeImageVoxelLayout(img(rows), { maxSize: 4 });
    expect(layout.tw).toBe(4);
    expect(layout.th).toBe(2);
    expect(layout.columns).toHaveLength(8);
  });
});
