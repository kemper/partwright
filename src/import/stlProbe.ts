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
    const trial = opts.tryManifold(mesh);
    if (trial.ok) return { mesh, isManifold: true };
    manifoldError = trial.error;
    if (tol > maxTried) maxTried = tol;
    bestMesh = mesh;
  }
  return { mesh: bestMesh, isManifold: false, manifoldError, maxTried, triCount: probe.numTri, vertCount: probe.numVert };
}
