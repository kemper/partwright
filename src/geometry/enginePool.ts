// A small pool of geometry Workers for building many parts in PARALLEL — used by
// the Assembly view, where every part in a session is meshed at once. The main
// editor keeps its single long-lived `engineWorker` (see engine.ts); this pool
// is a separate, disposable set of workers so a burst of assembly builds never
// contends with — or recycles — the interactive editor's engine.
//
// It intentionally speaks only the `execute` slice of the Worker protocol (no
// STEP export, simplify, imports side-channels, or progressive preview): the
// Assembly grid just needs each part's base mesh + declared param schema. Each
// worker is booted with the `init` handshake (manifold-3d WASM) and only takes
// jobs once it has posted `ready`; jobs beyond the free-worker count queue.
//
// Lifecycle: workers are spawned lazily on first `buildInPool` and torn down by
// `disposeEnginePool()` when the Assembly view closes, so we don't hold N extra
// WASM heaps resident while the user is back in the single-part editor.

import { getDefaultCircularSegments } from './qualitySettings';
import { getConfig } from '../config/appConfig';
import type { Language } from './engines/types';
import type { MeshData } from './types';
import type { ImportedMesh } from '../import/importedMesh';

export interface PoolBuildRequest {
  code: string;
  lang: Language;
  /** Customizer overrides for this build (merged into the part's own values). */
  params?: Record<string, unknown>;
  /** Imported meshes exposed to the sandbox as `api.imports[i]`. */
  imports?: ImportedMesh[];
  /** SCAD companion files (MEMFS path → source). */
  companionFiles?: Record<string, string>;
}

export interface PoolBuildResult {
  mesh: MeshData | null;
  error: string | null;
  paramsSchema: import('./params').ParamSpec[] | undefined;
  labelMap: Map<string, Set<number>> | undefined;
  labelColors: Map<string, [number, number, number]> | undefined;
  renderOnly: boolean;
}

interface Job {
  req: PoolBuildRequest;
  resolve: (r: PoolBuildResult) => void;
  reject: (e: Error) => void;
}

interface PoolWorker {
  worker: Worker;
  /** True once the worker has booted its WASM and posted `ready`. */
  ready: boolean;
  /** callId → its in-flight job, so a result routes back to the right promise. */
  inflight: Map<string, Job>;
  busy: boolean;
}

let workers: PoolWorker[] = [];
const queue: Job[] = [];
let callCounter = 0;
// Respawn budget so a worker that keeps failing to boot (e.g. WASM init fault)
// can't spin an unbounded respawn loop while queued jobs hang forever. Reset to
// 0 whenever any worker reaches `ready`; once it's exhausted AND no worker is
// ready, the pool gives up and rejects the queue instead of respawning.
let respawns = 0;
function maxRespawns(): number { return targetPoolSize() * 2 + 2; }

/** How many workers to run — config, clamped to available cores and ≥ 1. */
function targetPoolSize(): number {
  const want = getConfig().renderer.assemblyPoolSize;
  const cores = navigator.hardwareConcurrency || 4;
  return Math.max(1, Math.min(want, cores - 1));
}

function spawnWorker(): PoolWorker {
  const worker = new Worker(new URL('./engineWorker.ts', import.meta.url), { type: 'module' });
  const pw: PoolWorker = { worker, ready: false, inflight: new Map(), busy: false };
  worker.onmessage = (e: MessageEvent) => handleMessage(pw, e.data);
  worker.onerror = () => {
    // A worker-level error can't be tied to one callId; fail everything in flight
    // on this worker and replace it so the pool stays usable.
    failWorker(pw, new Error('Assembly build worker crashed'));
  };
  // Boot manifold-3d WASM; the worker replies `ready` when execute is safe.
  worker.postMessage({ type: 'init' });
  return pw;
}

function failWorker(pw: PoolWorker, err: Error): void {
  for (const job of pw.inflight.values()) job.reject(err);
  pw.inflight.clear();
  pw.busy = false;
  replaceWorker(pw);
}

function replaceWorker(dead: PoolWorker): void {
  const idx = workers.indexOf(dead);
  if (idx === -1) return; // already disposed
  try { dead.worker.terminate(); } catch { /* already gone */ }
  // If we've burned through the respawn budget and no worker is healthy, the
  // pool can't build anything — reject the queue rather than respawn forever.
  if (respawns++ >= maxRespawns() && !workers.some(w => w !== dead && w.ready)) {
    workers.splice(idx, 1);
    drainQueue(new Error('Assembly build workers failed to initialise'));
    return;
  }
  workers[idx] = spawnWorker();
  pump();
}

/** Reject every queued (not-yet-dispatched) job — used when the pool gives up. */
function drainQueue(err: Error): void {
  for (const job of queue.splice(0)) job.reject(err);
}

function ensureWorkers(): void {
  const n = targetPoolSize();
  while (workers.length < n) workers.push(spawnWorker());
}

function handleMessage(pw: PoolWorker, msg: Record<string, unknown>): void {
  if (msg.type === 'ready') {
    pw.ready = true;
    respawns = 0; // a healthy worker resets the give-up budget
    pump();
    return;
  }
  if (msg.type === 'error') {
    // A thrown/escaped error. If it carries a callId, fail just that job;
    // otherwise the WASM instance may be poisoned — fail the worker and replace.
    const callId = msg.callId as string | null;
    const message = (msg.message as string) || 'Assembly build failed';
    if (callId && pw.inflight.has(callId)) {
      pw.inflight.get(callId)!.reject(new Error(message));
      pw.inflight.delete(callId);
      pw.busy = false;
      pump();
    } else {
      failWorker(pw, new Error(message));
    }
    return;
  }
  if (msg.type !== 'execute_result') return; // pool ignores other traffic

  const callId = msg.callId as string;
  const job = pw.inflight.get(callId);
  if (!job) return;
  pw.inflight.delete(callId);
  pw.busy = false;

  const mesh = (msg.mesh as MeshData | null) ?? null;
  // Restore the voxel `_painted` mask structured-clone dropped (mirrors engine.ts).
  if (mesh && mesh.triColors && !(mesh.triColors as Uint8Array & { _painted?: Uint8Array })._painted) {
    (mesh.triColors as Uint8Array & { _painted?: Uint8Array })._painted = new Uint8Array(mesh.numTri).fill(1);
  }
  const labelMapEntries = msg.labelMapEntries as [string, number[]][] | null;
  const labelColorEntries = msg.labelColorEntries as [string, [number, number, number]][] | null;
  job.resolve({
    mesh,
    error: (msg.error as string | null) ?? null,
    paramsSchema: (msg.paramsSchema as PoolBuildResult['paramsSchema']) ?? undefined,
    labelMap: labelMapEntries ? new Map(labelMapEntries.map(([k, v]) => [k, new Set(v)])) : undefined,
    labelColors: labelColorEntries && labelColorEntries.length > 0 ? new Map(labelColorEntries) : undefined,
    renderOnly: !!msg.renderOnly,
  });
  pump();
}

/** Dispatch queued jobs onto any ready, free workers. */
function pump(): void {
  if (queue.length === 0) return;
  for (const pw of workers) {
    if (pw.busy || !pw.ready) continue;
    const job = queue.shift();
    if (!job) return;
    dispatch(pw, job);
  }
}

function dispatch(pw: PoolWorker, job: Job): void {
  const callId = `pool-${++callCounter}`;
  pw.busy = true;
  pw.inflight.set(callId, job);
  const { code, lang, params, imports, companionFiles } = job.req;
  const wireImports = (imports ?? []).map(m => ({
    id: m.id, filename: m.filename, format: m.format,
    numProp: m.numProp, numVert: m.numVert, numTri: m.numTri,
    vertProperties: m.vertProperties.slice(), triVerts: m.triVerts.slice(),
  }));
  pw.worker.postMessage({
    type: 'execute',
    callId,
    code,
    lang,
    imports: wireImports,
    circularSegments: getDefaultCircularSegments(),
    params: params ?? null,
    ...(companionFiles && Object.keys(companionFiles).length > 0 ? { companionFiles } : {}),
  });
}

/** Build one part in the pool. Spawns workers on first use. Concurrency is
 *  bounded by the pool size; excess calls queue and run as workers free up. */
export function buildInPool(req: PoolBuildRequest): Promise<PoolBuildResult> {
  ensureWorkers();
  return new Promise<PoolBuildResult>((resolve, reject) => {
    queue.push({ req, resolve, reject });
    pump();
  });
}

/** Tear down the pool and reject anything still queued. Call when the Assembly
 *  view closes so the extra WASM heaps are released. */
export function disposeEnginePool(): void {
  const err = new Error('Assembly view closed');
  for (const pw of workers) {
    for (const job of pw.inflight.values()) job.reject(err);
    try { pw.worker.terminate(); } catch { /* already gone */ }
  }
  for (const job of queue.splice(0)) job.reject(err);
  workers = [];
  respawns = 0;
}
