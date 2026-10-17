// Smooth part edges — sub-triangle boundaries from a per-triangle partition.
//
// A partition stored per triangle can only change colour along triangle
// edges, which reads as stair-steps. Here every vertex gets a soft
// membership in the parts around it (area share of its incident triangles),
// diffused a few passes across the boundary band; each vertex then belongs
// to its strongest part, and every triangle whose corners disagree is split
// along the line where the two memberships are equal. More passes = smoother,
// rounder curves.
//
// Crossing points are defined per mesh EDGE (keyed by its two vertices), so
// the two triangles sharing an edge split at the same point — the refined
// mesh stays watertight/manifold. A triangle whose three corners all differ
// gets a centre point and splits into three quads.
//
// Boundaries that already run along a sharp fold are PINNED: a vertex whose
// boundary edges all fold at least `pinCreaseDeg` (groove or ridge — the
// angle between the two faces' normals; default 60°, so CAD/box edges pin
// while a sculpted groove's 30–60° stair-steps still smooth) keeps out of
// the vote (it belongs to both sides) and edges touching it are never split,
// so a seeded boundary that sits exactly on a seam stays there. Only the
// stair-stepped stretches (boundaries crossing flat or faint surface) move.
//
// The same cut drives both the on-screen overlay (sub-triangles mapped onto
// the displayed mesh) and acceptParts' re-mesh of the import (buildCutMesh),
// so what you see is what gets saved. Pure + Worker-safe.

import type { SegMesh } from './types';

/** Labels tracked per vertex (top-K by membership). */
const K = 3;
/** Crossing points are kept this far from an edge's ends so a split never
 *  produces zero-area sliver triangles. Structural guard, not a knob. */
const T_MIN = 0.08;

/** Default for EdgeCutOptions.pinCreaseDeg (appConfig.segmentation.edgePinCreaseDeg
 *  overrides it from the main thread). */
export const DEFAULT_PIN_CREASE_DEG = 60;

export interface EdgeCut {
  /** Smoothed part per triangle; −2 where the triangle is split. */
  triLabel: Int32Array;
  /** Source triangles that are split, ascending. */
  splitTris: Int32Array;
  /** splitTris[i]'s sub-triangles are subStart[i] .. subStart[i+1]. */
  subStart: Int32Array;
  /** 3 point ids per sub-triangle (into the points table). */
  subPoints: Int32Array;
  subLabel: Int32Array;
  /** Point table. kind 0 = an original vertex (a = vertex id); 1 = on the
   *  edge a–b (a < b) at parameter t from a; 2 = centre of triangle a. */
  pointKind: Uint8Array;
  pointA: Int32Array;
  pointB: Int32Array;
  pointT: Float32Array;
}

interface Membership { lab: Int32Array; w: Float32Array }

/** Vertex → incident triangles (CSR). */
function vertexTriangles(triVerts: Uint32Array, nVert: number): { start: Int32Array; tri: Int32Array } {
  const start = new Int32Array(nVert + 1);
  for (let i = 0; i < triVerts.length; i++) start[triVerts[i] + 1]++;
  for (let v = 0; v < nVert; v++) start[v + 1] += start[v];
  const tri = new Int32Array(triVerts.length);
  const fill = start.slice(0, nVert);
  for (let i = 0; i < triVerts.length; i++) tri[fill[triVerts[i]]++] = Math.floor(i / 3);
  return { start, tri };
}

/** Vertex → neighbouring vertices (CSR, deduped). */
function vertexNeighbors(triVerts: Uint32Array, nVert: number, vt: { start: Int32Array; tri: Int32Array }): { start: Int32Array; nbr: Int32Array } {
  const start = new Int32Array(nVert + 1);
  const out: number[] = [];
  const seen = new Set<number>();
  for (let v = 0; v < nVert; v++) {
    seen.clear();
    for (let j = vt.start[v]; j < vt.start[v + 1]; j++) {
      const t = vt.tri[j];
      for (let k = 0; k < 3; k++) {
        const u = triVerts[t * 3 + k];
        if (u !== v && !seen.has(u)) { seen.add(u); out.push(u); }
      }
    }
    start[v + 1] = out.length;
  }
  return { start, nbr: Int32Array.from(out) };
}

/** Accumulate (label, weight) into a small top-K slot set. */
function addTo(labs: number[], ws: number[], L: number, w: number): void {
  const i = labs.indexOf(L);
  if (i >= 0) ws[i] += w;
  else { labs.push(L); ws.push(w); }
}

function storeTopK(m: Membership, v: number, labs: number[], ws: number[]): void {
  const order = labs.map((_, i) => i).sort((a, b) => ws[b] - ws[a]).slice(0, K);
  let sum = 0;
  for (const i of order) sum += ws[i];
  for (let k = 0; k < K; k++) {
    if (k < order.length && sum > 0) { m.lab[v * K + k] = labs[order[k]]; m.w[v * K + k] = ws[order[k]] / sum; }
    else { m.lab[v * K + k] = -2; m.w[v * K + k] = 0; }
  }
}

function weightOf(m: Membership, v: number, L: number): number {
  for (let k = 0; k < K; k++) if (m.lab[v * K + k] === L) return m.w[v * K + k];
  return 0;
}

export interface EdgeCutOptions {
  /** Triangle adjacency (edge-sharing triangle pairs) — MeshFeatures. */
  adjacency?: { edgeA: Int32Array; edgeB: Int32Array };
  /** Boundary edges folding at least this much (°, convex or concave) pin
   *  their vertices (see header). */
  pinCreaseDeg?: number;
}

function faceNormal(p: Float32Array, tv: Uint32Array, t: number, out: number[]): void {
  const a = tv[t * 3] * 3, b = tv[t * 3 + 1] * 3, c = tv[t * 3 + 2] * 3;
  const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
  const wx = p[c] - p[a], wy = p[c + 1] - p[a + 1], wz = p[c + 2] - p[a + 2];
  const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
  const l = Math.hypot(nx, ny, nz) || 1;
  out[0] = nx / l; out[1] = ny / l; out[2] = nz / l;
}

/** Vertices whose part-boundary edges are all strong creases. */
function pinnedVertices(p: Float32Array, tv: Uint32Array, triPart: Int32Array, nVert: number, opts: EdgeCutOptions): Uint8Array {
  const pinned = new Uint8Array(nVert);
  const c = opts.adjacency;
  const thr = opts.pinCreaseDeg;
  if (!c || thr === undefined || !(thr > 0)) return pinned;
  const cosThr = Math.cos((thr * Math.PI) / 180);
  const na = [0, 0, 0], nb = [0, 0, 0];
  const strong = new Uint8Array(nVert), weak = new Uint8Array(nVert);
  for (let e = 0; e < c.edgeA.length; e++) {
    const ta = c.edgeA[e], tb = c.edgeB[e];
    if (triPart[ta] === triPart[tb]) continue;
    faceNormal(p, tv, ta, na); faceNormal(p, tv, tb, nb);
    const isStrong = na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2] <= cosThr;
    for (let k = 0; k < 3; k++) {
      const v = tv[ta * 3 + k];
      if (v !== tv[tb * 3] && v !== tv[tb * 3 + 1] && v !== tv[tb * 3 + 2]) continue;
      if (isStrong) strong[v] = 1; else weak[v] = 1;
    }
  }
  for (let v = 0; v < nVert; v++) if (strong[v] && !weak[v]) pinned[v] = 1;
  return pinned;
}

export function computeEdgeCut(mesh: SegMesh, triPart: Int32Array, iterations: number, opts: EdgeCutOptions = {}): EdgeCut {
  const tv = mesh.triVerts, p = mesh.positions;
  const nTri = triPart.length, nVert = p.length / 3;
  const vt = vertexTriangles(tv, nVert);
  const pinned = pinnedVertices(p, tv, triPart, nVert, opts);

  // --- Initial membership: area share of each incident part. Unassigned
  // (−1) is a label like any other so it gets clean edges too.
  const m: Membership = { lab: new Int32Array(nVert * K).fill(-2), w: new Float32Array(nVert * K) };
  const boundary = new Uint8Array(nVert);
  const labs: number[] = [], ws: number[] = [];
  for (let v = 0; v < nVert; v++) {
    labs.length = 0; ws.length = 0;
    for (let j = vt.start[v]; j < vt.start[v + 1]; j++) {
      const t = vt.tri[j];
      const a = tv[t * 3] * 3, b = tv[t * 3 + 1] * 3, c = tv[t * 3 + 2] * 3;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
      const wx = p[c] - p[a], wy = p[c + 1] - p[a + 1], wz = p[c + 2] - p[a + 2];
      const area = Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) / 2;
      addTo(labs, ws, triPart[t], area + 1e-12);
    }
    if (labs.length > 1) boundary[v] = 1;
    storeTopK(m, v, labs, ws);
  }

  // --- Diffuse membership across the boundary band (band = boundary
  // vertices dilated by iterations+1 rings; everything else is one label).
  if (iterations > 0) {
    const vn = vertexNeighbors(tv, nVert, vt);
    const band = boundary.slice();
    let frontier: number[] = [];
    for (let v = 0; v < nVert; v++) if (band[v]) frontier.push(v);
    for (let r = 0; r <= iterations; r++) {
      const next: number[] = [];
      for (const v of frontier) {
        for (let j = vn.start[v]; j < vn.start[v + 1]; j++) {
          const u = vn.nbr[j];
          if (!band[u]) { band[u] = 1; next.push(u); }
        }
      }
      frontier = next;
    }
    const bandVerts: number[] = [];
    for (let v = 0; v < nVert; v++) if (band[v]) bandVerts.push(v);
    const next: Membership = { lab: m.lab.slice(), w: m.w.slice() };
    for (let it = 0; it < iterations; it++) {
      for (const v of bandVerts) {
        if (pinned[v]) continue; // keeps its two-sided membership
        labs.length = 0; ws.length = 0;
        for (let k = 0; k < K; k++) if (m.lab[v * K + k] !== -2) addTo(labs, ws, m.lab[v * K + k], 0.5 * m.w[v * K + k]);
        const deg = vn.start[v + 1] - vn.start[v];
        for (let j = vn.start[v]; j < vn.start[v + 1]; j++) {
          const u = vn.nbr[j];
          for (let k = 0; k < K; k++) if (m.lab[u * K + k] !== -2) addTo(labs, ws, m.lab[u * K + k], (0.5 / deg) * m.w[u * K + k]);
        }
        storeTopK(next, v, labs, ws);
      }
      for (const v of bandVerts) {
        if (pinned[v]) continue;
        for (let k = 0; k < K; k++) { m.lab[v * K + k] = next.lab[v * K + k]; m.w[v * K + k] = next.w[v * K + k]; }
      }
    }
  }

  // --- Dominant label per vertex, then classify / split triangles.
  const dom = new Int32Array(nVert);
  for (let v = 0; v < nVert; v++) dom[v] = m.lab[v * K];

  const triLabel = new Int32Array(nTri);
  const splitTris: number[] = [], subStart: number[] = [0], subPoints: number[] = [], subLabel: number[] = [];
  const pointKind: number[] = [], pointA: number[] = [], pointB: number[] = [], pointT: number[] = [];
  const vertexPoint = new Map<number, number>();
  const edgePoint = new Map<number, number>();
  const vp = (v: number): number => {
    let id = vertexPoint.get(v);
    if (id === undefined) { id = pointKind.length; pointKind.push(0); pointA.push(v); pointB.push(-1); pointT.push(0); vertexPoint.set(v, id); }
    return id;
  };
  /** Crossing point on edge a–b. Only called when neither end is pinned
   *  and their dominant parts differ — a per-edge rule, so both triangles
   *  sharing the edge agree on it. */
  const ep = (a: number, b: number): number => {
    const lo = a < b ? a : b, hi = a < b ? b : a;
    const key = lo * nVert + hi;
    let id = edgePoint.get(key);
    if (id === undefined) {
      // Where membership of dom[lo] equals membership of dom[hi] along lo→hi.
      const La = dom[lo], Lb = dom[hi];
      const fa = weightOf(m, lo, La) - weightOf(m, lo, Lb);
      const fb = weightOf(m, hi, La) - weightOf(m, hi, Lb);
      let t = fa - fb !== 0 ? fa / (fa - fb) : 0.5;
      t = Math.min(1 - T_MIN, Math.max(T_MIN, t));
      id = pointKind.length; pointKind.push(1); pointA.push(lo); pointB.push(hi); pointT.push(t);
      edgePoint.set(key, id);
    }
    return id;
  };
  const emitFan = (poly: number[], L: number) => {
    for (let i = 1; i + 1 < poly.length; i++) { subPoints.push(poly[0], poly[i], poly[i + 1]); subLabel.push(L); }
  };

  for (let t = 0; t < nTri; t++) {
    const vs = [tv[t * 3], tv[t * 3 + 1], tv[t * 3 + 2]];
    const ls = vs.map((v) => dom[v]);
    const pin = vs.map((v) => pinned[v] === 1);
    // Parts voted by the unpinned corners (pinned corners side with anyone).
    const voted: number[] = [];
    for (let i = 0; i < 3; i++) if (!pin[i] && !voted.includes(ls[i])) voted.push(ls[i]);
    if (voted.length <= 1) { triLabel[t] = voted.length ? voted[0] : triPart[t]; continue; }
    triLabel[t] = -2;
    splitTris.push(t);
    if (voted.length === 3) {
      // Three parts meet: centre point, one quad per corner.
      const c = pointKind.length; pointKind.push(2); pointA.push(t); pointB.push(-1); pointT.push(0);
      for (let i = 0; i < 3; i++) {
        const prev = (i + 2) % 3, next = (i + 1) % 3;
        emitFan([vp(vs[i]), ep(vs[i], vs[next]), c, ep(vs[prev], vs[i])], ls[i]);
      }
    } else {
      // Two parts: walk the corners in winding order; each part gets its
      // corners, a pinned corner goes to both, and a crossing point sits on
      // every edge whose unpinned ends disagree.
      const polys = new Map<number, number[]>(voted.map((L) => [L, []] as const));
      for (let i = 0; i < 3; i++) {
        const next = (i + 1) % 3;
        if (pin[i]) for (const poly of polys.values()) poly.push(vp(vs[i]));
        else polys.get(ls[i])!.push(vp(vs[i]));
        if (!pin[i] && !pin[next] && ls[i] !== ls[next]) {
          const x = ep(vs[i], vs[next]);
          polys.get(ls[i])!.push(x);
          polys.get(ls[next])!.push(x);
        }
      }
      for (const [L, poly] of polys) emitFan(rotateToCorner(poly, pointKind), L);
    }
    subStart.push(subLabel.length);
  }

  return {
    triLabel,
    splitTris: Int32Array.from(splitTris),
    subStart: Int32Array.from(subStart),
    subPoints: Int32Array.from(subPoints),
    subLabel: Int32Array.from(subLabel),
    pointKind: Uint8Array.from(pointKind),
    pointA: Int32Array.from(pointA),
    pointB: Int32Array.from(pointB),
    pointT: Float32Array.from(pointT),
  };
}

/** Fan-triangulate from an original corner when there is one (avoids a fan
 *  hub on a crossing point, which can fold the pieces on a 2-part split). */
function rotateToCorner(poly: number[], kind: number[]): number[] {
  const i = poly.findIndex((id) => kind[id] === 0);
  return i <= 0 ? poly : [...poly.slice(i), ...poly.slice(0, i)];
}

/** Position (and any extra vertex properties) of a cut point. */
export function cutPointProps(
  cut: EdgeCut, id: number, vertProperties: ArrayLike<number>, numProp: number, triVerts: ArrayLike<number>, out: Float32Array,
): void {
  const kind = cut.pointKind[id];
  if (kind === 0) {
    const v = cut.pointA[id] * numProp;
    for (let k = 0; k < numProp; k++) out[k] = vertProperties[v + k];
  } else if (kind === 1) {
    const a = cut.pointA[id] * numProp, b = cut.pointB[id] * numProp, t = cut.pointT[id];
    for (let k = 0; k < numProp; k++) out[k] = vertProperties[a + k] * (1 - t) + vertProperties[b + k] * t;
  } else {
    const tri = cut.pointA[id];
    for (let k = 0; k < numProp; k++) {
      let s = 0;
      for (let c = 0; c < 3; c++) s += vertProperties[(triVerts[tri * 3 + c] as number) * numProp + k];
      out[k] = s / 3;
    }
  }
}

/**
 * Re-mesh an import along the cut: unsplit triangles keep their vertices,
 * split ones are replaced by their sub-triangles (shared edge points are
 * created once, so the result stays watertight). Returns the new mesh and
 * its partition; parts that ended up empty are dropped from `names`.
 */
export function buildCutMesh(
  src: { vertProperties: Float32Array; triVerts: Uint32Array; numProp: number },
  cut: EdgeCut,
  names: string[],
  colors: (string | null)[],
): { vertProperties: Float32Array; triVerts: Uint32Array; numVert: number; numTri: number; triPart: Int32Array; names: string[]; colors: (string | null)[] } {
  const { vertProperties: vpIn, triVerts: tvIn, numProp } = src;
  const nVert = vpIn.length / numProp;
  const nTri = tvIn.length / 3;
  // New vertex per non-vertex point.
  const pointVertex = new Int32Array(cut.pointKind.length).fill(-1);
  let extra = 0;
  for (let id = 0; id < cut.pointKind.length; id++) {
    if (cut.pointKind[id] === 0) pointVertex[id] = cut.pointA[id];
    else pointVertex[id] = nVert + extra++;
  }
  const vertProperties = new Float32Array((nVert + extra) * numProp);
  vertProperties.set(vpIn);
  const tmp = new Float32Array(numProp);
  for (let id = 0; id < cut.pointKind.length; id++) {
    if (cut.pointKind[id] === 0) continue;
    cutPointProps(cut, id, vpIn, numProp, tvIn, tmp);
    vertProperties.set(tmp, pointVertex[id] * numProp);
  }
  const subCount = cut.subLabel.length;
  const outTri = nTri - cut.splitTris.length + subCount;
  const triVerts = new Uint32Array(outTri * 3);
  const rawPart = new Int32Array(outTri);
  let o = 0;
  for (let t = 0; t < nTri; t++) {
    if (cut.triLabel[t] === -2) continue;
    triVerts[o * 3] = tvIn[t * 3]; triVerts[o * 3 + 1] = tvIn[t * 3 + 1]; triVerts[o * 3 + 2] = tvIn[t * 3 + 2];
    rawPart[o++] = cut.triLabel[t];
  }
  for (let s = 0; s < subCount; s++) {
    for (let k = 0; k < 3; k++) triVerts[o * 3 + k] = pointVertex[cut.subPoints[s * 3 + k]];
    rawPart[o++] = cut.subLabel[s];
  }
  // Drop parts that vanished (e.g. a 1-triangle sliver absorbed by smoothing).
  const used = new Uint8Array(names.length);
  for (let i = 0; i < rawPart.length; i++) if (rawPart[i] >= 0) used[rawPart[i]] = 1;
  const remap = new Int32Array(names.length).fill(-1);
  const outNames: string[] = [], outColors: (string | null)[] = [];
  names.forEach((nm, i) => { if (used[i]) { remap[i] = outNames.length; outNames.push(nm); outColors.push(colors[i] ?? null); } });
  const triPart = new Int32Array(outTri);
  for (let i = 0; i < outTri; i++) triPart[i] = rawPart[i] >= 0 ? remap[rawPart[i]] : -1;
  return { vertProperties, triVerts, numVert: nVert + extra, numTri: outTri, triPart, names: outNames, colors: outColors };
}
