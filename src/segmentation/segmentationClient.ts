// Main-thread client for part detection.
//
// Serializes calls (one in flight at a time), (re)loads the mesh into the
// Worker on demand, and supports cancel via AbortSignal (terminate + lazy
// respawn — the engrave/surface Worker idiom). Falls back to running the
// SegmentationRunner in-process where Workers don't exist (Node / unit tier).

import { getConfig } from '../config/appConfig';
import type { DraftSummary, PartEditOp } from './draft';
import { AbortedError } from './growth';
import { SegmentationRunner, type DetectRequest } from './runner';
import type { SegWorkerRequest, SegWorkerResponse } from './segmentationWorker';
import type { EdgeCut } from './smoothEdges';
import type { SavedPartsPayload, SegMesh } from './types';

export interface SegCallResult {
  summary: DraftSummary | null;
  triPart: Int32Array | null;
}

export interface SegCallControl {
  signal?: AbortSignal;
  onProgress?: (fraction: number, message?: string) => void;
}

/** Distributes a SegWorkerRequest without its callId. */
type RequestBody = SegWorkerRequest extends infer R ? R extends { callId: number } ? Omit<R, 'callId'> : never : never;

let worker: Worker | null = null;
let loadedKey: string | null = null;
let nextCallId = 1;
let chain: Promise<unknown> = Promise.resolve();
let local: { key: string; runner: SegmentationRunner } | null = null;

function teardown(): void {
  worker?.terminate();
  worker = null;
  loadedKey = null;
}

function getWorker(): Worker {
  if (!worker) worker = new Worker(new URL('./segmentationWorker.ts', import.meta.url), { type: 'module' });
  return worker;
}

type Reply = Extract<SegWorkerResponse, { type: 'result' } | { type: 'cut' }>;

function call(body: RequestBody, ctl?: SegCallControl): Promise<SegCallResult> {
  return callRaw(body, ctl).then((m) => {
    if (m.type !== 'result') throw new Error('part detection worker: unexpected reply');
    return { summary: m.summary, triPart: m.triPart };
  });
}

function callRaw(body: RequestBody, ctl?: SegCallControl): Promise<Reply> {
  return new Promise<Reply>((resolve, reject) => {
    if (ctl?.signal?.aborted) { reject(new AbortedError()); return; }
    const w = getWorker();
    const callId = nextCallId++;
    let settled = false;
    const cleanup = () => {
      ctl?.signal?.removeEventListener('abort', onAbort);
      w.onmessage = null;
      w.onerror = null;
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      ctl?.signal?.removeEventListener('abort', onAbort);
      teardown();
      reject(new AbortedError());
    };
    w.onmessage = (e: MessageEvent<SegWorkerResponse>) => {
      const m = e.data;
      if (m.callId !== callId) return;
      if (m.type === 'progress') { ctl?.onProgress?.(m.fraction, m.message); return; }
      if (settled) return;
      settled = true;
      cleanup();
      if (m.type === 'error') reject(new Error(m.message));
      else resolve(m);
    };
    w.onerror = (e) => {
      if (settled) return;
      settled = true;
      cleanup();
      teardown();
      reject(new Error(e.message || 'part detection worker error'));
    };
    if (ctl?.signal) ctl.signal.addEventListener('abort', onAbort, { once: true });
    w.postMessage({ ...body, callId } as SegWorkerRequest);
  });
}

function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

const hasWorker = () => typeof Worker !== 'undefined';

/** Read on the main thread and threaded into the Worker (getConfig() there
 *  only sees static defaults). */
const pinCreaseDeg = () => getConfig().segmentation.edgePinCreaseDeg;
const runnerOpts = () => {
  const c = getConfig().segmentation;
  return { undoDepth: c.undoDepth, defaultEdgeSmoothing: c.defaultEdgeSmoothing, anchorMinRegionFrac: c.seedsFromPartsMinRegionFrac };
};

async function ensureLoaded(meshKey: string, mesh: () => SegMesh): Promise<void> {
  if (!hasWorker()) {
    if (local?.key !== meshKey) local = { key: meshKey, runner: new SegmentationRunner(mesh(), runnerOpts()) };
    return;
  }
  if (loadedKey === meshKey && worker) return;
  const m = mesh();
  // Clone so the caller's arrays stay usable (structured clone, not transfer).
  await call({ type: 'load', meshKey, mesh: { positions: m.positions.slice(), triVerts: m.triVerts.slice() }, ...runnerOpts() });
  loadedKey = meshKey;
}

/** Run a detector on `mesh` (identified by `meshKey`, which must change when
 *  the geometry does). The first run creates the draft; later runs go into
 *  it as an undoable step (honouring its locks and focus). */
export function detectPartsAsync(
  meshKey: string,
  mesh: () => SegMesh,
  req: Omit<DetectRequest, 'signal' | 'progress'>,
  ctl?: SegCallControl,
): Promise<SegCallResult> {
  return serialized(async () => {
    await ensureLoaded(meshKey, mesh);
    if (!hasWorker()) {
      const summary = local!.runner.detect({ ...req, signal: ctl?.signal, progress: ctl?.onProgress });
      return { summary, triPart: local!.runner.draft!.triPart.slice() };
    }
    return call({ type: 'detect', req }, ctl);
  });
}

/** Run a detector without replacing the current draft (side-by-side
 *  comparisons). */
export function previewPartsAsync(
  meshKey: string,
  mesh: () => SegMesh,
  req: Omit<DetectRequest, 'signal' | 'progress'>,
  ctl?: SegCallControl,
): Promise<SegCallResult> {
  return serialized(async () => {
    await ensureLoaded(meshKey, mesh);
    if (!hasWorker()) {
      const p = local!.runner.preview({ ...req, signal: ctl?.signal, progress: ctl?.onProgress });
      return { summary: p.summary, triPart: p.triPart };
    }
    return call({ type: 'preview', req }, ctl);
  });
}

/** Apply edit ops to the current draft. Throws when the draft is gone
 *  (e.g. after a cancel tore the Worker down). */
export function editPartsAsync(meshKey: string, ops: PartEditOp[]): Promise<SegCallResult> {
  return serialized(async () => {
    if (!hasWorker()) {
      if (local?.key !== meshKey) throw new Error('No part draft — call detectParts first.');
      const summary = local.runner.edit(ops);
      return { summary, triPart: local.runner.draft!.triPart.slice() };
    }
    if (loadedKey !== meshKey || !worker) throw new Error('No part draft — call detectParts first.');
    return call({ type: 'edit', ops });
  });
}

export function discardPartsDraft(): Promise<void> {
  return serialized(async () => {
    if (!hasWorker()) { if (local) local.runner.draft = null; return; }
    if (worker) await call({ type: 'discard' });
  });
}

/** Make parts saved on an import the draft (re-opening accepted parts). */
export function adoptPartsAsync(meshKey: string, mesh: () => SegMesh, saved: SavedPartsPayload): Promise<SegCallResult> {
  return serialized(async () => {
    await ensureLoaded(meshKey, mesh);
    if (!hasWorker()) {
      const summary = local!.runner.adopt(saved);
      return { summary, triPart: local!.runner.draft!.triPart.slice() };
    }
    return call({ type: 'adopt', saved: { ...saved, triPart: saved.triPart.slice() } });
  });
}

/** Smooth part edges for the current draft (null when smoothing is off). */
export function edgeCutAsync(meshKey: string, iterations?: number): Promise<EdgeCut | null> {
  return serialized(async () => {
    if (!hasWorker()) {
      if (local?.key !== meshKey) throw new Error('No part draft — call detectParts first.');
      return local.runner.cut(iterations, pinCreaseDeg());
    }
    if (loadedKey !== meshKey || !worker) throw new Error('No part draft — call detectParts first.');
    const m = await callRaw(iterations === undefined ? { type: 'cut', pinCreaseDeg: pinCreaseDeg() } : { type: 'cut', iterations, pinCreaseDeg: pinCreaseDeg() });
    if (m.type !== 'cut') throw new Error('part detection worker: unexpected reply');
    return m.cut;
  });
}
