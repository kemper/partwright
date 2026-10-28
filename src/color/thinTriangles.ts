// Sub-pixel sliver absorption for the projection paintbrush.
//
// The projection brush collects the triangles whose id lands on a pixel centre
// under the brush disk. A sliver narrower than a pixel (the fans a smooth-edge
// cut or a part-boundary cut leaves along a seam) often covers no pixel centre,
// so it is never collected — yet the antialiased viewport still draws it as a
// fine line of the old colour that no amount of re-painting removes. This grows
// the footprint across mesh edges into such slivers when they sit inside the
// brush. "Thin" is measured in world space (triangle height below `maxWidth`),
// so a normally-shaped face merely seen edge-on is never pulled in.

import type { MeshData } from '../geometry/types';
import type { AdjacencyGraph } from './adjacency';

/** Smallest height of triangle t (2·area / longest edge), in mesh units. */
function minAltitude(mesh: MeshData, t: number): number {
  const { triVerts, vertProperties: p, numProp: n } = mesh;
  const a = triVerts[t * 3] * n, b = triVerts[t * 3 + 1] * n, c = triVerts[t * 3 + 2] * n;
  const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
  const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
  const wx = p[c] - p[b], wy = p[c + 1] - p[b + 1], wz = p[c + 2] - p[b + 2];
  const cross = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  const longest = Math.sqrt(Math.max(ux * ux + uy * uy + uz * uz, vx * vx + vy * vy + vz * vz, wx * wx + wy * wy + wz * wz));
  return longest > 0 ? cross / longest : 0;
}

/** True when triangles s and t share an edge: two corners at the same position.
 *  The paint adjacency graph links triangles that share only a corner, which
 *  would let a fan of thin wedges around one hub vertex all qualify. */
function sharesEdge(mesh: MeshData, s: number, t: number): boolean {
  const { triVerts, vertProperties: p, numProp: n } = mesh;
  let shared = 0;
  for (let i = 0; i < 3; i++) {
    const a = triVerts[s * 3 + i] * n;
    for (let j = 0; j < 3; j++) {
      const b = triVerts[t * 3 + j] * n;
      if (p[a] === p[b] && p[a + 1] === p[b + 1] && p[a + 2] === p[b + 2]) { shared++; break; }
    }
  }
  return shared >= 2;
}

/** Add to `footprint` (in place) every triangle reachable from it across shared
 *  edges through slivers — triangles thinner than `maxWidth` mesh units that sit
 *  in the brush (`inBrush` holds at their centroid or at two of their corners).
 *  Chains of slivers are followed. Returns how many triangles were added. */
export function absorbSubPixelSlivers(
  footprint: Set<number>,
  mesh: MeshData,
  adjacency: Pick<AdjacencyGraph, 'nbStart' | 'nbFlat'>,
  maxWidth: number,
  inBrush: (x: number, y: number, z: number) => boolean,
): number {
  if (!(maxWidth > 0) || footprint.size === 0) return 0;
  const { nbStart, nbFlat } = adjacency;
  const { triVerts, vertProperties: p, numProp: n } = mesh;
  const rejected = new Set<number>();
  const stack = [...footprint];
  let added = 0;
  const inBrushEnough = (t: number): boolean => {
    let cx = 0, cy = 0, cz = 0, corners = 0;
    for (let k = 0; k < 3; k++) {
      const o = triVerts[t * 3 + k] * n;
      if (inBrush(p[o], p[o + 1], p[o + 2])) corners++;
      cx += p[o]; cy += p[o + 1]; cz += p[o + 2];
    }
    return corners >= 2 || inBrush(cx / 3, cy / 3, cz / 3);
  };
  while (stack.length > 0) {
    const t = stack.pop()!;
    for (let i = nbStart[t]; i < nbStart[t + 1]; i++) {
      const nb = nbFlat[i];
      if (footprint.has(nb) || rejected.has(nb)) continue;
      if (!sharesEdge(mesh, t, nb)) continue; // corner-only neighbour: may still join via an edge
      if (minAltitude(mesh, nb) >= maxWidth || !inBrushEnough(nb)) {
        rejected.add(nb);
        continue;
      }
      footprint.add(nb);
      stack.push(nb);
      added++;
    }
  }
  return added;
}
