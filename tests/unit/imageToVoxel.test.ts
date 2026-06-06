import { describe, it, expect } from 'vitest';
import {
  imageDataToVoxelGrid,
  computeImageVoxelLayout,
  generateVoxelImportCode,
  extractImagePalette,
  countVoxelBuilderCalls,
  luminance,
  type ImageDataLike,
} from '../../src/import/imageToVoxel';
import { VoxelGrid, decodeGrid, normalizeColor } from '../../src/geometry/voxel/grid';

/** Execute generated voxel editor code against a minimal sandbox `api`, exactly
 *  as the voxel engine does, and return the grid it builds. */
function runVoxelCode(code: string): VoxelGrid {
  const voxels = (() => new VoxelGrid()) as unknown as {
    (): VoxelGrid;
    decode: (d: string) => VoxelGrid;
    color: (c: unknown) => number;
  };
  voxels.decode = (d: string) => decodeGrid(d);
  voxels.color = (c) => normalizeColor(c as never);
  const fn = new Function('api', `"use strict";\n${code}`);
  return fn({ voxels, VoxelGrid }) as VoxelGrid;
}

/** True when two grids occupy the same cells with the same colors. */
function gridsEqual(a: VoxelGrid, b: VoxelGrid): boolean {
  if (a.size !== b.size) return false;
  let ok = true;
  a.forEach((x, y, z, c) => { if (b.get(x, y, z) !== c) ok = false; });
  return ok;
}

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

describe('fixed palette (snap to nearest)', () => {
  const BLUE: [number, number, number, number] = [0, 0, 255, 255];

  it('snaps every pixel to the single palette entry', () => {
    const grid = imageDataToVoxelGrid(img([[RED, BLUE]]), { palette: [[10, 200, 10]] });
    expect(grid.size).toBe(2);
    const colors = new Set<number>();
    grid.forEach((_x, _y, _z, c) => colors.add(c));
    expect(colors).toEqual(new Set([0x0ac80a]));
  });

  it('snaps each pixel to its nearest of several palette entries', () => {
    const grid = imageDataToVoxelGrid(img([[RED, BLUE]]), { palette: [[255, 0, 0], [0, 0, 255]] });
    const colors = new Set<number>();
    grid.forEach((_x, _y, _z, c) => colors.add(c));
    expect(colors).toEqual(new Set([0xff0000, 0x0000ff]));
  });

  it('takes precedence over posterizeColors', () => {
    const grid = imageDataToVoxelGrid(img([[RED, BLUE]]), {
      palette: [[255, 255, 255]],
      posterizeColors: 2,
    });
    const colors = new Set<number>();
    grid.forEach((_x, _y, _z, c) => colors.add(c));
    expect(colors).toEqual(new Set([0xffffff]));
  });

  it('is ignored outside original color mode', () => {
    // grayscale wins; palette is only an original-mode snap.
    const grid = imageDataToVoxelGrid(img([[RED]]), { colorMode: 'grayscale', palette: [[0, 0, 255]] });
    const b = grid.bounds()!;
    const lum = Math.round(luminance(255, 0, 0));
    expect(grid.get(b.min[0], 0, b.min[2])).toBe((lum << 16) | (lum << 8) | lum);
  });

  it('an empty palette falls through to per-pixel original color', () => {
    const grid = imageDataToVoxelGrid(img([[RED]]), { palette: [] });
    const b = grid.bounds()!;
    expect(grid.get(b.min[0], 0, b.min[2])).toBe(0xff0000);
  });
});

describe('extractImagePalette', () => {
  const BLUE: [number, number, number, number] = [0, 0, 255, 255];

  it('returns up to k representative colors', () => {
    const pal = extractImagePalette(img([[RED, BLUE]]), 2);
    expect(pal.length).toBe(2);
    for (const c of pal) {
      expect(c).toHaveLength(3);
      for (const ch of c) {
        expect(ch).toBeGreaterThanOrEqual(0);
        expect(ch).toBeLessThanOrEqual(255);
      }
    }
  });

  it('clamps k to the available pixel count', () => {
    const pal = extractImagePalette(img([[RED, BLUE]]), 8);
    expect(pal.length).toBeLessThanOrEqual(2);
  });

  it('returns [] for a degenerate image', () => {
    expect(extractImagePalette({ width: 0, height: 0, data: new Uint8ClampedArray(0) }, 4)).toEqual([]);
  });
});

describe('generateVoxelImportCode', () => {
  it('defaults to the compact voxels.decode(...) form', () => {
    const grid = imageDataToVoxelGrid(img([[RED, RED]]));
    const code = generateVoxelImportCode(grid, 'pic.png');
    expect(code).toContain('voxels.decode(');
    expect(code).not.toContain('v.fillBox(['); // a real call, not the comment's "v.fillBox(...)"
  });

  it("style 'calls' emits editable builder calls that round-trip the grid", () => {
    const grid = new VoxelGrid();
    grid.fillBox([0, 0, 0], [2, 2, 2], '#112233');
    grid.set(5, 0, 0, '#ff0000');
    grid.set(0, 5, 0, '#00ff00');
    const code = generateVoxelImportCode(grid, 'pic.png', { style: 'calls' });
    expect(code).toContain('v.fillBox([');
    expect(code).not.toContain('voxels.decode(');
    expect(gridsEqual(runVoxelCode(code), grid)).toBe(true);
  });

  it("style 'calls' merges a solid same-color block into one fillBox", () => {
    const grid = new VoxelGrid();
    grid.fillBox([0, 0, 0], [3, 3, 3], '#abcdef');
    const code = generateVoxelImportCode(grid, 'block.png', { style: 'calls' });
    const fillBoxes = (code.match(/v\.fillBox\(\[/g) ?? []).length; // count real calls, not the comment
    expect(fillBoxes).toBe(1);
    expect(gridsEqual(runVoxelCode(code), grid)).toBe(true);
  });

  it("style 'calls' preserves smooth surfacing", () => {
    const grid = new VoxelGrid();
    grid.fillBox([0, 0, 0], [2, 2, 2], '#445566');
    grid.smooth({ iterations: 3, detail: 2 });
    const code = generateVoxelImportCode(grid, 'pic.png', { style: 'calls' });
    expect(code).toContain('v.smooth({ iterations: 3, detail: 2 })');
  });

  it("style 'calls' falls back to decode when the cap is exceeded", () => {
    // Four isolated, distinct-colored voxels → four calls; cap of 2 forces decode.
    const grid = new VoxelGrid();
    grid.set(0, 0, 0, '#ff0000');
    grid.set(2, 0, 0, '#00ff00');
    grid.set(4, 0, 0, '#0000ff');
    grid.set(6, 0, 0, '#ffff00');
    const code = generateVoxelImportCode(grid, 'pic.png', { style: 'calls', maxCalls: 2 });
    expect(code).toContain('voxels.decode(');
    expect(code).not.toContain('v.fillBox(');
    expect(gridsEqual(runVoxelCode(code), grid)).toBe(true);
  });

  it('countVoxelBuilderCalls counts merged boxes, not raw voxels', () => {
    const solid = new VoxelGrid();
    solid.fillBox([0, 0, 0], [3, 3, 3], '#abcdef'); // 64 voxels, one box
    expect(countVoxelBuilderCalls(solid)).toBe(1);

    const scattered = new VoxelGrid();
    scattered.set(0, 0, 0, '#ff0000');
    scattered.set(2, 0, 0, '#00ff00');
    scattered.set(4, 0, 0, '#0000ff');
    expect(countVoxelBuilderCalls(scattered)).toBe(3);

    expect(countVoxelBuilderCalls(new VoxelGrid())).toBe(0);
  });

  it('round-trips a palette-limited image as editable calls', () => {
    const rows: [number, number, number, number][][] = [
      [[250, 10, 10, 255], [240, 20, 20, 255]],
      [[10, 10, 240, 255], [20, 20, 250, 255]],
    ];
    const grid = imageDataToVoxelGrid(img(rows), { palette: [[255, 0, 0], [0, 0, 255]], depth: 2 });
    const code = generateVoxelImportCode(grid, 'pic.png', { style: 'calls' });
    expect(gridsEqual(runVoxelCode(code), grid)).toBe(true);
  });
});

describe('loop codegen (repeated sequences → for loops)', () => {
  it('collapses an evenly-spaced run of identical voxels into one loop', () => {
    const grid = new VoxelGrid();
    for (let z = 0; z <= 8; z += 2) grid.set(0, 0, z, '#ffffff'); // 5 dots, step 2
    const code = generateVoxelImportCode(grid, 'dots.png', { style: 'calls' });
    expect(code).toContain('for (let i = 0;');
    expect((code.match(/v\.set\(/g) ?? []).length).toBe(1); // one loop, not five sets
    expect(countVoxelBuilderCalls(grid)).toBe(1);
    expect(gridsEqual(runVoxelCode(code), grid)).toBe(true);
  });

  it('collapses evenly-spaced identical boxes (a stripe pattern) into one loop', () => {
    const grid = new VoxelGrid();
    for (let x = 0; x <= 12; x += 3) grid.fillBox([x, 0, 0], [x, 0, 5], '#33aaff'); // 5 columns
    const code = generateVoxelImportCode(grid, 'stripes.png', { style: 'calls' });
    expect(code).toContain('for (let i = 0;');
    expect((code.match(/v\.fillBox\(\[/g) ?? []).length).toBe(1);
    expect(gridsEqual(runVoxelCode(code), grid)).toBe(true);
  });

  it('does not loop fewer than three repeats', () => {
    const grid = new VoxelGrid();
    grid.set(0, 0, 0, '#fff');
    grid.set(0, 0, 2, '#fff'); // only two → stays as plain set calls
    const code = generateVoxelImportCode(grid, 'two.png', { style: 'calls' });
    expect(code).not.toContain('for (let i = 0;');
    expect(gridsEqual(runVoxelCode(code), grid)).toBe(true);
  });

  it('handles mixed loopable + irregular boxes, round-tripping exactly', () => {
    const grid = new VoxelGrid();
    for (let x = 0; x <= 10; x += 2) grid.set(x, 0, 0, '#ff0000'); // loopable run of 6
    grid.fillBox([0, 0, 3], [4, 0, 3], '#00ff00');                  // a separate box
    grid.set(7, 0, 5, '#0000ff');                                    // a lone voxel
    const code = generateVoxelImportCode(grid, 'mix.png', { style: 'calls' });
    expect(code).toContain('for (let i = 0;');
    expect(gridsEqual(runVoxelCode(code), grid)).toBe(true);
  });
});
