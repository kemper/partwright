// Main-thread client for the paint-subdivision Web Worker.
//
// Owns a single lazily-created Worker, dispatches one job at a time, and
// supports cancellation via `AbortSignal` — abort terminates the Worker and
// the next job spins up a fresh instance. Heavy paint strokes (max settings
// on a complex base) used to freeze the main thread for multiple seconds
// here; everything in this module exists to keep the UI responsive and the
// user in control while subdivision runs.

import type { MeshData } from '../geometry/types';
import type { RegionDescriptor } from './regions';
import type { RefineRequest, RefineResponse, RefineDone } from './subdivisionWorker';

let worker: Worker | null = null;
let nextJobId = 1;

interface PendingJob {
  id: number;
  resolve: (result: RefinedResult) => void;
  reject: (err: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

let inFlight: PendingJob | null = null;

export interface RefineJobInput {
  /** Pristine base mesh — used to build brush-stroke geodesic / normal data. */
  base: MeshData;
  /** Mesh to subdivide. For an incremental append this is the current refined
   *  mesh; for a full rebuild it's the same as `base`. */
  input: MeshData;
  descriptors: RegionDescriptor[];
  /** Aborting terminates the Worker, drops the in-flight job, and rejects this
   *  call's promise with an `AbortError`. The next job creates a fresh Worker. */
  signal?: AbortSignal;
}

export interface RefinedResult {
  mesh: MeshData;
  childToParent: Int32Array;
  brushStrokeTriangles: Map<number, Uint32Array>;
  durationMs: number;
}

export class SubdivisionAbortError extends Error {
  constructor(message = 'paint subdivision aborted') {
    super(message);
    this.name = 'AbortError';
  }
}

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./subdivisionWorker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<RefineResponse>) => {
    const msg = e.data;
    if (!inFlight || msg.id !== inFlight.id) return; // stale
    const job = inFlight;
    inFlight = null;
    if (job.signal && job.onAbort) job.signal.removeEventListener('abort', job.onAbort);
    if (msg.type === 'done') {
      job.resolve(toRefinedResult(msg));
    } else {
      job.reject(new Error(msg.message));
    }
  };
  worker.onerror = (ev) => {
    const err = new Error(`Subdivision worker crashed: ${ev.message}`);
    const job = inFlight;
    inFlight = null;
    if (job) {
      if (job.signal && job.onAbort) job.signal.removeEventListener('abort', job.onAbort);
      job.reject(err);
    }
    // Drop the dead worker; the next refine() creates a fresh one.
    worker?.terminate();
    worker = null;
  };
  return worker;
}

function toRefinedResult(msg: RefineDone): RefinedResult {
  const map = new Map<number, Uint32Array>();
  for (const entry of msg.brushStrokeTriangles) map.set(entry.index, entry.tris);
  return {
    mesh: msg.mesh,
    childToParent: msg.childToParent,
    brushStrokeTriangles: map,
    durationMs: msg.durationMs,
  };
}

/** Dispatch one refine job to the worker. Rejects if a prior job is still
 *  running — callers are expected to coalesce / queue at the reconcile layer.
 *  Abort terminates the worker; the next call spins a fresh one up. */
export function refineInWorker(input: RefineJobInput): Promise<RefinedResult> {
  if (inFlight) {
    return Promise.reject(new Error('subdivision worker is already running a job'));
  }
  if (input.signal?.aborted) {
    return Promise.reject(new SubdivisionAbortError());
  }
  const w = ensureWorker();
  const id = nextJobId++;

  return new Promise<RefinedResult>((resolve, reject) => {
    const job: PendingJob = { id, resolve, reject, signal: input.signal };
    if (input.signal) {
      job.onAbort = () => {
        if (!inFlight || inFlight.id !== id) return;
        inFlight = null;
        // Terminate is the only reliable way to interrupt the JS loop inside
        // the worker (postMessage can't preempt synchronous code). The next
        // refineInWorker() call rebuilds the worker.
        worker?.terminate();
        worker = null;
        reject(new SubdivisionAbortError());
      };
      input.signal.addEventListener('abort', job.onAbort, { once: true });
    }
    inFlight = job;

    const req: RefineRequest = {
      type: 'refine',
      id,
      base: input.base,
      input: input.input,
      descriptors: input.descriptors,
    };
    w.postMessage(req);
  });
}

/** True if a subdivision job is currently running in the worker. */
export function isSubdivisionInFlight(): boolean {
  return inFlight !== null;
}

/** Terminate the worker (test cleanup / hard reset). Any in-flight job is
 *  rejected with an abort error. */
export function terminateSubdivisionWorker(): void {
  const job = inFlight;
  inFlight = null;
  if (job) {
    if (job.signal && job.onAbort) job.signal.removeEventListener('abort', job.onAbort);
    job.reject(new SubdivisionAbortError());
  }
  worker?.terminate();
  worker = null;
}
