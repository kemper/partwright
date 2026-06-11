// Mesh-level connected-component extraction.
//
// Iso-surfacers (Surface Nets, marching cubes) can split a thin shell into a few
// disconnected pieces — a strut pinched off, a secondary inner surface, or specks
// that touch the main web at only a single vertex. `largestMeshComponent` keeps
// only the biggest EDGE-connected piece (two triangles are connected only when
// they share a full edge, the same notion of connectivity Manifold uses), which
// restores the "one watertight, printable solid" guarantee and drops point-only
// junk that vertex-connectivity would wrongly keep.
//
// Pure logic (no DOM/WASM) → unit-tested in the vitest tier.

import type { MeshData } from '../geometry/types';

/** Return a new mesh containing only the largest edge-connected component of
 *  `mesh`. Preserves per-triangle colors. A mesh with ≤ 1 component is returned
 *  unchanged. */
export function largestMeshComponent(mesh: MeshData): MeshData {
  const { triVerts, numTri } = mesh;
  if (numTri <= 1) return mesh;

  // Union-find over TRIANGLES; union two triangles that share an edge.
  const parent = new Int32Array(numTri);
  for (let i = 0; i < numTri; i++) parent[i] = i;
  const find = (x: number): number => {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  };
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  // Edge key: ordered vertex pair packed into a string (vertex ids can exceed
  // what a single number key can pack safely). First triangle to claim an edge
  // records itself; the second unions with it.
  const edgeOwner = new Map<string, number>();
  const claim = (u: number, v: number, t: number) => {
    const key = u < v ? `${u},${v}` : `${v},${u}`;
    const prev = edgeOwner.get(key);
    if (prev === undefined) edgeOwner.set(key, t);
    else union(prev, t);
  };
  for (let t = 0; t < numTri; t++) {
    const a = triVerts[t * 3], b = triVerts[t * 3 + 1], c = triVerts[t * 3 + 2];
    claim(a, b, t); claim(b, c, t); claim(c, a, t);
  }

  // Largest component by triangle count.
  const count = new Map<number, number>();
  for (let t = 0; t < numTri; t++) {
    const r = find(t);
    count.set(r, (count.get(r) ?? 0) + 1);
  }
  if (count.size <= 1) return mesh;
  let bestRoot = -1, bestCount = -1;
  for (const [r, n] of count) if (n > bestCount) { bestCount = n; bestRoot = r; }

  // Compact: keep the winning component's triangles, re-index their vertices.
  const numProp = mesh.numProp;
  const src = mesh.vertProperties;
  const colors = mesh.triColors;
  const remap = new Int32Array(mesh.numVert).fill(-1);
  const outPos: number[] = [];
  const outTris: number[] = [];
  const outColors: number[] = [];
  const keepVert = (v: number): number => {
    let idx = remap[v];
    if (idx === -1) {
      idx = outPos.length / 3;
      outPos.push(src[v * numProp], src[v * numProp + 1], src[v * numProp + 2]);
      remap[v] = idx;
    }
    return idx;
  };
  for (let t = 0; t < numTri; t++) {
    if (find(t) !== bestRoot) continue;
    const a = triVerts[t * 3], b = triVerts[t * 3 + 1], c = triVerts[t * 3 + 2];
    outTris.push(keepVert(a), keepVert(b), keepVert(c));
    if (colors) outColors.push(colors[t * 3], colors[t * 3 + 1], colors[t * 3 + 2]);
  }

  const out: MeshData = {
    vertProperties: Float32Array.from(outPos),
    triVerts: Uint32Array.from(outTris),
    numVert: outPos.length / 3,
    numTri: outTris.length / 3,
    numProp: 3,
  };
  if (colors) out.triColors = Uint8Array.from(outColors);
  return out;
}

/** Keep every edge-connected component whose triangle count is at least
 *  `fraction × (largest component)` — dropping only smaller specks/dust. Unlike
 *  `largestMeshComponent` (which keeps exactly one piece), this preserves a
 *  model's real features when a modifier severs it into several substantial
 *  pieces (e.g. a perforated lattice on a tapered/multi-feature model, where the
 *  Z-projected pattern breaks the shell into rings). `fraction <= 0` keeps
 *  everything; `fraction >= 1` is equivalent to `largestMeshComponent`. Preserves
 *  per-triangle colors. */
export function meshComponentsAboveFraction(mesh: MeshData, fraction: number): MeshData {
  const { triVerts, numTri } = mesh;
  if (numTri <= 1 || fraction <= 0) return mesh;

  const parent = new Int32Array(numTri);
  for (let i = 0; i < numTri; i++) parent[i] = i;
  const find = (x: number): number => {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  };
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  const edgeOwner = new Map<string, number>();
  const claim = (u: number, v: number, t: number) => {
    const key = u < v ? `${u},${v}` : `${v},${u}`;
    const prev = edgeOwner.get(key);
    if (prev === undefined) edgeOwner.set(key, t);
    else union(prev, t);
  };
  for (let t = 0; t < numTri; t++) {
    const a = triVerts[t * 3], b = triVerts[t * 3 + 1], c = triVerts[t * 3 + 2];
    claim(a, b, t); claim(b, c, t); claim(c, a, t);
  }

  const count = new Map<number, number>();
  for (let t = 0; t < numTri; t++) {
    const r = find(t);
    count.set(r, (count.get(r) ?? 0) + 1);
  }
  if (count.size <= 1) return mesh;
  let bestCount = 0;
  for (const n of count.values()) if (n > bestCount) bestCount = n;
  const threshold = Math.max(1, fraction * bestCount);

  const numProp = mesh.numProp;
  const src = mesh.vertProperties;
  const colors = mesh.triColors;
  const remap = new Int32Array(mesh.numVert).fill(-1);
  const outPos: number[] = [];
  const outTris: number[] = [];
  const outColors: number[] = [];
  const keepVert = (v: number): number => {
    let idx = remap[v];
    if (idx === -1) {
      idx = outPos.length / 3;
      outPos.push(src[v * numProp], src[v * numProp + 1], src[v * numProp + 2]);
      remap[v] = idx;
    }
    return idx;
  };
  for (let t = 0; t < numTri; t++) {
    if ((count.get(find(t)) ?? 0) < threshold) continue;
    const a = triVerts[t * 3], b = triVerts[t * 3 + 1], c = triVerts[t * 3 + 2];
    outTris.push(keepVert(a), keepVert(b), keepVert(c));
    if (colors) outColors.push(colors[t * 3], colors[t * 3 + 1], colors[t * 3 + 2]);
  }

  const out: MeshData = {
    vertProperties: Float32Array.from(outPos),
    triVerts: Uint32Array.from(outTris),
    numVert: outPos.length / 3,
    numTri: outTris.length / 3,
    numProp: 3,
  };
  if (colors) out.triColors = Uint8Array.from(outColors);
  return out;
}
