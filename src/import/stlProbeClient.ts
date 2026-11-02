// Main-thread client for the STL probe Worker (`stlProbeWorker.ts`). Lazy
// spawn, terminate-on-abort (parsing and `Manifold.ofMesh` are synchronous —
// terminate+respawn is the only true interrupt), settled-guarded handlers.
// Each probe gets its own short-lived Worker, terminated when it settles: a
// WASM heap never shrinks, so a Worker that just checked a 2M-triangle mesh
// would otherwise sit on hundreds of MB. (Spawning + loading manifold-3d is
// ~0.2 s, small next to the probe of any mesh big enough to matter.)

import type { IndexedProbeResult, STLProbeResult } from './stlProbe';
import type { MeshData } from '../geometry/types';
import { ImportCancelledError, runImportWorkerJob, transferableBytes, type ImportWorkerControl } from './importWorkerJob';

/** Rejection when the caller aborts (shared with the 3MF parse Worker). */
export const STLProbeAbortError = ImportCancelledError;
export type STLProbeControl = ImportWorkerControl;

/** Probe STL bytes in the Worker. Rejects with STLProbeAbortError on abort,
 *  or a plain Error when the Worker fails. The bytes' buffer is TRANSFERRED
 *  (zero-copy; cloning 100 MB stalls the UI for ~0.4 s) once the Worker has
 *  loaded manifold-3d, so a Worker that fails to start leaves `bytes` intact
 *  for a main-thread fallback; after the hand-off they are detached. */
export function probeSTLInWorker(bytes: Uint8Array, configuredTolerance: number, ctl?: STLProbeControl): Promise<STLProbeResult | null> {
  return runProbe<STLProbeResult | null>({ type: 'probe', bytes, configuredTolerance }, transferableBytes(bytes), ctl);
}

/** Run the exact weld-ladder probe for an already-indexed mesh (a 3MF that
 *  failed the quick check) in the Worker. The mesh is copied, so the caller
 *  keeps it. */
export function probeIndexedInWorker(mesh: MeshData, configuredTolerance: number, ctl?: STLProbeControl): Promise<IndexedProbeResult> {
  const copy = { vertProperties: mesh.vertProperties.slice(), triVerts: mesh.triVerts.slice(), numVert: mesh.numVert, numTri: mesh.numTri, numProp: mesh.numProp };
  return runProbe<IndexedProbeResult>({ type: 'probeIndexed', mesh: copy, configuredTolerance }, [copy.vertProperties.buffer, copy.triVerts.buffer], ctl);
}

function runProbe<T>(payload: object, transfer: Transferable[], ctl?: STLProbeControl): Promise<T> {
  return runImportWorkerJob<T>(() => new Worker(new URL('./stlProbeWorker.ts', import.meta.url), { type: 'module' }), payload, transfer, 'STL probe', ctl);
}
