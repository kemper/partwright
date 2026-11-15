// Split a closed triangle mesh along horizontal planes (z = const), keeping it
// closed and edge-manifold. Used by the layered-print painted export's
// "layer stripes" option: side walls are cut at the filament swap heights so
// each band can be painted with the filament printed there. Pure; unit-tested.
//
// Every triangle that a plane strictly crosses is cut (not only the ones the
// caller wants to recolour): the cut points live on the triangle EDGES, and a
// neighbour sharing that edge must be cut at the same point or the mesh gets a
// T-junction. Cut points are keyed by (edge, plane) and interpolated from the
// edge's endpoints in a fixed order, so both triangles on an edge get the very
// same vertex. Each triangle ∩ slab is convex, so a fan over its boundary
// points (in the triangle's own winding) triangulates it.

import type { MeshData } from '../../geometry/types';

export interface ZPlaneSplit {
  /** The split mesh (positions/props copied; no merge vectors or colours). */
  mesh: MeshData;
  /** For every output triangle, the input triangle it came from. */
  parent: Uint32Array;
}

/** A vertex within this distance of a plane counts as ON it (no cut there). */
const ON_PLANE_EPS = 1e-6;

/** Cut `mesh` at every z in `planes`. Triangles no plane crosses are copied
 *  unchanged (same index order: they keep their place relative to the rest).
 *  Vertices that `mergeFromVert`/`mergeToVert` mark as one are welded first,
 *  so a property seam can't hide a shared edge. */
export function splitMeshAtZPlanes(mesh: MeshData, planes: readonly number[]): ZPlaneSplit {
  const np = mesh.numProp;
  const zs = [...new Set(planes.filter((z) => Number.isFinite(z)))].sort((a, b) => a - b);
  // Canonical vertex per id (welds manifold-3d property seams).
  const canon = new Uint32Array(mesh.numVert);
  for (let v = 0; v < mesh.numVert; v++) canon[v] = v;
  if (mesh.mergeFromVert && mesh.mergeToVert) {
    for (let i = 0; i < mesh.mergeFromVert.length; i++) canon[mesh.mergeFromVert[i]] = mesh.mergeToVert[i];
  }
  const vp = mesh.vertProperties;
  const out: number[] = [];
  for (let v = 0; v < mesh.numVert; v++) for (let k = 0; k < np; k++) out.push(vp[v * np + k]);
  const z = (v: number) => out[v * np + 2];

  /** Side of plane `p` for an existing vertex: -1 below, 0 on, +1 above. */
  const side = (v: number, p: number) => (z(v) < p - ON_PLANE_EPS ? -1 : z(v) > p + ON_PLANE_EPS ? 1 : 0);

  const cut = new Map<string, number>();
  /** The shared vertex where plane `pi` crosses edge (a, b). */
  const cutVertex = (a: number, b: number, pi: number): number => {
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const key = `${lo},${hi},${pi}`;
    let id = cut.get(key);
    if (id === undefined) {
      const p = zs[pi];
      const t = (p - z(lo)) / (z(hi) - z(lo));
      id = out.length / np;
      for (let k = 0; k < np; k++) out.push(out[lo * np + k] + (out[hi * np + k] - out[lo * np + k]) * t);
      out[id * np + 2] = p; // exactly on the plane
      cut.set(key, id);
    }
    return id;
  };

  const tris: number[] = [];
  const parent: number[] = [];
  const tv = mesh.triVerts;
  for (let t = 0; t < mesh.numTri; t++) {
    const c = [canon[tv[t * 3]], canon[tv[t * 3 + 1]], canon[tv[t * 3 + 2]]];
    const lo = Math.min(z(c[0]), z(c[1]), z(c[2])), hi = Math.max(z(c[0]), z(c[1]), z(c[2]));
    // Planes that strictly separate two of this triangle's vertices.
    const crossing: number[] = [];
    for (let pi = 0; pi < zs.length; pi++) {
      const p = zs[pi];
      if (p <= lo + ON_PLANE_EPS || p >= hi - ON_PLANE_EPS) continue;
      crossing.push(pi);
    }
    if (crossing.length === 0) {
      tris.push(c[0], c[1], c[2]);
      parent.push(t);
      continue;
    }
    // Boundary walk: each corner, then the cut points along the edge to the
    // next corner (in order of travel). Each point remembers which plane it
    // lies on (-1 for a corner; a corner may still sit ON a plane).
    const ring: Array<{ v: number; plane: number }> = [];
    for (let e = 0; e < 3; e++) {
      const a = c[e], b = c[(e + 1) % 3];
      ring.push({ v: a, plane: -1 });
      const pts: Array<{ v: number; plane: number }> = [];
      for (const pi of crossing) {
        const sa = side(a, zs[pi]), sb = side(b, zs[pi]);
        if (sa * sb < 0) pts.push({ v: cutVertex(a, b, pi), plane: pi });
      }
      // Planes ascend in z; travel order follows the edge's direction.
      if (z(b) < z(a)) pts.reverse();
      ring.push(...pts);
    }
    // Slabs between consecutive crossing planes (plus below the first and
    // above the last). A point belongs to a slab when it is inside it or on
    // one of its bounding planes.
    const bounds = [-Infinity, ...crossing.map((pi) => zs[pi]), Infinity];
    const boundPlane = [-1, ...crossing, -1];
    for (let s = 0; s + 1 < bounds.length; s++) {
      const bot = bounds[s], top = bounds[s + 1];
      const poly: Array<{ v: number; plane: number }> = [];
      for (const pt of ring) {
        const pz = z(pt.v);
        const onBot = pt.plane >= 0 ? pt.plane === boundPlane[s] : Math.abs(pz - bot) <= ON_PLANE_EPS;
        const onTop = pt.plane >= 0 ? pt.plane === boundPlane[s + 1] : Math.abs(pz - top) <= ON_PLANE_EPS;
        const inside = pz > bot + ON_PLANE_EPS && pz < top - ON_PLANE_EPS;
        if (inside || onBot || onTop) poly.push(pt);
      }
      if (poly.length < 3) continue;
      // All points on one plane = a chord or a sliver with no area.
      const allOn = (p: number) => p >= 0 && poly.every((pt) => (pt.plane >= 0 ? pt.plane === p : Math.abs(z(pt.v) - zs[p]) <= ON_PLANE_EPS));
      if (allOn(boundPlane[s]) || allOn(boundPlane[s + 1])) continue;
      for (let i = 1; i + 1 < poly.length; i++) {
        tris.push(poly[0].v, poly[i].v, poly[i + 1].v);
        parent.push(t);
      }
    }
  }
  // Compact: drop vertices no triangle uses (the welded-away seam copies).
  const remap = new Int32Array(out.length / np).fill(-1);
  let numVert = 0;
  for (const v of tris) if (remap[v] < 0) remap[v] = numVert++;
  const props = new Float32Array(numVert * np);
  for (let v = 0; v < remap.length; v++) {
    const r = remap[v];
    if (r >= 0) for (let k = 0; k < np; k++) props[r * np + k] = out[v * np + k];
  }
  const triVerts = new Uint32Array(tris.length);
  for (let i = 0; i < tris.length; i++) triVerts[i] = remap[tris[i]];
  return {
    mesh: { vertProperties: props, triVerts, numVert, numTri: tris.length / 3, numProp: np },
    parent: Uint32Array.from(parent),
  };
}
