// Build the mesh a "print preview" shows: the model's own surface, cut along
// layer boundaries and coloured by the filament each layer prints in.
//
// A filament change at a layer makes colour a function of height, so no
// slicing is needed: every triangle is split at the band boundaries and each
// piece takes its band's colour. The layer slider is one more split plane
// (pieces above it are dropped and the opening is capped). With blending on,
// upward-facing pieces take an ESTIMATED see-through colour instead.
//
// Pure: no DOM, no engine. The result is an ordinary coloured `MeshData`, so
// the viewport, the offscreen renderer and the headless preview can all draw
// it. Unit tests: tests/unit/layerPreviewMesh.test.ts.

import { ShapeUtils, Vector2 } from 'three';
import type { MeshData } from '../geometry/types';
import {
  bandAtZ, estimateTopColor, hexToRgb, layerCount, layerIndexAt, layerTopZ,
  type LayerBand, type LayerProfile, type Rgb,
} from './layerColors';

export interface LayerPreviewOptions {
  /** The bands to draw, from `resolveLayerBands` (heights are above the bed). */
  bands: readonly LayerBand[];
  profile: LayerProfile;
  /** Show the print only up to this height above the bed. Snapped to the top
   *  of the layer it falls in. Omit (or pass a height at/above the model) for
   *  the whole model. */
  cutZ?: number;
  /** Estimate blending on upward-facing surfaces. Omit for opaque bands. */
  blend?: {
    /** mm of a colour's filament that light gets through. */
    transmissionOf: (color: string) => number;
    /** How many layers down to look. */
    maxLayers: number;
    /** A face counts as upward-facing when its unit normal's z is at least this. */
    minUpNormal: number;
  };
}

export interface LayerPreviewResult {
  /** Unindexed, coloured mesh (every triangle owns its three vertices). */
  mesh: MeshData;
  /** Z of the bed in model coordinates (the model's lowest point). */
  bedZ: number;
  totalLayers: number;
  /** Layers shown (equals `totalLayers` when not cut). */
  shownLayers: number;
  /** Height above the bed the model was cut at, or null when shown whole. */
  cutZ: number | null;
  /** False when the cut opening could not be closed (an open or broken mesh). */
  capped: boolean;
}

type P3 = [number, number, number];
const EPS = 1e-7;

/** Split a convex polygon at height `z` into the part below and the part above. */
function splitAtZ(poly: P3[], z: number): { below: P3[]; above: P3[]; cut: P3[] } {
  const below: P3[] = [];
  const above: P3[] = [];
  const cut: P3[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const da = a[2] - z;
    const db = b[2] - z;
    if (da <= EPS) below.push(a);
    if (da >= -EPS) above.push(a);
    if ((da < -EPS && db > EPS) || (da > EPS && db < -EPS)) {
      const t = da / (da - db);
      const p: P3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, z];
      below.push(p);
      above.push(p);
      cut.push(p);
    } else if (Math.abs(da) <= EPS && ((db > EPS) || (db < -EPS))) {
      // A vertex exactly on the plane with the edge leaving it: it is a cut end too.
      cut.push(a);
    }
  }
  return { below, above, cut };
}

/** Chain cut segments (in XY) into closed loops. Returns null when any chain fails to close. */
function chainLoops(segments: [P3, P3][]): [number, number][][] | null {
  const key = (p: P3) => `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)}`;
  const next = new Map<string, { to: P3; used: boolean }[]>();
  for (const [a, b] of segments) {
    if (key(a) === key(b)) continue;
    if (!next.has(key(a))) next.set(key(a), []);
    next.get(key(a))!.push({ to: b, used: false });
  }
  const loops: [number, number][][] = [];
  for (const [startKey, outs] of next) {
    for (const first of outs) {
      if (first.used) continue;
      const loop: [number, number][] = [];
      let edge: { to: P3; used: boolean } | undefined = first;
      let guard = 0;
      while (edge && !edge.used && guard++ <= segments.length) {
        edge.used = true;
        loop.push([edge.to[0], edge.to[1]]);
        if (key(edge.to) === startKey) break;
        edge = next.get(key(edge.to))?.find((e) => !e.used);
      }
      const end = loop[loop.length - 1];
      if (!end || `${Math.round(end[0] * 1e4)},${Math.round(end[1] * 1e4)}` !== startKey) return null;
      if (loop.length >= 3) loops.push(loop);
    }
  }
  return loops;
}

function pointInLoop(x: number, y: number, loop: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const [xi, yi] = loop[i];
    const [xj, yj] = loop[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Triangulate the region enclosed by the loops (even-odd nesting: islands inside holes are solid). */
function triangulateCap(loops: [number, number][][]): [number, number][][] {
  const depth = loops.map((l, i) => loops.reduce((d, other, j) => d + (i !== j && pointInLoop(l[0][0], l[0][1], other) ? 1 : 0), 0));
  const tris: [number, number][][] = [];
  loops.forEach((outer, i) => {
    if (depth[i] % 2 !== 0) return;
    // Holes directly inside this outline: one level deeper and contained by it.
    const holes = loops.filter((h, j) => depth[j] === depth[i] + 1 && pointInLoop(h[0][0], h[0][1], outer));
    const all = [outer, ...holes].flat();
    const faces = ShapeUtils.triangulateShape(outer.map((p) => new Vector2(p[0], p[1])), holes.map((h) => h.map((p) => new Vector2(p[0], p[1]))));
    for (const f of faces) tris.push([all[f[0]], all[f[1]], all[f[2]]]);
  });
  return tris;
}

/**
 * Build the preview mesh. `mesh` is the model as the app holds it (any
 * `numProp >= 3`; only positions are read). Heights in `opts` are measured
 * from the model's lowest point, which is where it sits on the bed.
 */
export function buildLayerPreviewMesh(mesh: MeshData, opts: LayerPreviewOptions): LayerPreviewResult {
  const { vertProperties: vp, triVerts, numTri, numProp } = mesh;
  const { bands, profile, blend } = opts;
  let bedZ = Infinity;
  let topZ = -Infinity;
  for (let t = 0; t < numTri * 3; t++) {
    const z = vp[triVerts[t] * numProp + 2];
    if (z < bedZ) bedZ = z;
    if (z > topZ) topZ = z;
  }
  if (numTri === 0 || !Number.isFinite(bedZ)) {
    return { mesh: { vertProperties: new Float32Array(0), triVerts: new Uint32Array(0), numVert: 0, numTri: 0, numProp: 3, triColors: new Uint8Array(0) }, bedZ: 0, totalLayers: 0, shownLayers: 0, cutZ: null, capped: true };
  }
  const height = topZ - bedZ;
  const totalLayers = layerCount(height, profile);

  // The cut: snap to the top of the layer the requested height falls in.
  let cut: number | null = null;
  let shownLayers = totalLayers;
  if (opts.cutZ !== undefined && opts.cutZ < height - EPS) {
    const layer = Math.max(0, layerIndexAt(Math.max(opts.cutZ, 0), profile));
    if (layer < totalLayers - 1) { cut = layerTopZ(layer, profile); shownLayers = layer + 1; }
  }

  // Heights (above the bed) to split at: band starts, the cut, and with
  // blending the layer tops where the see-through colour still changes.
  const planes = new Set<number>();
  const addPlane = (z: number) => { if (z > EPS && z < height - EPS) planes.add(Math.round(z * 1e5) / 1e5); };
  for (const b of bands.slice(1)) addPlane(b.fromZ);
  if (cut !== null) addPlane(cut);
  if (blend) {
    for (const b of bands.slice(1)) for (let k = 0; k < blend.maxLayers && b.firstLayer + k <= b.lastLayer; k++) addPlane(layerTopZ(b.firstLayer + k, profile));
  }
  const sorted = [...planes].sort((a, b) => a - b);
  const cutKey = cut === null ? null : Math.round(cut * 1e5) / 1e5;

  const rgbCache = new Map<string, Rgb>();
  const rgbOf = (hex: string) => { let c = rgbCache.get(hex); if (!c) { c = hexToRgb(hex); rgbCache.set(hex, c); } return c; };

  const pos: number[] = [];
  const col: number[] = [];
  const emit = (a: P3, b: P3, c: P3, rgb: Rgb) => {
    pos.push(a[0], a[1], a[2] + bedZ, b[0], b[1], b[2] + bedZ, c[0], c[1], c[2] + bedZ);
    // (0,0,0) reads as "unpainted" elsewhere in the app; keep true black visible.
    const black = rgb[0] === 0 && rgb[1] === 0 && rgb[2] === 0;
    col.push(black ? 1 : rgb[0], black ? 1 : rgb[1], black ? 1 : rgb[2]);
  };
  const cutSegments: [P3, P3][] = [];

  for (let t = 0; t < numTri; t++) {
    const v = (k: number): P3 => { const i = triVerts[t * 3 + k] * numProp; return [vp[i], vp[i + 1], vp[i + 2] - bedZ]; };
    const a = v(0), b = v(1), c = v(2);
    // Face normal z (unit), for the up/down decisions below.
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-12) continue; // degenerate
    const upness = nz / len;

    const zMin = Math.min(a[2], b[2], c[2]);
    const zMax = Math.max(a[2], b[2], c[2]);
    let rest: P3[] = [a, b, c];
    const pieces: P3[][] = [];
    for (const z of sorted) {
      if (z <= zMin + EPS) continue;
      if (z >= zMax - EPS) break;
      const s = splitAtZ(rest, z);
      if (z === cutKey && s.cut.length === 2) {
        // Orient the segment so the solid lies to its left when seen from above.
        const [p, q] = s.cut;
        const dx = q[0] - p[0], dy = q[1] - p[1];
        cutSegments.push(dx * ny - dy * nx > 0 ? [p, q] : [q, p]);
      }
      if (s.below.length >= 3) pieces.push(s.below);
      rest = s.above;
      if (rest.length < 3) break;
    }
    if (rest.length >= 3) pieces.push(rest);

    for (const poly of pieces) {
      let cz = 0;
      for (const p of poly) cz += p[2];
      cz /= poly.length;
      if (cut !== null && cz > cut + EPS) continue; // above the slider
      const flat = zMax - zMin < EPS;
      // A flat face on a layer boundary belongs to the layer below when it
      // faces up (a top surface) and to the layer above when it faces down.
      const lookupZ = flat && upness < 0 ? cz + profile.layerHeight / 2 : cz;
      const band = bandAtZ(bands, lookupZ, profile);
      if (!band) continue;
      const seeThrough = blend && upness >= blend.minUpNormal ? estimateTopColor(bands, cz, profile, blend.transmissionOf, blend.maxLayers) : null;
      const rgb = rgbOf(seeThrough ?? band.color);
      for (let i = 1; i < poly.length - 1; i++) emit(poly[0], poly[i], poly[i + 1], rgb);
    }
  }

  // Close the opening left by the slider with a flat cap in that layer's colour.
  let capped = true;
  if (cut !== null) {
    // A face lying exactly in the cut plane is not split, so it leaves no
    // segments; that is fine (the face itself closes the model there).
    const loops = cutSegments.length > 0 ? chainLoops(cutSegments) : [];
    if (loops === null) capped = false;
    else {
      const band = bandAtZ(bands, cut, profile);
      const rgb = rgbOf(band ? band.color : '#808080');
      for (const tri of triangulateCap(loops)) {
        const [p, q, r] = tri;
        const ccw = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]) > 0;
        const pts: P3[] = (ccw ? [p, q, r] : [p, r, q]).map((s) => [s[0], s[1], cut!] as P3);
        emit(pts[0], pts[1], pts[2], rgb);
      }
    }
  }

  const outTri = pos.length / 9;
  const index = new Uint32Array(outTri * 3);
  for (let i = 0; i < index.length; i++) index[i] = i;
  return {
    mesh: { vertProperties: new Float32Array(pos), triVerts: index, numVert: outTri * 3, numTri: outTri, numProp: 3, triColors: new Uint8Array(col) },
    bedZ,
    totalLayers,
    shownLayers,
    cutZ: cut,
    capped,
  };
}
