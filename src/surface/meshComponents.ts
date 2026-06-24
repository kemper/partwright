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

/** Drop tiny edge-connected components — keep every component whose enclosed
 *  |signed volume| is at least `minFraction` of the largest component's. Unlike
 *  `largestMeshComponent` this preserves multiple substantial pieces (e.g. the
 *  separate outer and inner shells of a hollow solid — the inner one's signed
 *  volume is negative but large in magnitude), removing only the near-zero-volume
 *  debris an iso-surfacer beads off a thin wall. Volume is the right metric here:
 *  the debris are thin SHEETS, so they slip past both triangle-count and
 *  bounding-box tests (many tiny tris spread over a wide-but-flat patch). A mesh
 *  with ≤ 1 component is returned unchanged. */
export function dropTinyMeshComponents(mesh: MeshData, minFraction = 0.02): MeshData {
  const { triVerts, numTri, numProp } = mesh;
  if (numTri <= 1) return mesh;
  const pos = mesh.vertProperties;

  const parent = new Int32Array(numTri);
  for (let i = 0; i < numTri; i++) parent[i] = i;
  const find = (x: number): number => {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  };
  const union = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  const edgeOwner = new Map<string, number>();
  const claim = (u: number, v: number, t: number) => {
    const key = u < v ? `${u},${v}` : `${v},${u}`;
    const prev = edgeOwner.get(key);
    if (prev === undefined) edgeOwner.set(key, t); else union(prev, t);
  };
  for (let t = 0; t < numTri; t++) {
    const a = triVerts[t * 3], b = triVerts[t * 3 + 1], c = triVerts[t * 3 + 2];
    claim(a, b, t); claim(b, c, t); claim(c, a, t);
  }

  // Per-component signed volume (Σ a·(b×c)/6 — the divergence-theorem volume of
  // each closed component, robust to thin debris).
  const vol = new Map<number, number>();
  for (let t = 0; t < numTri; t++) {
    const a = triVerts[t * 3], b = triVerts[t * 3 + 1], c = triVerts[t * 3 + 2];
    const ax = pos[a * numProp], ay = pos[a * numProp + 1], az = pos[a * numProp + 2];
    const bx = pos[b * numProp], by = pos[b * numProp + 1], bz = pos[b * numProp + 2];
    const cx = pos[c * numProp], cy = pos[c * numProp + 1], cz = pos[c * numProp + 2];
    const v = (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    const r = find(t);
    vol.set(r, (vol.get(r) ?? 0) + v);
  }
  if (vol.size <= 1) return mesh;
  let maxVol = 0;
  for (const v of vol.values()) if (Math.abs(v) > maxVol) maxVol = Math.abs(v);
  const threshold = maxVol * minFraction;
  const keepRoot = new Set<number>();
  for (const [r, v] of vol) if (Math.abs(v) >= threshold) keepRoot.add(r);

  const src = mesh.vertProperties;
  const colors = mesh.triColors;
  const remap = new Int32Array(mesh.numVert).fill(-1);
  const outPos: number[] = [];
  const outTris: number[] = [];
  const outColors: number[] = [];
  const keepVert = (v: number): number => {
    let idx = remap[v];
    if (idx === -1) { idx = outPos.length / 3; outPos.push(src[v * numProp], src[v * numProp + 1], src[v * numProp + 2]); remap[v] = idx; }
    return idx;
  };
  for (let t = 0; t < numTri; t++) {
    if (!keepRoot.has(find(t))) continue;
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
