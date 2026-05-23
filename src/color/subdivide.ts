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
  /** When true, refine the FULL interior of the footprint, not just the rim the
   *  boundary crosses. The airbrush needs fine triangles throughout its
   *  footprint so its stochastic speckle reads as fine dots; the smooth brush
   *  leaves this off (rim-only) because its interior paints solid. */
  fill?: boolean;
}

/** Hard ceilings so a tiny target edge on a coarse mesh can't run away.
 *  Straddle-only selection already bounds growth to the boundary length (not the
 *  area), but a pathological case shouldn't be able to lock the tab. */
const MAX_PASSES = 12;
const MAX_TRIANGLES = 1_500_000;

/** True when `p` is within the brush footprint of any of the stroke's samples,
 *  using the shape's distance metric (circle = Euclidean, square = Chebyshev,
 *  diamond = L1). */
export function withinFootprint(
  px: number, py: number, pz: number,
  stroke: BrushStroke,
): boolean {
  const { samples, radius, shape } = stroke;
  const r = radius;
  for (let i = 0; i < samples.length; i++) {
    const dx = px - samples[i][0];
    const dy = py - samples[i][1];
    const dz = pz - samples[i][2];
    if (shape === 'square') {
      if (Math.abs(dx) <= r && Math.abs(dy) <= r && Math.abs(dz) <= r) return true;
    } else if (shape === 'diamond') {
      if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) <= r) return true;
    } else {
      if (dx * dx + dy * dy + dz * dz <= r * r) return true;
    }
  }
  return false;
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
  const r = stroke.radius;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const s of stroke.samples) {
    for (let k = 0; k < 3; k++) {
      if (s[k] - r < min[k]) min[k] = s[k] - r;
      if (s[k] + r > max[k]) max[k] = s[k] + r;
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

/** Triangles that the brush boundary crosses (partially, not fully covered)
 *  AND are still coarser than `maxEdge`. These are the ones worth subdividing:
 *  fully-inside triangles already paint solid, fully-outside ones never paint,
 *  and boundary triangles already finer than the target are left alone (that's
 *  the stopping condition). Catches the brush-smaller-than-a-triangle case via a
 *  closest-point test so a small brush in the middle of a big face still
 *  tessellates. */
export function selectStrokeTriangles(mesh: MeshData, stroke: BrushStroke, maxEdge: number): Set<number> {
  const { triVerts, numTri } = mesh;
  const selected = new Set<number>();
  const r2 = stroke.radius * stroke.radius;
  const maxEdge2 = maxEdge * maxEdge;
  const box = strokeAabb(stroke);

  for (let t = 0; t < numTri; t++) {
    const a = triVertex(mesh, triVerts[t * 3]);
    const b = triVertex(mesh, triVerts[t * 3 + 1]);
    const c = triVertex(mesh, triVerts[t * 3 + 2]);

    // Cheap spatial reject: skip triangles nowhere near the stroke.
    if (triOutsideAabb(a, b, c, box)) continue;

    // Already fine enough → leave it (keeps the refined band tight and bounded).
    if (maxEdgeLen2(a, b, c) <= maxEdge2) continue;

    let inside = 0;
    if (withinFootprint(a[0], a[1], a[2], stroke)) inside++;
    if (withinFootprint(b[0], b[1], b[2], stroke)) inside++;
    if (withinFootprint(c[0], c[1], c[2], stroke)) inside++;

    // Fully inside — no edge crosses it. The smooth brush leaves these coarse
    // (the interior paints solid); the airbrush refines them too (`fill`) so its
    // speckle has fine triangles across the whole footprint.
    if (inside === 3) { if (stroke.fill) selected.add(t); continue; }
    if (inside >= 1) { selected.add(t); continue; } // straddles the boundary

    // No vertex inside: the footprint might still pass through this triangle
    // (brush smaller than the face, or grazing an edge). Test the closest point
    // on the triangle to each sample against the radius.
    for (let s = 0; s < stroke.samples.length; s++) {
      const sp = stroke.samples[s];
      const cp = closestPointOnTriangle(
        sp[0], sp[1], sp[2],
        a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2],
      );
      const dx = cp[0] - sp[0], dy = cp[1] - sp[1], dz = cp[2] - sp[2];
      if (dx * dx + dy * dy + dz * dz <= r2) { selected.add(t); break; }
    }
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
    if (withinFootprint(cx, cy, cz, stroke)) out.add(t);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Airbrush — soft-edged paint via stochastic density falloff.
//
// No alpha or colour blending is ever used: every triangle is painted fully or
// not at all, so each one stays a single printable colour. The "soft" edge is a
// dither — triangles near the stroke centre are painted with probability
// `strength`, thinning to zero across a `softness`-wide rim. The decision is
// made per grain CELL (not per triangle) and keyed by a stored seed, so the
// speckle is deterministic: it reproduces exactly when a saved version reloads
// and stays stable as the mesh is subdivided under the stroke.
// ---------------------------------------------------------------------------

export interface AirbrushStroke {
  /** World-space surface points sampled along the stroke. */
  samples: [number, number, number][];
  /** Brush radius in mesh units. */
  radius: number;
  /** Paint density through the core, 0..1. Lower = a lighter dusting. */
  strength: number;
  /** Fraction of the radius that fades out (the feathered rim), 0..1.
   *  0 = hard-edged disc; 1 = fades all the way from the centre. */
  softness: number;
  /** Stable per-stroke seed so the speckle reproduces across reloads but
   *  differs between strokes. */
  seed: number;
  /** Grain cell size in mesh units — also the interior subdivision target. The
   *  paint decision is made per cell of this size, so it is identical no matter
   *  how finely the mesh is later subdivided. */
  maxEdge: number;
}

/** Probability a point at normalized distance `dn` (0 at centre, 1 at the rim)
 *  is painted: a `strength`-dense core, then a linear fade to 0 across the outer
 *  `softness` fraction of the radius. */
export function airbrushProbability(dn: number, strength: number, softness: number): number {
  if (dn >= 1) return 0;
  if (dn < 0) dn = 0;
  const core = 1 - softness;          // softness 0 → core 1 → hard disc
  if (dn <= core) return strength;
  const u = (dn - core) / (1 - core); // 0..1 across the feather band
  return strength * (1 - u);
}

/** Deterministic hash of an integer grid cell + seed → [0, 1). */
function cellHash(qx: number, qy: number, qz: number, seed: number): number {
  let h = (seed | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (qx | 0), 0x85ebca6b);
  h = Math.imul(h ^ (qy | 0), 0xc2b2ae35);
  h = Math.imul(h ^ (qz | 0), 0x27d4eb2f);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Triangles the airbrush paints: centroid within the (round) footprint, kept
 *  with the falloff probability via a per-cell deterministic dither. Run against
 *  the refined mesh (interior filled to `maxEdge`) so the speckle is fine. */
export function airbrushFootprintTriangles(mesh: MeshData, stroke: AirbrushStroke): Set<number> {
  const { triVerts, numTri, vertProperties, numProp } = mesh;
  const out = new Set<number>();
  const r = stroke.radius;
  if (r <= 0 || stroke.samples.length === 0) return out;
  const r2 = r * r;
  const strength = Math.max(0, Math.min(1, stroke.strength));
  const softness = Math.max(0, Math.min(1, stroke.softness));
  const cell = stroke.maxEdge > 0 ? stroke.maxEdge : r / 10;
  const seed = stroke.seed | 0;
  const samples = stroke.samples;
  const box = strokeAabb({ samples, radius: r, shape: 'circle', maxEdge: cell });

  for (let t = 0; t < numTri; t++) {
    const v0 = triVerts[t * 3], v1 = triVerts[t * 3 + 1], v2 = triVerts[t * 3 + 2];
    const ax = vertProperties[v0 * numProp], ay = vertProperties[v0 * numProp + 1], az = vertProperties[v0 * numProp + 2];
    const bx = vertProperties[v1 * numProp], by = vertProperties[v1 * numProp + 1], bz = vertProperties[v1 * numProp + 2];
    const cx2 = vertProperties[v2 * numProp], cy2 = vertProperties[v2 * numProp + 1], cz2 = vertProperties[v2 * numProp + 2];
    if (triOutsideAabb([ax, ay, az], [bx, by, bz], [cx2, cy2, cz2], box)) continue;
    const cx = (ax + bx + cx2) / 3, cy = (ay + by + cy2) / 3, cz = (az + bz + cz2) / 3;

    // Nearest sample, Euclidean (the airbrush is round).
    let best2 = Infinity;
    for (let s = 0; s < samples.length; s++) {
      const dx = cx - samples[s][0], dy = cy - samples[s][1], dz = cz - samples[s][2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < best2) best2 = d2;
    }
    if (best2 > r2) continue;

    const p = airbrushProbability(Math.sqrt(best2) / r, strength, softness);
    if (p <= 0) continue;
    if (p >= 1) { out.add(t); continue; }

    // Decide per grain cell so the speckle is identical regardless of how finely
    // the mesh is later subdivided under (or near) this stroke.
    const qx = Math.floor(cx / cell), qy = Math.floor(cy / cell), qz = Math.floor(cz / cell);
    if (cellHash(qx, qy, qz, seed) < p) out.add(t);
  }
  return out;
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
export function subdivideSelected(
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
 *  brush strokes. Each stroke refines the (possibly already-refined) mesh near
 *  its own footprint until the boundary triangles fall below `stroke.maxEdge`.
 *  Returns the refined mesh and a `childToParent` map from each final triangle
 *  back to its base-mesh triangle index — used to carry non-stroke colour
 *  regions across the refinement. */
export function buildStrokeMesh(
  base: MeshData,
  strokes: BrushStroke[],
): { mesh: MeshData; childToParent: Int32Array } {
  let mesh = base;
  let comp: Int32Array = new Int32Array(base.numTri);
  for (let i = 0; i < comp.length; i++) comp[i] = i;

  for (const stroke of strokes) {
    const target = stroke.maxEdge > 0 ? stroke.maxEdge : stroke.radius / 16;
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const selected = selectStrokeTriangles(mesh, stroke, target);
      if (selected.size === 0) break;
      const { mesh: nm, childToParent } = subdivideSelected(mesh, selected);
      mesh = nm;
      comp = composeMaps(comp, childToParent);
      if (nm.numTri > MAX_TRIANGLES) break;
    }
  }
  return { mesh, childToParent: comp };
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
