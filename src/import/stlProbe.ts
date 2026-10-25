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

/** True when every directed edge a→b of the mesh occurs exactly as often as
 *  its reverse b→a — each edge's triangles pair up with opposite orientation.
 *  That is the property `Manifold.ofMesh` checks: it pairs each halfedge with
 *  an opposite one and fails "Not manifold" when one is left over (a pinched
 *  edge shared by two pairs of faces is fine — real sculpts have them). A
 *  welded mesh can't trip its other checks (out-of-range indices, non-finite
 *  coordinates), so a mesh that passes here is accepted there, at a fraction
 *  of the cost (a CSR pass, ~0.2 s, vs. ~10 s of halfedge build + sort at
 *  3.7M triangles). A mesh that fails still gets the exact ofMesh trial. */
export function isOrientedEdgeManifold(mesh: Pick<MeshData, 'triVerts' | 'numTri' | 'numVert'>): boolean {
  const { triVerts, numTri, numVert } = mesh;
  if (numTri === 0) return false;
  // Outgoing directed edges per vertex, as CSR.
  const start = new Uint32Array(numVert + 1);
  for (let i = 0; i < numTri * 3; i++) {
    const v = triVerts[i];
    if (v >= numVert) return false;
    start[v + 1]++;
  }
  for (let v = 0; v < numVert; v++) start[v + 1] += start[v];
  const to = new Uint32Array(numTri * 3);
  const cursor = start.slice(0, numVert);
  for (let t = 0; t < numTri; t++) {
    const a = triVerts[t * 3], b = triVerts[t * 3 + 1], c = triVerts[t * 3 + 2];
    to[cursor[a]++] = b;
    to[cursor[b]++] = c;
    to[cursor[c]++] = a;
  }
  for (let a = 0; a < numVert; a++) {
    for (let i = start[a]; i < start[a + 1]; i++) {
      const b = to[i];
      let forward = 0;
      for (let j = start[a]; j < start[a + 1]; j++) if (to[j] === b) forward++;
      let back = 0;
      for (let j = start[b]; j < start[b + 1]; j++) if (to[j] === a) back++;
      if (forward !== back) return false;
    }
  }
  return true;
}
