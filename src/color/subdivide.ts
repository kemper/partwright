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
 *  Brush strokes, slabs, and oriented shapes all reduce to one of these. */
export interface RefineRegion {
  aabb: Aabb | null;
  maxEdge: number;
  classify: TriClassifier;
}

/** Per-stroke depth bound so a single stroke can't run away (each pass ~doubles
 *  the boundary triangle count). There is deliberately NO cumulative triangle
 *  cap — the mesh may grow across many strokes; the UI surfaces a high-complexity
 *  warning and a live triangle count instead of silently degrading quality. */
const MAX_PASSES = 16;

/** True when `p` is within the brush footprint of any of the stroke's samples,
 *  using the shape's distance metric (circle = Euclidean, square = Chebyshev,
 *  diamond = L1). */
function withinFootprint(
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

/** Classify a triangle against a brush footprint: inside when all three
 *  vertices are covered, straddle when some (but not all) are — or, for a brush
 *  smaller than the face, when the footprint's closest point on the triangle is
 *  within the radius (so a small brush in the middle of a big face still
 *  tessellates). */
function brushClassifier(stroke: BrushStroke): TriClassifier {
  const r2 = stroke.radius * stroke.radius;
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
      const dx = cp[0] - sp[0], dy = cp[1] - sp[1], dz = cp[2] - sp[2];
      if (dx * dx + dy * dy + dz * dz <= r2) return 'straddle';
    }
    return 'outside';
  };
}

/** Build a refine region for a brush stroke (its footprint classifier, AABB,
 *  and target edge length). */
export function brushRefineRegion(stroke: BrushStroke): RefineRegion {
  const maxEdge = stroke.maxEdge > 0 ? stroke.maxEdge : stroke.radius / 256;
  return { aabb: strokeAabb(stroke), maxEdge, classify: brushClassifier(stroke) };
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

  for (let t = 0; t < numTri; t++) {
    const a = triVertex(mesh, triVerts[t * 3]);
    const b = triVertex(mesh, triVerts[t * 3 + 1]);
    const c = triVertex(mesh, triVerts[t * 3 + 2]);

    // Cheap spatial reject: skip triangles nowhere near the region.
    if (box && triOutsideAabb(a, b, c, box)) continue;

    // Already fine enough → leave it (keeps the refined band tight and bounded).
    if (maxEdgeLen2(a, b, c) <= maxEdge2) continue;

    if (region.classify(a, b, c) === 'straddle') selected.add(t);
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
      const { mesh: nm, childToParent } = subdivideSelected(mesh, selected);
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
