// Dedicated Web Worker that runs the paint-subdivision pipeline off the main
// thread. Each `RefineRequest` from the main thread is built into refine
// regions, fed through `buildRefinedMesh`, and the resulting mesh + footprint
// triangle sets are posted back (with transferables) on completion.
//
// The main thread cancels by calling `worker.terminate()` (the client recreates
// the worker for the next job). Errors are surfaced as `{ type: 'error' }`
// messages — they never propagate out of the worker, which would crash it.
//
// All the actual math lives in `refinePipeline.ts` so the same code runs on
// the main-thread synchronous fallback (used by the console `paintStroke` API)
// and inside the worker.

import { refineMeshPipeline } from './refinePipeline';
import type { MeshData } from '../geometry/types';
import type { RegionDescriptor } from './regions';

export interface RefineRequest {
  type: 'refine';
  /** Caller-assigned id echoed back on response so stale messages from a
   *  superseded job can be discarded. */
  id: number;
  /** Pristine base mesh — used to build brush-stroke geodesic / normal data. */
  base: MeshData;
  /** Mesh to subdivide: the current refined mesh on an incremental append, or
   *  the base mesh on a full rebuild. */
  input: MeshData;
  descriptors: RegionDescriptor[];
}

export interface RefineDone {
  type: 'done';
  id: number;
  mesh: MeshData;
  childToParent: Int32Array;
  /** Plain-object encoding of the `Map<descriptorIdx, Uint32Array>` since
   *  Map keys survive structured-clone but iterating by key is awkward on the
   *  receiving side. */
  brushStrokeTriangles: Array<{ index: number; tris: Uint32Array }>;
  /** Wall-clock ms the worker spent on the refine — handy for the UI to
   *  decide whether to surface a "this is slow, cancel?" toast next time. */
  durationMs: number;
}

export interface RefineError {
  type: 'error';
  id: number;
  message: string;
}

export type RefineResponse = RefineDone | RefineError;

// `tsconfig.json` ships with the DOM lib but not the WebWorker lib, so `self`
// is typed as `Window` (whose `postMessage` is a different signature). Narrow
// it to the worker-side shape locally.
interface WorkerPost {
  postMessage(message: RefineResponse, transfer?: Transferable[]): void;
}
const workerPost = (self as unknown as WorkerPost).postMessage.bind(self) as WorkerPost['postMessage'];

self.onmessage = (event: MessageEvent<RefineRequest>): void => {
  const msg = event.data;
  if (!msg || msg.type !== 'refine') return;
  const { id, base, input, descriptors } = msg;
  const started = performance.now();
  try {
    const { mesh, childToParent, brushStrokeTriangles } = refineMeshPipeline(base, input, descriptors);

    const brushList: RefineDone['brushStrokeTriangles'] = [];
    for (const [index, tris] of brushStrokeTriangles) {
      brushList.push({ index, tris });
    }

    const response: RefineDone = {
      type: 'done',
      id,
      mesh,
      childToParent,
      brushStrokeTriangles: brushList,
      durationMs: performance.now() - started,
    };

    // Transfer ownership of the big typed arrays so structured-clone doesn't
    // memcpy them across the thread boundary. Only the *output* buffers are
    // transferred — `base` / `input` were copied in via structured clone (the
    // main thread still holds its own copies and may keep using them).
    const transfers: Transferable[] = [
      mesh.vertProperties.buffer,
      mesh.triVerts.buffer,
      childToParent.buffer,
    ];
    if (mesh.triColors) transfers.push(mesh.triColors.buffer);
    if (mesh.mergeFromVert) transfers.push(mesh.mergeFromVert.buffer);
    if (mesh.mergeToVert) transfers.push(mesh.mergeToVert.buffer);
    if (mesh.runIndex) transfers.push(mesh.runIndex.buffer);
    if (mesh.runOriginalID) transfers.push(mesh.runOriginalID.buffer);
    for (const entry of brushList) transfers.push(entry.tris.buffer);

    workerPost(response, transfers);
  } catch (err) {
    const response: RefineError = {
      type: 'error',
      id,
      message: err instanceof Error ? err.message : String(err),
    };
    workerPost(response);
  }
};
