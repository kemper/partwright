import { describe, it, expect } from 'vitest';
import { computeLadder, layerTop, layerBottom, layerCountFor, rgb01ToLab } from '../../src/relief/layeredPrint/optics';
import { solveLayeredPrint, resolveLayeredPrintOptions, layeredPrintSummary } from '../../src/relief/layeredPrint/solver';
import { buildHeightfieldMesh } from '../../src/relief/layeredPrint/mesh';
import { layeredPrintLayerPlan, layeredPrintMeshData, buildLayeredPrint3MF } from '../../src/relief/layeredPrint/export3mf';
import { snapTriColorsToFilaments } from '../../src/relief/layeredPrint/paintedExport';
import { layeredPrintRecord, layeredPrintZRegions, planSwapText } from '../../src/relief/layeredPrint/plan';
import { parseLayeredPrintOptions, layeredPrintCode, planToScheduleOption } from '../../src/relief/layeredPrint/sandboxApi';
import { sourceImageRefs, hashImagePixels } from '../../src/geometry/modelImages';
import { buildCustomGcodePerLayerXml } from '../../src/export/threemfProject';
import { toLayeredPrintFilaments, LAYERED_PRINT_TD_MIN, LAYERED_PRINT_TD_MAX } from '../../src/relief/layeredPrint/filamentLibrary';

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

});

describe('code-native layered print', () => {
  const img = rgba(40, 10, (x) => { const v = Math.round((x / 39) * 255); return [v, v, v]; });

  it('a pinned schedule skips the search and keeps the given swaps', () => {
    const r = solveLayeredPrint(img, { widthMm: 20, pixelSizeMm: 1, maxHeightMm: 3.6, schedule: [{ filament: BLACK, startLayer: 0 }, { filament: WHITE, startLayer: 6 }] });
    expect(r.blocks.map((b) => [b.filament.name, b.startLayer])).toEqual([['Black', 0], ['White', 6]]);
    expect(r.swaps[0].layer).toBe(7);
    expect(() => solveLayeredPrint(img, { widthMm: 20, pixelSizeMm: 1, schedule: [{ filament: BLACK, startLayer: 0 }, { filament: WHITE, startLayer: 0 }] })).toThrow(/same layer/);
    expect(() => solveLayeredPrint(img, { widthMm: 20, pixelSizeMm: 1, maxHeightMm: 1, schedule: [{ filament: BLACK, startLayer: 0 }, { filament: WHITE, startLayer: 90 }] })).toThrow(/above the top layer/);
  });

  it('finds literal api.image ids and hashes pixels', () => {
    expect(sourceImageRefs("const a = api.image('abc'); api.image( \"d-2\" ); api.image(id)")).toEqual(['abc', 'd-2']);
    const d = new Uint8ClampedArray(16).fill(9);
    expect(hashImagePixels(2, 2, d)).toBe(hashImagePixels(2, 2, new Uint8ClampedArray(16).fill(9)));
    expect(hashImagePixels(2, 2, d)).not.toBe(hashImagePixels(2, 2, new Uint8ClampedArray(16).fill(8)));
  });

  it('validates sandbox options', () => {
    expect(parseLayeredPrintOptions({ colors: 6, widthMm: 100 })).toEqual({ numColors: 6, widthMm: 100 });
    expect(() => parseLayeredPrintOptions({ colour: 6 })).toThrow(/unknown option "colour"/);
    expect(() => parseLayeredPrintOptions({ widthMm: 5 })).toThrow(/widthMm/);
    expect(() => parseLayeredPrintOptions({ schedule: [{ name: 'W', hex: '#ffffff', td: 3, layer: 0 }] })).toThrow(/1-based/);
    const sched = parseLayeredPrintOptions({ schedule: [{ name: 'W', hex: 'FFFFFF', td: 3, layer: 1 }] }).schedule!;
    expect(sched[0]).toEqual({ filament: { name: 'W', hex: '#ffffff', td: 3 }, startLayer: 0 });
  });

  it('generates runnable code that pins the solved schedule', () => {
    const r = solveLayeredPrint(img, { numColors: 2, widthMm: 20, pixelSizeMm: 1, filaments: [BLACK, WHITE], iterations: 500 });
    const plan = layeredPrintRecord(r);
    const code = layeredPrintCode('att1', r.options, plan);
    expect(code).toMatch(/api\.layeredPrint\(api\.image\('att1'\)/);
    expect(code).toMatch(/pixelSizeMm: 1,/);
    // The generated object literal parses and round-trips the schedule.
    const body = code.slice(code.indexOf('{', code.indexOf('api.image')), code.lastIndexOf('});') + 1);
    const opts = new Function(`return (${body});`)();
    expect(opts.schedule).toEqual(planToScheduleOption(plan));
    // Re-solving with the pinned schedule gives the same heights.
    const again = solveLayeredPrint(img, parseLayeredPrintOptions(opts));
    expect(Array.from(again.heightsMm)).toEqual(Array.from(r.heightsMm));
  });

  it('colours a mesh by height from its own bottom', () => {
    const r = solveLayeredPrint(img, { numColors: 2, widthMm: 20, pixelSizeMm: 1, filaments: [BLACK, WHITE], iterations: 500 });
    const mesh = layeredPrintMeshData(r);
    const regions = layeredPrintZRegions(mesh, layeredPrintRecord(r));
    const total = regions.reduce((n, g) => n + g.triangles.size, 0);
    expect(total).toBe(mesh.numTri);
    // Lifting the mesh doesn't change the colouring (measured from its bottom).
    const lifted = { ...mesh, vertProperties: mesh.vertProperties.map((v, i) => (i % 3 === 2 ? v + 5 : v)) };
    expect(layeredPrintZRegions(lifted, layeredPrintRecord(r)).map((g) => g.name).sort()).toEqual(regions.map((g) => g.name).sort());
  });
});

describe('painted (AMS) export', () => {
  // Three shades: 50% dark grey, 30% orange-ish, 20% near white.
  const numTri = 10;
  const tri = new Uint8Array(numTri * 3);
  const put = (t: number, rgb: [number, number, number]) => { tri[t * 3] = rgb[0]; tri[t * 3 + 1] = rgb[1]; tri[t * 3 + 2] = rgb[2]; };
  for (let t = 0; t < 5; t++) put(t, [40, 40, 42]);
  for (let t = 5; t < 8; t++) put(t, [240, 110, 30]);
  for (let t = 8; t < 10; t++) put(t, [250, 250, 248]);

  it('snaps shades to the nearest real filaments within the slot cap', () => {
    const lib = [BLACK, WHITE, RED, { name: 'Orange', hex: '#f26a1b', td: 3 }];
    const s = snapTriColorsToFilaments(tri, numTri, 3, lib);
    expect(s.filaments.map((f) => f.name).sort()).toEqual(['Black', 'Orange', 'White']);
    expect(s.filaments[0].share).toBeCloseTo(0.5);
    // Every triangle is marked painted (a pure-black filament must not read as unpainted).
    expect((s.triColors as Uint8Array & { _painted?: Uint8Array })._painted?.every((v) => v === 1)).toBe(true);
    // Fewer slots than shades: the light shades merge, dark stays.
    const two = snapTriColorsToFilaments(tri, numTri, 2, lib);
    expect(two.filaments).toHaveLength(2);
  });

  it("'exact' keeps the preview shades (k-means when over the cap)", () => {
    const s = snapTriColorsToFilaments(tri, numTri, 3, 'exact');
    expect(s.filaments.map((f) => f.hex).sort()).toEqual(['#28282a', '#f06e1e', '#fafaf8']);
    expect(snapTriColorsToFilaments(tri, numTri, 2, 'exact').filaments).toHaveLength(2);
  });

  it('a layered plan exports painted or layer-swap from one path', () => {
    const img = rgba(40, 10, (x) => { const v = Math.round((x / 39) * 255); return [v, v, v]; });
    const r = solveLayeredPrint(img, { numColors: 2, widthMm: 20, pixelSizeMm: 1, filaments: [BLACK, WHITE], iterations: 500 });
    const painted = buildLayeredPrint3MF(r, { mode: 'painted', slots: 4 });
    expect(painted.mode).toBe('painted');
    expect(painted.swaps).toBe(0);
    expect(painted.filaments.length).toBeGreaterThan(0);
    expect(painted.filaments.length).toBeLessThanOrEqual(4);
    const swap = buildLayeredPrint3MF(r, { mode: 'layer-swap', swapMode: 'pause' });
    expect(swap.swaps).toBe(r.blocks.length - 1);
    expect(swap.filaments.map((f) => f.name)).toEqual(r.blocks.map((b) => b.filament.name));
  });
});

describe('toLayeredPrintFilaments (palette spools → solver pool)', () => {
  it('normalises hex, clamps TD, trims names, and skips unreadable colours', () => {
    const pool = toLayeredPrintFilaments([
      { name: '  Ink  ', hex: '#1A1A1A', td: 0.6 },
      { name: 'Paper', hex: 'fff', td: 3 },
      { name: 'Glass', hex: '#88ccee', td: 999 },
      { name: 'Opaque', hex: '#202020', td: 0 },
      { name: '', hex: '#00ff00', td: 2 },
      { name: 'Broken', hex: 'not-a-colour', td: 1 },
      { name: 'NaN TD', hex: '#123456', td: Number.NaN },
    ]);
    expect(pool).toEqual([
      { name: 'Ink', hex: '#1a1a1a', td: 0.6 },
      { name: 'Paper', hex: '#ffffff', td: 3 },
      { name: 'Glass', hex: '#88ccee', td: LAYERED_PRINT_TD_MAX },
      { name: 'Opaque', hex: '#202020', td: LAYERED_PRINT_TD_MIN },
      { name: '#00ff00', hex: '#00ff00', td: 2 },
      { name: 'NaN TD', hex: '#123456', td: 1.5 },
    ]);
  });

  it('drops extra slot fields (id) and caps long names', () => {
    const [f] = toLayeredPrintFilaments([{ id: 'fil-1', name: 'x'.repeat(200), hex: '#abcdef', td: 1 } as { name: string; hex: string; td: number }]);
    expect(Object.keys(f).sort()).toEqual(['hex', 'name', 'td']);
    expect(f.name).toHaveLength(80);
  });

  it('a palette pool drives the solve: the stack uses only those filaments', () => {
    const pool = toLayeredPrintFilaments([
      { name: 'Spool Ink', hex: '#101018', td: 0.6 },
      { name: 'Spool Paper', hex: '#f4f4ee', td: 3.4 },
    ]);
    const img = rgba(24, 16, (x) => { const v = Math.round((x / 23) * 255); return [v, v, v]; });
    const r = solveLayeredPrint(img, { filaments: pool, numColors: 4, widthMm: 20, pixelSizeMm: 1, iterations: 500 });
    const names = new Set(pool.map((f) => f.name));
    expect(r.blocks.length).toBeGreaterThan(0);
    for (const b of r.blocks) expect(names.has(b.filament.name)).toBe(true);
  });
});
