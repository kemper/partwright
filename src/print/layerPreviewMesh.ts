// Build the mesh a "print preview" shows: the model's own surface, cut along
// layer boundaries and coloured by the filament each layer prints in.
//
// A filament change at a layer makes colour a function of height, so no
// slicing is needed: every triangle is split at the band boundaries and each
// piece takes its band's colour. With blending on, upward-facing pieces take
// an ESTIMATED see-through colour instead.
//
// Two stages, so dragging the layer slider stays cheap on a big model:
//   1. `splitMeshByBands`  the band split and colouring. Depends on the model
//      and the colours only, so callers keep it between slider moves.
//   2. `cutBandMesh`       the layer slider: drop what is above the cut, trim
//      the triangles that cross it and cap the opening.
//
// Pure: no DOM, no engine. The result is an ordinary coloured `MeshData`, so
// the viewport, the offscreen renderer and the headless preview can all draw
// it. Unit tests: tests/unit/layerPreviewMesh.test.ts.

import { ShapeUtils, Vector2 } from 'three';
import type { MeshData } from '../geometry/types';
import {
  estimateTopColor, hexToRgb, layerCount, layerIndexAt, layerTopZ,
  type LayerBand, type LayerProfile,
} from './layerColors';

export interface LayerBandOptions {
  /** The bands to draw, from `resolveLayerBands` (heights are above the bed). */
  bands: readonly LayerBand[];
  profile: LayerProfile;
  /** Estimate blending on upward-facing surfaces. Omit for opaque bands. */
  blend?: {
    /** mm of a colour's filament that light gets through. */
    transmissionOf: (color: string) => number;
    /** How many layers down to look (and how many layers above a colour change still change shade). */
    maxLayers: number;
    /** The colour seen on top of 0-based `layer`, as "#rrggbb". When given it
     *  replaces the built-in estimate: a layered photo print brings the
     *  prediction its own solver made. */
    colorOnTopOf?: (layer: number) => string | null;
    /** A face counts as upward-facing when its unit normal's z is at least this. */
    minUpNormal: number;
  };
}

export interface LayerPreviewOptions extends LayerBandOptions {
  /** Show the print only up to this height above the bed. Snapped to the top
   *  of the layer it falls in. Omit (or pass a height at/above the model) for
   *  the whole model. */
  cutZ?: number;
}

/** The model split and coloured by band, before the layer slider is applied. */
export interface LayerBandMesh {
  /** Nine numbers per triangle (three corners), in model coordinates. */
  positions: Float32Array;
  /** One RGB per triangle. Black is stored as (1,1,1): (0,0,0) reads as "unpainted" elsewhere in the app. */
  colors: Uint8Array;
  numTri: number;
  /** Z of the bed in model coordinates (the model's lowest point). */
  bedZ: number;
  /** The model's height above the bed. */
  height: number;
  totalLayers: number;
  profile: LayerProfile;
  /** RGB of the cap drawn when the model is cut at the top of a layer (index = layer). */
  capColorOfLayer: (layer: number) => [number, number, number];
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
  /** False when part of the cut opening could not be closed (an open or broken mesh). */
  capped: boolean;
}

type P3 = [number, number, number];
const EPS = 1e-7;

/** Where the edge a→b meets height `z`. Always measured from the lower end, so
 *  two triangles sharing the edge get the very same point. */
function edgeAtZ(a: P3, b: P3, z: number): P3 {
  const lo = a[2] <= b[2] ? a : b;
  const hi = lo === a ? b : a;
  const t = (z - lo[2]) / (hi[2] - lo[2]);
  return [lo[0] + (hi[0] - lo[0]) * t, lo[1] + (hi[1] - lo[1]) * t, z];
}

/** Split a convex polygon at height `z` into the part below and the part above. */
function splitAtZ(poly: P3[], z: number): { below: P3[]; above: P3[] } {
  const below: P3[] = [];
  const above: P3[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const da = a[2] - z;
    const db = b[2] - z;
    if (da <= EPS) below.push(a);
    if (da >= -EPS) above.push(a);
    if ((da < -EPS && db > EPS) || (da > EPS && db < -EPS)) {
      const p = edgeAtZ(a, b, z);
      below.push(p);
      above.push(p);
    }
  }
  return { below, above };
}

/** Growable triangle output: nine positions and one RGB per triangle. */
class TriSink {
  pos: Float32Array;
  col: Uint8Array;
  n = 0;
  constructor(capacity: number) {
    const cap = Math.max(16, capacity);
    this.pos = new Float32Array(cap * 9);
    this.col = new Uint8Array(cap * 3);
  }
  private room(): void {
    if ((this.n + 1) * 9 <= this.pos.length) return;
    const pos = new Float32Array(this.pos.length * 2);
    pos.set(this.pos);
    this.pos = pos;
    const col = new Uint8Array(this.col.length * 2);
    col.set(this.col);
    this.col = col;
  }
  push(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, r: number, g: number, b: number): void {
    this.room();
    const p = this.pos, i = this.n * 9, j = this.n * 3;
    p[i] = ax; p[i + 1] = ay; p[i + 2] = az;
    p[i + 3] = bx; p[i + 4] = by; p[i + 5] = bz;
    p[i + 6] = cx; p[i + 7] = cy; p[i + 8] = cz;
    this.col[j] = r; this.col[j + 1] = g; this.col[j + 2] = b;
    this.n++;
  }
}

/** Colour as stored on the preview mesh ((0,0,0) would read as "unpainted"). */
function storedRgb(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex);
  return r === 0 && g === 0 && b === 0 ? [1, 1, 1] : [r, g, b];
}

/**
 * Stage 1: split the model at the band boundaries and colour every piece.
 * `mesh` is the model as the app holds it (any `numProp >= 3`; only positions
 * are read). Band heights are measured from the model's lowest point, which is
 * where it sits on the bed.
 */
export function splitMeshByBands(mesh: MeshData, opts: LayerBandOptions): LayerBandMesh {
  const { vertProperties: vp, triVerts, numTri, numProp } = mesh;
  const { bands, profile, blend } = opts;
  let bedZ = Infinity;
  let topZ = -Infinity;
  for (let t = 0; t < numTri * 3; t++) {
    const z = vp[triVerts[t] * numProp + 2];
    if (z < bedZ) bedZ = z;
    if (z > topZ) topZ = z;
  }
  if (numTri === 0 || !Number.isFinite(bedZ) || bands.length === 0) {
    return { positions: new Float32Array(0), colors: new Uint8Array(0), numTri: 0, bedZ: 0, height: 0, totalLayers: 0, profile, capColorOfLayer: () => [128, 128, 128] };
  }
  const height = topZ - bedZ;
  const totalLayers = layerCount(height, profile);

  // Heights (above the bed) to split at: band starts, and with blending the
  // layer tops where the see-through colour still changes.
  const planeSet = new Set<number>();
  const addPlane = (z: number) => { if (z > EPS && z < height - EPS) planeSet.add(Math.round(z * 1e5) / 1e5); };
  for (const b of bands.slice(1)) addPlane(b.fromZ);
  if (blend) {
    for (const b of bands.slice(1)) for (let k = 0; k < blend.maxLayers && b.firstLayer + k <= b.lastLayer; k++) addPlane(layerTopZ(b.firstLayer + k, profile));
  }
  // In model coordinates, so pieces keep the model's own vertex values.
  const planes = Float64Array.from([...planeSet].sort((a, b) => a - b), (z) => z + bedZ);

  // Colour per layer, worked out once instead of per piece.
  const lastLayer = Math.max(totalLayers - 1, bands[bands.length - 1].lastLayer);
  const bandRgb = new Uint8Array((lastLayer + 1) * 3);
  for (let layer = 0, bi = 0; layer <= lastLayer; layer++) {
    while (bi < bands.length - 1 && layer > bands[bi].lastLayer) bi++;
    bandRgb.set(storedRgb(bands[bi].color), layer * 3);
  }
  const seeRgb = blend ? new Uint8Array((lastLayer + 1) * 3) : null;
  const seeKnown = blend ? new Uint8Array(lastLayer + 1) : null;
  const clampLayer = (layer: number) => (layer < 0 ? 0 : layer > lastLayer ? lastLayer : layer);
  /** Offset into `seeRgb` of the estimated see-through colour on top of `layer`. */
  const seeThrough = (layer: number): number => {
    if (!seeKnown![layer]) {
      const hex = blend!.colorOnTopOf ? blend!.colorOnTopOf(layer) : estimateTopColor(bands, layerTopZ(layer, profile), profile, blend!.transmissionOf, blend!.maxLayers);
      seeRgb!.set(hex ? storedRgb(hex) : [bandRgb[layer * 3], bandRgb[layer * 3 + 1], bandRgb[layer * 3 + 2]], layer * 3);
      seeKnown![layer] = 1;
    }
    return layer * 3;
  };

  const half = profile.layerHeight / 2;
  /** Offset into the colour table for a piece whose centroid is at model height `z`.
   *  A flat face on a layer boundary belongs to the layer below when it faces
   *  up (a top surface) and to the layer above when it faces down. */
  const colourAt = (z: number, flatDown: boolean, sees: boolean): number => {
    const rel = z - bedZ;
    return sees ? seeThrough(clampLayer(layerIndexAt(rel, profile))) : clampLayer(layerIndexAt(flatDown ? rel + half : rel, profile)) * 3;
  };

  const out = new TriSink(numTri + (numTri >> 2));
  const nPlanes = planes.length;

  for (let t = 0; t < numTri; t++) {
    const ia = triVerts[t * 3] * numProp, ib = triVerts[t * 3 + 1] * numProp, ic = triVerts[t * 3 + 2] * numProp;
    const ax = vp[ia], ay = vp[ia + 1], az = vp[ia + 2];
    const bx = vp[ib], by = vp[ib + 1], bz = vp[ib + 2];
    const cx = vp[ic], cy = vp[ic + 1], cz = vp[ic + 2];
    // Face normal z (unit), for the up/down decisions below.
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const wx = cx - ax, wy = cy - ay, wz = cz - az;
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-12) continue; // degenerate
    const upness = nz / len;
    const zMin = Math.min(az, bz, cz);
    const zMax = Math.max(az, bz, cz);
    const flat = zMax - zMin < EPS;
    const seesThrough = blend !== undefined && upness >= blend.minUpNormal;

    const table = seesThrough ? seeRgb! : bandRgb;
    const flatDown = flat && upness < 0;

    // First plane above the triangle's lowest point (binary search).
    let lo = 0, hi = nPlanes;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (planes[mid] <= zMin + EPS) lo = mid + 1; else hi = mid; }
    if (lo === nPlanes || planes[lo] >= zMax - EPS) {
      // The usual case: the triangle lies inside one band.
      const at = colourAt((az + bz + cz) / 3, flatDown, seesThrough);
      out.push(ax, ay, az, bx, by, bz, cx, cy, cz, table[at], table[at + 1], table[at + 2]);
      continue;
    }

    let rest: P3[] = [[ax, ay, az], [bx, by, bz], [cx, cy, cz]];
    const pieces: P3[][] = [];
    for (let k = lo; k < nPlanes; k++) {
      const z = planes[k];
      if (z >= zMax - EPS) break;
      const s = splitAtZ(rest, z);
      if (s.below.length >= 3) pieces.push(s.below);
      rest = s.above;
      if (rest.length < 3) break;
    }
    if (rest.length >= 3) pieces.push(rest);
    for (const poly of pieces) {
      let sum = 0;
      for (const p of poly) sum += p[2];
      const at = colourAt(sum / poly.length, flatDown, seesThrough);
      const p0 = poly[0];
      for (let i = 1; i < poly.length - 1; i++) {
        const p1 = poly[i], p2 = poly[i + 1];
        out.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], table[at], table[at + 1], table[at + 2]);
      }
    }
  }

  return {
    positions: out.pos.subarray(0, out.n * 9),
    colors: out.col.subarray(0, out.n * 3),
    numTri: out.n,
    bedZ,
    height,
    totalLayers,
    profile,
    capColorOfLayer: (layer) => {
      const l = clampLayer(layer);
      const table = blend ? seeRgb! : bandRgb;
      const at = blend ? seeThrough(l) : l * 3;
      return [table[at], table[at + 1], table[at + 2]];
    },
  };
}

/** Colour of a cut's cap, and of unpainted triangles, when the model is drawn in its own colours. */
const PLAIN_RGB: [number, number, number] = [140, 140, 140];

/**
 * A model drawn in its OWN colours (paint, labels, or none), in the shape
 * `cutBandMesh` takes, so the layer slider works on a model that has no layer
 * colours too. The inside of a painted model has no colour to show, so the
 * cap of a cut is a neutral grey.
 */
export function bandMeshFromColoredMesh(mesh: MeshData, profile: LayerProfile): LayerBandMesh {
  const { vertProperties: vp, triVerts, numTri, numProp, triColors } = mesh;
  const positions = new Float32Array(numTri * 9);
  const colors = new Uint8Array(numTri * 3);
  let bedZ = Infinity;
  let topZ = -Infinity;
  for (let t = 0; t < numTri; t++) {
    for (let k = 0; k < 3; k++) {
      const i = triVerts[t * 3 + k] * numProp;
      positions[t * 9 + k * 3] = vp[i];
      positions[t * 9 + k * 3 + 1] = vp[i + 1];
      positions[t * 9 + k * 3 + 2] = vp[i + 2];
      if (vp[i + 2] < bedZ) bedZ = vp[i + 2];
      if (vp[i + 2] > topZ) topZ = vp[i + 2];
    }
    const r = triColors ? triColors[t * 3] : 0, g = triColors ? triColors[t * 3 + 1] : 0, b = triColors ? triColors[t * 3 + 2] : 0;
    const unpainted = r === 0 && g === 0 && b === 0;
    colors[t * 3] = unpainted ? PLAIN_RGB[0] : r;
    colors[t * 3 + 1] = unpainted ? PLAIN_RGB[1] : g;
    colors[t * 3 + 2] = unpainted ? PLAIN_RGB[2] : b;
  }
  if (numTri === 0 || !Number.isFinite(bedZ)) {
    return { positions: new Float32Array(0), colors: new Uint8Array(0), numTri: 0, bedZ: 0, height: 0, totalLayers: 0, profile, capColorOfLayer: () => PLAIN_RGB };
  }
  const height = topZ - bedZ;
  return { positions, colors, numTri, bedZ, height, totalLayers: layerCount(height, profile), profile, capColorOfLayer: () => PLAIN_RGB };
}

type P2 = [number, number];

/** Chain cut segments (in XY) into closed loops. `open` is true when some chain did not close. */
function chainLoops(segments: [P2, P2][]): { loops: P2[][]; open: boolean } {
  const key = (p: P2) => `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)}`;
  const next = new Map<string, { to: P2; toKey: string; used: boolean }[]>();
  for (const [a, b] of segments) {
    const ka = key(a), kb = key(b);
    if (ka === kb) continue;
    let outs = next.get(ka);
    if (!outs) { outs = []; next.set(ka, outs); }
    outs.push({ to: b, toKey: kb, used: false });
  }
  const loops: P2[][] = [];
  let open = false;
  for (const [startKey, outs] of next) {
    for (const first of outs) {
      if (first.used) continue;
      const loop: P2[] = [];
      let edge: { to: P2; toKey: string; used: boolean } | undefined = first;
      let closed = false;
      while (edge && !edge.used) {
        edge.used = true;
        loop.push(edge.to);
        if (edge.toKey === startKey) { closed = true; break; }
        edge = next.get(edge.toKey)?.find((e) => !e.used);
      }
      if (!closed) open = true;
      else if (loop.length >= 3) loops.push(loop);
    }
  }
  return { loops, open };
}

function pointInLoop(x: number, y: number, loop: P2[]): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const [xi, yi] = loop[i];
    const [xj, yj] = loop[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Triangulate the region enclosed by the loops (even-odd nesting: islands inside holes are solid). */
function triangulateCap(loops: P2[][]): P2[][] {
  // Bounding boxes first: a lattice cut can have thousands of loops.
  const boxes = loops.map((l) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of l) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return [x0, y0, x1, y1] as const;
  });
  const contains = (outer: number, inner: number): boolean => {
    const [x, y] = loops[inner][0];
    const b = boxes[outer];
    return x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3] && pointInLoop(x, y, loops[outer]);
  };
  const depth = loops.map((_, i) => { let d = 0; for (let j = 0; j < loops.length; j++) if (i !== j && contains(j, i)) d++; return d; });
  const tris: P2[][] = [];
  loops.forEach((outer, i) => {
    if (depth[i] % 2 !== 0) return;
    // Holes directly inside this outline: one level deeper and contained by it.
    const holes = loops.filter((_, j) => depth[j] === depth[i] + 1 && contains(i, j));
    const all = [outer, ...holes].flat();
    const faces = ShapeUtils.triangulateShape(outer.map((p) => new Vector2(p[0], p[1])), holes.map((h) => h.map((p) => new Vector2(p[0], p[1]))));
    for (const f of faces) tris.push([all[f[0]], all[f[1]], all[f[2]]]);
  });
  return tris;
}

function previewMesh(positions: Float32Array, colors: Uint8Array, numTri: number): MeshData {
  const index = new Uint32Array(numTri * 3);
  for (let i = 0; i < index.length; i++) index[i] = i;
  return { vertProperties: positions, triVerts: index, numVert: numTri * 3, numTri, numProp: 3, triColors: colors };
}

/**
 * Stage 2: the layer slider. Shows the print up to `cutZ` (mm above the bed,
 * snapped to the top of the layer it falls in) and caps the opening. Omit
 * `cutZ`, or pass a height at/above the model, for the whole model.
 */
export function cutBandMesh(split: LayerBandMesh, cutZ?: number): LayerPreviewResult {
  const { positions: src, colors: srcCol, numTri, bedZ, height, totalLayers, profile } = split;

  // The cut: snap to the top of the layer the requested height falls in.
  let cut: number | null = null;
  let shownLayers = totalLayers;
  if (numTri > 0 && cutZ !== undefined && cutZ < height - EPS) {
    const layer = Math.max(0, layerIndexAt(Math.max(cutZ, 0), profile));
    if (layer < totalLayers - 1) { cut = layerTopZ(layer, profile); shownLayers = layer + 1; }
  }
  if (cut === null) {
    return { mesh: previewMesh(src, srcCol, numTri), bedZ, totalLayers, shownLayers, cutZ: null, capped: true };
  }

  // Models are full of faces and edges lying exactly on a layer top (a step, a
  // shelf, the foot of a boss). Cutting a hair BELOW the layer top puts all of
  // them cleanly above the cut, so every wall under it is crossed and the
  // opening's outline is complete. What is kept is then drawn AT the layer top.
  const capZ = bedZ + cut;
  const plane = capZ - Math.max(profile.layerHeight * 1e-3, height * 1e-6);
  const out = new TriSink(numTri);
  const segments: [P2, P2][] = [];
  const corner: P3[] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const meet = (a: P3, b: P3): P3 => { const p = edgeAtZ(a, b, plane); p[2] = capZ; return p; };

  for (let t = 0; t < numTri; t++) {
    const i = t * 9;
    const az = src[i + 2], bz = src[i + 5], cz = src[i + 8];
    const below = (az < plane ? 1 : 0) + (bz < plane ? 1 : 0) + (cz < plane ? 1 : 0);
    if (below === 0) continue; // above the slider
    const j = t * 3;
    const r = srcCol[j], g = srcCol[j + 1], b = srcCol[j + 2];
    if (below === 3) {
      out.push(src[i], src[i + 1], az, src[i + 3], src[i + 4], bz, src[i + 6], src[i + 7], cz, r, g, b);
      continue;
    }
    for (let k = 0; k < 3; k++) { corner[k][0] = src[i + k * 3]; corner[k][1] = src[i + k * 3 + 1]; corner[k][2] = src[i + k * 3 + 2]; }
    // Walk the triangle's edges keeping the part below the cut. The surface
    // leaves the kept part at `exit` and comes back at `entry`; since
    // neighbours share edges, the entry→exit segments chain into the outline.
    const poly: P3[] = [];
    let exit: P3 | null = null;
    let entry: P3 | null = null;
    for (let k = 0; k < 3; k++) {
      const p = corner[k], q = corner[(k + 1) % 3];
      const pBelow = p[2] < plane, qBelow = q[2] < plane;
      if (pBelow) poly.push([p[0], p[1], p[2]]);
      if (pBelow !== qBelow) {
        const m = meet(p, q);
        poly.push(m);
        if (pBelow) exit = m; else entry = m;
      }
    }
    if (exit && entry) segments.push([[entry[0], entry[1]], [exit[0], exit[1]]]);
    const p0 = poly[0];
    for (let k = 1; k < poly.length - 1; k++) {
      const p1 = poly[k], p2 = poly[k + 1];
      out.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], r, g, b);
    }
  }

  // Close the opening with a flat cap in that layer's colour. Loops that do
  // not close (an open or broken mesh) are left out and reported.
  const { loops, open } = chainLoops(segments);
  const [r, g, b] = split.capColorOfLayer(shownLayers - 1);
  for (const [p, q, s] of triangulateCap(loops)) {
    const ccw = (q[0] - p[0]) * (s[1] - p[1]) - (q[1] - p[1]) * (s[0] - p[0]) > 0;
    const [u, v] = ccw ? [q, s] : [s, q];
    out.push(p[0], p[1], capZ, u[0], u[1], capZ, v[0], v[1], capZ, r, g, b);
  }

  return {
    mesh: previewMesh(out.pos.subarray(0, out.n * 9), out.col.subarray(0, out.n * 3), out.n),
    bedZ,
    totalLayers,
    shownLayers,
    cutZ: cut,
    capped: !open,
  };
}

/** Both stages in one call (tests, one-off renders). */
export function buildLayerPreviewMesh(mesh: MeshData, opts: LayerPreviewOptions): LayerPreviewResult {
  return cutBandMesh(splitMeshByBands(mesh, opts), opts.cutZ);
}
