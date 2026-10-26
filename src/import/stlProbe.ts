// STL import probe — parse the bytes once, then walk a ladder of weld
// tolerances until `Manifold.ofMesh` accepts the welded mesh. Pure (the
// manifold check is injected), so the same code runs in the STL probe Worker
// (`stlProbeWorker.ts`, the normal path — a multi-million-triangle STL takes
// seconds here and must not freeze the UI) and on the main thread as a
// fallback when the Worker can't start.

import type { MeshData } from '../geometry/types';
import { DEFAULT_STL_WELD_TOLERANCE, parseSTLSoup, weldSoup } from './parsers/stl';

export type ManifoldTrial = { ok: true } | { ok: false; error: string };

export type STLProbeResult =
  | { mesh: MeshData; isManifold: true }
  | { mesh: MeshData; isManifold: false; manifoldError: string | null; maxTried: number; triCount: number; vertCount: number };

export interface STLProbeOptions {
  /** The configured STL weld tolerance (`import.stlWeldTolerance`) — the
   *  ladder's first rung. */
  configuredTolerance: number;
  /** Does `Manifold.ofMesh` accept this mesh? */
  tryManifold: (mesh: MeshData) => ManifoldTrial;
  /** Called before each step with the fraction done and what's running. */
  onProgress?: (fraction: number, message: string) => void;
}

/** Weld tolerances to try, loosest last: the configured STL tolerance, two
 *  fixed steps, then a scale-aware fallback — 5 ppm of the bounding-box
 *  diagonal catches imports in unusual units (μm or m) where 1e-3 absolute is
 *  either way too tight or way too loose. Shared by the STL and 3MF paths. */
export function weldToleranceLadder(mesh: Pick<MeshData, 'vertProperties' | 'numVert' | 'numProp'>, configuredTolerance: number): number[] {
  return [configuredTolerance, 1e-4, 1e-3, Math.max(bboxDiagonal(mesh.vertProperties, mesh.numVert, mesh.numProp) * 5e-6, 1e-6)];
}

function bboxDiagonal(p: ArrayLike<number>, count: number, stride: number): number {
  if (count === 0) return 0;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < count; i++) {
    const x = p[i * stride], y = p[i * stride + 1], z = p[i * stride + 2];
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  return Math.hypot(x1 - x0, y1 - y0, z1 - z0);
}

/** Parse + probe STL bytes. Returns null only when the bytes don't parse as
 *  STL at all. The bytes are parsed once; each tolerance re-welds the soup. */
export function probeSTL(bytes: Uint8Array, opts: STLProbeOptions): STLProbeResult | null {
  opts.onProgress?.(0, 'Reading triangles…');
  const soup = parseSTLSoup(bytes);
  if (!soup) return null;
  // Sanity-check that the soup welds to *something* before the more expensive
  // ofMesh trials. Its counts are what the render-only dialog reports.
  const probe = weldSoup(soup, DEFAULT_STL_WELD_TOLERANCE);
  if (!probe || probe.numTri === 0) return null;

  const tolerances = weldToleranceLadder(probe, opts.configuredTolerance);
  const soupTris = (soup.length / 9).toLocaleString();
  let bestMesh = probe;
  let maxTried = 0;
  let manifoldError: string | null = null;
  for (let i = 0; i < tolerances.length; i++) {
    const tol = tolerances[i];
    opts.onProgress?.((i + 1) / (tolerances.length + 1), `Checking ${soupTris} triangles (weld tolerance ${tol.toExponential(0)})…`);
    const mesh = tol === DEFAULT_STL_WELD_TOLERANCE ? probe : weldSoup(soup, tol);
    if (!mesh || mesh.numTri === 0) continue;
    // The cheap topology check settles the common (clean) case without a
    // multi-second `Manifold.ofMesh` the engine will repeat anyway; only a
    // mesh it rejects pays for the exact trial.
    const trial = isOrientedEdgeManifold(mesh) ? { ok: true as const } : opts.tryManifold(mesh);
    if (trial.ok) return { mesh, isManifold: true };
    manifoldError = trial.error;
    if (tol > maxTried) maxTried = tol;
    bestMesh = mesh;
  }
  return { mesh: bestMesh, isManifold: false, manifoldError, maxTried, triCount: probe.numTri, vertCount: probe.numVert };
}

/** A cheap stand-in for "would `Manifold.ofMesh` accept this mesh?" that
 *  settles the common clean case without the multi-second ofMesh (~10 s at
 *  3.7M triangles). It is deliberately conservative: when it says true, ofMesh
 *  accepts the mesh; when unsure it says false, and callers then run the exact
 *  ofMesh trial. True requires all of:
 *  - every referenced coordinate is finite (ofMesh: "Non-finite vertex");
 *  - at least one non-degenerate triangle;
 *  - no triangle has a reverse twin (same three vertices, opposite winding) —
 *    ofMesh cancels such pairs, which can leave a mesh empty or open;
 *  - every directed edge a→b occurs exactly as often as b→a — the halfedge
 *    pairing ofMesh enforces ("Not manifold" otherwise). Pinched edges (two
 *    pairs of faces on one edge, common in sculpts) pass, as in ofMesh.
 *  Cross-checked against manifold-3d on clean, pinched, open, doubled and
 *  non-finite meshes (tests/unit/stlProbe.test.ts). O(E log valence). */
export function isOrientedEdgeManifold(mesh: Pick<MeshData, 'triVerts' | 'numTri' | 'numVert' | 'vertProperties' | 'numProp'>): boolean {
  const { triVerts, numTri, numVert, vertProperties: vp, numProp: np } = mesh;
  if (numTri === 0) return false;
  for (let i = 0; i < numTri * 3; i++) if (triVerts[i] >= numVert) return false;
  for (let v = 0; v < numVert; v++) {
    if (!Number.isFinite(vp[v * np]) || !Number.isFinite(vp[v * np + 1]) || !Number.isFinite(vp[v * np + 2])) return false;
  }

  // Reverse twins: group triangles by their smallest vertex, key each by its
  // other two vertices (sorted) plus winding parity, sort, and look for equal
  // keys of opposite parity side by side.
  const byMin = new Uint32Array(numVert + 1);
  let nonDegenerate = 0;
  for (let t = 0; t < numTri; t++) {
    const a = triVerts[t * 3], b = triVerts[t * 3 + 1], c = triVerts[t * 3 + 2];
    if (a !== b && b !== c && a !== c) nonDegenerate++;
    byMin[Math.min(a, b, c) + 1]++;
  }
  if (nonDegenerate === 0) return false;
  for (let v = 0; v < numVert; v++) byMin[v + 1] += byMin[v];
  const keys = new Float64Array(numTri);
  const fill = byMin.slice(0, numVert);
  for (let t = 0; t < numTri; t++) {
    const a = triVerts[t * 3], b = triVerts[t * 3 + 1], c = triVerts[t * 3 + 2];
    // Rotate so the smallest vertex leads; the winding is then (lo, x, y).
    const [lo, x, y] = a <= b && a <= c ? [a, b, c] : b <= c ? [b, c, a] : [c, a, b];
    const parity = x < y ? 0 : 1;
    keys[fill[lo]++] = (Math.min(x, y) * numVert + Math.max(x, y)) * 2 + parity;
  }
  for (let v = 0; v < numVert; v++) {
    const lo = byMin[v], hi = byMin[v + 1];
    if (hi - lo < 2) continue;
    const group = keys.subarray(lo, hi).sort();
    for (let i = 1; i < group.length; i++) {
      // Same vertex pair (key >> 1), different parity (key & 1) → twins.
      if (Math.floor(group[i] / 2) === Math.floor(group[i - 1] / 2) && group[i] !== group[i - 1]) return false;
    }
  }

  // Edge pairing: outgoing edges per vertex as CSR, each list sorted so the
  // forward run and the reverse count are both binary searches.
  const start = new Uint32Array(numVert + 1);
  for (let i = 0; i < numTri * 3; i++) start[triVerts[i] + 1]++;
  for (let v = 0; v < numVert; v++) start[v + 1] += start[v];
  const to = new Uint32Array(numTri * 3);
  const cursor = start.slice(0, numVert);
  for (let t = 0; t < numTri; t++) {
    const a = triVerts[t * 3], b = triVerts[t * 3 + 1], c = triVerts[t * 3 + 2];
    to[cursor[a]++] = b;
    to[cursor[b]++] = c;
    to[cursor[c]++] = a;
  }
  for (let v = 0; v < numVert; v++) if (start[v + 1] - start[v] > 1) to.subarray(start[v], start[v + 1]).sort();
  const countIn = (lo: number, hi: number, x: number): number => {
    let l = lo, h = hi;
    while (l < h) { const m = (l + h) >> 1; if (to[m] < x) l = m + 1; else h = m; }
    let r = l;
    while (r < hi && to[r] === x) r++;
    return r - l;
  };
  for (let a = 0; a < numVert; a++) {
    const end = start[a + 1];
    for (let i = start[a]; i < end;) {
      const b = to[i];
      let j = i + 1;
      while (j < end && to[j] === b) j++;
      if (countIn(start[b], start[b + 1], a) !== j - i) return false;
      i = j;
    }
  }
  return true;
}
