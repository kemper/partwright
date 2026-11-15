import { describe, it, expect } from 'vitest';
import { bandMeshFromColoredMesh, buildLayerPreviewMesh, cutBandMesh, splitMeshByBands } from '../../src/print/layerPreviewMesh';
import { resolveLayerBands } from '../../src/print/layerColors';
import type { MeshData } from '../../src/geometry/types';

const P = { layerHeight: 0.2, firstLayerHeight: 0.2 };
const WHITE = '#f0f0f0', RED = '#dc1e1e', BLUE = '#1e50dc';

/** An axis-aligned box as 12 triangles (2 per face), outward-facing. `inverted` flips it (a cavity). */
function box(min: [number, number, number], max: [number, number, number], inverted = false): { verts: number[]; tris: number[] } {
  const [x0, y0, z0] = min, [x1, y1, z1] = max;
  const verts = [x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1];
  const tris = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
  if (inverted) for (let i = 0; i < tris.length; i += 3) [tris[i + 1], tris[i + 2]] = [tris[i + 2], tris[i + 1]];
  return { verts, tris };
}
function meshOf(...parts: { verts: number[]; tris: number[] }[]): MeshData {
  const verts: number[] = [];
  const tris: number[] = [];
  for (const p of parts) { const off = verts.length / 3; verts.push(...p.verts); tris.push(...p.tris.map((i) => i + off)); }
  return { vertProperties: new Float32Array(verts), triVerts: new Uint32Array(tris), numVert: verts.length / 3, numTri: tris.length / 3, numProp: 3 };
}

interface Tri { z: [number, number, number]; area: number; nz: number; hex: string; cx: number; cy: number }
function trisOf(m: MeshData): Tri[] {
  const out: Tri[] = [];
  const v = m.vertProperties;
  for (let t = 0; t < m.numTri; t++) {
    const p = [0, 1, 2].map((k) => { const i = m.triVerts[t * 3 + k] * 3; return [v[i], v[i + 1], v[i + 2]]; });
    const u = p[1].map((x, i) => x - p[0][i]), w = p[2].map((x, i) => x - p[0][i]);
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const len = Math.hypot(n[0], n[1], n[2]);
    const c = m.triColors!;
    out.push({
      z: [p[0][2], p[1][2], p[2][2]], area: len / 2, nz: n[2] / len,
      hex: '#' + [c[t * 3], c[t * 3 + 1], c[t * 3 + 2]].map((x) => x.toString(16).padStart(2, '0')).join(''),
      cx: (p[0][0] + p[1][0] + p[2][0]) / 3, cy: (p[0][1] + p[1][1] + p[2][1]) / 3,
    });
  }
  return out;
}
const areaWhere = (ts: Tri[], f: (t: Tri) => boolean) => ts.filter(f).reduce((s, t) => s + t.area, 0);

describe('buildLayerPreviewMesh', () => {
  // A 10 mm cube sitting at z = 5..15 (so the bed is NOT at z = 0).
  const cube = meshOf(box([0, 0, 5], [10, 10, 15]));
  const bands = resolveLayerBands(WHITE, [{ z: 4, color: RED }, { z: 8, color: BLUE }], 10, P);

  it('splits the surface at band boundaries and colours each piece by its band', () => {
    const r = buildLayerPreviewMesh(cube, { bands, profile: P });
    expect(r.bedZ).toBe(5);
    expect(r.totalLayers).toBe(50);
    expect(r.shownLayers).toBe(50);
    expect(r.cutZ).toBeNull();
    const ts = trisOf(r.mesh);
    expect(ts.length).toBeGreaterThan(12);
    // Nothing is lost or added: the cube's 600 mm² of surface is all there.
    expect(areaWhere(ts, () => true)).toBeCloseTo(600, 4);
    // Every piece lies inside one band (heights are in model coordinates: bed at 5).
    for (const t of ts) {
      const lo = Math.min(...t.z) - 5, hi = Math.max(...t.z) - 5;
      const want = hi <= 4 + 1e-6 ? WHITE : lo >= 8 - 1e-6 ? BLUE : RED;
      expect(lo >= 4 - 1e-6 || hi <= 4 + 1e-6).toBe(true);
      expect(lo >= 8 - 1e-6 || hi <= 8 + 1e-6).toBe(true);
      expect(t.hex).toBe(want);
    }
    // Side walls: 40 mm perimeter × band height.
    expect(areaWhere(ts, (t) => Math.abs(t.nz) < 0.5 && t.hex === WHITE)).toBeCloseTo(160, 4);
    expect(areaWhere(ts, (t) => Math.abs(t.nz) < 0.5 && t.hex === RED)).toBeCloseTo(160, 4);
    expect(areaWhere(ts, (t) => Math.abs(t.nz) < 0.5 && t.hex === BLUE)).toBeCloseTo(80, 4);
    // Bottom is the first band, top the last.
    expect(areaWhere(ts, (t) => t.nz < -0.5 && t.hex === WHITE)).toBeCloseTo(100, 4);
    expect(areaWhere(ts, (t) => t.nz > 0.5 && t.hex === BLUE)).toBeCloseTo(100, 4);
  });

  it('with one band returns the same surface in one colour', () => {
    const r = buildLayerPreviewMesh(cube, { bands: resolveLayerBands(RED, [], 10, P), profile: P });
    const ts = trisOf(r.mesh);
    expect(ts).toHaveLength(12);
    expect(new Set(ts.map((t) => t.hex))).toEqual(new Set([RED]));
  });

  it('cuts at the layer slider height, snapped to a layer top, and caps the opening', () => {
    // 5.07 mm falls in the layer spanning 5.0-5.2, so the cut is at its top.
    const r = buildLayerPreviewMesh(cube, { bands, profile: P, cutZ: 5.07 });
    expect(r.cutZ).toBeCloseTo(5.2, 6);
    expect(r.shownLayers).toBe(26);
    expect(r.capped).toBe(true);
    const ts = trisOf(r.mesh);
    expect(Math.max(...ts.flatMap((t) => t.z))).toBeCloseTo(5 + 5.2, 5);
    // The cap: a full 10 × 10 face at the cut, facing up, in that layer's colour (red band).
    const cap = ts.filter((t) => t.nz > 0.5);
    expect(areaWhere(cap, () => true)).toBeCloseTo(100, 4);
    expect(new Set(cap.map((t) => t.hex))).toEqual(new Set([RED]));
    expect(cap.every((t) => t.z.every((z) => Math.abs(z - 10.2) < 1e-5))).toBe(true);
    // Walls below the cut only: 40 × 5.2.
    expect(areaWhere(ts, (t) => Math.abs(t.nz) < 0.5)).toBeCloseTo(208, 4);
    expect(ts.some((t) => t.hex === BLUE)).toBe(false);
  });

  it('caps a hollow model as a ring, not a filled square', () => {
    // 10 mm cube with a 6 mm cavity through its middle band.
    const hollow = meshOf(box([0, 0, 0], [10, 10, 10]), box([2, 2, 2], [8, 8, 8], true));
    const r = buildLayerPreviewMesh(hollow, { bands: resolveLayerBands(WHITE, [], 10, P), profile: P, cutZ: 5 });
    expect(r.capped).toBe(true);
    const cap = trisOf(r.mesh).filter((t) => t.nz > 0.5 && Math.abs(t.z[0] - r.cutZ!) < 1e-5);
    expect(areaWhere(cap, () => true)).toBeCloseTo(100 - 36, 4);
    // No cap triangle sits over the cavity.
    expect(cap.every((t) => !(t.cx > 2.01 && t.cx < 7.99 && t.cy > 2.01 && t.cy < 7.99))).toBe(true);
  });

  it('a cut at or above the top shows the whole model', () => {
    const r = buildLayerPreviewMesh(cube, { bands, profile: P, cutZ: 10 });
    expect(r.cutZ).toBeNull();
    expect(areaWhere(trisOf(r.mesh), () => true)).toBeCloseTo(600, 4);
  });

  it('reports an open mesh it cannot cap, and still draws it', () => {
    const open = meshOf(box([0, 0, 0], [10, 10, 10]));
    open.triVerts = open.triVerts.slice(0, 33); // drop one side triangle
    open.numTri = 11;
    const r = buildLayerPreviewMesh(open, { bands: resolveLayerBands(WHITE, [], 10, P), profile: P, cutZ: 5 });
    expect(r.capped).toBe(false);
    expect(r.mesh.numTri).toBeGreaterThan(0);
  });

  it('a downward-facing flat face on a boundary takes the band above it', () => {
    // A slab floating from 4 mm up (above a separate base) with its underside exactly on the red band's start.
    const m = meshOf(box([0, 0, 0], [10, 10, 1]), box([0, 0, 4], [10, 10, 6]));
    const r = buildLayerPreviewMesh(m, { bands: resolveLayerBands(WHITE, [{ z: 4, color: RED }], 6, P), profile: P });
    const ts = trisOf(r.mesh);
    const underside = ts.filter((t) => t.nz < -0.5 && t.z.every((z) => Math.abs(z - 4) < 1e-6));
    expect(areaWhere(underside, () => true)).toBeCloseTo(100, 4);
    expect(new Set(underside.map((t) => t.hex))).toEqual(new Set([RED]));
    // The base's top at 1 mm is white.
    const baseTop = ts.filter((t) => t.nz > 0.5 && t.z.every((z) => Math.abs(z - 1) < 1e-6));
    expect(new Set(baseTop.map((t) => t.hex))).toEqual(new Set([WHITE]));
  });

  it('with blending, a thin translucent top band shows a mix on top but stays pure on the sides', () => {
    // Black cube with one 0.2 mm white layer on top.
    const thin = resolveLayerBands('#000000', [{ z: 9.8, color: '#ffffff' }], 10, P);
    const blend = { transmissionOf: (c: string) => (c === '#ffffff' ? 2 : 0.1), maxLayers: 12, minUpNormal: 0.5 };
    const opaque = trisOf(buildLayerPreviewMesh(cube, { bands: thin, profile: P }).mesh);
    const mixed = trisOf(buildLayerPreviewMesh(cube, { bands: thin, profile: P, blend }).mesh);
    const top = (ts: Tri[]) => ts.filter((t) => t.nz > 0.5);
    expect(new Set(top(opaque).map((t) => t.hex))).toEqual(new Set(['#ffffff']));
    const seen = new Set(top(mixed).map((t) => t.hex));
    expect(seen.size).toBe(1);
    const grey = parseInt([...seen][0].slice(1, 3), 16);
    expect(grey).toBeGreaterThan(20);
    expect(grey).toBeLessThan(120);
    // Side walls of the white layer are unaffected (true black is stored as 1,1,1 so it stays visible).
    expect(new Set(mixed.filter((t) => Math.abs(t.nz) < 0.5).map((t) => t.hex))).toEqual(new Set(['#ffffff', '#010101']));
  });

  it('caps the whole section when the cut lands exactly on a step', () => {
    // A 20 x 20 x 5 slab with a 10 x 10 x 10 tower on it, cut at the top of the slab.
    // The slab's top face and the foot of the tower both lie exactly in the cut.
    const stepped = meshOf(box([0, 0, 0], [20, 20, 5]), box([5, 5, 5], [15, 15, 15]));
    const r = buildLayerPreviewMesh(stepped, { bands: resolveLayerBands(WHITE, [{ z: 5, color: RED }], 15, P), profile: P, cutZ: 5 });
    expect(r.cutZ).toBeCloseTo(5, 6);
    expect(r.capped).toBe(true);
    const ts = trisOf(r.mesh);
    // Everything at the cut faces up and covers the full 20 x 20 section: no hole under the tower.
    const top = ts.filter((t) => t.z.every((z) => Math.abs(z - 5) < 1e-5));
    expect(top.every((t) => t.nz > 0.5)).toBe(true);
    expect(areaWhere(top, () => true)).toBeCloseTo(400, 3);
    // Nothing above the cut, and the slab's walls are whole.
    expect(Math.max(...ts.flatMap((t) => t.z))).toBeCloseTo(5, 5);
    expect(areaWhere(ts, (t) => Math.abs(t.nz) < 0.5)).toBeCloseTo(80 * 5, 3);
    // The top of the print so far is the layer below the change: white.
    expect(new Set(top.map((t) => t.hex))).toEqual(new Set([WHITE]));
  });

  it('caps the outlines that close even when another one is open', () => {
    // Two separate cubes; one has lost a side triangle.
    const good = box([0, 0, 0], [10, 10, 10]);
    const broken = box([20, 0, 0], [30, 10, 10]);
    broken.tris = broken.tris.slice(0, 33);
    const r = buildLayerPreviewMesh(meshOf(good, broken), { bands: resolveLayerBands(WHITE, [], 10, P), profile: P, cutZ: 5 });
    expect(r.capped).toBe(false);
    const cap = trisOf(r.mesh).filter((t) => t.nz > 0.5 && t.z.every((z) => Math.abs(z - 5) < 1e-5));
    expect(areaWhere(cap, (t) => t.cx < 10)).toBeCloseTo(100, 4);
  });

  it('the band split is reusable: cutting it at several heights matches a fresh build', () => {
    const split = splitMeshByBands(cube, { bands, profile: P });
    for (const cutZ of [0.1, 3.3, 4, 7.95, 9.7]) {
      const fresh = buildLayerPreviewMesh(cube, { bands, profile: P, cutZ });
      const reused = cutBandMesh(split, cutZ);
      expect(reused.cutZ).toBe(fresh.cutZ);
      expect(reused.shownLayers).toBe(fresh.shownLayers);
      expect(Array.from(reused.mesh.vertProperties)).toEqual(Array.from(fresh.mesh.vertProperties));
      expect(Array.from(reused.mesh.triColors!)).toEqual(Array.from(fresh.mesh.triColors!));
    }
    // The split itself is untouched by cutting.
    expect(cutBandMesh(split).mesh.numTri).toBe(split.numTri);
  });

  it('with blending, the cap shows the estimated colour of the top layer so far', () => {
    const thin = resolveLayerBands('#000000', [{ z: 5, color: '#ffffff' }], 10, P);
    const blend = { transmissionOf: (c: string) => (c === '#ffffff' ? 2 : 0.1), maxLayers: 12, minUpNormal: 0.5 };
    // One white layer printed on the black so far: a dark grey, not white.
    const r = buildLayerPreviewMesh(cube, { bands: thin, profile: P, blend, cutZ: 5.1 });
    const cap = trisOf(r.mesh).filter((t) => t.nz > 0.5);
    const grey = parseInt(cap[0].hex.slice(1, 3), 16);
    expect(grey).toBeGreaterThan(20);
    expect(grey).toBeLessThan(120);
  });

  it('a blend can bring its own colour per layer (a layered photo print\'s prediction)', () => {
    const two = resolveLayerBands('#000000', [{ z: 5, color: '#ffffff' }], 10, P);
    const seen: number[] = [];
    const blend = { transmissionOf: () => 1, maxLayers: 50, minUpNormal: 0.5, colorOnTopOf: (layer: number) => { seen.push(layer); return layer >= 49 ? '#123456' : '#654321'; } };
    const ts = trisOf(buildLayerPreviewMesh(cube, { bands: two, profile: P, blend }).mesh);
    // The top of the cube is the top of the last layer (index 49).
    expect(new Set(ts.filter((t) => t.nz > 0.5).map((t) => t.hex))).toEqual(new Set(['#123456']));
    expect(seen).toContain(49);
    // Walls keep their band's own colour.
    expect(new Set(ts.filter((t) => Math.abs(t.nz) < 0.5).map((t) => t.hex))).toEqual(new Set(['#010101', '#ffffff']));
  });

  it('a painted model can be cut by the layer slider too, in its own colours', () => {
    const painted = meshOf(box([0, 0, 0], [10, 10, 10]));
    // Two red triangles, the rest unpainted.
    painted.triColors = new Uint8Array(12 * 3);
    painted.triColors.set([220, 30, 30, 220, 30, 30], 4 * 3);
    const whole = bandMeshFromColoredMesh(painted, P);
    expect(whole.numTri).toBe(12);
    expect(whole.totalLayers).toBe(50);
    const all = trisOf(cutBandMesh(whole).mesh);
    expect(areaWhere(all, (t) => t.hex === '#dc1e1e')).toBeCloseTo(100, 4);
    expect(areaWhere(all, (t) => t.hex === '#8c8c8c')).toBeCloseTo(500, 4);
    // Cut halfway: walls up to the cut, and a neutral cap over the opening.
    const r = cutBandMesh(whole, 4.9);
    expect(r.cutZ).toBeCloseTo(5, 6);
    expect(r.capped).toBe(true);
    const ts = trisOf(r.mesh);
    expect(Math.max(...ts.flatMap((t) => t.z))).toBeCloseTo(5, 5);
    expect(areaWhere(ts, (t) => t.nz > 0.5 && t.hex === '#8c8c8c')).toBeCloseTo(100, 4);
    expect(areaWhere(ts, (t) => Math.abs(t.nz) < 0.5)).toBeCloseTo(200, 4);
  });

  it('with blending, walls are split at the colour changes only, and a cut across mixed faces is still capped', () => {
    // A gabled house: 10 x 20 footprint, walls to 5 mm, ridge at 10 mm along Y.
    // The roof planes face up (they blend); the two gable walls are vertical
    // and share SLOPED edges with the roof, so the two are split differently.
    const verts = [
      0, 0, 0, 10, 0, 0, 10, 20, 0, 0, 20, 0,     // 0-3 floor
      0, 0, 5, 10, 0, 5, 10, 20, 5, 0, 20, 5,     // 4-7 eaves
      5, 0, 10, 5, 20, 10,                        // 8-9 ridge
    ];
    const tris = [
      0, 2, 1, 0, 3, 2,               // floor (down)
      0, 1, 5, 0, 5, 4,               // front wall (y = 0)
      1, 2, 6, 1, 6, 5,               // right wall
      2, 3, 7, 2, 7, 6,               // back wall
      3, 0, 4, 3, 4, 7,               // left wall
      4, 5, 8, 7, 9, 6,               // gables (vertical)
      5, 6, 9, 5, 9, 8,               // right roof plane
      7, 4, 8, 7, 8, 9,               // left roof plane
    ];
    const house: MeshData = { vertProperties: new Float32Array(verts), triVerts: new Uint32Array(tris), numVert: 10, numTri: tris.length / 3, numProp: 3 };
    const twoBands = resolveLayerBands('#000000', [{ z: 2, color: '#ffffff' }], 10, P);
    let asked = 0;
    // A prediction that changes on every layer: the worst case for splitting.
    const blend = { transmissionOf: () => 1, maxLayers: 50, minUpNormal: 0.5, colorOnTopOf: (layer: number) => { asked++; return '#' + (0x101010 + layer * 0x030201).toString(16).padStart(6, '0'); } };
    const opaque = splitMeshByBands(house, { bands: twoBands, profile: P });
    const blended = splitMeshByBands(house, { bands: twoBands, profile: P, blend });
    expect(asked).toBeGreaterThan(0);
    // Only the roof was cut finer: the eight wall triangles, two gables and the floor are as in the opaque split.
    const wallish = (m: { positions: Float32Array; numTri: number }) => {
      let n = 0;
      for (let t = 0; t < m.numTri; t++) {
        const q = m.positions.subarray(t * 9, t * 9 + 9);
        const nz = (q[3] - q[0]) * (q[7] - q[1]) - (q[4] - q[1]) * (q[6] - q[0]);
        const len = Math.hypot((q[4] - q[1]) * (q[8] - q[2]) - (q[5] - q[2]) * (q[7] - q[1]), (q[5] - q[2]) * (q[6] - q[0]) - (q[3] - q[0]) * (q[8] - q[2]), nz);
        if (nz / len < 0.5) n++;
      }
      return n;
    };
    expect(wallish(blended)).toBe(wallish(opaque));
    expect(blended.numTri).toBeGreaterThan(opaque.numTri + 40);
    // Cuts through the roof cross gables (coarse) and roof planes (fine) at once.
    for (const cutZ of [5.9, 6.5, 7.3, 8.1, 9.3]) {
      const r = cutBandMesh(blended, cutZ);
      expect(r.capped).toBe(true);
      const cap = trisOf(r.mesh).filter((t) => t.nz > 0.99 && t.z.every((z) => Math.abs(z - r.cutZ!) < 1e-5));
      // At height h in the roof the section is (10 - 2 (h - 5)) wide and 20 long.
      // (The outline is taken a hair below the layer top, so on a slope it is a few microns wider.)
      expect(areaWhere(cap, () => true)).toBeCloseTo((10 - 2 * (r.cutZ! - 5)) * 20, 1);
    }
  });

  it('handles an empty mesh', () => {
    const empty: MeshData = { vertProperties: new Float32Array(0), triVerts: new Uint32Array(0), numVert: 0, numTri: 0, numProp: 3 };
    expect(buildLayerPreviewMesh(empty, { bands, profile: P })).toMatchObject({ totalLayers: 0, shownLayers: 0, cutZ: null });
  });
});
