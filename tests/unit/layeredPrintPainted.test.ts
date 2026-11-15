import { describe, it, expect } from 'vitest';
import { buildHeightfieldMesh } from '../../src/relief/layeredPrint/mesh';
import { splitMeshAtZPlanes } from '../../src/relief/layeredPrint/zPlaneSplit';
import { photoTriColors, planSwapPlanesZ, stripeSideColors, isSideTriangle } from '../../src/relief/layeredPrint/photoColors';
import { buildPlan3MF } from '../../src/relief/layeredPrint/export3mf';
import { layerTop } from '../../src/relief/layeredPrint/optics';
import { LAYERED_PRINT_FILAMENT_LIBRARY } from '../../src/relief/layeredPrint/filamentLibrary';
import type { MeshData } from '../../src/geometry/types';
import type { LayeredPrintPlanRecord } from '../../src/relief/types';
import { checkEngineWorkerMessage } from '../../src/geometry/workerMessageValidation';

// Painted layered-print export: colours from the source photo, and side walls
// cut into layer stripes. Synthetic images and meshes only.

const spec = { firstLayerHeight: 0.16, layerHeight: 0.08 };

function rgba(w: number, h: number, fn: (x: number, y: number) => [number, number, number]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4; const [r, g, b] = fn(x, y);
    data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255;
  }
  return { width: w, height: h, data };
}

/** Bad-edge count: every undirected edge must be used exactly twice, once in
 *  each direction (closed, consistently oriented, no T-junctions). */
function manifoldDefects(m: MeshData): number {
  const directed = new Map<string, number>();
  for (let t = 0; t < m.numTri; t++) for (let e = 0; e < 3; e++) {
    const a = m.triVerts[t * 3 + e], b = m.triVerts[t * 3 + ((e + 1) % 3)];
    const k = `${a},${b}`;
    directed.set(k, (directed.get(k) ?? 0) + 1);
  }
  let bad = 0;
  for (const [k, n] of directed) {
    const [a, b] = k.split(',');
    if (n !== 1 || directed.get(`${b},${a}`) !== 1) bad++;
  }
  return bad;
}

function signedVolume(m: MeshData): number {
  const vp = m.vertProperties, np = m.numProp;
  let vol = 0;
  for (let t = 0; t < m.numTri; t++) {
    const [a, b, c] = [m.triVerts[t * 3], m.triVerts[t * 3 + 1], m.triVerts[t * 3 + 2]].map((v) => [vp[v * np], vp[v * np + 1], vp[v * np + 2]]);
    vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return vol;
}

function minTriArea(m: MeshData): number {
  const vp = m.vertProperties, np = m.numProp;
  let min = Infinity;
  for (let t = 0; t < m.numTri; t++) {
    const [a, b, c] = [m.triVerts[t * 3], m.triVerts[t * 3 + 1], m.triVerts[t * 3 + 2]].map((v) => [vp[v * np], vp[v * np + 1], vp[v * np + 2]]);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    min = Math.min(min, Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) / 2);
  }
  return min;
}

/** A heightfield whose cells sit on layer tops (as a real solve's do), so
 *  many vertices land exactly on the swap planes. */
function layeredField(W: number, H: number, layers: (x: number, y: number) => number) {
  const heights = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) heights[y * W + x] = layerTop(layers(x, y), spec);
  return buildHeightfieldMesh(heights, W, H, (W - 1) * 1, (H - 1) * 1);
}

function plan(over: Partial<LayeredPrintPlanRecord>): LayeredPrintPlanRecord {
  return {
    blocks: [
      { name: 'Black', hex: '#161616', td: 0.6, startLayer: 0 },
      { name: 'Gray', hex: '#8e9089', td: 1.6, startLayer: 4 },
      { name: 'White', hex: '#f8f8f6', td: 3.2, startLayer: 9 },
    ],
    layerHeight: spec.layerHeight, firstLayerHeight: spec.firstLayerHeight,
    totalLayers: 14, totalHeightMm: layerTop(13, spec), widthMm: 10, depthMm: 6, meanDeltaE: 5,
    ...over,
  };
}

describe('splitMeshAtZPlanes', () => {
  it('keeps a heightfield closed and edge-manifold when cut at swap heights (vertices on planes)', () => {
    const m = layeredField(11, 7, (x, y) => (x * 3 + y * 5) % 14);
    expect(manifoldDefects(m)).toBe(0);
    const planes = planSwapPlanesZ(plan({}), 0);
    // Cell tops land exactly on layer boundaries, so many vertices sit ON a plane.
    expect(planes).toEqual([layerTop(3, spec), layerTop(8, spec)].map((z) => expect.closeTo(z, 6)));
    const s = splitMeshAtZPlanes(m, planes);
    expect(s.mesh.numTri).toBeGreaterThan(m.numTri);
    expect(manifoldDefects(s.mesh)).toBe(0);
    expect(signedVolume(s.mesh)).toBeCloseTo(signedVolume(m), 3);
    expect(minTriArea(s.mesh)).toBeGreaterThan(1e-9);
    expect(s.parent).toHaveLength(s.mesh.numTri);
    // No output triangle straddles a plane.
    const vp = s.mesh.vertProperties;
    for (let t = 0; t < s.mesh.numTri; t++) {
      const zs = [0, 1, 2].map((k) => vp[s.mesh.triVerts[t * 3 + k] * 3 + 2]);
      for (const p of planes) expect(Math.min(...zs) < p - 1e-5 && Math.max(...zs) > p + 1e-5).toBe(false);
    }
  });

  it('cuts random heights at arbitrary planes and leaves uncut triangles alone', () => {
    let seed = 7;
    const rand = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; };
    const W = 9, H = 6;
    const heights = new Float32Array(W * H).map(() => 0.2 + rand() * 3);
    const m = buildHeightfieldMesh(heights, W, H, 8, 5);
    const s = splitMeshAtZPlanes(m, [0.7, 1.3, 1.3, 2.05, 9]);
    expect(manifoldDefects(s.mesh)).toBe(0);
    expect(signedVolume(s.mesh)).toBeCloseTo(signedVolume(m), 3);
    // No plane inside the mesh's z range → an identical copy.
    const none = splitMeshAtZPlanes(m, [50]);
    expect(none.mesh.numTri).toBe(m.numTri);
    expect(Array.from(none.parent)).toEqual(Array.from({ length: m.numTri }, (_, i) => i));
  });

  it('welds property-seam duplicates (merge vectors) before cutting', () => {
    // A tetrahedron where vertex 3 is a seam copy of vertex 0.
    const vp = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 2]);
    const tv = new Uint32Array([0, 2, 1, 3, 1, 4, 1, 2, 4, 2, 0, 4]);
    const mesh: MeshData = { vertProperties: vp, triVerts: tv, numVert: 5, numTri: 4, numProp: 3, mergeFromVert: new Uint32Array([3]), mergeToVert: new Uint32Array([0]) };
    const s = splitMeshAtZPlanes(mesh, [1]);
    expect(manifoldDefects(s.mesh)).toBe(0);
    expect(s.mesh.numVert).toBe(4 + 3);
  });
});

describe('painted colours from the photo', () => {
  // Left half dusty blue, right half warm red; image top row is a yellow strip.
  const photo = rgba(40, 24, (x, y) => (y < 6 ? [230, 200, 40] : x < 20 ? [91, 127, 166] : [200, 60, 50]));

  it('samples the photo under each top triangle; the underside and off-print parts keep their colour', () => {
    const m = layeredField(11, 7, () => 6);
    // A "frame" triangle far outside the footprint.
    const vp = new Float32Array([...m.vertProperties, 30, 30, 0.5, 31, 30, 0.5, 30, 31, 0.5]);
    const tv = new Uint32Array([...m.triVerts, m.numVert, m.numVert + 1, m.numVert + 2]);
    const mesh: MeshData = { vertProperties: vp, triVerts: tv, numVert: m.numVert + 3, numTri: m.numTri + 1, numProp: 3 };
    const fallback = new Uint8Array(mesh.numTri * 3).fill(128);
    const { triColors, fromPhoto } = photoTriColors(mesh, plan({}), photo, fallback);
    expect(fromPhoto).toBeGreaterThan(m.numTopTri - 1);
    const col = (t: number) => [triColors[t * 3], triColors[t * 3 + 1], triColors[t * 3 + 2]];
    // Top triangle in the lower-left cell (−X, −Y) → blue; lower-right → red;
    // top row of cells (+Y = image top) → yellow.
    expect(col(0)).toEqual([91, 127, 166]);
    expect(col(2 * 9)).toEqual([200, 60, 50]);
    expect(col(2 * (5 * 10 + 1))).toEqual([230, 200, 40]);
    // Underside fan (last triangles of the heightfield) keeps the base colour.
    expect(col(m.numTri - 1)).toEqual([128, 128, 128]);
    expect(col(mesh.numTri - 1)).toEqual([128, 128, 128]);
  });

  it('a print the code moved off the footprint falls back to the preview colours', () => {
    const m = layeredField(11, 7, () => 6);
    const moved: MeshData = { ...m, vertProperties: m.vertProperties.map((v, i) => (i % 3 === 0 ? v + 100 : v)) };
    expect(photoTriColors(moved, plan({}), photo, new Uint8Array(m.numTri * 3)).fromPhoto).toBe(0);
    const out = buildPlan3MF(plan({}), moved, { mode: 'painted', photo, slots: 4 });
    expect(out.paintColors).toBe('preview');
  });

  it('snapping photo colours keeps a saturated hue the preview blend would grey out', () => {
    // A dusty blue photo; the predicted layer-swap blend for it is a mid grey.
    const blue = rgba(30, 18, () => [91, 127, 166]);
    const m = layeredField(11, 7, (x) => 4 + (x % 3));
    const grey = new Uint8Array(m.numTri * 3).fill(138);
    const mesh: MeshData = { ...m, triColors: grey };
    const p = plan({});
    const fromPreview = buildPlan3MF(p, mesh, { mode: 'painted', slots: 2, paintColors: 'preview', photo: blue });
    const fromPhoto = buildPlan3MF(p, mesh, { mode: 'painted', slots: 2, photo: blue });
    expect(fromPreview.paintColors).toBe('preview');
    expect(fromPhoto.paintColors).toBe('photo');
    const hue = (hex: string) => { const v = parseInt(hex.slice(1), 16); return { r: v >> 16, g: (v >> 8) & 255, b: v & 255 }; };
    const top = (e: typeof fromPhoto) => hue(e.filaments[0].hex);
    // Preview: the dominant filament is a neutral grey.
    expect(Math.abs(top(fromPreview).b - top(fromPreview).r)).toBeLessThan(20);
    // Photo: the dominant filament is a real blue from the library.
    expect(top(fromPhoto).b - top(fromPhoto).r).toBeGreaterThan(40);
    expect(LAYERED_PRINT_FILAMENT_LIBRARY.map((f) => f.hex)).toContain(fromPhoto.filaments[0].hex);
  });
});

describe('layer stripes on the sides', () => {
  it('bands each side at the swap heights with the filament printed there', () => {
    const m = layeredField(9, 6, (x, y) => (x + y) % 2 === 0 ? 13 : 2);
    const p = plan({ widthMm: 8, depthMm: 5 });
    const planes = planSwapPlanesZ(p, 0);
    const split = splitMeshAtZPlanes(m, planes);
    const base = new Uint8Array(split.mesh.numTri * 3).fill(7);
    const { triColors, striped } = stripeSideColors(split.mesh, p, base);
    expect(striped).toBeGreaterThan(0);
    const vp = split.mesh.vertProperties;
    const expected = [[0x16, 0x16, 0x16], [0x8e, 0x90, 0x89], [0xf8, 0xf8, 0xf6]];
    const seen = new Set<number>();
    for (let t = 0; t < split.mesh.numTri; t++) {
      const c = [triColors[t * 3], triColors[t * 3 + 1], triColors[t * 3 + 2]];
      if (!isSideTriangle(split.mesh, t)) { expect(c).toEqual([7, 7, 7]); continue; }
      const zc = [0, 1, 2].reduce((s, k) => s + vp[split.mesh.triVerts[t * 3 + k] * 3 + 2], 0) / 3;
      const band = zc < planes[0] ? 0 : zc < planes[1] ? 1 : 2;
      expect(c).toEqual(expected[band]);
      seen.add(band);
    }
    expect([...seen].sort()).toEqual([0, 1, 2]);
  });

  it("sides: 'layers' exports a closed, striped painted 3MF", () => {
    const m = layeredField(9, 6, (x, y) => (x * 2 + y) % 14);
    const photo = rgba(16, 10, () => [200, 60, 50]);
    const p = plan({ widthMm: 8, depthMm: 5 });
    const striped = buildPlan3MF(p, m, { mode: 'painted', photo, slots: 4, sides: 'layers' });
    expect(striped.sides).toBe('layers');
    expect(striped.paintColors).toBe('photo');
    // The stripes add the stack's filaments next to the photo's red.
    const names = striped.filaments.map((f) => f.name);
    expect(names.length).toBeGreaterThan(1);
    expect(names.length).toBeLessThanOrEqual(4);
    const region = buildPlan3MF(p, m, { mode: 'painted', photo, slots: 4 });
    expect(region.sides).toBe('region');
    expect(region.built.blob.size).toBeLessThan(striped.built.blob.size);
  });
});

describe('plan record from the Worker', () => {
  it('accepts the photo attachment id and refuses a forged one', () => {
    const exec = (lp: Record<string, unknown>) => checkEngineWorkerMessage({ type: 'execute_result', callId: 'e', mesh: null, error: null, layeredPrint: lp });
    const p = plan({});
    expect(exec({ ...p }).ok).toBe(true);
    expect(exec({ ...p, imageId: 'a1b2c3' }).ok).toBe(true);
    expect(exec({ ...p, imageId: 42 }).ok).toBe(false);
    expect(exec({ ...p, imageId: 'x'.repeat(201) }).ok).toBe(false);
  });
});
