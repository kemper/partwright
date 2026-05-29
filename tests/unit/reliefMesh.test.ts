import { describe, it, expect } from 'vitest';
import { generateRelief } from '../../src/relief/imageToRelief';
import { DEFAULT_RELIEF_OPTIONS, type ReliefOptions } from '../../src/relief/types';

// Build a fake ImageData-shaped object. generateRelief only reads
// .data / .width / .height, so a plain object stands in for the browser type
// (which doesn't exist in the node/vitest environment).
function img(w: number, h: number, fn: (x: number, y: number) => [number, number, number]): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const [r, g, b] = fn(x, y);
      data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255;
    }
  }
  return { data, width: w, height: h } as unknown as ImageData;
}

// Every undirected edge of a closed 2-manifold appears in exactly two
// triangles. A slicer (Bambu Studio etc.) rejects anything with open edges
// (count 1) or non-manifold edges (count > 2). This is the invariant that
// regressed when stepped relief used per-cell vertical walls.
function manifoldStats(mesh: { numTri: number; triVerts: Uint32Array }): { open: number; nonManifold: number } {
  const counts = new Map<number, number>();
  const bump = (u: number, v: number): void => {
    const a = Math.min(u, v), b = Math.max(u, v);
    const key = a * 1e8 + b;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };
  for (let t = 0; t < mesh.numTri; t++) {
    const a = mesh.triVerts[t * 3], b = mesh.triVerts[t * 3 + 1], c = mesh.triVerts[t * 3 + 2];
    bump(a, b); bump(b, c); bump(c, a);
  }
  let open = 0, nonManifold = 0;
  for (const n of counts.values()) {
    if (n === 1) open++;
    else if (n !== 2) nonManifold++;
  }
  return { open, nonManifold };
}

function reliefOpts(over: Partial<ReliefOptions['common']>, quant: Partial<ReliefOptions['quantized']>): ReliefOptions {
  const o = structuredClone(DEFAULT_RELIEF_OPTIONS);
  o.mode = 'quantized';
  Object.assign(o.common, { widthMm: 40, resolution: 40, maxHeight: 2, baseThickness: 0.6, layerHeight: 0.2 }, over);
  Object.assign(o.quantized, { output: 'relief', clusters: 4 }, quant);
  return o;
}

const PALETTE: [number, number, number][] = [
  [20, 20, 30], [200, 60, 60], [60, 200, 60], [60, 60, 220], [230, 230, 180],
];

describe('relief mesh is watertight (printable)', () => {
  // Regression: a detailed/complex image (many small regions of differing
  // height meeting at corners) used to produce a non-manifold mesh that
  // Bambu Studio refused to slice. The stepped relief now uses the continuous
  // height-grid mesh, which is a closed 2-manifold for any heightfield.
  const cases: Array<[string, ImageData, number]> = [
    ['flat', img(40, 40, () => PALETTE[2]), 2],
    ['single step', img(40, 40, (x) => (x < 20 ? PALETTE[1] : PALETTE[4])), 2],
    ['checkerboard 4-colour', img(40, 40, (x, y) => PALETTE[((x >> 3) & 1) + ((y >> 3) & 1) * 2 + 1]), 4],
    ['concentric pyramid', img(40, 40, (x, y) => PALETTE[Math.min(4, Math.max(Math.abs(x - 20), Math.abs(y - 20)) >> 2)]), 5],
    ['thin spikes', img(40, 40, (x, y) => (x % 5 === 0 && y % 5 === 0 ? PALETTE[0] : PALETTE[4])), 2],
  ];

  for (const mode of ['single-nozzle', 'multi-color'] as const) {
    for (const [name, image, clusters] of cases) {
      it(`${mode} / ${name} produces a closed 2-manifold`, () => {
        const res = generateRelief(image, reliefOpts({}, { clusters, paintingMode: mode }));
        expect(res.mesh.numTri).toBeGreaterThan(0);
        const stats = manifoldStats(res.mesh);
        expect(stats.open).toBe(0);
        expect(stats.nonManifold).toBe(0);
        expect(res.mesh.watertight).toBe(true);
      });
    }
  }

  // An unaligned base (0.64 mm at 0.2 mm layers — the user's 3.64 mm tile)
  // must still produce a watertight mesh.
  it('unaligned base stays watertight', () => {
    const image = img(40, 40, (x, y) => (x >= 12 && x < 28 && y >= 12 && y < 28 ? PALETTE[3] : PALETTE[4]));
    const res = generateRelief(image, reliefOpts({ baseThickness: 0.64 }, { clusters: 2, paintingMode: 'single-nozzle' }));
    const stats = manifoldStats(res.mesh);
    expect(stats.open).toBe(0);
    expect(stats.nonManifold).toBe(0);
  });

  // The subject colour must survive on its own cells (the earlier "blue fur
  // renders tan" bug). With per-cluster seed regions this is structural.
  it('keeps a distinct blue region for a blue subject on a light background', () => {
    const image = img(40, 40, (x, y) => (x >= 12 && x < 28 && y >= 12 && y < 28 ? [34, 85, 192] : [232, 224, 176]));
    const res = generateRelief(image, reliefOpts({ baseThickness: 0.64 }, { clusters: 2, paintingMode: 'single-nozzle' }));
    const hasBlue = (res.seedRegions ?? []).some(r => r.color[2] > 0.5 && r.color[0] < 0.4 && r.color[1] < 0.5);
    expect(hasBlue).toBe(true);
  });
});
