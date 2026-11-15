// Colour seeding for a coloured mesh import (3MF): which triangles of the mesh
// the import wrapper produced carry which palette entry of the file.
//
// `Manifold.ofMesh` reorders triangles, so the file's per-triangle colours are
// carried over by position: an output triangle takes the colour of the source
// triangle whose centroid sits on its own. Only such exact matches count, so
// geometry composed in beside the import (the rest of the object it was added
// to) stays uncoloured — and is skipped without a search (see `maxDistance`).
//
// Pure (no DOM/engine): runs on the main thread for small meshes and in
// `colorSeedWorker.ts` for big ones, and unit-tests in the vitest tier.

import { nearestTriangleMap, type CentroidMesh } from '../surface/colorTransfer';

/** One palette entry's triangles in the output mesh. */
export interface ColorSeedGroup {
  /** Index into the file's palette. */
  colorIdx: number;
  /** Output-mesh triangle ids, ascending. */
  triangleIds: Uint32Array;
}

/** The palette index every triangle shares, or -1 when the triangles differ
 *  (or none is coloured). A file whose triangles all carry one colour — any
 *  unpainted single-filament slicer project — has nothing for paint regions
 *  to tell apart. */
export function singleColorIndex(triColor: Int32Array): number {
  if (triColor.length === 0) return -1;
  const first = triColor[0];
  if (first < 0) return -1;
  for (let i = 1; i < triColor.length; i++) if (triColor[i] !== first) return -1;
  return first;
}

/** How far apart two centroids may be and still count as the same triangle:
 *  a hair of the source's size (float rounding through the import wrapper). */
function matchTolerance(source: CentroidMesh): number {
  const v = source.vertProperties, n = source.numProp;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i + 2 < v.length; i += n) {
    const x = v[i], y = v[i + 1], z = v[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const diag = minX <= maxX ? Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) : 1;
  return Math.max(diag, 1e-3) * 1e-5;
}

/** Group `out`'s triangles by the palette entry of the `source` triangle each
 *  one coincides with. `triColor` is per SOURCE triangle (-1 = uncoloured).
 *  Triangles with no coinciding source triangle, or an uncoloured one, are in
 *  no group. Groups come back in palette order. */
export function matchImportColors(source: CentroidMesh, out: CentroidMesh, triColor: Int32Array): ColorSeedGroup[] {
  const nearest = nearestTriangleMap(source, out, { maxDistance: matchTolerance(source) });
  const counts = new Map<number, number>();
  for (let t = 0; t < nearest.length; t++) {
    const o = nearest[t];
    if (o < 0) continue;
    const c = triColor[o];
    if (c >= 0) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const groups = new Map<number, ColorSeedGroup>();
  const filled = new Map<number, number>();
  for (const [colorIdx, n] of [...counts].sort((a, b) => a[0] - b[0])) {
    groups.set(colorIdx, { colorIdx, triangleIds: new Uint32Array(n) });
    filled.set(colorIdx, 0);
  }
  for (let t = 0; t < nearest.length; t++) {
    const o = nearest[t];
    if (o < 0) continue;
    const c = triColor[o];
    if (c < 0) continue;
    const at = filled.get(c)!;
    groups.get(c)!.triangleIds[at] = t;
    filled.set(c, at + 1);
  }
  return [...groups.values()];
}
