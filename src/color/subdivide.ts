// Local mesh subdivision for the smooth paintbrush.
//
// The blocky brush paints whole triangles, so a stroke's edge follows the
// existing tessellation. The smooth brush instead subdivides the triangles the
// brush boundary crosses, so the painted region's edge can follow the brush
// outline closely. Subdivision is a crack-free "red-green" refinement: every
// edge of a selected triangle is split at its midpoint, and any neighbour that
// shares a split edge is split to match (so no T-junctions / cracks appear and
// the mesh stays watertight). Midpoint vertices are shared per undirected edge.
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

  for (let t = 0; t < numTri; t++) {
    const a = triVertex(mesh, triVerts[t * 3]);
    const b = triVertex(mesh, triVerts[t * 3 + 1]);
    const c = triVertex(mesh, triVerts[t * 3 + 2]);

    // Already fine enough → leave it (keeps the refined band tight and bounded).
    if (maxEdgeLen2(a, b, c) <= maxEdge2) continue;

    let inside = 0;
    if (withinFootprint(a[0], a[1], a[2], stroke)) inside++;
    if (withinFootprint(b[0], b[1], b[2], stroke)) inside++;
    if (withinFootprint(c[0], c[1], c[2], stroke)) inside++;

    if (inside === 3) continue;       // fully inside — no edge crosses it
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
  for (let t = 0; t < numTri; t++) {
    const v0 = triVerts[t * 3], v1 = triVerts[t * 3 + 1], v2 = triVerts[t * 3 + 2];
    const cx = (vertProperties[v0 * numProp] + vertProperties[v1 * numProp] + vertProperties[v2 * numProp]) / 3;
    const cy = (vertProperties[v0 * numProp + 1] + vertProperties[v1 * numProp + 1] + vertProperties[v2 * numProp + 1]) / 3;
    const cz = (vertProperties[v0 * numProp + 2] + vertProperties[v1 * numProp + 2] + vertProperties[v2 * numProp + 2]) / 3;
    if (withinFootprint(cx, cy, cz, stroke)) out.add(t);
  }
  return out;
}

/** One crack-free red-green refinement pass over `selected` triangles.
 *  Returns the new mesh plus `childToParent`: for each output triangle, the
 *  index of the input triangle it came from (so callers can carry per-triangle
 *  data — e.g. existing colour regions — across the split). */
export function redGreenSubdivide(
  mesh: MeshData,
  selected: Set<number>,
): { mesh: MeshData; childToParent: Int32Array } {
  const { vertProperties, triVerts, numVert, numTri, numProp } = mesh;
  const P = numProp;

  // Numeric key for an undirected edge. numVert is the multiplier and stays
  // fixed within a pass; products stay well under Number.MAX_SAFE_INTEGER for
  // any realistic mesh.
  const key = (a: number, b: number): number => (a < b ? a * numVert + b : b * numVert + a);

  // 1. Mark every edge of every selected triangle.
  const marked = new Set<number>();
  for (const t of selected) {
    const a = triVerts[t * 3], b = triVerts[t * 3 + 1], c = triVerts[t * 3 + 2];
    marked.add(key(a, b)); marked.add(key(b, c)); marked.add(key(c, a));
  }

  // 2. Allocate a shared midpoint vertex per marked edge (lazily).
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

  // 3. Emit children, splitting by how many edges are marked (0/1/2/3).
  const outTris: number[] = [];
  const childParent: number[] = [];
  const emit = (a: number, b: number, c: number, parent: number): void => {
    outTris.push(a, b, c);
    childParent.push(parent);
  };

  for (let t = 0; t < numTri; t++) {
    const v0 = triVerts[t * 3], v1 = triVerts[t * 3 + 1], v2 = triVerts[t * 3 + 2];
    const e0 = marked.has(key(v0, v1));
    const e1 = marked.has(key(v1, v2));
    const e2 = marked.has(key(v2, v0));
    const count = (e0 ? 1 : 0) + (e1 ? 1 : 0) + (e2 ? 1 : 0);

    if (count === 0) { emit(v0, v1, v2, t); continue; }

    if (count === 3) {
      const m0 = midOf(v0, v1), m1 = midOf(v1, v2), m2 = midOf(v2, v0);
      emit(v0, m0, m2, t); emit(m0, v1, m1, t); emit(m2, m1, v2, t); emit(m0, m1, m2, t);
      continue;
    }

    if (count === 1) {
      // Marked edge (a,b), opposite vertex c, midpoint m → (a,m,c),(m,b,c).
      let a: number, b: number, c: number;
      if (e0) { a = v0; b = v1; c = v2; }
      else if (e1) { a = v1; b = v2; c = v0; }
      else { a = v2; b = v0; c = v1; }
      const m = midOf(a, b);
      emit(a, m, c, t); emit(m, b, c, t);
      continue;
    }

    // count === 2: rotate so the UNMARKED edge is (w2,w0); marked = (w0,w1),(w1,w2).
    let w0: number, w1: number, w2: number;
    if (!e2) { w0 = v0; w1 = v1; w2 = v2; }
    else if (!e0) { w0 = v1; w1 = v2; w2 = v0; }
    else { w0 = v2; w1 = v0; w2 = v1; }
    const m0 = midOf(w0, w1), m1 = midOf(w1, w2);
    emit(m0, w1, m1, t);   // corner at w1
    emit(w0, m0, m1, t);   // quad w0-m0-m1-w2, fanned from w0
    emit(w0, m1, w2, t);
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
      const { mesh: nm, childToParent } = redGreenSubdivide(mesh, selected);
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
