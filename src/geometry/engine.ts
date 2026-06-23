import type { MeshData, MeshResult } from './types';
import type { Engine, Language, ValidateResult } from './engines/types';
import { DEFAULT_LANGUAGE, isLanguage } from './engines/types';
import { manifoldJsEngine, getManifoldModule } from './engines/manifoldJs';
import { openscadEngine } from './engines/openscad';
import { replicadEngine } from './engines/replicad';
import { voxelEngine } from './engines/voxel';
import { getActiveImports, type ImportedMesh } from '../import/importedMesh';
import { getCompanionFiles } from '../import/companionFiles';
import { getDefaultCircularSegments } from './qualitySettings';
import { getConfig } from '../config/appConfig';
import { errorLog } from '../diagnostics/errorLog';
import {
  registerWorker,
  markWorkerStarted,
  markWorkerRestarted,
  recordWorkerRun,
  type RunStatus,
} from '../diagnostics/workerStats';
import { isFatalWasmFault } from './workerFaults';

export type { Language };
export { isLanguage, DEFAULT_LANGUAGE };

const engines: Record<Language, Engine> = {
  'manifold-js': manifoldJsEngine,
  'scad': openscadEngine,
  'replicad': replicadEngine,
  'voxel': voxelEngine,
};

let activeLanguage: Language = DEFAULT_LANGUAGE;

export function getActiveLanguage(): Language {
  return activeLanguage;
}

export function setActiveLanguage(lang: Language): void {
  if (!isLanguage(lang)) return;
  activeLanguage = lang;
}

/** Initialize the specified engine (defaults to the manifold-js engine, which
 * is always eager-loaded since OpenSCAD needs it for the round-trip).
 * Also boots the geometry Worker so it's warm before first code execution. */
export async function initEngine(lang: Language = DEFAULT_LANGUAGE): Promise<void> {
  // Always make sure manifold-js is ready (exports + slicing + ofMesh rely on it).
  await manifoldJsEngine.init();
  if (lang !== 'manifold-js') {
    await engines[lang].init();
  }
  // Boot the geometry Worker eagerly so it's warm before the first run.
  initEngineWorker();
}

/** The manifold-3d module — used by crossSection.ts, exports, and the SCAD round-trip. */
export function getModule() {
  return getManifoldModule();
}

/** Resolve which language to use. Explicit lang arg wins; otherwise active language. */
function pickLang(lang?: Language): Language {
  if (lang && isLanguage(lang)) return lang;
  return activeLanguage;
}

/** Synchronous execution — works for manifold-js only, stays on the main
 *  thread. Use for cases that need the live Manifold object immediately
 *  (e.g. phantom/reference geometry that inspects volume/bbox inline).
 *  For all other code execution use executeCodeAsync(). */
export function executeCode(source: string, lang?: Language, paramOverrides?: Record<string, unknown>): MeshResult {
  const l = pickLang(lang);
  if (l === 'scad' || l === 'replicad') {
    return {
      mesh: null,
      manifold: null,
      error: `${l === 'scad' ? 'OpenSCAD' : 'BREP/replicad'} requires async execution — use executeCodeAsync() instead.`,
    };
  }
  const engine = engines[l];
  if (!engine.isReady()) {
    return {
      mesh: null,
      manifold: null,
      error: `${engine.id} engine not initialized yet — try again after loading completes.`,
    };
  }
  return engine.run(source, paramOverrides);
}

// ── Geometry Worker client ──────────────────────────────────────────────────

let engineWorker: Worker | null = null;
let workerReadyResolve: (() => void) | null = null;
let workerReadyReject: ((e: Error) => void) | null = null;
// Mutable so it can be replaced when the Worker is restarted after a crash.
// A crashed-and-restarted Worker must not inherit the already-resolved promise
// from its predecessor — callers would skip the await and race the new init.
let workerReady: Promise<void> = new Promise((r, rej) => { workerReadyResolve = r; workerReadyReject = rej; });
let callIdCounter = 0;

const pendingExecutions  = new Map<string, { resolve: (r: MeshResult) => void; reject: (e: Error) => void; onPreview?: (r: MeshResult) => void; meta?: { startedAt: number; lang: Language } }>();
const pendingValidations = new Map<string, { resolve: (r: ValidateResult) => void; reject: (e: Error) => void }>();
const pendingDetections  = new Map<string, { resolve: (r: string[]) => void; reject: (e: Error) => void }>();
const pendingStepExports = new Map<string, { resolve: (blob: Blob | null) => void; reject: (e: Error) => void }>();
const pendingStepBrepImports = new Map<string, { resolve: (filename: string) => void; reject: (e: Error) => void }>();
const pendingStepMeshImports = new Map<string, { resolve: (mesh: MeshData) => void; reject: (e: Error) => void }>();
const pendingClearBrepImports = new Map<string, { resolve: () => void; reject: (e: Error) => void }>();
const pendingClearBrepShapes = new Map<string, { resolve: () => void; reject: (e: Error) => void }>();
const pendingSimplifies  = new Map<string, {
  resolve: (r: SimplifyWorkerResult | null) => void;
  reject: (e: Error) => void;
  onProgress: (fraction: number) => void;
}>();
const pendingEnhances = new Map<string, {
  resolve: (r: EnhanceWorkerResult | null) => void;
  reject: (e: Error) => void;
  onProgress: (fraction: number) => void;
}>();

/** Total operations the geometry Worker is currently working on, across every
 *  request kind. Drives the in-flight readout in the worker-health panel. */
function geometryInFlight(): number {
  return (
    pendingExecutions.size +
    pendingValidations.size +
    pendingDetections.size +
    pendingStepExports.size +
    pendingStepBrepImports.size +
    pendingStepMeshImports.size +
    pendingClearBrepImports.size +
    pendingClearBrepShapes.size +
    pendingSimplifies.size +
    pendingEnhances.size
  );
}

// Register with the worker-health registry so the diagnostics panel can show
// liveness + in-flight load without this module having to push an update on
// every map mutation (the live provider is polled by the panel instead).
registerWorker('geometry', 'Geometry (manifold / SCAD / BREP)', () => ({
  alive: engineWorker !== null,
  inFlight: geometryInFlight(),
}));

/** Record one settled geometry execute into the worker run-history ring. */
function recordGeometryRun(
  meta: { startedAt: number; lang: Language } | undefined,
  status: RunStatus,
  workerMs?: number,
  detail?: string,
): void {
  if (!meta) return;
  recordWorkerRun({
    worker: 'geometry',
    kind: meta.lang,
    durationMs: Math.round(performance.now() - meta.startedAt),
    workerMs,
    status,
    detail,
  });
}

// Hard-timeout for the non-render Worker operations that have no on-screen
// cancel affordance: SCAD validation / include-detection and STEP
// export/import. The Worker posts no result back if its WASM hangs, so without
// this the promise (and the UI waiting on it) would never settle. The render
// path (executeCodeAsync) deliberately has *no* timeout — a slow model is
// bounded by the user instead, via the live elapsed-time counter and the
// "× Cancel" button that terminates the Worker on demand.
function getWorkerOpTimeoutMs(lang: 'scad' | 'replicad'): number {
  const cfg = getConfig();
  return lang === 'scad' ? cfg.ai.geometryTimeoutScadMs : cfg.ai.geometryTimeoutReplicadMs;
}

function rejectAllPending(err: Error): void {
  // Classify the teardown so each in-flight execute lands in the run history
  // with the right status rather than a generic failure.
  const teardownStatus: RunStatus = /timed out/i.test(err.message)
    ? 'timeout'
    : /cancel/i.test(err.message)
      ? 'cancelled'
      : 'error';
  for (const p of pendingExecutions.values()) {
    recordGeometryRun(p.meta, teardownStatus, undefined, err.message);
    p.reject(err);
  }
  for (const p of pendingValidations.values()) p.reject(err);
  for (const p of pendingDetections.values()) p.reject(err);
  for (const p of pendingStepExports.values()) p.reject(err);
  for (const p of pendingStepBrepImports.values()) p.reject(err);
  for (const p of pendingStepMeshImports.values()) p.reject(err);
  for (const p of pendingClearBrepImports.values()) p.reject(err);
  for (const p of pendingClearBrepShapes.values()) p.reject(err);
  for (const p of pendingSimplifies.values()) p.reject(err);
  for (const p of pendingEnhances.values()) p.reject(err);
  pendingExecutions.clear();
  pendingValidations.clear();
  pendingDetections.clear();
  pendingStepExports.clear();
  pendingStepBrepImports.clear();
  pendingStepMeshImports.clear();
  pendingClearBrepImports.clear();
  pendingClearBrepShapes.clear();
  pendingSimplifies.clear();
  pendingEnhances.clear();
}

/** Terminate an unresponsive Worker and reject everything in flight so the next
 *  call boots a fresh instance instead of queueing behind a hang. */
function restartEngineWorker(reason: string): void {
  const err = new Error(reason);
  rejectAllPending(err);
  // Unblock any executeCodeAsync that's still awaiting 'workerReady' (i.e. the
  // worker was terminated before it sent the 'ready' message). Promise state is
  // immutable so this is a no-op if the gate was already resolved.
  workerReadyReject?.(err);
  workerReadyReject = null;
  engineWorker?.terminate();
  engineWorker = null;
  // Surface the teardown in the worker-health panel and the central
  // Diagnostic Log. A user-initiated cancel is routine (info, kept off the
  // unseen-error badge); a timeout/crash is a real problem (warn). This was
  // previously a bare console.error, which the errorLog intercepted as a
  // generic 'app' error — even for normal cancels. console.debug keeps the
  // devtools breadcrumb without being re-captured.
  const cancelled = /cancel/i.test(reason);
  markWorkerRestarted('geometry', reason);
  errorLog.capture({
    level: cancelled ? 'info' : 'warn',
    source: 'engine',
    message: `Geometry worker restarted: ${reason}`,
  });
  // eslint-disable-next-line no-console
  console.debug('[EngineWorker]', reason);
}

/** Cancel any in-flight executeCodeAsync by terminating the Worker.
 *  The pending Promise rejects immediately; the Worker restarts automatically
 *  on the next executeCodeAsync call. */
export function cancelCurrentExecution(): void {
  restartEngineWorker('Execution cancelled');
}

/** Discard the Worker after a *handled* fatal WASM fault. Unlike
 *  restartEngineWorker, the current call's result has already been delivered —
 *  we tear the Worker down only so the *next* run boots a clean WASM module.
 *  A WASM trap (e.g. "memory access out of bounds") can leave the kernel's C++
 *  state half-mutated, after which every subsequent call into the same instance
 *  faults instantly; recycling here is the only reliable recovery short of a
 *  page reload. Any *other* in-flight calls are rejected so they reboot too. */
function recycleEngineWorker(reason: string): void {
  rejectAllPending(new Error(reason));
  workerReadyReject?.(new Error(reason));
  workerReadyReject = null;
  engineWorker?.terminate();
  engineWorker = null;
  // Surface the teardown in the worker-health panel and the Diagnostic Log.
  // A fatal-WASM-fault recycle is usually the OOM case the panel exists to
  // make visible — so it bumps the restart counter like any other teardown.
  // Recovery, not a crash — warn rather than error, so it doesn't read as a
  // second hard failure to the user.
  markWorkerRestarted('geometry', reason);
  errorLog.capture({ level: 'warn', source: 'engine', message: `Geometry worker recycled: ${reason}` });
  // eslint-disable-next-line no-console
  console.debug('[EngineWorker]', reason);
}

function initEngineWorker(): void {
  if (engineWorker) return;
  // Fresh ready-gate so the restarted Worker's 'ready' message resolves it,
  // not the one that was already resolved by the previous instance.
  workerReady = new Promise((r, rej) => { workerReadyResolve = r; workerReadyReject = rej; });
  engineWorker = new Worker(new URL('./engineWorker.ts', import.meta.url), { type: 'module' });
  markWorkerStarted('geometry');
  engineWorker.onmessage = handleEngineWorkerMessage;
  engineWorker.onerror = (ev) => {
    // Reject all pending calls if the Worker crashes.
    rejectAllPending(new Error(`Geometry Worker crashed: ${ev.message}`));
    engineWorker = null;
    markWorkerRestarted('geometry', `crashed: ${ev.message}`);
    errorLog.capture({ level: 'error', source: 'engine', message: `Geometry worker crashed — next call will restart it: ${ev.message}` });
  };
  engineWorker.onmessageerror = (ev) => {
    // A Worker→Main message that fails structured-clone on receipt is dropped
    // silently otherwise, leaving every pending promise unsettled (UI hangs).
    rejectAllPending(new Error('Geometry Worker sent an undeserializable message'));
    engineWorker?.terminate();
    engineWorker = null;
    markWorkerRestarted('geometry', 'undeserializable message');
    errorLog.capture({ level: 'error', source: 'engine', message: 'Geometry worker sent an undeserializable message — restarting' });
    // eslint-disable-next-line no-console
    console.debug('[EngineWorker] messageerror', ev);
  };
  engineWorker.postMessage({ type: 'init' });
}

function handleEngineWorkerMessage(event: MessageEvent): void {
  const msg = event.data as { type: string } & Record<string, unknown>;

  if (msg.type === 'ready') {
    workerReadyResolve?.();
    workerReadyResolve = null;
    return;
  }

  if (msg.type === 'execute_preview') {
    const callId = msg.callId as string;
    const pending = pendingExecutions.get(callId);
    if (!pending?.onPreview) return;
    const mesh = msg.mesh as MeshResult['mesh'];
    // Model-declared colour data, when the engine attached it (manifold-js SDF
    // preview path). Reconstruct the Map<string,Set> the consumer expects, same
    // as the execute_result branch below — so the coarse preview can paint its
    // estimated label/paint colours instead of bare grey.
    const labelMapEntries = msg.labelMapEntries as [string, number[]][] | null | undefined;
    const labelColorEntries = msg.labelColorEntries as [string, [number, number, number]][] | null | undefined;
    pending.onPreview({
      mesh,
      manifold: null,
      error: null,
      labelMap: labelMapEntries
        ? new Map(labelMapEntries.map(([k, v]) => [k, new Set(v)]))
        : undefined,
      labelColors: labelColorEntries && labelColorEntries.length > 0
        ? new Map(labelColorEntries)
        : undefined,
      paintOps: (msg.paintOps as MeshResult['paintOps']) ?? undefined,
    });
    return;
  }

  if (msg.type === 'execute_result') {
    const callId = msg.callId as string;
    const pending = pendingExecutions.get(callId);
    if (!pending) return;
    pendingExecutions.delete(callId);

    const resultError = msg.error as string | null;
    recordGeometryRun(
      pending.meta,
      resultError ? 'error' : 'ok',
      typeof msg.workerMs === 'number' ? msg.workerMs : undefined,
      resultError ?? undefined,
    );

    const mesh = msg.mesh as MeshResult['mesh'];
    // A worker mesh carrying triColors came from the voxel engine, whose
    // per-voxel colors are all authored. Structured clone dropped the
    // mesher's `_painted` mask (an expando on the typed array), so restore it
    // here — every triangle painted — otherwise the color pipeline treats
    // black voxels as unpainted and recolors them to the default blue.
    if (mesh && mesh.triColors && !(mesh.triColors as Uint8Array & { _painted?: Uint8Array })._painted) {
      (mesh.triColors as Uint8Array & { _painted?: Uint8Array })._painted = new Uint8Array(mesh.numTri).fill(1);
    }
    const labelMapEntries = msg.labelMapEntries as [string, number[]][] | null;
    const labelColorEntries = msg.labelColorEntries as [string, [number, number, number]][] | null;
    const lostLabels = msg.lostLabels as string[] | null;
    const result: MeshResult = {
      mesh,
      manifold: null, // live WASM object can't cross threads; caller reconstructs via ofMesh() when not render-only
      error: msg.error as string | null,
      diagnostics: msg.diagnostics as MeshResult['diagnostics'],
      labelMap: labelMapEntries
        ? new Map(labelMapEntries.map(([k, v]) => [k, new Set(v)]))
        : undefined,
      labelColors: labelColorEntries && labelColorEntries.length > 0
        ? new Map(labelColorEntries)
        : undefined,
      paintOps: (msg.paintOps as MeshResult['paintOps']) ?? undefined,
      surfaceOps: (msg.surfaceOps as MeshResult['surfaceOps']) ?? undefined,
      renderOnly: !!msg.renderOnly,
      lostLabels: lostLabels && lostLabels.length > 0 ? lostLabels : undefined,
      paramsSchema: (msg.paramsSchema as MeshResult['paramsSchema']) ?? undefined,
      engineHeapBytes: msg.engineHeapBytes as number | undefined,
      voxelCount: msg.voxelCount as number | undefined,
      voxelPieceCount: msg.voxelPieceCount as number | undefined,
      voxelRes: msg.voxelRes as number | undefined,
      voxelResMixed: msg.voxelResMixed as boolean | undefined,
      sdfLabelCounts: msg.sdfLabelCounts as Record<string, number> | undefined,
    };
    pending.resolve(result);
    // A WASM trap (OOM / abort) reported as a *result* leaves the Worker's
    // kernel poisoned — without this, the next run could fault instantly with
    // the same error until the page is reloaded. Recycle so it boots fresh.
    if (result.error && isFatalWasmFault(result.error)) {
      recycleEngineWorker(`Recycling geometry Worker after fatal WASM fault: ${result.error}`);
    }
    return;
  }

  if (msg.type === 'validate_result') {
    const callId = msg.callId as string;
    const pending = pendingValidations.get(callId);
    if (!pending) return;
    pendingValidations.delete(callId);
    pending.resolve(msg.result as ValidateResult);
    return;
  }

  if (msg.type === 'detect_includes_result') {
    const callId = msg.callId as string;
    const pending = pendingDetections.get(callId);
    if (!pending) return;
    pendingDetections.delete(callId);
    pending.resolve(msg.result as string[]);
    return;
  }

  if (msg.type === 'exportSTEP_result') {
    const callId = msg.callId as string;
    const pending = pendingStepExports.get(callId);
    if (!pending) return;
    pendingStepExports.delete(callId);
    const error = msg.error as string | null;
    if (error) {
      pending.reject(new Error(error));
      return;
    }
    pending.resolve(msg.blob as Blob | null);
    return;
  }

  if (msg.type === 'importSTEPToBrep_result') {
    const callId = msg.callId as string;
    const pending = pendingStepBrepImports.get(callId);
    if (!pending) return;
    pendingStepBrepImports.delete(callId);
    const error = msg.error as string | null;
    if (error) { pending.reject(new Error(error)); return; }
    pending.resolve(msg.filename as string);
    return;
  }

  if (msg.type === 'importSTEPToMesh_result') {
    const callId = msg.callId as string;
    const pending = pendingStepMeshImports.get(callId);
    if (!pending) return;
    pendingStepMeshImports.delete(callId);
    const error = msg.error as string | null;
    if (error) { pending.reject(new Error(error)); return; }
    pending.resolve(msg.mesh as MeshData);
    return;
  }

  if (msg.type === 'clearBrepImports_result') {
    const callId = msg.callId as string;
    const pending = pendingClearBrepImports.get(callId);
    if (!pending) return;
    pendingClearBrepImports.delete(callId);
    const error = msg.error as string | null;
    if (error) { pending.reject(new Error(error)); return; }
    pending.resolve();
    return;
  }

  if (msg.type === 'clearBrepShape_result') {
    const callId = msg.callId as string;
    const pending = pendingClearBrepShapes.get(callId);
    if (!pending) return;
    pendingClearBrepShapes.delete(callId);
    const error = msg.error as string | null;
    if (error) { pending.reject(new Error(error)); return; }
    pending.resolve();
    return;
  }

  if (msg.type === 'simplify_progress') {
    const callId = msg.callId as string;
    const pending = pendingSimplifies.get(callId);
    if (!pending) return;
    pending.onProgress(msg.fraction as number);
    return;
  }

  if (msg.type === 'simplify_result') {
    const callId = msg.callId as string;
    const pending = pendingSimplifies.get(callId);
    if (!pending) return;
    pendingSimplifies.delete(callId);
    const error = msg.error as string | null;
    if (error) {
      pending.reject(new Error(error));
      return;
    }
    if (msg.cancelled || !msg.mesh) {
      pending.resolve(null);
      return;
    }
    pending.resolve({
      mesh: msg.mesh as MeshData,
      triangleCount: msg.triangleCount as number,
      tolerance: msg.tolerance as number,
    });
    return;
  }

  if (msg.type === 'enhance_progress') {
    const callId = msg.callId as string;
    const pending = pendingEnhances.get(callId);
    if (!pending) return;
    pending.onProgress(msg.fraction as number);
    return;
  }

  if (msg.type === 'enhance_result') {
    const callId = msg.callId as string;
    const pending = pendingEnhances.get(callId);
    if (!pending) return;
    pendingEnhances.delete(callId);
    const error = msg.error as string | null;
    if (error) {
      pending.reject(new Error(error));
      return;
    }
    if (msg.exceeded) {
      pending.resolve({ mesh: null, triangleCount: msg.triangleCount as number, exceeded: true });
      return;
    }
    if (msg.cancelled || !msg.mesh) {
      pending.resolve(null);
      return;
    }
    pending.resolve({
      mesh: msg.mesh as MeshData,
      triangleCount: msg.triangleCount as number,
    });
    return;
  }

  if (msg.type === 'error') {
    const callId = msg.callId as string | null;
    const err = new Error(msg.message as string);
    if (callId) {
      const failedExec = pendingExecutions.get(callId);
      if (failedExec) recordGeometryRun(failedExec.meta, 'error', undefined, err.message);
      failedExec?.reject(err);
      pendingExecutions.delete(callId ?? '');
      pendingValidations.get(callId)?.reject(err);
      pendingValidations.delete(callId ?? '');
      pendingDetections.get(callId)?.reject(err);
      pendingDetections.delete(callId ?? '');
      pendingStepExports.get(callId)?.reject(err);
      pendingStepExports.delete(callId ?? '');
      pendingStepBrepImports.get(callId)?.reject(err);
      pendingStepBrepImports.delete(callId ?? '');
      pendingStepMeshImports.get(callId)?.reject(err);
      pendingStepMeshImports.delete(callId ?? '');
      pendingClearBrepImports.get(callId)?.reject(err);
      pendingClearBrepImports.delete(callId ?? '');
      pendingClearBrepShapes.get(callId)?.reject(err);
      pendingClearBrepShapes.delete(callId ?? '');
      pendingSimplifies.get(callId)?.reject(err);
      pendingSimplifies.delete(callId ?? '');
      pendingEnhances.get(callId)?.reject(err);
      pendingEnhances.delete(callId ?? '');
    } else {
      // callId === null: the Worker forwarded an *unhandled* rejection / escaped
      // WASM panic (engineWorker installs this to keep the main thread from
      // hanging forever). It isn't tied to one call, and an escaped trap likely
      // poisoned the WASM instance — so reject every in-flight call and recycle
      // the Worker rather than silently dropping the error (which would leave
      // the no-timeout render path's promise unsettled and the UI spinning).
      recycleEngineWorker(err.message || 'Geometry worker reported an unhandled error');
    }
  }
}

/** Async execution via the geometry Worker. Returns mesh data with
 *  manifold=null; callers that need the live Manifold should reconstruct
 *  it with getModule().Manifold.ofMesh(result.mesh). */
export async function executeCodeAsync(
  source: string,
  lang?: Language,
  paramOverrides?: Record<string, unknown>,
  onPreview?: (result: MeshResult) => void,
  explicitImports?: ImportedMesh[],
  explicitCompanions?: Record<string, string>,
): Promise<MeshResult> {
  const l = pickLang(lang);

  // Ensure the Worker is booted.
  initEngineWorker();
  await workerReady;

  const callId = `exec-${++callIdCounter}`;

  // Include the currently-active imports so user code can access api.imports.
  // A caller may pass an explicit set (offscreen thumbnail backfill) to run a
  // specific version's code without disturbing — or depending on — the live
  // active-imports register, which another tab/run may be mutating.
  const imports = (explicitImports ?? getActiveImports()).map(m => ({
    id:             m.id,
    filename:       m.filename,
    format:         m.format,
    numProp:        m.numProp,
    numVert:        m.numVert,
    numTri:         m.numTri,
    // Copy typed arrays so the main thread retains ownership.
    vertProperties: m.vertProperties.slice(),
    triVerts:       m.triVerts.slice(),
  }));

  return new Promise<MeshResult>((resolve, reject) => {
    // No hard timeout on the render path: a slow model is bounded by the user,
    // not the clock. The live elapsed-time counter shows how long it's taking
    // and the "× Cancel" button (cancelCurrentExecution → restartEngineWorker)
    // terminates the Worker on demand, rejecting this promise. A genuine hang
    // is therefore recoverable without auto-killing legitimately-heavy work.
    pendingExecutions.set(callId, {
      resolve,
      reject,
      onPreview,
      meta: { startedAt: performance.now(), lang: l },
    });
    // Like explicitImports: a caller (offscreen thumbnail backfill) may pass a
    // specific version's companion files so a SCAD run doesn't pick up the live
    // (latest) version's includes.
    const companionFiles = explicitCompanions ?? getCompanionFiles();
    // Progressive render: when the caller supplies an onPreview consumer and this
    // is a manifold-js run, tell the Worker the coarse-preview factor so SDF
    // figures rough out fast. The Worker further gates on the source actually
    // doing an SDF `.build()`, so non-SDF code never pays for a second pass.
    const sdfPreviewScale = (onPreview && l === 'manifold-js') ? getConfig().renderer.sdfPreviewScale : undefined;
    engineWorker!.postMessage({ type: 'execute', callId, code: source, lang: l, imports, circularSegments: getDefaultCircularSegments(), params: paramOverrides ?? null, ...(sdfPreviewScale ? { sdfPreviewScale } : {}), ...(Object.keys(companionFiles).length > 0 ? { companionFiles } : {}) });
  });
}

/** Ensure the specified engine is initialized. Async; use to pre-warm SCAD. */
export async function ensureEngineReady(lang: Language): Promise<void> {
  if (!engines[lang].isReady()) {
    await engines[lang].init();
  }
}

/** Sync validation — works for manifold-js and replicad (both share a JS
 *  parser, so the validate step doesn't need to boot WASM). SCAD still goes
 *  async because its parser lives inside the WASM module. */
export function validateCode(source: string, lang?: Language): ValidateResult {
  const l = pickLang(lang);
  if (l === 'scad') {
    return { valid: false, error: 'OpenSCAD validation requires async — use validateCodeAsync()' };
  }
  const engine = engines[l];
  // The replicad engine's `validate()` is a parse-only Function check that
  // doesn't need the OCCT module loaded, so we don't gate on isReady() for it.
  if (l !== 'replicad' && !engine.isReady()) {
    return { valid: false, error: `${engine.id} engine not initialized` };
  }
  return engine.validate(source);
}

/** Async validation — works for all engines. For manifold-js the syntax
 *  check is cheap enough to run on the main thread; SCAD uses the Worker. */
export async function validateCodeAsync(source: string, lang?: Language): Promise<ValidateResult> {
  const l = pickLang(lang);
  if (l === 'scad') {
    // Route SCAD through the Worker so its Emscripten init doesn't block.
    initEngineWorker();
    await workerReady;
    const callId = `val-${++callIdCounter}`;
    const timeoutMs = getWorkerOpTimeoutMs('scad');
    return new Promise<ValidateResult>((resolve, reject) => {
      // A hung validate never posts a result back, and (unlike the render path)
      // there's no Cancel button on validation — so a stuck OpenSCAD parse
      // restarts the worker (which rejects all pending validations) instead of
      // leaving the promise unsettled forever.
      const timer = setTimeout(() => {
        if (pendingValidations.has(callId)) {
          restartEngineWorker(`OpenSCAD validation timed out after ${timeoutMs / 1000}s`);
        }
      }, timeoutMs);
      pendingValidations.set(callId, {
        resolve: (r) => { clearTimeout(timer); resolve(r); },
        reject:  (e) => { clearTimeout(timer); reject(e); },
      });
      engineWorker!.postMessage({ type: 'validate', callId, code: source, lang: l });
    });
  }
  return validateCode(source, l);
}

/** Probe a SCAD source for unresolved `include`/`use` dependencies. Routes a
 *  fast CSG-compile through the Worker and returns the MEMFS-relative paths
 *  OpenSCAD couldn't open (empty array = the probe ran and everything resolved).
 *  Never rejects: a transport failure (timeout, worker restart, engine error)
 *  resolves to `null`, which the caller reads as "couldn't determine" and falls
 *  back to its static regex candidates — distinct from an empty result. */
export async function detectScadIncludesAsync(source: string): Promise<string[] | null> {
  initEngineWorker();
  try {
    await workerReady;
  } catch {
    return null;
  }
  const callId = `det-${++callIdCounter}`;
  const timeoutMs = getWorkerOpTimeoutMs('scad');
  return new Promise<string[] | null>((resolve) => {
    const timer = setTimeout(() => {
      if (pendingDetections.has(callId)) {
        pendingDetections.delete(callId);
        resolve(null);
      }
    }, timeoutMs);
    pendingDetections.set(callId, {
      resolve: (r) => { clearTimeout(timer); resolve(r); },
      // Worker restart / hard error → "couldn't determine".
      reject: () => { clearTimeout(timer); resolve(null); },
    });
    engineWorker!.postMessage({ type: 'detect_includes', callId, code: source });
  });
}

/** Ask the engine Worker for a STEP blob of the most recent BREP-engine
 *  result. Returns `null` (with no rejection) when no shape is available so
 *  the caller can surface a user-friendly "save your BREP model first"
 *  message rather than treating it as a hard error. Any *real* failure
 *  (worker dead, OCCT threw) rejects. */
export async function exportLastBrepAsSTEP(): Promise<Blob | null> {
  initEngineWorker();
  await workerReady;
  const callId = `step-${++callIdCounter}`;
  return new Promise<Blob | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pendingStepExports.has(callId)) {
        restartEngineWorker('STEP export timed out');
      }
    }, getWorkerOpTimeoutMs('replicad'));
    pendingStepExports.set(callId, {
      resolve: (b) => { clearTimeout(timer); resolve(b); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    engineWorker!.postMessage({ type: 'exportSTEP', callId });
  });
}

/** Parse a STEP file and stash it on the worker's pending BREP import list.
 *  Subsequent `replicad`-language runs will see it as `api.imports[0]`. The
 *  blob is copied (zero-copy via transfer) into the worker; the main thread
 *  doesn't hold the parsed shape itself. Resolves with the filename so the
 *  caller can echo it in confirmation UI. */
export async function importSTEPToBrep(blob: Blob, filename: string): Promise<string> {
  initEngineWorker();
  await workerReady;
  const callId = `stepin-brep-${++callIdCounter}`;
  const bytes = await blob.arrayBuffer();
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pendingStepBrepImports.has(callId)) {
        restartEngineWorker('STEP→BREP import timed out');
      }
    }, getWorkerOpTimeoutMs('replicad'));
    pendingStepBrepImports.set(callId, {
      resolve: (n) => { clearTimeout(timer); resolve(n); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    engineWorker!.postMessage({ type: 'importSTEPToBrep', callId, bytes, filename }, [bytes]);
  });
}

/** Parse a STEP file and tessellate it into a `MeshData` the caller can
 *  feed through the normal STL-style import pipeline. The BREP source is
 *  discarded — this path is for users who want the import as mesh (paint,
 *  mesh-only ops). */
export async function importSTEPToMesh(blob: Blob): Promise<MeshData> {
  initEngineWorker();
  await workerReady;
  const callId = `stepin-mesh-${++callIdCounter}`;
  const bytes = await blob.arrayBuffer();
  return new Promise<MeshData>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pendingStepMeshImports.has(callId)) {
        restartEngineWorker('STEP→mesh import timed out');
      }
    }, getWorkerOpTimeoutMs('replicad'));
    pendingStepMeshImports.set(callId, {
      resolve: (m) => { clearTimeout(timer); resolve(m); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    engineWorker!.postMessage({ type: 'importSTEPToMesh', callId, bytes }, [bytes]);
  });
}

/** Drop any pending BREP imports. Called when the user opens a different
 *  session or clears them explicitly. */
export async function clearBrepImports(): Promise<void> {
  initEngineWorker();
  await workerReady;
  const callId = `clearbrepin-${++callIdCounter}`;
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pendingClearBrepImports.has(callId)) {
        restartEngineWorker('clearBrepImports timed out');
      }
    }, getWorkerOpTimeoutMs('replicad'));
    pendingClearBrepImports.set(callId, {
      resolve: () => { clearTimeout(timer); resolve(); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    engineWorker!.postMessage({ type: 'clearBrepImports', callId });
  });
}

/** Drop (and free) the retained STEP-export shape from the most recent
 *  replicad run. Called when leaving a replicad session (switch/close) or
 *  switching the active language away from replicad, so a later exportSTEP
 *  can't return a stale shape that belongs to a different session. */
export async function clearBrepShape(): Promise<void> {
  initEngineWorker();
  await workerReady;
  const callId = `clearbrepshape-${++callIdCounter}`;
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pendingClearBrepShapes.has(callId)) {
        restartEngineWorker('clearBrepShape timed out');
      }
    }, getWorkerOpTimeoutMs('replicad'));
    pendingClearBrepShapes.set(callId, {
      resolve: () => { clearTimeout(timer); resolve(); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    engineWorker!.postMessage({ type: 'clearBrepShape', callId });
  });
}

// ── Simplify Worker client ──────────────────────────────────────────────────

export interface SimplifyWorkerResult {
  mesh: MeshData;
  triangleCount: number;
  tolerance: number;
}

export class SimplifyAbortError extends Error {
  constructor(message = 'simplify aborted') {
    super(message);
    this.name = 'AbortError';
  }
}

/** Run the mesh-budget simplify search inside the geometry Worker so a
 *  heavy reduction (binary search × Manifold.simplify calls) doesn't freeze
 *  the main thread. Resolves to null when no reduction was needed/possible
 *  or the caller aborted; rejects with a real Error only on a worker fault.
 *
 *  `onProgress(fraction)` fires with values in [0,1] between binary-search
 *  iterations — wire it to the progress modal. `signal.abort()` posts a
 *  `simplify_cancel` to the worker; the simplify loop checks the flag
 *  between iterations and bails out (latency ≈ one iteration). */
export async function simplifyInWorker(
  mesh: MeshData,
  targetTriangles: number,
  maxTolerance: number,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
  /** When > 0, the worker runs a single direct `simplify(tolerance)` pass
   *  instead of binary-searching to `targetTriangles` — the "by edge length /
   *  feature size" knob. `targetTriangles`/`maxTolerance` are then ignored. */
  directTolerance?: number,
): Promise<SimplifyWorkerResult | null> {
  if (signal?.aborted) throw new SimplifyAbortError();
  initEngineWorker();
  await workerReady;
  const callId = `simplify-${++callIdCounter}`;

  return new Promise<SimplifyWorkerResult | null>((resolve, reject) => {
    let abortListener: (() => void) | null = null;
    pendingSimplifies.set(callId, {
      resolve: (r) => {
        if (signal && abortListener) signal.removeEventListener('abort', abortListener);
        resolve(r);
      },
      reject: (e) => {
        if (signal && abortListener) signal.removeEventListener('abort', abortListener);
        reject(e);
      },
      onProgress,
    });
    if (signal) {
      abortListener = () => {
        // Post the cancel hint; the worker's simplify loop checks it at the
        // next iteration boundary and resolves the pending promise with
        // cancelled=true (which surfaces as `null` here, not a reject — the
        // caller treats the cancel like a no-op reduction).
        engineWorker?.postMessage({ type: 'simplify_cancel', callId });
        // Eagerly reject with AbortError so the caller can distinguish
        // user-cancel from "no reduction possible" — we still clean up the
        // worker-side flag via the eventual simplify_result that arrives.
        const pending = pendingSimplifies.get(callId);
        if (pending) {
          pendingSimplifies.delete(callId);
          pending.reject(new SimplifyAbortError());
        }
      };
      signal.addEventListener('abort', abortListener, { once: true });
    }
    // Send a copy of the mesh so the main thread can keep using its own.
    const meshCopy: MeshData = {
      vertProperties: mesh.vertProperties.slice(),
      triVerts: mesh.triVerts.slice(),
      numVert: mesh.numVert,
      numTri: mesh.numTri,
      numProp: mesh.numProp,
    };
    const transfer: Transferable[] = [meshCopy.vertProperties.buffer, meshCopy.triVerts.buffer];
    engineWorker!.postMessage(
      { type: 'simplify', callId, mesh: meshCopy, targetTriangles, maxTolerance,
        ...(directTolerance && directTolerance > 0 ? { tolerance: directTolerance } : {}) },
      transfer,
    );
  });
}

// ── Enhance Worker client ───────────────────────────────────────────────────

export interface EnhanceWorkerResult {
  /** The refined mesh, or null when the result was refused for exceeding the
   *  hard triangle cap (see `exceeded`). */
  mesh: MeshData | null;
  triangleCount: number;
  /** True when the refine would have exceeded `maxTriangles`; the mesh was
   *  discarded in the Worker and never committed. */
  exceeded?: boolean;
}

export class EnhanceAbortError extends Error {
  constructor(message = 'enhance aborted') {
    super(message);
    this.name = 'AbortError';
  }
}

/** Run the mesh-budget enhance (refineToLength) search inside the geometry
 *  Worker. Mirrors simplifyInWorker but adds triangles instead of removing
 *  them. Resolves to null when no enhancement was needed/possible or the
 *  caller aborted. */
export async function enhanceInWorker(
  mesh: MeshData,
  targetTriangles: number,
  maxEdgeLength: number,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
  /** When > 0, the worker runs a single direct `refineToLength(edgeLength)`
   *  pass instead of binary-searching to `targetTriangles` — the "by edge
   *  length / triangle size" knob. `targetTriangles`/`maxEdgeLength` are then
   *  ignored. */
  directEdgeLength?: number,
): Promise<EnhanceWorkerResult | null> {
  if (signal?.aborted) throw new EnhanceAbortError();
  initEngineWorker();
  await workerReady;
  const callId = `enhance-${++callIdCounter}`;

  return new Promise<EnhanceWorkerResult | null>((resolve, reject) => {
    let abortListener: (() => void) | null = null;
    pendingEnhances.set(callId, {
      resolve: (r) => {
        if (signal && abortListener) signal.removeEventListener('abort', abortListener);
        resolve(r);
      },
      reject: (e) => {
        if (signal && abortListener) signal.removeEventListener('abort', abortListener);
        reject(e);
      },
      onProgress,
    });
    if (signal) {
      abortListener = () => {
        engineWorker?.postMessage({ type: 'enhance_cancel', callId });
        const pending = pendingEnhances.get(callId);
        if (pending) {
          pendingEnhances.delete(callId);
          pending.reject(new EnhanceAbortError());
        }
      };
      signal.addEventListener('abort', abortListener, { once: true });
    }
    const meshCopy: MeshData = {
      vertProperties: mesh.vertProperties.slice(),
      triVerts: mesh.triVerts.slice(),
      numVert: mesh.numVert,
      numTri: mesh.numTri,
      numProp: mesh.numProp,
    };
    const transfer: Transferable[] = [meshCopy.vertProperties.buffer, meshCopy.triVerts.buffer];
    // Read the hard cap on the main thread (where getConfig sees the user's
    // override) and pass it through — the Worker's own getConfig only sees
    // static defaults.
    const maxTriangles = getConfig().renderer.enhanceMaxTriangles;
    engineWorker!.postMessage(
      { type: 'enhance', callId, mesh: meshCopy, targetTriangles, maxEdgeLength, maxTriangles,
        ...(directEdgeLength && directEdgeLength > 0 ? { edgeLength: directEdgeLength } : {}) },
      transfer,
    );
  });
}
