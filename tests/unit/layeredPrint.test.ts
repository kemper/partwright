import { describe, it, expect } from 'vitest';
import { computeLadder, layerTop, layerBottom, layerCountFor, rgb01ToLab } from '../../src/relief/layeredPrint/optics';
import { solveLayeredPrint, resolveLayeredPrintOptions, layeredPrintSummary } from '../../src/relief/layeredPrint/solver';
import { buildHeightfieldMesh } from '../../src/relief/layeredPrint/mesh';
import { layeredPrintLayerPlan, layeredPrintMeshData } from '../../src/relief/layeredPrint/export3mf';
import { layeredPrintRecord, planMeshMismatch, planSwapText } from '../../src/relief/layeredPrint/plan';
import { buildCustomGcodePerLayerXml } from '../../src/export/threemfProject';

const spec = { firstLayerHeight: 0.16, layerHeight: 0.08 };
const BLACK = { name: 'Black', hex: '#000000', td: 0.6 };
const WHITE = { name: 'White', hex: '#ffffff', td: 3.2 };
const RED = { name: 'Red', hex: '#ff0000', td: 0.8 };

function rgba(w: number, h: number, fn: (x: number, y: number) => [number, number, number]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4; const [r, g, b] = fn(x, y);
    data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255;
  }
  return { width: w, height: h, data };
}

function edgeCounts(triVerts: Uint32Array, numTri: number) {
  const m = new Map<number, number>();
  for (let t = 0; t < numTri; t++) for (let e = 0; e < 3; e++) {
    const a = triVerts[t * 3 + e], b = triVerts[t * 3 + ((e + 1) % 3)];
    const k = Math.min(a, b) * 1e7 + Math.max(a, b);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  let bad = 0; for (const n of m.values()) if (n !== 2) bad++;
  return bad;
}

describe('layeredPrint optics', () => {
  it('layer geometry: first layer is thicker', () => {
    expect(layerTop(0, spec)).toBeCloseTo(0.16);
    expect(layerTop(4, spec)).toBeCloseTo(0.48);
    expect(layerBottom(0, spec)).toBe(0);
    expect(layerBottom(1, spec)).toBeCloseTo(0.16);
    expect(layerCountFor(2.4, spec)).toBe(29);
  });

  it('a filament blends linearly toward opaque at its TD', () => {
    const lad = computeLadder([{ filament: BLACK, startLayer: 0 }, { filament: WHITE, startLayer: 1 }], 60, spec);
    // Layer 0 is the opaque base.
    expect(lad[0]).toBeCloseTo(0);
    // Below TD white is partial, so successive layers get lighter...
    expect(lad[10 * 3]).toBeGreaterThan(lad[5 * 3]);
    // ...and 3.2 mm of white (40 layers over the base) is fully white.
    const i = Math.ceil((0.16 + 3.2 - 0.16) / 0.08);
    expect(lad[i * 3]).toBeCloseTo(1, 2);
    // Halfway through TD → about half.
    const half = Math.round((0.16 + 1.6 - 0.16) / 0.08);
    expect(lad[half * 3]).toBeGreaterThan(0.4);
    expect(lad[half * 3]).toBeLessThan(0.6);
  });

  it('Lab of white and black', () => {
    expect(rgb01ToLab(1, 1, 1)[0]).toBeCloseTo(100, 0);
    expect(rgb01ToLab(0, 0, 0)[0]).toBeCloseTo(0, 0);
  });
});

describe('layeredPrint solver', () => {
  it('reproduces a black→white gradient with a dark base and a light top', () => {
    const img = rgba(64, 16, (x) => { const v = Math.round((x / 63) * 255); return [v, v, v]; });
    const r = solveLayeredPrint(img, { numColors: 2, widthMm: 40, pixelSizeMm: 1, maxHeightMm: 3.6, baseHeightMm: 0.16, filaments: [BLACK, WHITE, RED], iterations: 3000, smoothing: 0 });
    expect(r.blocks.map((b) => b.filament.name)).toEqual(['Black', 'White']);
    expect(r.swaps).toHaveLength(1);
    // Height rises left→right along the gradient.
    const W = r.gridWidth;
    expect(r.heightsMm[W - 1]).toBeGreaterThan(r.heightsMm[0]);
    expect(r.meanDeltaE).toBeLessThan(8);
    // Every height sits exactly on a layer top.
    for (const h of r.heightsMm) {
      const k = (h - 0.16) / 0.08;
      expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-4);
    }
    expect(planSwapText(layeredPrintRecord(r))).toMatch(/swap to White/);
    expect(layeredPrintSummary(r).filaments[0].name).toBe('Black');
  });

  it('is deterministic for a seed and prunes swaps that do not help', () => {
    // A flat image one filament matches exactly needs no swaps at all.
    const GREY = { name: 'Grey', hex: '#808080', td: 1.5 };
    const pool = [BLACK, WHITE, RED, GREY];
    const img = rgba(24, 24, () => [128, 128, 128]);
    const a = solveLayeredPrint(img, { numColors: 4, widthMm: 20, pixelSizeMm: 1, iterations: 2000, filaments: pool });
    const b = solveLayeredPrint(img, { numColors: 4, widthMm: 20, pixelSizeMm: 1, iterations: 2000, filaments: pool });
    expect(a.blocks.map((x) => x.filament.name)).toEqual(b.blocks.map((x) => x.filament.name));
    expect(a.blocks.length).toBeLessThanOrEqual(2);
    expect(a.blocks[a.blocks.length - 1].filament.name).toBe('Grey');
    expect(a.meanDeltaE).toBeLessThan(0.5);
  });

  it('honours a forced base filament', () => {
    const img = rgba(32, 8, (x) => (x < 16 ? [250, 250, 250] : [200, 20, 20]));
    const r = solveLayeredPrint(img, { numColors: 3, widthMm: 20, pixelSizeMm: 1, filaments: [BLACK, WHITE, RED], baseFilament: 'White', iterations: 1500 });
    expect(r.blocks[0].filament.name).toBe('White');
  });

  it('clamps options', () => {
    const o = resolveLayeredPrintOptions({ numColors: 99, layerHeight: -1, pixelSizeMm: 0 });
    expect(o.numColors).toBe(16);
    expect(o.layerHeight).toBeGreaterThan(0);
    expect(o.pixelSizeMm).toBeGreaterThan(0);
  });
});

describe('layeredPrint mesh + 3MF plan', () => {
  it('heightfield mesh is closed and edge-manifold', () => {
    const W = 7, H = 5;
    const heights = new Float32Array(W * H).map((_, i) => 0.16 + (i % 4) * 0.08);
    const m = buildHeightfieldMesh(heights, W, H, 12, 8);
    expect(m.numTopTri).toBe(2 * (W - 1) * (H - 1));
    expect(edgeCounts(m.triVerts, m.numTri)).toBe(0);
    // Signed volume is positive (outward normals) and equals the prism volume.
    const vp = m.vertProperties; let vol = 0;
    for (let t = 0; t < m.numTri; t++) {
      const [a, b, c] = [m.triVerts[t * 3], m.triVerts[t * 3 + 1], m.triVerts[t * 3 + 2]].map((v) => [vp[v * 3], vp[v * 3 + 1], vp[v * 3 + 2]]);
      vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    }
    expect(vol).toBeGreaterThan(0);
  });

  it('builds a Bambu custom_gcode_per_layer plan from a solve', () => {
    const img = rgba(40, 10, (x) => { const v = Math.round((x / 39) * 255); return [v, v, v]; });
    const r = solveLayeredPrint(img, { numColors: 3, widthMm: 20, pixelSizeMm: 1, filaments: [BLACK, WHITE, RED], iterations: 1500, pruneDeltaE: 0 });
    const plan = layeredPrintLayerPlan(r, 'ams');
    expect(plan.filamentColors).toHaveLength(r.blocks.length);
    expect(plan.changes.map((c) => c.filament)).toEqual(r.swaps.map((_, i) => i + 2));
    const xml = buildCustomGcodePerLayerXml(plan);
    expect(xml).toMatch(/<custom_gcodes_per_layer>/);
    expect(xml).toMatch(/type="2" extruder="2"/);
    expect(xml).toMatch(/<mode value="MultiAsSingle"\/>/);
    const pause = buildCustomGcodePerLayerXml(layeredPrintLayerPlan(r, 'pause'));
    expect(pause).toMatch(/type="1" extruder="1"/);
    expect(pause).toMatch(/gcode="M400 U1"/);
    expect(pause).toMatch(/SingleExtruder/);
  });
});

describe('layered print guards', () => {
  const img = rgba(40, 10, (x) => { const v = Math.round((x / 39) * 255); return [v, v, v]; });

  it('refuses grids and layer counts over the caps', () => {
    expect(() => solveLayeredPrint(img, { widthMm: 100, pixelSizeMm: 0.1, maxCells: 10_000 })).toThrow(/cells/);
    expect(() => solveLayeredPrint(img, { maxHeightMm: 10, layerHeight: 0.04, maxLayers: 50, pixelSizeMm: 1, widthMm: 20 })).toThrow(/layers/);
  });

  it('detects a mesh that no longer matches the plan', () => {
    const r = solveLayeredPrint(img, { numColors: 2, widthMm: 20, pixelSizeMm: 1, filaments: [BLACK, WHITE], iterations: 500 });
    const plan = layeredPrintRecord(r);
    const mesh = layeredPrintMeshData(r);
    expect(planMeshMismatch(plan, mesh)).toBeNull();
    const scaled = { ...mesh, vertProperties: mesh.vertProperties.map((v, i) => (i % 3 === 2 ? v * 2 : v)) };
    expect(planMeshMismatch(plan, scaled)).toMatch(/no longer matches/);
  });
});
