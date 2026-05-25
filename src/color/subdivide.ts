// Local mesh subdivision for the smooth paintbrush.
//
// The blocky brush paints whole triangles, so a stroke's edge follows the
// existing tessellation. The smooth brush instead subdivides the triangles the
// brush boundary crosses (only those — never the deep interior or exterior), so
// the painted region's edge can follow the brush outline closely. Subdivision
// refines just those rim triangles 1→4 until they're below a target edge
// length; coarse neighbours are left as-is, which leaves zero-width T-junctions
// where the fine band meets the coarse interior. That keeps the result lean and
// fast (the painted band is not strictly 2-manifold — fine for rendering colours
// and most slicers; see the smooth-brush notes).
//
// Nothing here mutates the input mesh. The base (authored-code) mesh is always
// kept pristine; the refined mesh is rebuilt from base + stroke descriptors so
// it reconstructs deterministically when a saved version is reloaded.

import type { MeshData } from '../geometry/types';
import { closestPointOnTriangle } from './adjacency';

export type BrushShape = 'circle' | 'square' | 'diamond';

export interface BrushStroke {
  /** World-space surface points sampled along the stroke. */
  samples: [number, number, number][];
  /** Brush radius in mesh units. */
  radius: number;
  shape: BrushShape;
  /** Target triangle edge length near the stroke boundary, in mesh units.
   *  Triangles the brush edge crosses are refined until their edges fall below
   *  this — so the painted outline is smooth regardless of how coarse the base
   *  mesh is. Smaller = smoother + more triangles. */
  maxEdge: number;
  /** Surface-painting mode. `slab` constrains the footprint to a thin shell
   *  hugging the picked surface so paint can't bleed through thin / hollow walls
   *  (the brush is a surface tool, not a 3D ball). Omitted → treated as `slab`
   *  for back-compat. (A true `geodesic` walk is added in a later pass; until
   *  then it falls back to the unconstrained 3D footprint.) */
  surface?: 'geodesic' | 'slab';
  /** Slab thickness in mesh units: the largest offset along the local surface
   *  normal a point may have and still count as inside the footprint. Only used
   *  in `slab` mode; the depth knob is how far through a wall paint may reach. */
  depth?: number;
  /** Per-sample unit surface normals, parallel to `samples`. Required for the
   *  `slab` normal-offset test; derived from the base mesh (`deriveSampleNormals`)
   *  when a descriptor doesn't carry them. */
  sampleNormals?: [number, number, number][];
  /** Per-sample tangent-plane basis `[u, v]` (both unit, ⟂ to the normal),
   *  parallel to `samples`. Used by `slab` mode to measure a square/diamond
   *  cross-section in the surface plane; derived from the normals when absent. */
  sampleTangents?: [[number, number, number], [number, number, number]][];
  /** Geodesic reachability for `geodesic` mode (built from the base mesh via
   *  `buildGeodesicField`). Runtime-only — never persisted; rebuilt on demand. */
  geoField?: GeodesicField;
  /** Airbrush: when set, the stroke paints a soft *spray* instead of a solid
   *  fill — coverage fades from the core out via a stochastic per-triangle dither
   *  (every triangle stays one printable colour). Implies geodesic + no boundary
   *  clip (the edge is the dither). Works with any shape (circle/square/diamond
   *  spackle) since it reuses the footprint's signed distance. */
  spray?: { strength: number; softness: number; seed: number };
}

export interface Aabb {
  min: [number, number, number];
  max: [number, number, number];
}

export type TriClass = 'inside' | 'outside' | 'straddle';

/** Classify a triangle (given its three world-space vertex coords) against a
 *  paint region: fully inside, fully outside, or straddling the boundary.
 *  Only `straddle` triangles get subdivided. A classifier must never report
 *  `outside` for a triangle the region actually crosses (a missed straddle
 *  leaves a coarse, blocky edge there) — reporting `straddle` for a triangle
 *  that turns out to be just outside is harmless (a few extra triangles). */
export type TriClassifier = (a: number[], b: number[], c: number[]) => TriClass;

/** A region to refine the mesh around: its boundary classifier, the target edge
 *  length near that boundary, and an optional AABB for cheap spatial rejection.
 *  Brush strokes, slabs, and oriented shapes all reduce to one of these.
 *
 *  `field` (optional) is a signed-distance function for the region boundary
 *  (≤0 inside, 0 on the boundary). When present, after the rim is refined the
 *  boundary triangles are *clipped* exactly along `field = 0`, so the painted
 *  edge follows the analytic outline (crisp squares, clean circles) instead of a
 *  staircase — letting a much coarser refinement still look exact. */
export interface RefineRegion {
  aabb: Aabb | null;
  maxEdge: number;
  classify: TriClassifier;
  field?: (px: number, py: number, pz: number) => number;
}

/** Per-stroke depth bound so a single stroke can't run away (each pass ~doubles
 *  the boundary triangle count). There is deliberately NO cumulative triangle
 *  cap — the mesh may grow across many strokes; the UI surfaces a high-complexity
 *  warning and a live triangle count instead of silently degrading quality. */
const MAX_PASSES = 16;

/** Absolute safety ceiling on the refined triangle count. Normal painting stays
 *  far below this (the UI surfaces a high-complexity warning around 1M). It is
 *  NOT a quality cap on legitimate multi-stroke growth — it's an OOM guard so a
 *  single pathological region (e.g. a brush stroke handed a tiny absolute
 *  `maxEdge`) can't subdivide until the tab runs out of memory. When a pass
 *  would cross it, we stop refining and accept a coarser-than-requested edge
 *  rather than freeze. */
const MAX_REFINED_TRIANGLES = 5_000_000;

/** Whether the `slab` surface constraint is active for a stroke (mode not
 *  geodesic, a finite depth, and per-sample normals to measure offset against). */
function slabActive(stroke: BrushStroke): boolean {
  return stroke.surface !== 'geodesic'
    && !!stroke.sampleNormals
    && stroke.depth !== undefined
    && Number.isFinite(stroke.depth);
}

/** An orthonormal tangent-plane basis `[u, v]` for a unit normal `n`, derived
 *  deterministically (project the world axis least aligned with `n`). On an
 *  axis-aligned face this lands on the world axes, so a slab square/diamond reads
 *  the same as the geodesic one. */
export function tangentBasis(n: number[]): [[number, number, number], [number, number, number]] {
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  // Reference = world axis least parallel to n (smallest |component|).
  const ref: [number, number, number] = (ax <= ay && ax <= az) ? [1, 0, 0] : (ay <= az ? [0, 1, 0] : [0, 0, 1]);
  const d = ref[0] * n[0] + ref[1] * n[1] + ref[2] * n[2];
  let ux = ref[0] - d * n[0], uy = ref[1] - d * n[1], uz = ref[2] - d * n[2];
  const ul = Math.hypot(ux, uy, uz) || 1;
  ux /= ul; uy /= ul; uz /= ul;
  const vx = n[1] * uz - n[2] * uy, vy = n[2] * ux - n[0] * uz, vz = n[0] * uy - n[1] * ux;
  return [[ux, uy, uz], [vx, vy, vz]];
}

/** Signed distance to a 3D footprint (circle = sphere, square = cube, diamond =
 *  octahedron): ≤0 inside, >0 outside, 0 on the boundary. The metric for
 *  geodesic / legacy strokes, where the surface gate handles through-wall
 *  rejection. (For square/diamond this is the constraint-max, not a true
 *  Euclidean distance — but it has the right sign and zero set, which is what the
 *  in/out test and the boundary clip need.) */
function shapeDist3D(dx: number, dy: number, dz: number, shape: BrushShape, r: number): number {
  if (shape === 'square') return Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) - r;
  if (shape === 'diamond') return Math.abs(dx) + Math.abs(dy) + Math.abs(dz) - r;
  return Math.hypot(dx, dy, dz) - r;
}

/** Signed distance to a slab footprint: the 2D brush cross-section measured in
 *  the tangent plane (circle → cylinder, square → cuboid, diamond →
 *  diamond-prism) extruded along the normal by ±`depth`. ≤0 inside. Constant
 *  cross-section (no taper), so the shape punches cleanly through a wall. */
function slabPrismDist(
  dx: number, dy: number, dz: number,
  n: number[], u: number[], v: number[],
  shape: BrushShape, r: number, depth: number,
): number {
  const off = dx * n[0] + dy * n[1] + dz * n[2];
  const tx = dx - off * n[0], ty = dy - off * n[1], tz = dz - off * n[2];
  let lateral: number;
  if (shape === 'circle') {
    lateral = Math.hypot(tx, ty, tz) - r;
  } else {
    const a = tx * u[0] + ty * u[1] + tz * u[2];
    const b = tx * v[0] + ty * v[1] + tz * v[2];
    lateral = (shape === 'square') ? Math.max(Math.abs(a), Math.abs(b)) - r : Math.abs(a) + Math.abs(b) - r;
  }
  // Intersection of the lateral cross-section and the |off| ≤ depth slab.
  return Math.max(lateral, Math.abs(off) - depth);
}

/** Signed distance from `p` to the stroke's footprint (the union over samples):
 *  ≤0 inside, >0 outside, 0 on the boundary. This is the field the boundary clip
 *  follows; `withinFootprint` is just its sign. Geodesic returns +∞ off the
 *  seed-connected surface region so paint can't jump a wall. */
export function strokeSignedDist(
  px: number, py: number, pz: number,
  stroke: BrushStroke,
): number {
  if (stroke.surface === 'geodesic' && stroke.geoField && !stroke.geoField.reachableAt(px, py, pz)) {
    return Infinity;
  }
  const { samples, radius: r, shape } = stroke;
  const slab = slabActive(stroke);
  const depth = stroke.depth ?? Infinity;
  const normals = stroke.sampleNormals;
  const tangents = stroke.sampleTangents;
  let best = Infinity;
  for (let i = 0; i < samples.length; i++) {
    const dx = px - samples[i][0];
    const dy = py - samples[i][1];
    const dz = pz - samples[i][2];
    let d: number;
    if (slab && normals) {
      const n = normals[i];
      const t = tangents ? tangents[i] : tangentBasis(n);
      d = slabPrismDist(dx, dy, dz, n, t[0], t[1], shape, r, depth);
    } else {
      d = shapeDist3D(dx, dy, dz, shape, r);
    }
    if (d < best) best = d;
  }
  return best;
}

/** True when `p` is within the brush footprint of any of the stroke's samples. */
function withinFootprint(px: number, py: number, pz: number, stroke: BrushStroke): boolean {
  return strokeSignedDist(px, py, pz, stroke) <= 0;
}

function triVertex(mesh: MeshData, vi: number): [number, number, number] {
  const p = mesh.numProp;
  return [mesh.vertProperties[vi * p], mesh.vertProperties[vi * p + 1], mesh.vertProperties[vi * p + 2]];
}

/** Axis-aligned bounds of a stroke's footprint (samples expanded by radius).
 *  Used to cheaply reject the (usually vast majority of) triangles nowhere near
 *  the stroke before the per-triangle footprint math — the difference between
 *  O(whole mesh) and O(triangles under the brush) on an accumulated mesh. */
function strokeAabb(stroke: BrushStroke): { min: [number, number, number]; max: [number, number, number] } {
  // Pad generously: a square cross-section reaches r·√2 at its corners, and a
  // slab prism extends ±depth along the (possibly tilted) normal. Over-inclusion
  // only costs a little extra classify work; under-inclusion would clip paint.
  const pad = stroke.radius * Math.SQRT2 + (slabActive(stroke) ? (stroke.depth ?? 0) : 0);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const s of stroke.samples) {
    for (let k = 0; k < 3; k++) {
      if (s[k] - pad < min[k]) min[k] = s[k] - pad;
      if (s[k] + pad > max[k]) max[k] = s[k] + pad;
    }
  }
  return { min, max };
}

/** True when triangle (a,b,c) is entirely outside the stroke's AABB. */
function triOutsideAabb(a: number[], b: number[], c: number[], box: { min: [number, number, number]; max: [number, number, number] }): boolean {
  for (let k = 0; k < 3; k++) {
    if (a[k] < box.min[k] && b[k] < box.min[k] && c[k] < box.min[k]) return true;
    if (a[k] > box.max[k] && b[k] > box.max[k] && c[k] > box.max[k]) return true;
  }
  return false;
}

/** Longest squared edge of a triangle's three vertices. */
function maxEdgeLen2(a: number[], b: number[], c: number[]): number {
  const e = (p: number[], q: number[]): number => {
    const dx = p[0] - q[0], dy = p[1] - q[1], dz = p[2] - q[2];
    return dx * dx + dy * dy + dz * dz;
  };
  return Math.max(e(a, b), e(b, c), e(c, a));
}

/** Refine classifier for an airbrush spray: densify the dithered band so the
 *  speckle is fine. The feather (signed distance within `softness·radius` of the
 *  edge) always refines; a solid `strength ≥ 1` core stays coarse, but a
 *  `strength < 1` core dithers too and so refines. Off-footprint / unreachable
 *  (signed distance > 0, incl. +∞) is left alone. No clip — the edge is dither. */
function sprayClassifier(stroke: BrushStroke): TriClassifier {
  const featherWidth = stroke.radius * stroke.spray!.softness;
  const solidCore = stroke.spray!.strength >= 1;
  return (a, b, c) => {
    const fa = strokeSignedDist(a[0], a[1], a[2], stroke);
    const fb = strokeSignedDist(b[0], b[1], b[2], stroke);
    const fc = strokeSignedDist(c[0], c[1], c[2], stroke);
    if (fa <= 0 || fb <= 0 || fc <= 0) {
      if (solidCore && fa < -featherWidth && fb < -featherWidth && fc < -featherWidth) return 'inside';
      return 'straddle';
    }
    // All vertices outside the footprint — but a spray smaller than the face may
    // still sit inside this triangle; refine if its closest point to a sample is
    // within the footprint (mirrors the brush's small-footprint fallback).
    for (let s = 0; s < stroke.samples.length; s++) {
      const sp = stroke.samples[s];
      const cp = closestPointOnTriangle(sp[0], sp[1], sp[2], a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
      if (strokeSignedDist(cp[0], cp[1], cp[2], stroke) < 0) return 'straddle';
    }
    return 'outside';
  };
}

/** Classify a triangle against a brush footprint: inside when all three
 *  vertices are covered, straddle when some (but not all) are — or, for a brush
 *  smaller than the face, when the footprint's closest point on the triangle
 *  still falls inside the footprint (so a small brush in the middle of a big face
 *  tessellates). The fallback tests the *actual* shape, not a bounding sphere —
 *  a sphere of radius r misses a square's corners (at r·√2), leaving them coarse
 *  and unpainted. */
function brushClassifier(stroke: BrushStroke): TriClassifier {
  if (stroke.spray) return sprayClassifier(stroke);
  const { radius: r, shape } = stroke;
  const slab = slabActive(stroke);
  const geodesic = stroke.surface === 'geodesic' && !!stroke.geoField;
  const depth = stroke.depth ?? Infinity;
  const normals = stroke.sampleNormals;
  const tangents = stroke.sampleTangents;
  return (a, b, c) => {
    let inside = 0;
    if (withinFootprint(a[0], a[1], a[2], stroke)) inside++;
    if (withinFootprint(b[0], b[1], b[2], stroke)) inside++;
    if (withinFootprint(c[0], c[1], c[2], stroke)) inside++;
    if (inside === 3) return 'inside';
    if (inside >= 1) return 'straddle';
    for (let s = 0; s < stroke.samples.length; s++) {
      const sp = stroke.samples[s];
      const cp = closestPointOnTriangle(
        sp[0], sp[1], sp[2],
        a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2],
      );
      if (geodesic && stroke.geoField && !stroke.geoField.reachableAt(cp[0], cp[1], cp[2])) continue;
      const dx = cp[0] - sp[0], dy = cp[1] - sp[1], dz = cp[2] - sp[2];
      let d: number;
      if (slab && normals) {
        const n = normals[s];
        const t = tangents ? tangents[s] : tangentBasis(n);
        d = slabPrismDist(dx, dy, dz, n, t[0], t[1], shape, r, depth);
      } else {
        d = shapeDist3D(dx, dy, dz, shape, r);
      }
      if (d <= 0) return 'straddle';
    }
    return 'outside';
  };
}

/** Per-sample unit surface normals derived from a base mesh: each sample takes
 *  the geometric normal of the base triangle whose surface is closest to it.
 *  Used for the `slab` constraint when a stroke descriptor doesn't carry stored
 *  normals (old sessions, or console paints that omit them). The sign is
 *  irrelevant — the slab test uses |offset| — so winding is not normalized. */
export function deriveSampleNormals(
  samples: [number, number, number][],
  base: MeshData,
): [number, number, number][] {
  const { triVerts, numTri } = base;
  const out: [number, number, number][] = [];
  for (const s of samples) {
    let best = Infinity;
    let bn: [number, number, number] = [0, 0, 1];
    for (let t = 0; t < numTri; t++) {
      const a = triVertex(base, triVerts[t * 3]);
      const b = triVertex(base, triVerts[t * 3 + 1]);
      const c = triVertex(base, triVerts[t * 3 + 2]);
      const cp = closestPointOnTriangle(s[0], s[1], s[2], a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
      const dx = cp[0] - s[0], dy = cp[1] - s[1], dz = cp[2] - s[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < best) {
        best = d2;
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
        const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const len = Math.hypot(nx, ny, nz) || 1;
        bn = [nx / len, ny / len, nz / len];
      }
    }
    out.push(bn);
  }
  return out;
}

/** Geodesic reachability for a stroke: which surface points are reachable by
 *  walking along the mesh from the seed (vs. lying across a gap through a wall). */
export interface GeodesicField {
  /** True when `p`'s nearest base triangle is in the flood-filled reachable set —
   *  i.e. it's on the surface region connected to the seed within the radius.
   *  Combined with the in-plane footprint test, this is what stops a geodesic
   *  stroke bleeding onto a disconnected wall. */
  reachableAt(px: number, py: number, pz: number): boolean;
}

/** Build the geodesic reachability field for a stroke against a base mesh: flood
 *  fills base triangles outward from the sample seeds across shared edges,
 *  keeping only triangles whose surface comes within `radius` of a sample. The
 *  painted region is then (in-plane footprint) ∩ (reachable), so paint follows
 *  the surface around curves and over edges but never jumps the gap through a
 *  thin / hollow wall — and, unlike the slab, needs no depth tuning. All work is
 *  bounded to a local AABB (samples padded by 2·radius) so it stays cheap on
 *  large base meshes. */
export function buildGeodesicField(
  base: MeshData,
  samples: [number, number, number][],
  radius: number,
): GeodesicField {
  const { triVerts, numTri, numVert } = base;
  const r2 = radius * radius;

  const pad = 2 * radius;
  const box: Aabb = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const s of samples) {
    for (let k = 0; k < 3; k++) {
      if (s[k] - pad < box.min[k]) box.min[k] = s[k] - pad;
      if (s[k] + pad > box.max[k]) box.max[k] = s[k] + pad;
    }
  }

  // Local triangles only, with their vertex coords cached for the distance math.
  const active: number[] = [];
  const coords: [number[], number[], number[]][] = [];
  for (let t = 0; t < numTri; t++) {
    const a = triVertex(base, triVerts[t * 3]);
    const b = triVertex(base, triVerts[t * 3 + 1]);
    const c = triVertex(base, triVerts[t * 3 + 2]);
    if (triOutsideAabb(a, b, c, box)) continue;
    active.push(t);
    coords.push([a, b, c]);
  }

  const dist2ToActive = (px: number, py: number, pz: number, li: number): number => {
    const [a, b, c] = coords[li];
    const cp = closestPointOnTriangle(px, py, pz, a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    const dx = cp[0] - px, dy = cp[1] - py, dz = cp[2] - pz;
    return dx * dx + dy * dy + dz * dz;
  };
  const nearestActive = (px: number, py: number, pz: number): number => {
    let best = Infinity, bi = -1;
    for (let li = 0; li < active.length; li++) {
      const d2 = dist2ToActive(px, py, pz, li);
      if (d2 < best) { best = d2; bi = li; }
    }
    return bi;
  };
  const withinR = (li: number): boolean => {
    for (const s of samples) if (dist2ToActive(s[0], s[1], s[2], li) <= r2) return true;
    return false;
  };

  // Shared-edge adjacency among the active triangles.
  const ekey = (u: number, v: number): number => (u < v ? u * numVert + v : v * numVert + u);
  const edgeMap = new Map<number, number[]>();
  for (let li = 0; li < active.length; li++) {
    const t = active[li];
    const v0 = triVerts[t * 3], v1 = triVerts[t * 3 + 1], v2 = triVerts[t * 3 + 2];
    for (const [u, v] of [[v0, v1], [v1, v2], [v2, v0]] as const) {
      const arr = edgeMap.get(ekey(u, v));
      if (arr) arr.push(li); else edgeMap.set(ekey(u, v), [li]);
    }
  }
  const neighbors = (li: number): number[] => {
    const t = active[li];
    const v0 = triVerts[t * 3], v1 = triVerts[t * 3 + 1], v2 = triVerts[t * 3 + 2];
    const out: number[] = [];
    for (const [u, v] of [[v0, v1], [v1, v2], [v2, v0]] as const) {
      const arr = edgeMap.get(ekey(u, v));
      if (!arr) continue;
      for (const other of arr) if (other !== li) out.push(other);
    }
    return out;
  };

  // Flood fill from each sample's nearest active triangle.
  const reachable = new Uint8Array(active.length);
  const stack: number[] = [];
  for (const s of samples) {
    const li = nearestActive(s[0], s[1], s[2]);
    if (li >= 0 && !reachable[li]) { reachable[li] = 1; stack.push(li); }
  }
  while (stack.length) {
    const li = stack.pop()!;
    for (const nb of neighbors(li)) {
      if (reachable[nb]) continue;
      if (withinR(nb)) { reachable[nb] = 1; stack.push(nb); }
    }
  }

  const memo = new Map<string, boolean>();
  return {
    reachableAt(px, py, pz) {
      const k = `${Math.round(px * 1e4)},${Math.round(py * 1e4)},${Math.round(pz * 1e4)}`;
      const hit = memo.get(k);
      if (hit !== undefined) return hit;
      const li = nearestActive(px, py, pz);
      const res = li >= 0 && reachable[li] === 1;
      memo.set(k, res);
      return res;
    },
  };
}

/** Build a refine region for a brush stroke (its footprint classifier, AABB,
 *  and target edge length). */
export function brushRefineRegion(stroke: BrushStroke): RefineRegion {
  const maxEdge = stroke.maxEdge > 0 ? stroke.maxEdge : stroke.radius / 256;
  return {
    aabb: strokeAabb(stroke),
    maxEdge,
    classify: brushClassifier(stroke),
    // The rim is refined to maxEdge for curve segment density, then clipped
    // exactly along this field so the painted edge is the analytic outline.
    // A spray has no hard edge (it dithers), so it skips the clip.
    field: stroke.spray ? undefined : (px, py, pz) => strokeSignedDist(px, py, pz, stroke),
  };
}

/** Airbrush coverage probability for a point at signed footprint distance `sd`
 *  (≤0 inside, as returned by `strokeSignedDist`): `strength` deep in the core,
 *  fading linearly to 0 at the footprint edge across the outer `softness·radius`
 *  band. Shape-agnostic — a square footprint gives a square spackle, etc. */
export function sprayCoverage(sd: number, stroke: BrushStroke): number {
  const spray = stroke.spray;
  if (!spray || sd >= 0) return 0;
  const featherWidth = stroke.radius * spray.softness;
  const depthInside = -sd;
  const f = featherWidth > 0 ? Math.min(depthInside / featherWidth, 1) : 1;
  return spray.strength * f;
}

/** Deterministic dither in [0,1) from a world position + seed. Quantizes coords
 *  to a fine grid (the refined centroids are deterministic, so this reproduces
 *  exactly on reload) and mixes them with an integer hash. */
export function airbrushDither(px: number, py: number, pz: number, seed: number): number {
  const q = (v: number): number => Math.round(v * 1024) | 0;
  let h = (seed | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ q(px), 2654435761);
  h = Math.imul(h ^ q(py), 2654435761);
  h = Math.imul(h ^ q(pz), 2654435761);
  h ^= h >>> 15; h = Math.imul(h, 2246822519); h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** Triangles a region's boundary crosses (partially, not fully covered) AND are
 *  still coarser than `region.maxEdge`. These are the ones worth subdividing:
 *  fully-inside triangles already paint solid, fully-outside ones never paint,
 *  and boundary triangles already finer than the target are left alone (that's
 *  the stopping condition). */
function selectByClassify(mesh: MeshData, region: RefineRegion): Set<number> {
  const { triVerts, numTri } = mesh;
  const selected = new Set<number>();
  const maxEdge2 = region.maxEdge * region.maxEdge;
  const box = region.aabb;
  const field = region.field;
  // Only densify where the boundary actually curves: if the signed-distance
  // field is (near-)linear across a triangle, the boundary runs straight through
  // it and the exact clip already gives a perfect edge — refining there just
  // burns triangles. A straight square edge skips the band entirely; a circle
  // (curved everywhere) still refines to maxEdge. Tiny, FP-noise-proof tolerance.
  const straightTol = region.maxEdge * 1e-3;

  for (let t = 0; t < numTri; t++) {
    const a = triVertex(mesh, triVerts[t * 3]);
    const b = triVertex(mesh, triVerts[t * 3 + 1]);
    const c = triVertex(mesh, triVerts[t * 3 + 2]);

    // Cheap spatial reject: skip triangles nowhere near the region.
    if (box && triOutsideAabb(a, b, c, box)) continue;

    // Already fine enough → leave it (keeps the refined band tight and bounded).
    if (maxEdgeLen2(a, b, c) <= maxEdge2) continue;

    if (region.classify(a, b, c) !== 'straddle') continue;

    if (field) {
      const fa = field(a[0], a[1], a[2]), fb = field(b[0], b[1], b[2]), fc = field(c[0], c[1], c[2]);
      const dab = Math.abs(field((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2) - (fa + fb) / 2);
      const dbc = Math.abs(field((b[0] + c[0]) / 2, (b[1] + c[1]) / 2, (b[2] + c[2]) / 2) - (fb + fc) / 2);
      const dca = Math.abs(field((c[0] + a[0]) / 2, (c[1] + a[1]) / 2, (c[2] + a[2]) / 2) - (fc + fa) / 2);
      const dev = Math.max(dab, dbc, dca);
      // Skip only when the boundary is provably straight here (finite & flat);
      // a +∞ region edge or any curvature falls through to refine.
      if (Number.isFinite(dev) && dev <= straightTol) continue;
    }

    selected.add(t);
  }
  return selected;
}

/** Triangles whose centroid falls within the stroke footprint — the set that
 *  receives the stroke's colour. Run against the refined mesh so the painted
 *  area hugs the brush outline. */
export function strokeFootprintTriangles(mesh: MeshData, stroke: BrushStroke): Set<number> {
  const { triVerts, numTri, vertProperties, numProp } = mesh;
  const out = new Set<number>();
  const box = strokeAabb(stroke);
  for (let t = 0; t < numTri; t++) {
    const v0 = triVerts[t * 3], v1 = triVerts[t * 3 + 1], v2 = triVerts[t * 3 + 2];
    const ax = vertProperties[v0 * numProp], ay = vertProperties[v0 * numProp + 1], az = vertProperties[v0 * numProp + 2];
    const bx = vertProperties[v1 * numProp], by = vertProperties[v1 * numProp + 1], bz = vertProperties[v1 * numProp + 2];
    const cx2 = vertProperties[v2 * numProp], cy2 = vertProperties[v2 * numProp + 1], cz2 = vertProperties[v2 * numProp + 2];
    if (triOutsideAabb([ax, ay, az], [bx, by, bz], [cx2, cy2, cz2], box)) continue;
    const cx = (ax + bx + cx2) / 3, cy = (ay + by + cy2) / 3, cz = (az + bz + cz2) / 3;
    if (stroke.spray) {
      // Spray: dither coverage at the centroid's footprint depth.
      const sd = strokeSignedDist(cx, cy, cz, stroke);
      if (sd < 0 && airbrushDither(cx, cy, cz, stroke.spray.seed) < sprayCoverage(sd, stroke)) out.add(t);
    } else if (withinFootprint(cx, cy, cz, stroke)) {
      out.add(t);
    }
  }
  return out;
}

/** Clip the mesh exactly along a region's boundary field (marching-triangles):
 *  every triangle the contour `field = 0` crosses is split so the cut lies on the
 *  outline, with edge crossings shared between neighbours (watertight, no
 *  T-junctions). Fully-inside / fully-outside triangles (and any touching a +∞
 *  region — geodesic-disconnected surface) pass through untouched. After this the
 *  painted set still resolves by centroid, but the boundary is the analytic
 *  outline rather than a staircase, so a coarse refinement looks crisp.
 *
 *  Returns the new mesh + `childToParent` (each output triangle's source index),
 *  same contract as `subdivideSelected`. */
function clipByField(
  mesh: MeshData,
  region: RefineRegion,
): { mesh: MeshData; childToParent: Int32Array } {
  const field = region.field!;
  const box = region.aabb;
  const { vertProperties, triVerts, numVert, numTri, numProp } = mesh;
  const P = numProp;

  // Lazy per-vertex field value (NaN = not yet evaluated).
  const fval = new Float32Array(numVert).fill(NaN);
  const fieldAt = (v: number): number => {
    let f = fval[v];
    if (Number.isNaN(f)) {
      f = field(vertProperties[v * P], vertProperties[v * P + 1], vertProperties[v * P + 2]);
      fval[v] = f;
    }
    return f;
  };

  // Shared crossing vertex per edge — deduped so neighbours meet exactly.
  const key = (a: number, b: number): number => (a < b ? a * numVert + b : b * numVert + a);
  const crossIndex = new Map<number, number>();
  const newVertProps: number[] = [];
  let nextV = numVert;
  const crossOf = (a: number, b: number): number => {
    const k = key(a, b);
    const existing = crossIndex.get(k);
    if (existing !== undefined) return existing;
    const fa = fieldAt(a), fb = fieldAt(b);
    // Crossing parameter, clamped just off the endpoints so a contour grazing a
    // vertex can't spawn a zero-area sliver.
    let t = fa / (fa - fb);
    if (!(t > 1e-6)) t = 1e-6;
    if (!(t < 1 - 1e-6)) t = 1 - 1e-6;
    const m = nextV++;
    crossIndex.set(k, m);
    for (let p = 0; p < P; p++) {
      newVertProps.push(vertProperties[a * P + p] + t * (vertProperties[b * P + p] - vertProperties[a * P + p]));
    }
    return m;
  };

  const outTris: number[] = [];
  const childParent: number[] = [];
  const emit = (a: number, b: number, c: number, parent: number): void => {
    outTris.push(a, b, c);
    childParent.push(parent);
  };

  for (let t = 0; t < numTri; t++) {
    const v0 = triVerts[t * 3], v1 = triVerts[t * 3 + 1], v2 = triVerts[t * 3 + 2];
    if (box) {
      const a = triVertex(mesh, v0), b = triVertex(mesh, v1), c = triVertex(mesh, v2);
      if (triOutsideAabb(a, b, c, box)) { emit(v0, v1, v2, t); continue; }
    }
    const f0 = fieldAt(v0), f1 = fieldAt(v1), f2 = fieldAt(v2);
    // +∞ (geodesic-disconnected) or all-same-side → no boundary inside this tri.
    if (!Number.isFinite(f0 + f1 + f2)) { emit(v0, v1, v2, t); continue; }
    const in0 = f0 <= 0, in1 = f1 <= 0, in2 = f2 <= 0;
    const cnt = (in0 ? 1 : 0) + (in1 ? 1 : 0) + (in2 ? 1 : 0);
    if (cnt === 0 || cnt === 3) { emit(v0, v1, v2, t); continue; }
    // Rotate so the lone-sign vertex is A (cyclic → winding preserved). The cut
    // crosses edges A-B and A-C; the resulting 3 triangles split inside/outside.
    let A: number, B: number, C: number;
    if (in0 !== in1 && in0 !== in2) { A = v0; B = v1; C = v2; }
    else if (in1 !== in0 && in1 !== in2) { A = v1; B = v2; C = v0; }
    else { A = v2; B = v0; C = v1; }
    const P1 = crossOf(A, B), Q = crossOf(A, C);
    emit(A, P1, Q, t);
    emit(P1, B, C, t);
    emit(P1, C, Q, t);
  }

  const totalVert = numVert + newVertProps.length / P;
  const vp = new Float32Array(totalVert * P);
  vp.set(vertProperties.subarray(0, numVert * P), 0);
  vp.set(newVertProps, numVert * P);
  const newMesh: MeshData = {
    vertProperties: vp,
    triVerts: new Uint32Array(outTris),
    numVert: totalVert,
    numTri: outTris.length / 3,
    numProp: P,
  };
  return { mesh: newMesh, childToParent: Int32Array.from(childParent) };
}

/** One refinement pass that splits ONLY the `selected` (rim) triangles 1→4,
 *  leaving every other triangle untouched. Edge midpoints are shared between
 *  adjacent selected triangles (watertight within the refined band), but where a
 *  selected triangle meets an unselected one the shared edge is split on the
 *  selected side only — a zero-width T-junction. That's deliberate: it keeps the
 *  disc interior coarse (just the rim is fine), which is ~10x leaner than a
 *  crack-free graded refinement. The seams are invisible when rendering colours
 *  and fine for GLB / most slicers, though the painted band is not strictly
 *  2-manifold (see the smooth-brush notes).
 *
 *  Returns the new mesh plus `childToParent`: for each output triangle, the
 *  index of the input triangle it came from (so callers can carry per-triangle
 *  data — e.g. existing colour regions — across the split). */
function subdivideSelected(
  mesh: MeshData,
  selected: Set<number>,
): { mesh: MeshData; childToParent: Int32Array } {
  const { vertProperties, triVerts, numVert, numTri, numProp } = mesh;
  const P = numProp;

  // Numeric key for an undirected edge. numVert is the multiplier and stays
  // fixed within a pass; products stay well under Number.MAX_SAFE_INTEGER for
  // any realistic mesh.
  const key = (a: number, b: number): number => (a < b ? a * numVert + b : b * numVert + a);

  // Shared midpoint vertex per split edge (lazily) — adjacent rim triangles
  // reuse midpoints so the band itself stays watertight.
  const midIndex = new Map<number, number>();
  const newVertProps: number[] = [];
  let nextV = numVert;
  const midOf = (a: number, b: number): number => {
    const k = key(a, b);
    const existing = midIndex.get(k);
    if (existing !== undefined) return existing;
    const m = nextV++;
    midIndex.set(k, m);
    for (let p = 0; p < P; p++) {
      newVertProps.push((vertProperties[a * P + p] + vertProperties[b * P + p]) / 2);
    }
    return m;
  };

  const outTris: number[] = [];
  const childParent: number[] = [];
  const emit = (a: number, b: number, c: number, parent: number): void => {
    outTris.push(a, b, c);
    childParent.push(parent);
  };

  for (let t = 0; t < numTri; t++) {
    const v0 = triVerts[t * 3], v1 = triVerts[t * 3 + 1], v2 = triVerts[t * 3 + 2];
    if (!selected.has(t)) { emit(v0, v1, v2, t); continue; }
    const m0 = midOf(v0, v1), m1 = midOf(v1, v2), m2 = midOf(v2, v0);
    emit(v0, m0, m2, t); emit(m0, v1, m1, t); emit(m2, m1, v2, t); emit(m0, m1, m2, t);
  }

  const totalVert = numVert + newVertProps.length / P;
  const vp = new Float32Array(totalVert * P);
  vp.set(vertProperties.subarray(0, numVert * P), 0);
  vp.set(newVertProps, numVert * P);

  const tv = new Uint32Array(outTris);
  const newMesh: MeshData = {
    vertProperties: vp,
    triVerts: tv,
    numVert: totalVert,
    numTri: outTris.length / 3,
    numProp: P,
    // Provenance/merge arrays describe the base tessellation and no longer
    // apply once triangles are split; drop them.
  };
  return { mesh: newMesh, childToParent: Int32Array.from(childParent) };
}

/** Rebuild a refined mesh from a pristine base mesh and an ordered list of
 *  refine regions (brush strokes, slabs, oriented shapes). Each region refines
 *  the (possibly already-refined) mesh near its own boundary until the boundary
 *  triangles fall below its `maxEdge`. Returns the refined mesh and a
 *  `childToParent` map from each final triangle back to its base-mesh triangle
 *  index (used to carry colour regions across the refinement). */
export function buildRefinedMesh(
  base: MeshData,
  regions: RefineRegion[],
): { mesh: MeshData; childToParent: Int32Array } {
  let mesh = base;
  let comp: Int32Array = new Int32Array(base.numTri);
  for (let i = 0; i < comp.length; i++) comp[i] = i;

  for (const region of regions) {
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const selected = selectByClassify(mesh, region);
      if (selected.size === 0) break;
      // Each selected triangle becomes 4 (+3 net). Stop before crossing the
      // safety ceiling so a tiny maxEdge can't OOM the tab.
      if (mesh.numTri + selected.size * 3 > MAX_REFINED_TRIANGLES) break;
      const { mesh: nm, childToParent } = subdivideSelected(mesh, selected);
      mesh = nm;
      comp = composeMaps(comp, childToParent);
    }
    // Boundary-conforming clip: cut the now-fine rim exactly along the region
    // outline so the painted edge is the analytic curve, not a staircase.
    if (region.field && mesh.numTri < MAX_REFINED_TRIANGLES) {
      const { mesh: nm, childToParent } = clipByField(mesh, region);
      mesh = nm;
      comp = composeMaps(comp, childToParent);
    }
  }
  return { mesh, childToParent: comp };
}

/** Convenience wrapper: refine a base mesh under an ordered list of brush
 *  strokes (each mapped to its footprint refine region). */
export function buildStrokeMesh(
  base: MeshData,
  strokes: BrushStroke[],
): { mesh: MeshData; childToParent: Int32Array } {
  return buildRefinedMesh(base, strokes.map(brushRefineRegion));
}

function composeMaps(parentToBase: Int32Array, childToParent: Int32Array): Int32Array {
  const out = new Int32Array(childToParent.length);
  for (let i = 0; i < out.length; i++) out[i] = parentToBase[childToParent[i]];
  return out;
}

/** Invert a final→base triangle map into base→[final children]. Used to carry
 *  a region defined on the base mesh (raw triangle ids, label ids) onto the
 *  refined mesh. */
export function childrenByParent(childToParent: Int32Array): Map<number, number[]> {
  const map = new Map<number, number[]>();
  for (let child = 0; child < childToParent.length; child++) {
    const parent = childToParent[child];
    let list = map.get(parent);
    if (!list) { list = []; map.set(parent, list); }
    list.push(child);
  }
  return map;
}
