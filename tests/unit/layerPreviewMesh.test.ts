import { describe, it, expect } from 'vitest';
import { buildLayerPreviewMesh } from '../../src/print/layerPreviewMesh';
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

  it('handles an empty mesh', () => {
    const empty: MeshData = { vertProperties: new Float32Array(0), triVerts: new Uint32Array(0), numVert: 0, numTri: 0, numProp: 3 };
    expect(buildLayerPreviewMesh(empty, { bands, profile: P })).toMatchObject({ totalLayers: 0, shownLayers: 0, cutZ: null });
  });
});
