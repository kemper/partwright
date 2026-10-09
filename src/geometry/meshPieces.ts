// Pieces + parts of one object's mesh — the data behind the object list's
// expandable "Parts" / "Pieces" section (and `partwright.listObjectParts()`).
//
// Vocabulary (see public/ai.md#objects-parts-and-pieces):
//   - object — a row in the left rail: its own code + version history.
//   - part   — a named region of that object's mesh, declared in code with
//              `api.label(shape, name)` (or SCAD `label("name")` / `BREP.label`).
//              Tracked by provenance, so it survives unions/cuts even when
//              several parts fuse into one solid.
//   - piece  — a physically separate solid (a connected component of the mesh):
//              what actually comes off the print bed as its own lump.
//
// Pure and dependency-free so it runs in the vitest unit tier.

/** The minimal mesh shape this module reads (a subset of `MeshData`). */
export interface PieceMesh {
  vertProperties: Float32Array;
  triVerts: Uint32Array;
  numTri: number;
  numProp: number;
  /** manifold-3d's seam-merge pairs: vertex `mergeFromVert[i]` is the same
   *  point as `mergeToVert[i]`. When present they weld exactly (and fast);
   *  without them vertices are welded by quantized position. */
  mergeFromVert?: Uint32Array;
  mergeToVert?: Uint32Array;
}

export interface MeshPieces {
  /** Number of connected components. */
  count: number;
  /** Component index (0-based, ordered by first triangle) for every triangle. */
  pieceOfTri: Int32Array;
}

/** Split a mesh into connected components (union-find over vertices).
 *
 *  manifold-3d meshes (merge vectors present — even empty ones) are trusted as
 *  already indexed: vertices are shared by index and any property-seam
 *  duplicates are joined through the merge pairs (unioned, so chains resolve).
 *  That matches `Manifold.decompose()` / `componentCount` exactly — including
 *  two solids that merely touch at a point, which stay separate pieces.
 *  Meshes without merge vectors (imports, re-tessellated meshes) are welded by
 *  quantized position instead. */
export function computeMeshPieces(mesh: PieceMesh): MeshPieces {
  const { vertProperties, triVerts, numTri, numProp } = mesh;
  const pieceOfTri = new Int32Array(numTri).fill(-1);
  if (numTri === 0) return { count: 0, pieceOfTri };

  const numVert = Math.floor(vertProperties.length / numProp);
  const parent = new Int32Array(numVert);
  for (let i = 0; i < numVert; i++) parent[i] = i;
  const find = (x: number): number => {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  };
  const union = (x: number, y: number): void => {
    const rx = find(x);
    const ry = find(y);
    if (rx !== ry) parent[ry] = rx;
  };

  if (mesh.mergeFromVert && mesh.mergeToVert) {
    const n = Math.min(mesh.mergeFromVert.length, mesh.mergeToVert.length);
    for (let i = 0; i < n; i++) {
      const from = mesh.mergeFromVert[i];
      const to = mesh.mergeToVert[i];
      if (from < numVert && to < numVert) union(from, to);
    }
  } else {
    weldByPosition(vertProperties, numProp, numVert, union);
  }

  for (let t = 0; t < numTri; t++) {
    const a = triVerts[t * 3];
    union(a, triVerts[t * 3 + 1]);
    union(a, triVerts[t * 3 + 2]);
  }

  // Number the roots in first-triangle order so piece 0 is stable.
  const rootToPiece = new Map<number, number>();
  for (let t = 0; t < numTri; t++) {
    const r = find(triVerts[t * 3]);
    let p = rootToPiece.get(r);
    if (p === undefined) { p = rootToPiece.size; rootToPiece.set(r, p); }
    pieceOfTri[t] = p;
  }
  return { count: rootToPiece.size, pieceOfTri };
}

/** Union every pair of vertices at the same quantized position. Numeric (sort
 *  by quantized x,y,z, then join runs) — no per-vertex string keys. The quantum
 *  is relative to the model size so tiny and huge models weld alike, and coarse
 *  enough to absorb float noise on a shared seam. */
function weldByPosition(vp: Float32Array, numProp: number, numVert: number, union: (a: number, b: number) => void): void {
  let span = 0;
  for (let v = 0; v < numVert; v++) {
    for (let k = 0; k < 3; k++) span = Math.max(span, Math.abs(vp[v * numProp + k]));
  }
  const q = span > 0 ? span * 1e-7 : 1e-9;
  const qx = new Float64Array(numVert);
  const qy = new Float64Array(numVert);
  const qz = new Float64Array(numVert);
  for (let v = 0; v < numVert; v++) {
    qx[v] = Math.round(vp[v * numProp] / q);
    qy[v] = Math.round(vp[v * numProp + 1] / q);
    qz[v] = Math.round(vp[v * numProp + 2] / q);
  }
  const order = new Uint32Array(numVert);
  for (let i = 0; i < numVert; i++) order[i] = i;
  order.sort((a, b) => (qx[a] - qx[b]) || (qy[a] - qy[b]) || (qz[a] - qz[b]));
  for (let i = 1; i < numVert; i++) {
    const a = order[i - 1];
    const b = order[i];
    if (qx[a] === qx[b] && qy[a] === qy[b] && qz[a] === qz[b]) union(a, b);
  }
}

export interface ObjectPartSummary {
  name: string;
  triangles: Set<number>;
}

export interface ObjectPieceSummary {
  index: number;
  triangles: number[];
  /** The part (label) covering most of this piece's surface area, if any. */
  part?: string;
}

export interface ObjectPartsSummary {
  parts: ObjectPartSummary[];
  /** Triangles no label covers. Empty when the object declares no parts. */
  unlabeled: number[];
  /** One entry per connected component. */
  pieces: ObjectPieceSummary[];
}

/** Combine the per-run label map (label name → triangle ids) with the mesh's
 *  connected components into the rail's parts/pieces summary. Parts keep the
 *  label map's insertion (declaration) order; each piece is named after the
 *  part that covers the most of its surface area. */
export function summarizeObjectParts(
  mesh: PieceMesh,
  labelMap: ReadonlyMap<string, Set<number>> | null,
  pieces: MeshPieces = computeMeshPieces(mesh),
): ObjectPartsSummary {
  const parts: ObjectPartSummary[] = [];
  const owner = new Int32Array(mesh.numTri).fill(-1);
  if (labelMap) {
    for (const [name, tris] of labelMap) {
      const idx = parts.length;
      parts.push({ name, triangles: tris });
      for (const t of tris) if (t >= 0 && t < mesh.numTri) owner[t] = idx;
    }
  }

  const unlabeled: number[] = [];
  if (parts.length > 0) {
    for (let t = 0; t < mesh.numTri; t++) if (owner[t] < 0) unlabeled.push(t);
  }

  const pieceTris: number[][] = Array.from({ length: pieces.count }, () => []);
  for (let t = 0; t < mesh.numTri; t++) {
    const p = pieces.pieceOfTri[t];
    if (p >= 0) pieceTris[p].push(t);
  }
  // Weight by surface area, not triangle count: a finely-tessellated handle
  // shouldn't out-vote the big, coarsely-meshed body it's attached to.
  const { vertProperties: vp, triVerts: tv, numProp: np } = mesh;
  const triArea = (t: number): number => {
    const a = tv[t * 3] * np, b = tv[t * 3 + 1] * np, c = tv[t * 3 + 2] * np;
    const ux = vp[b] - vp[a], uy = vp[b + 1] - vp[a + 1], uz = vp[b + 2] - vp[a + 2];
    const vx = vp[c] - vp[a], vy = vp[c + 1] - vp[a + 1], vz = vp[c + 2] - vp[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    return Math.sqrt(cx * cx + cy * cy + cz * cz) / 2;
  };
  const summaries: ObjectPieceSummary[] = pieceTris.map((tris, index) => {
    if (parts.length === 0) return { index, triangles: tris };
    const counts = new Map<number, number>();
    for (const t of tris) {
      const o = owner[t];
      if (o >= 0) counts.set(o, (counts.get(o) ?? 0) + triArea(t));
    }
    let best = -1;
    let bestCount = 0;
    for (const [o, c] of counts) if (c > bestCount) { best = o; bestCount = c; }
    return best >= 0 ? { index, triangles: tris, part: parts[best].name } : { index, triangles: tris };
  });

  return { parts, unlabeled, pieces: summaries };
}

export interface TriangleSetStats {
  min: [number, number, number];
  max: [number, number, number];
  /** Total surface area of the set. */
  area: number;
}

/** Bounding box + surface area of a triangle subset (a part or a piece).
 *  Null for an empty set. */
export function triangleSetStats(mesh: PieceMesh, tris: Iterable<number>): TriangleSetStats | null {
  const { vertProperties: vp, triVerts: tv, numProp: np } = mesh;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let area = 0;
  let any = false;
  for (const t of tris) {
    if (t < 0 || t >= mesh.numTri) continue;
    any = true;
    const a = tv[t * 3] * np, b = tv[t * 3 + 1] * np, c = tv[t * 3 + 2] * np;
    for (const o of [a, b, c]) {
      for (let k = 0; k < 3; k++) {
        const v = vp[o + k];
        if (v < min[k]) min[k] = v;
        if (v > max[k]) max[k] = v;
      }
    }
    const ux = vp[b] - vp[a], uy = vp[b + 1] - vp[a + 1], uz = vp[b + 2] - vp[a + 2];
    const vx = vp[c] - vp[a], vy = vp[c + 1] - vp[a + 1], vz = vp[c + 2] - vp[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    area += Math.sqrt(cx * cx + cy * cy + cz * cz) / 2;
  }
  return any ? { min, max, area } : null;
}

/** A standalone mesh of just `tris` (positions only, re-indexed compactly;
 *  per-triangle colours carried when present) — e.g. to export one piece. */
export function extractSubMesh<M extends PieceMesh & { triColors?: Uint8Array | null }>(mesh: M, tris: Iterable<number>): { vertProperties: Float32Array; triVerts: Uint32Array; numTri: number; numVert: number; numProp: number; triColors?: Uint8Array } {
  const { vertProperties: vp, triVerts: tv, numProp: np } = mesh;
  const remap = new Map<number, number>();
  const verts: number[] = [];
  const outTris: number[] = [];
  const colors: number[] = [];
  for (const t of tris) {
    if (t < 0 || t >= mesh.numTri) continue;
    for (let k = 0; k < 3; k++) {
      const v = tv[t * 3 + k];
      let nv = remap.get(v);
      if (nv === undefined) {
        nv = remap.size;
        remap.set(v, nv);
        verts.push(vp[v * np], vp[v * np + 1], vp[v * np + 2]);
      }
      outTris.push(nv);
    }
    if (mesh.triColors) colors.push(mesh.triColors[t * 3], mesh.triColors[t * 3 + 1], mesh.triColors[t * 3 + 2]);
  }
  return {
    vertProperties: new Float32Array(verts),
    triVerts: new Uint32Array(outTris),
    numTri: outTris.length / 3,
    numVert: remap.size,
    numProp: 3,
    ...(mesh.triColors ? { triColors: new Uint8Array(colors) } : {}),
  };
}
