import type { MeshData, MeshResult } from './types';
import type { Engine, Language, ValidateResult } from './engines/types';
import { DEFAULT_LANGUAGE, isLanguage } from './engines/types';
import { manifoldJsEngine, getManifoldModule } from './engines/manifoldJs';
import { openscadEngine } from './engines/openscad';
import { replicadEngine } from './engines/replicad';
import { getActiveImports } from '../import/importedMesh';
import { getDefaultCircularSegments } from './qualitySettings';

export type { Language };
export { isLanguage, DEFAULT_LANGUAGE };

const engines: Record<Language, Engine> = {
  'manifold-js': manifoldJsEngine,
  'scad': openscadEngine,
  'replicad': replicadEngine,
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
export function executeCode(source: string, lang?: Language): MeshResult {
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
  return engine.run(source);
}

// ── Geometry Worker client ──────────────────────────────────────────────────

let engineWorker: Worker | null = null;
let workerReadyResolve: (() => void) | null = null;
// Mutable so it can be replaced when the Worker is restarted after a crash.
// A crashed-and-restarted Worker must not inherit the already-resolved promise
// from its predecessor — callers would skip the await and race the new init.
let workerReady: Promise<void> = new Promise(r => { workerReadyResolve = r; });
let callIdCounter = 0;

const pendingExecutions  = new Map<string, { resolve: (r: MeshResult) => void; reject: (e: Error) => void }>();
const pendingValidations = new Map<string, { resolve: (r: ValidateResult) => void; reject: (e: Error) => void }>();
const pendingStepExports = new Map<string, { resolve: (blob: Blob | null) => void; reject: (e: Error) => void }>();
const pendingStepBrepImports = new Map<string, { resolve: (filename: string) => void; reject: (e: Error) => void }>();
const pendingStepMeshImports = new Map<string, { resolve: (mesh: MeshData) => void; reject: (e: Error) => void }>();
const pendingClearBrepImports = new Map<string, { resolve: () => void; reject: (e: Error) => void }>();
const pendingSimplifies  = new Map<string, {
  resolve: (r: SimplifyWorkerResult | null) => void;
  reject: (e: Error) => void;
  onProgress: (fraction: number) => void;
}>();

// Per-language hard-timeout for a single execute/validate call. The Worker
// posts no result back if its WASM hangs, so without this the promise (and
// the UI's "Running…" state) would wait forever. Manifold-js executes pure
// JS over the WASM kernel and is rarely slow enough to need much headroom;
// SCAD compiles BOSL2-style libraries from source per call, and complex
// real-thread / gear-tooth math can comfortably push past a minute on a
// slow CI runner — so it gets a much longer ceiling.
const EXECUTE_TIMEOUT_MS: Record<Language, number> = {
  'manifold-js': 60_000,
  'scad':        180_000,
  // BREP/replicad: OCCT booleans on complex parts (e.g. STEP-imported
  // assemblies) can rival SCAD's worst cases, so use the same 3-minute
  // ceiling as SCAD rather than the mesh kernel's tighter bound.
  'replicad':    180_000,
};

function rejectAllPending(err: Error): void {
  for (const p of pendingExecutions.values()) p.reject(err);
  for (const p of pendingValidations.values()) p.reject(err);
  for (const p of pendingStepExports.values()) p.reject(err);
  for (const p of pendingStepBrepImports.values()) p.reject(err);
  for (const p of pendingStepMeshImports.values()) p.reject(err);
  for (const p of pendingClearBrepImports.values()) p.reject(err);
  for (const p of pendingSimplifies.values()) p.reject(err);
  pendingExecutions.clear();
  pendingValidations.clear();
  pendingStepExports.clear();
  pendingStepBrepImports.clear();
  pendingStepMeshImports.clear();
  pendingClearBrepImports.clear();
  pendingSimplifies.clear();
}

/** Terminate an unresponsive Worker and reject everything in flight so the next
 *  call boots a fresh instance instead of queueing behind a hang. */
function restartEngineWorker(reason: string): void {
  rejectAllPending(new Error(reason));
  engineWorker?.terminate();
  engineWorker = null;
  // eslint-disable-next-line no-console
  console.error('[EngineWorker]', reason);
}

function initEngineWorker(): void {
  if (engineWorker) return;
  // Fresh ready-gate so the restarted Worker's 'ready' message resolves it,
  // not the one that was already resolved by the previous instance.
  workerReady = new Promise(r => { workerReadyResolve = r; });
  engineWorker = new Worker(new URL('./engineWorker.ts', import.meta.url), { type: 'module' });
  engineWorker.onmessage = handleEngineWorkerMessage;
  engineWorker.onerror = (ev) => {
    // Reject all pending calls if the Worker crashes.
    rejectAllPending(new Error(`Geometry Worker crashed: ${ev.message}`));
    engineWorker = null;
    // eslint-disable-next-line no-console
    console.error('[EngineWorker] crashed — next call will restart it', ev.message);
  };
  engineWorker.onmessageerror = (ev) => {
    // A Worker→Main message that fails structured-clone on receipt is dropped
    // silently otherwise, leaving every pending promise unsettled (UI hangs).
    rejectAllPending(new Error('Geometry Worker sent an undeserializable message'));
    engineWorker?.terminate();
    engineWorker = null;
    // eslint-disable-next-line no-console
    console.error('[EngineWorker] messageerror', ev);
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

  if (msg.type === 'execute_result') {
    const callId = msg.callId as string;
    const pending = pendingExecutions.get(callId);
    if (!pending) return;
    pendingExecutions.delete(callId);

    const mesh = msg.mesh as MeshResult['mesh'];
    const labelMapEntries = msg.labelMapEntries as [string, number[]][] | null;
    const lostLabels = msg.lostLabels as string[] | null;
    const result: MeshResult = {
      mesh,
      manifold: null, // live WASM object can't cross threads; caller reconstructs via ofMesh()
      error: msg.error as string | null,
      diagnostics: msg.diagnostics as MeshResult['diagnostics'],
      labelMap: labelMapEntries
        ? new Map(labelMapEntries.map(([k, v]) => [k, new Set(v)]))
        : undefined,
      lostLabels: lostLabels && lostLabels.length > 0 ? lostLabels : undefined,
    };
    pending.resolve(result);
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

  if (msg.type === 'error') {
    const callId = msg.callId as string | null;
    const err = new Error(msg.message as string);
    if (callId) {
      pendingExecutions.get(callId)?.reject(err);
      pendingExecutions.delete(callId ?? '');
      pendingValidations.get(callId)?.reject(err);
      pendingValidations.delete(callId ?? '');
      pendingStepExports.get(callId)?.reject(err);
      pendingStepExports.delete(callId ?? '');
      pendingStepBrepImports.get(callId)?.reject(err);
      pendingStepBrepImports.delete(callId ?? '');
      pendingStepMeshImports.get(callId)?.reject(err);
      pendingStepMeshImports.delete(callId ?? '');
      pendingClearBrepImports.get(callId)?.reject(err);
      pendingClearBrepImports.delete(callId ?? '');
      pendingSimplifies.get(callId)?.reject(err);
      pendingSimplifies.delete(callId ?? '');
    }
  }
}

/** Async execution via the geometry Worker. Returns mesh data with
 *  manifold=null; callers that need the live Manifold should reconstruct
 *  it with getModule().Manifold.ofMesh(result.mesh). */
export async function executeCodeAsync(source: string, lang?: Language): Promise<MeshResult> {
  const l = pickLang(lang);

  // Ensure the Worker is booted.
  initEngineWorker();
  await workerReady;

  const callId = `exec-${++callIdCounter}`;

  // Include the currently-active imports so user code can access api.imports.
  const imports = getActiveImports().map(m => ({
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

  const timeoutMs = EXECUTE_TIMEOUT_MS[l];
  return new Promise<MeshResult>((resolve, reject) => {
    // A hung WASM evaluation never posts a result back. Without a timeout the
    // promise (and the UI's "Running…" state) would wait forever.
    const timer = setTimeout(() => {
      if (pendingExecutions.has(callId)) {
        restartEngineWorker(`Geometry evaluation timed out after ${timeoutMs / 1000}s (the model may be too complex)`);
      }
    }, timeoutMs);
    pendingExecutions.set(callId, {
      resolve: (r) => { clearTimeout(timer); resolve(r); },
      reject:  (e) => { clearTimeout(timer); reject(e); },
    });
    engineWorker!.postMessage({ type: 'execute', callId, code: source, lang: l, imports, circularSegments: getDefaultCircularSegments() });
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
    const timeoutMs = EXECUTE_TIMEOUT_MS[l];
    return new Promise<ValidateResult>((resolve, reject) => {
      // A hung validate never posts a result back. Mirror executeCodeAsync's
      // timeout so a stuck OpenSCAD parse restarts the worker (which rejects all
      // pending validations) instead of leaving the promise unsettled forever.
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

export function isEngineReady(lang: Language): boolean {
  return engines[lang].isReady();
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
    }, EXECUTE_TIMEOUT_MS.replicad);
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
    }, EXECUTE_TIMEOUT_MS.replicad);
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
    }, EXECUTE_TIMEOUT_MS.replicad);
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
    }, EXECUTE_TIMEOUT_MS.replicad);
    pendingClearBrepImports.set(callId, {
      resolve: () => { clearTimeout(timer); resolve(); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    engineWorker!.postMessage({ type: 'clearBrepImports', callId });
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
      { type: 'simplify', callId, mesh: meshCopy, targetTriangles, maxTolerance },
      transfer,
    );
  });
}
