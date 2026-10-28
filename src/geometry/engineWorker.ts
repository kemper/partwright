// Web Worker for geometry code execution. Runs manifold-3d WASM and
// OpenSCAD off the main thread so complex boolean operations can't freeze
// the UI. The main thread keeps its own manifold-3d instance for
// lightweight queries (sliceAtZ, getBoundingBox, Manifold.ofMesh) and
// exports; this Worker owns the expensive execution path.
//
// Protocol — Main → Worker:
//   { type: 'init', ses?, sesTestFail?, sesUndeclaredCheckMaxChars? }   (ses: false = SES kill switch, #1127)
//   { type: 'execute',           callId, code, lang?, imports?, circularSegments?, params? }
//   { type: 'validate',          callId, code, lang? }
//   { type: 'detect_includes',   callId, code }
//   { type: 'voxel_grid',        callId, code, params? }
//   { type: 'exportSTEP',        callId }
//   { type: 'importSTEPToBrep',  callId, bytes, filename }
//   { type: 'importSTEPToMesh',  callId, bytes }
//   { type: 'clearBrepImports',  callId }
//   { type: 'clearBrepShape',    callId }
//   { type: 'simplify',          callId, mesh, targetTriangles, maxTolerance }
//   { type: 'simplify_cancel',   callId }
//   { type: 'enhance',           callId, mesh, targetTriangles, maxEdgeLength }
//   { type: 'enhance_cancel',    callId }
//   { type: 'inspect_realm',     callId }   (dev builds only)
//
// Protocol — Worker → Main:
//   { type: 'ready', initMs, compiler, sesMs }
//   { type: 'execute_result',          callId, mesh, error, diagnostics, labelMapEntries, labelColorEntries, paintOps, surfaceOps, lostLabels, paramsSchema, logs, workerMs }
//   { type: 'validate_result',         callId, result }
//   { type: 'detect_includes_result',  callId, result }
//   { type: 'voxel_grid_result',       callId, grid, error }
//   { type: 'exportSTEP_result',       callId, blob, error }
//   { type: 'importSTEPToBrep_result', callId, filename, error }
//   { type: 'importSTEPToMesh_result', callId, mesh, error }
//   { type: 'clearBrepImports_result', callId, error }
//   { type: 'clearBrepShape_result',   callId, error }
//   { type: 'simplify_progress',       callId, fraction }
//   { type: 'simplify_result',         callId, mesh, triangleCount, tolerance, cancelled, error }
//   { type: 'enhance_progress',        callId, fraction }
//   { type: 'enhance_result',          callId, mesh, triangleCount, cancelled, error }
//   { type: 'inspect_realm_result',    callId, report }   (dev builds only)
//   { type: 'error',                   callId, message }
//
// Mesh typed arrays are transferred (zero-copy) to the main thread.
// labelMap (Map<string, Set<number>>) is serialised as [string, number[]][].

import { manifoldJsEngine, getManifoldModule } from './engines/manifoldJs';
import { computeManifoldFacts } from './manifoldFacts';
import { runScadAsync, openscadEngine, detectUnresolvedIncludes } from './engines/openscad';
import { runReplicadAsync, replicadEngine, getLastBrepShape, clearLastBrepShape } from './engines/replicad';
import { voxelEngine, runVoxelGrid } from './engines/voxel';
import type { VoxelGridTransfer } from './voxel/grid';
import { ensureBrepLoaded, sourceUsesBrep, parseStepBlob, pushPendingBrepImport, clearPendingBrepImports } from './brepRuntime';
import { sourceUsesManifoldText, preloadTextFonts } from './textGlyphs';
import { setActiveImports, type ImportedMesh } from '../import/importedMesh';
import { setCircularSegmentsOverride } from './qualitySettings';
import { setSdfPreviewScale, sourceUsesSdfBuild } from './sdf';
import type { Language } from './engines/types';
import { simplifyToTriangleBudget, enhanceToTriangleBudget, simplifyToTolerance, refineToEdgeLength, isEnhanceExceeded, type SimplifyResult, type EnhanceResult, type EnhanceExceeded } from './simplify';
import type { MeshData } from './types';
import { lockdownGlobalScope, enumerateChain } from './workerLockdown';
import { formatLockdownRefusal } from './lockdownRefusal';
import { enableSesSandbox } from './sesSandbox';
import { modelCompilerName } from './modelEval';
import { applyWorkerImportConfig, getConfig } from '../config/appConfig';
import { createModelLog, withLogs } from './modelConsole';

/** Per-callId cancel flags for in-flight simplify jobs. The simplify loop
 *  yields to the event loop between iterations, so a `simplify_cancel`
 *  message has a chance to land and flip this flag — the loop checks it on
 *  each iteration boundary and bails out cleanly. */
const simplifyCancelFlags = new Map<string, boolean>();
const enhanceCancelFlags = new Map<string, boolean>();

let manifoldReady = false;

/** `manifoldFacts` for a simplify / enhance result of at least `minTriangles`
 *  (the same Worker-side stats a big run sends): built from a Manifold of the
 *  result here, so the main thread can defer its own multi-second rebuild.
 *  `manifoldError` when the result isn't a valid solid (main shows it as
 *  render-only). Empty for small results — main builds those itself. */
function resultFacts(mesh: MeshData, minTriangles: unknown, containmentSamples: unknown): { manifoldFacts?: ReturnType<typeof computeManifoldFacts>; manifoldError?: string } {
  if (typeof minTriangles !== 'number' || mesh.numTri < minTriangles) return {};
  let m: { delete?: () => void } | null = null;
  try {
    m = getManifoldModule().Manifold.ofMesh(mesh);
  } catch (err) {
    return { manifoldError: err instanceof Error ? err.message : String(err) };
  }
  // A failure computing the stats is NOT "not a solid": send nothing and let
  // the main thread build the Manifold itself, as for a small result.
  try {
    return { manifoldFacts: computeManifoldFacts(m, mesh, { containmentSamples: typeof containmentSamples === 'number' ? containmentSamples : undefined }) };
  } catch {
    return {};
  } finally {
    try { m?.delete?.(); } catch { /* already freed */ }
  }
}

/** `computeManifoldFacts` for a run result, or undefined if it throws — the
 *  main thread then builds its own Manifold (a stats failure must not fail
 *  the run). */
function computeFactsSafely(live: unknown, mesh: MeshData, containmentSamples: unknown): ReturnType<typeof computeManifoldFacts> | undefined {
  try {
    return computeManifoldFacts(live, mesh, { containmentSamples: typeof containmentSamples === 'number' ? containmentSamples : undefined });
  } catch {
    return undefined;
  }
}

/** Transfer list for a result mesh (+ its facts' piece split). */
function meshTransfer(mesh: MeshData, facts?: { pieces?: { pieceOfTri: Int32Array } }): Transferable[] {
  const t: Transferable[] = [mesh.vertProperties.buffer, mesh.triVerts.buffer];
  if (mesh.mergeFromVert) t.push(mesh.mergeFromVert.buffer);
  if (mesh.mergeToVert)   t.push(mesh.mergeToVert.buffer);
  if (mesh.runIndex)      t.push(mesh.runIndex.buffer);
  if (mesh.runOriginalID) t.push(mesh.runOriginalID.buffer);
  if (facts?.pieces) t.push(facts.pieces.pieceOfTri.buffer);
  return t;
}

/** Current size (bytes) of the manifold-3d WASM linear heap — its grown
 *  high-water mark, since WASM memory never shrinks. Reported back to the main
 *  thread so the diagnostics can show how close a run came to the 4 GB ceiling
 *  (and, on an OOM, whether it truly hit it or failed far below). Only
 *  meaningful for manifold-js runs; the other engines own separate WASM heaps. */
function manifoldHeapBytes(): number | undefined {
  try {
    const heap = (getManifoldModule() as { HEAPU8?: { byteLength?: number } } | null)?.HEAPU8;
    return typeof heap?.byteLength === 'number' ? heap.byteLength : undefined;
  } catch {
    return undefined;
  }
}

// Catch unhandled promise rejections inside the Worker (e.g. WASM panics that
// escape an inner try-catch) and forward them as 'error' messages so the main
// thread's pendingExecutions promises are rejected rather than hanging forever.
self.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
  const message = event.reason instanceof Error
    ? event.reason.message
    : String(event.reason ?? 'Unknown Worker error');
  self.postMessage({ type: 'error', callId: null, message });
  event.preventDefault();
});

// ── Sandbox lockdown (#1090) ─────────────────────────────────────────────
// Model code evaluated in this Worker must not reach the network or the
// origin's storage (IndexedDB holds the AI provider keys). After the init
// handshake — and before ANY message that can evaluate model code is handled —
// the global scope is permanently stripped of fetch/XHR/WebSocket/IndexedDB/
// caches/nested Workers/BroadcastChannel/navigator.storage/… (see
// workerLockdown.ts). Lazy engine assets loaded later (OCCT WASM, BOSL2, fonts)
// go through the private `fetchAppAsset`, which only does same-origin GETs.
// Fail closed: if the lockdown can't be verified, model code never runs.
let initPromise: Promise<void> | null = null;
let lockdownState: 'pending' | 'ok' | 'failed' = 'pending';
let lockdownFailure = '';

// ── SES lockdown + Compartment evaluation (#1127) ────────────────────────
// ON unless the init message says `ses: false` (the kill switch in
// sesSandboxFlag.ts) — a Worker that never got an init message still runs
// SES before its first model code. Ordering, enforced below:
//   1. SES `lockdown()` — before ANY engine glue initialises, so no engine
//      code ever sees unfrozen intrinsics (sesSandbox.ts);
//   2. engine init (manifold-3d; the lazy engines load later, on frozen
//      intrinsics — sesGlueFix.ts rewrites the glue that needs it);
//   3. workerLockdown (#1090/#1119): the network/storage denylist and the
//      default-deny allowlist audit of the Worker global, which also sees the
//      globals SES installs (allowlisted in workerGlobalAllowlist.ts).
// Fail closed: if SES can't lock down, model code never runs and the app
// shows the lockdown refusal (lockdownRefusal.ts).
let sesWanted = true;
let sesPromise: Promise<void> | null = null;
let sesFailure = '';
let sesInitMs: number | null = null;
/** AppConfig `geometry.sesUndeclaredCheckMaxChars`, from the init message (a
 *  Worker's getConfig() only sees the defaults). */
let sesUndeclaredCheckMaxChars = getConfig().geometry.sesUndeclaredCheckMaxChars;

function startSes(testFail: boolean): Promise<void> {
  if (!sesPromise) {
    sesPromise = (testFail
      ? Promise.reject(new Error('lockdown() failed (simulated: partwright.sesSandbox = test-fail)'))
      : enableSesSandbox({ undeclaredCheckMaxChars: sesUndeclaredCheckMaxChars }).then((r) => { sesInitMs = r.ms; })
    ).catch((err: unknown) => {
      sesFailure = err instanceof Error ? err.message : String(err);
    });
  }
  return sesPromise;
}

function lockdownNow(): void {
  if (lockdownState !== 'pending') return;
  if (sesWanted && (sesPromise === null || sesFailure)) {
    // SES was requested but isn't in place: refuse, never fall back to the
    // unsandboxed compiler.
    lockdownState = 'failed';
    lockdownFailure = `SES lockdown failed: ${sesFailure || 'not started'}`;
    console.error(`[lockdown] ${formatLockdownRefusal(lockdownFailure)}`);
    return;
  }
  try {
    const report = lockdownGlobalScope(self);
    // Names the allowlist audit removed that the explicit denylist didn't —
    // logged so a capability a newer browser adds shows up in DevTools.
    if (report.defaultDenied.length > 0) {
      console.debug(`[lockdown] default-deny removed ${report.defaultDenied.length} non-allowlisted globals: ${report.defaultDenied.join(', ')}`);
    }
    if (report.stillReachable.length > 0) {
      lockdownState = 'failed';
      lockdownFailure = `still reachable: ${report.stillReachable.join(', ')}`;
    } else {
      lockdownState = 'ok';
    }
  } catch (err) {
    lockdownState = 'failed';
    lockdownFailure = err instanceof Error ? err.message : String(err);
  }
  // The app also records this in its Diagnostic Log (engine.ts / enginePool.ts
  // recognise the message via parseLockdownRefusal); this is the devtools copy.
  if (lockdownState === 'failed') console.error(`[lockdown] ${formatLockdownRefusal(lockdownFailure)}`);
}

/** Resolve once the scope is locked down. Returns an error message when the
 *  lockdown failed (the caller must refuse the request), else null. */
async function ensureSandboxLocked(): Promise<string | null> {
  if (lockdownState === 'pending') {
    // A request that raced ahead of `init` still gets SES first.
    if (sesWanted) await startSes(false);
    // Let an in-flight manifold-3d init finish its WASM fetch first; it runs
    // before any model code, so the global fetch is still the pristine one.
    if (initPromise) { try { await initPromise; } catch { /* reported by init */ } }
    lockdownNow();
  }
  return lockdownState === 'ok'
    ? null
    : formatLockdownRefusal(lockdownFailure);
}

/** Dev-only engine-realm report (see the `inspect_realm` message). */
function inspectRealm(): Record<string, unknown> {
  const g = self as unknown as Record<string, unknown>;
  const urlStatics: Record<string, unknown> = {};
  const URLCtor = g.URL as Record<string, unknown> | undefined;
  for (const n of ['createObjectURL', 'revokeObjectURL']) {
    const d = URLCtor ? Object.getOwnPropertyDescriptor(URLCtor, n) : undefined;
    let call: string;
    try {
      call = 'returned:' + String((URLCtor?.[n] as (x: unknown) => unknown)(n === 'createObjectURL' ? new Blob(['x']) : 'blob:x'));
    } catch (e) { call = 'threw:' + String(e instanceof Error ? e.message : e); }
    urlStatics[n] = { type: typeof d?.value, writable: !!d?.writable, configurable: !!d?.configurable, call };
  }
  const nav = g.navigator;
  return {
    compiler: modelCompilerName(),
    sesWanted,
    global: enumerateChain(self, 'self').entries,
    navigator: nav !== null && typeof nav === 'object' ? enumerateChain(nav, 'navigator').entries : [],
    urlStatics,
    frozen: {
      objectPrototype: Object.isFrozen(Object.prototype),
      arrayPrototype: Object.isFrozen(Array.prototype),
      functionPrototype: Object.isFrozen(Function.prototype),
    },
  };
}

self.onmessage = async (event: MessageEvent) => {
  const msg = event.data as { type: string } & Record<string, unknown>;

  // ── init ───────────────────────────────────────────────────────────────
  if (msg.type === 'init') {
    const initStart = performance.now();
    // Decided synchronously, before the first await, so a request racing the
    // init sees the same choice. Only an explicit `false` turns SES off.
    if (!initPromise && sesPromise === null) {
      sesWanted = msg.ses !== false;
      if (typeof msg.sesUndeclaredCheckMaxChars === 'number' && Number.isFinite(msg.sesUndeclaredCheckMaxChars) && msg.sesUndeclaredCheckMaxChars >= 0) {
        sesUndeclaredCheckMaxChars = msg.sesUndeclaredCheckMaxChars;
      }
    }
    // 1. SES lockdown before any engine glue initialises.
    if (sesWanted) await startSes(import.meta.env.DEV && msg.sesTestFail === true);
    // 2. Engine init. 3. workerLockdown (lockdownNow) below.
    if (!initPromise) initPromise = manifoldJsEngine.init();
    try {
      await initPromise;
      manifoldReady = true;
    } catch (err) {
      self.postMessage({
        type: 'error',
        callId: null,
        message: err instanceof Error ? err.message : String(err),
      });
      // Still lock down: voxel runs need no WASM and must not run unlocked.
      lockdownNow();
      return;
    }
    lockdownNow();
    if (lockdownState === 'ok') {
      self.postMessage({ type: 'ready', initMs: Math.round(performance.now() - initStart), compiler: modelCompilerName(), sesMs: sesInitMs });
    } else {
      self.postMessage({ type: 'error', callId: null, message: formatLockdownRefusal(lockdownFailure) });
    }
    return;
  }

  // Every other request may evaluate model code (or touch state model code
  // could have influenced) — never handle one on an unlocked scope.
  if (lockdownState !== 'ok') {
    const lockErr = await ensureSandboxLocked();
    if (lockErr) {
      self.postMessage({ type: 'error', callId: typeof msg.callId === 'string' ? msg.callId : null, message: lockErr });
      return;
    }
  }

  // ── inspect_realm (dev builds only) ──────────────────────────────────────
  // Report on the ENGINE realm after lockdown — the Worker global's remaining
  // names (for the #1119 allowlist audit e2e test) and the SES state. Model
  // code can't do this itself under SES (it can't name the Worker global), and
  // only the app can send this message. Production builds drop the branch.
  if (import.meta.env.DEV && msg.type === 'inspect_realm') {
    self.postMessage({ type: 'inspect_realm_result', callId: msg.callId, report: inspectRealm() });
    return;
  }

  // ── execute ────────────────────────────────────────────────────────────
  if (msg.type === 'execute') {
    const { callId, code, lang, imports, circularSegments, params, companionFiles, sdfPreviewScale, manifoldFactsMinTriangles, containmentSamples, modelLog, voxelSdfMaxSamples } = msg as unknown as {
      callId: string;
      code: string;
      lang?: Language;
      imports?: ImportedMesh[];
      circularSegments?: number;
      params?: Record<string, unknown> | null;
      companionFiles?: Record<string, string>;
      sdfPreviewScale?: number | null;
      manifoldFactsMinTriangles?: number;
      containmentSamples?: number;
      modelLog?: { maxLines?: unknown; maxChars?: unknown };
      voxelSdfMaxSamples?: number;
    };
    // The Worker has no localStorage: apply the user's saved v.sdf budget
    // before model code reads getConfig().import.voxelSdfMaxSamples.
    if (typeof voxelSdfMaxSamples === 'number') applyWorkerImportConfig({ voxelSdfMaxSamples });
    // This run's console capture (modelConsole.ts), with the main thread's
    // caps. Each JS engine call below runs inside log.run(...), which only
    // redirects the console for that synchronous call — model code never
    // runs across an await, so overlapping async runs can't mix their logs.
    const log = createModelLog(
      modelLog && Number.isInteger(modelLog.maxLines) && Number.isInteger(modelLog.maxChars)
        ? { maxLines: modelLog.maxLines as number, maxChars: modelLog.maxChars as number }
        : undefined,
    );
    // Worker-side compute timer. Reported back on execute_result so the
    // worker-health panel can separate real evaluation time from the
    // queue + structured-clone transfer overhead the main thread also sees.
    const execStart = performance.now();
    try {
      // Propagate the main-thread quality setting so the Worker uses the same
      // segment count. SCAD/replicad execute asynchronously, so two runs can
      // overlap inside the worker; each carries its own circularSegments and
      // sets it here before generating geometry, in message (== generation)
      // order. We deliberately do NOT clear it back afterwards (see below) — the
      // most-recently-started run, whose result the main thread keeps, sets the
      // override last and so always reads the correct value.
      if (typeof circularSegments === 'number') setCircularSegmentsOverride(circularSegments);
      // Snapshot this run's imports. `setActiveImports` writes a module-global
      // registry, and the lazy-init / font / BREP-preload awaits below yield the
      // event loop — so a second `execute` message arriving mid-init would
      // overwrite the registry out from under this run, and the engine (which
      // reads getActiveImports() synchronously at the top of its evaluation)
      // would then tessellate with the wrong imports. Install the snapshot at
      // the last synchronous moment before each engine reads it, after the
      // awaits, instead of here — closing that interleaving window.
      const runImports = imports ?? [];

      const effectiveLang: Language =
        lang === 'scad' ? 'scad' :
        lang === 'replicad' ? 'replicad' :
        lang === 'voxel' ? 'voxel' :
        'manifold-js';
      let result;
      if (effectiveLang === 'voxel') {
        // Pure-JS voxel meshing — no WASM, no lazy init, synchronous.
        setActiveImports(runImports);
        result = withLogs(log.run(() => voxelEngine.run(code as string, params ?? undefined)), log);
      } else if (effectiveLang === 'scad') {
        // Ensure the OpenSCAD engine is loaded (lazy init).
        if (!openscadEngine.isReady()) await openscadEngine.init();
        setActiveImports(runImports);
        // Preview callback: post the rough mesh to the main thread so it can
        // update the viewport immediately while Phase 2 (full quality) runs.
        const onScadPreview = (previewResult: { mesh: import('./types').MeshData | null }) => {
          const mesh = previewResult.mesh;
          if (!mesh) return;
          const transfer: Transferable[] = [mesh.vertProperties.buffer, mesh.triVerts.buffer];
          if (mesh.mergeFromVert) transfer.push(mesh.mergeFromVert.buffer);
          if (mesh.mergeToVert)   transfer.push(mesh.mergeToVert.buffer);
          if (mesh.runIndex)      transfer.push(mesh.runIndex.buffer);
          if (mesh.runOriginalID) transfer.push(mesh.runOriginalID.buffer);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (self as any).postMessage({ type: 'execute_preview', callId, mesh }, transfer);
        };
        result = await runScadAsync(code as string, params ?? undefined, onScadPreview, companionFiles);
      } else if (effectiveLang === 'replicad') {
        // Full replicad-language session — lazy-init OCCT then evaluate as
        // BREP. Tessellation happens inside the engine before returning.
        if (!replicadEngine.isReady()) await replicadEngine.init();
        setActiveImports(runImports);
        // runReplicadAsync evaluates the model code before its first await, so
        // that part runs inside the capture.
        result = withLogs(await log.run(() => runReplicadAsync(code as string, params ?? undefined)), log);
      } else {
        if (!manifoldReady) {
          self.postMessage({
            type: 'error',
            callId,
            message: 'Geometry engine not initialised — try again after loading completes.',
          });
          return;
        }
        // Phase C: if the user's manifold-js source mentions `BREP`, preload
        // OCCT before evaluating so `api.BREP` is populated. Skipped entirely
        // when the source doesn't touch BREP — keeps the WASM payload off the
        // critical path for everyone else.
        if (sourceUsesBrep(code as string)) {
          await ensureBrepLoaded();
        }
        // Pre-load Liberation Sans fonts if the code calls api.text / api.textSection,
        // or uses api.fasteners (clearanceCoupon engraves text labels internally) —
        // including via its deprecated api.printFit alias, kept for old sessions.
        // Same lazy-load pattern as BREP — fonts are cached after the first run.
        if (sourceUsesManifoldText(code as string) || /\bapi\.(?:fasteners|printFit)\b/.test(code as string) || /[{,]\s*(?:fasteners|printFit)\s*[,}]/.test(code as string)) {
          await preloadTextFonts();
        }
        setActiveImports(runImports);
        // Progressive render for SDF models (figures): a throwaway coarse pass
        // first, posted as `execute_preview` so the viewport shows a rough shape
        // in ~1-2s, then the full-quality pass below. Gated on the source doing
        // an SDF `.build()` so plain Manifold code never pays for a second pass.
        // Both runs are synchronous and back-to-back (no await between them), so
        // no newer execute can interleave; cancellation terminates the Worker.
        if (typeof sdfPreviewScale === 'number' && sdfPreviewScale > 1 && sourceUsesSdfBuild(code as string)) {
          try {
            setSdfPreviewScale(sdfPreviewScale);
            const preview = manifoldJsEngine.run(code as string, params ?? undefined);
            if (preview.mesh) {
              const pm = preview.mesh;
              const ptransfer: Transferable[] = [pm.vertProperties.buffer, pm.triVerts.buffer];
              if (pm.mergeFromVert) ptransfer.push(pm.mergeFromVert.buffer);
              if (pm.mergeToVert)   ptransfer.push(pm.mergeToVert.buffer);
              if (pm.runIndex)      ptransfer.push(pm.runIndex.buffer);
              if (pm.runOriginalID) ptransfer.push(pm.runOriginalID.buffer);
              // Carry the model-declared colour data so the main thread can paint
              // an estimated colour onto the coarse mesh (api.label colours +
              // api.paint.* ops). Same serialisation as the full execute_result
              // below — labelMap is a Map<string,Set>, so flatten to entries.
              const pLabelMapEntries: [string, number[]][] | null = preview.labelMap
                ? Array.from(preview.labelMap.entries()).map(([k, v]) => [k, Array.from(v)])
                : null;
              const pLabelColorEntries: [string, [number, number, number]][] | null = preview.labelColors
                ? Array.from(preview.labelColors.entries())
                : null;
              const pPaintOps = preview.paintOps ?? null;
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (self as any).postMessage(
                { type: 'execute_preview', callId, mesh: pm, labelMapEntries: pLabelMapEntries, labelColorEntries: pLabelColorEntries, paintOps: pPaintOps },
                ptransfer,
              );
            }
            // Free the preview's live Manifold — only the mesh was transferred.
            const plive = (preview as { manifold?: { delete?: () => void } } | undefined)?.manifold;
            if (plive && typeof plive.delete === 'function') { try { plive.delete(); } catch { /* freed */ } }
          } catch { /* preview is best-effort; fall through to the full render */ }
          finally { setSdfPreviewScale(null); }
        }
        result = withLogs(log.run(() => manifoldJsEngine.run(code as string, params ?? undefined)), log);
      }

      // labelMap is Map<string, Set<number>> — not directly serialisable.
      const labelMapEntries: [string, number[]][] | null = result.labelMap
        ? Array.from(result.labelMap.entries()).map(([k, v]) => [k, Array.from(v)])
        : null;
      // Model-declared label colors (api.label(…, { color })) — plain entries.
      const labelColorEntries: [string, [number, number, number]][] | null = result.labelColors
        ? Array.from(result.labelColors.entries())
        : null;
      const lostLabels = result.lostLabels ?? null;
      // api.paint.* operations declared in code — already plain serialisable
      // objects ({ name, color, descriptor }), so they cross as-is.
      const paintOps = result.paintOps ?? null;
      // api.surface.* ops — plain serialisable { id, params } objects, cross as-is.
      const surfaceOps = result.surfaceOps ?? null;
      // api.material(...) — plain serialisable MaterialSpec, crosses as-is.
      const materialSpec = result.materialSpec ?? null;
      const paramsSchema = result.paramsSchema ?? null;
      // console.log output from the model code (success and error alike).
      const logs = result.logs ?? null;
      // Heap high-water for manifold-js runs (other engines own separate heaps).
      const engineHeapBytes = effectiveLang === 'manifold-js' ? manifoldHeapBytes() : undefined;

      const mesh = result.mesh;
      // A big result: compute the Manifold-dependent stats here, over the live
      // result, so the main thread can skip rebuilding its own Manifold from
      // the mesh (seconds of frozen UI at a few million triangles) until
      // something needs it. See MeshResult.manifoldFacts. Every engine that
      // returns a live Manifold returns that Manifold's own mesh (manifold-js,
      // SCAD's canonical mesh, replicad's getMesh()), so the facts describe it.
      const liveResult = (result as { manifold?: unknown }).manifold;
      const manifoldFacts = mesh && liveResult && !result.renderOnly &&
        typeof manifoldFactsMinTriangles === 'number' && mesh.numTri >= manifoldFactsMinTriangles
        ? computeFactsSafely(liveResult, mesh, containmentSamples)
        : undefined;
      if (mesh) {
        // Transfer typed array buffers zero-copy to the main thread.
        const transfer: Transferable[] = [
          mesh.vertProperties.buffer,
          mesh.triVerts.buffer,
        ];
        if (mesh.mergeFromVert) transfer.push(mesh.mergeFromVert.buffer);
        if (mesh.mergeToVert)   transfer.push(mesh.mergeToVert.buffer);
        if (mesh.runIndex)      transfer.push(mesh.runIndex.buffer);
        if (mesh.runOriginalID) transfer.push(mesh.runOriginalID.buffer);
        // Voxel meshes carry per-triangle colors; transfer them too (the
        // manifold-js path leaves triColors undefined).
        if (mesh.triColors)     transfer.push(mesh.triColors.buffer);
        if (manifoldFacts?.pieces) transfer.push(manifoldFacts.pieces.pieceOfTri.buffer);
        // Voxel runs also return the grid itself as typed arrays.
        const vg = result.voxelGrid as VoxelGridTransfer | undefined;
        if (vg) transfer.push(vg.keys.buffer, vg.colors.buffer);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (self as any).postMessage(
          { type: 'execute_result', callId, mesh, error: null, diagnostics: [], labelMapEntries, labelColorEntries, paintOps, surfaceOps, materialSpec, lostLabels, paramsSchema, logs, renderOnly: !!result.renderOnly, workerMs: Math.round(performance.now() - execStart), engineHeapBytes, ...(manifoldFacts ? { manifoldFacts } : {}), voxelCount: result.voxelCount, voxelPieceCount: result.voxelPieceCount, voxelRes: result.voxelRes, voxelResMixed: result.voxelResMixed, sdfLabelCounts: result.sdfLabelCounts, voxelGrid: result.voxelGrid },
          transfer,
        );
      } else {
        self.postMessage({
          type: 'execute_result',
          callId,
          mesh: null,
          error: result.error,
          diagnostics: result.diagnostics ?? [],
          labelMapEntries: null,
          lostLabels: null,
          paramsSchema,
          logs,
          workerMs: Math.round(performance.now() - execStart),
          engineHeapBytes,
        });
      }

      // Only the extracted mesh data crosses the thread boundary, so the live
      // result Manifold is no longer needed. Free it regardless of engine —
      // every path that builds a Manifold (manifold-js, SCAD's STL round-trip,
      // replicad's BREP→mesh→Manifold) pins one on the worker's WASM heap
      // otherwise, and the editor's per-edit auto-run would leak one per
      // keystroke. The BREP-specific lastShape lifecycle is unrelated and
      // lives inside the replicad engine.
      const live = (result as { manifold?: { delete?: () => void } } | undefined)?.manifold;
      if (live && typeof live.delete === 'function') {
        try { live.delete(); } catch { /* already freed */ }
      }
    } catch (err) {
      self.postMessage({
        type: 'error',
        callId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    // NB: intentionally no `finally { setCircularSegmentsOverride(null) }`.
    // Clearing here would race a concurrent async run: when this (older) run
    // finishes first, it would yank the override out from under a still-
    // compiling newer run, which would then fall back to the worker's
    // localStorage-less default segment count and silently render at the wrong
    // quality. The per-run set above is sufficient; nothing reads the override
    // outside an execute, and every execute sets it before generating geometry.
    return;
  }

  // ── simplify ───────────────────────────────────────────────────────────
  if (msg.type === 'simplify') {
    const { callId, mesh, targetTriangles, maxTolerance, tolerance, manifoldFactsMinTriangles, containmentSamples } = msg as unknown as {
      callId: string;
      mesh: MeshData;
      manifoldFactsMinTriangles?: number;
      containmentSamples?: number;
      targetTriangles: number;
      maxTolerance: number;
      // When set (> 0), run a single direct simplify(tolerance) pass instead of
      // the triangle-budget binary search — the "by edge length / size" knob.
      tolerance?: number;
    };
    if (!manifoldReady) {
      self.postMessage({
        type: 'simplify_result', callId, mesh: null, triangleCount: 0, tolerance: 0,
        cancelled: false, error: 'Geometry engine not initialised — try again after loading completes.',
      });
      return;
    }
    simplifyCancelFlags.set(callId, false);
    const mod = getManifoldModule();
    let baseManifold: { delete?: () => void } | null = null;
    try {
      baseManifold = mod.Manifold.ofMesh(mesh);
      const direct = typeof tolerance === 'number' && tolerance > 0;
      let result: SimplifyResult | null;
      if (direct) {
        // Single synchronous pass — bracket with 0/1 progress so the modal
        // behaves the same as the searched path.
        self.postMessage({ type: 'simplify_progress', callId, fraction: 0 });
        result = simplifyToTolerance(
          baseManifold as unknown as Parameters<typeof simplifyToTolerance>[0],
          tolerance,
        );
        self.postMessage({ type: 'simplify_progress', callId, fraction: 1 });
      } else {
        result = await simplifyToTriangleBudget(
          baseManifold as unknown as Parameters<typeof simplifyToTriangleBudget>[0],
          targetTriangles,
          maxTolerance,
          (fraction) => {
            self.postMessage({ type: 'simplify_progress', callId, fraction });
            // Loop yields to the event loop between iterations so a queued
            // 'simplify_cancel' message can flip the flag — checked here so the
            // search bails before doing more work.
            return new Promise<void>(r => setTimeout(r, 0));
          },
          () => simplifyCancelFlags.get(callId) === true,
        );
      }
      const cancelled = simplifyCancelFlags.get(callId) === true;
      simplifyCancelFlags.delete(callId);
      if (cancelled) {
        self.postMessage({
          type: 'simplify_result', callId, mesh: null, triangleCount: 0, tolerance: 0,
          cancelled: true, error: null,
        });
      } else if (result) {
        const facts = resultFacts(result.mesh, manifoldFactsMinTriangles, containmentSamples);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (self as any).postMessage({
          type: 'simplify_result', callId,
          mesh: result.mesh, triangleCount: result.triangleCount, tolerance: result.tolerance,
          cancelled: false, error: null, ...facts,
        }, meshTransfer(result.mesh, facts.manifoldFacts));
      } else {
        // null result: target ≥ current triangle count, or no reduction possible.
        self.postMessage({
          type: 'simplify_result', callId,
          mesh: null, triangleCount: 0, tolerance: 0, cancelled: false, error: null,
        });
      }
    } catch (err) {
      simplifyCancelFlags.delete(callId);
      self.postMessage({
        type: 'simplify_result', callId, mesh: null, triangleCount: 0, tolerance: 0,
        cancelled: false, error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      if (baseManifold && typeof baseManifold.delete === 'function') {
        try { baseManifold.delete(); } catch { /* already freed */ }
      }
    }
    return;
  }

  // ── simplify_cancel ─────────────────────────────────────────────────────
  if (msg.type === 'simplify_cancel') {
    const { callId } = msg as unknown as { callId: string };
    if (simplifyCancelFlags.has(callId)) simplifyCancelFlags.set(callId, true);
    return;
  }

  // ── enhance ────────────────────────────────────────────────────────────
  if (msg.type === 'enhance') {
    const { callId, mesh, targetTriangles, maxEdgeLength, edgeLength, maxTriangles, manifoldFactsMinTriangles, containmentSamples } = msg as unknown as {
      callId: string;
      mesh: MeshData;
      manifoldFactsMinTriangles?: number;
      containmentSamples?: number;
      targetTriangles: number;
      maxEdgeLength: number;
      // When set (> 0), run a single direct refineToLength(edgeLength) pass
      // instead of the triangle-budget binary search — the "by edge length /
      // size" knob. Splits only edges longer than this, so the larger triangles
      // densify first.
      edgeLength?: number;
      // Hard ceiling on the refined triangle count — the Worker refuses to
      // return a mesh larger than this so a runaway refine can't freeze the
      // main thread when the result is committed.
      maxTriangles?: number;
    };
    if (!manifoldReady) {
      self.postMessage({
        type: 'enhance_result', callId, mesh: null, triangleCount: 0,
        cancelled: false, error: 'Geometry engine not initialised — try again after loading completes.',
      });
      return;
    }
    enhanceCancelFlags.set(callId, false);
    const mod = getManifoldModule();
    let baseManifold: { delete?: () => void } | null = null;
    try {
      baseManifold = mod.Manifold.ofMesh(mesh);
      const direct = typeof edgeLength === 'number' && edgeLength > 0;
      let result: EnhanceResult | EnhanceExceeded | null;
      if (direct) {
        self.postMessage({ type: 'enhance_progress', callId, fraction: 0 });
        result = refineToEdgeLength(
          baseManifold as unknown as Parameters<typeof refineToEdgeLength>[0],
          edgeLength,
          maxTriangles,
        );
        self.postMessage({ type: 'enhance_progress', callId, fraction: 1 });
      } else {
        result = await enhanceToTriangleBudget(
          baseManifold as unknown as Parameters<typeof enhanceToTriangleBudget>[0],
          targetTriangles,
          maxEdgeLength,
          (fraction) => {
            self.postMessage({ type: 'enhance_progress', callId, fraction });
            return new Promise<void>(r => setTimeout(r, 0));
          },
          () => enhanceCancelFlags.get(callId) === true,
          maxTriangles,
        );
      }
      const cancelled = enhanceCancelFlags.get(callId) === true;
      enhanceCancelFlags.delete(callId);
      if (cancelled) {
        self.postMessage({
          type: 'enhance_result', callId, mesh: null, triangleCount: 0,
          cancelled: true, error: null,
        });
      } else if (result && isEnhanceExceeded(result)) {
        // Refused: the refine would exceed the hard cap. Report the count with
        // no mesh so the main thread can warn without ever committing it.
        self.postMessage({
          type: 'enhance_result', callId, mesh: null, triangleCount: result.triangleCount,
          cancelled: false, exceeded: true, error: null,
        });
      } else if (result) {
        const facts = resultFacts(result.mesh, manifoldFactsMinTriangles, containmentSamples);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (self as any).postMessage({
          type: 'enhance_result', callId,
          mesh: result.mesh, triangleCount: result.triangleCount,
          cancelled: false, error: null, ...facts,
        }, meshTransfer(result.mesh, facts.manifoldFacts));
      } else {
        self.postMessage({
          type: 'enhance_result', callId,
          mesh: null, triangleCount: 0, cancelled: false, error: null,
        });
      }
    } catch (err) {
      enhanceCancelFlags.delete(callId);
      self.postMessage({
        type: 'enhance_result', callId, mesh: null, triangleCount: 0,
        cancelled: false, error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      if (baseManifold && typeof baseManifold.delete === 'function') {
        try { baseManifold.delete(); } catch { /* already freed */ }
      }
    }
    return;
  }

  // ── enhance_cancel ──────────────────────────────────────────────────────
  if (msg.type === 'enhance_cancel') {
    const { callId } = msg as unknown as { callId: string };
    if (enhanceCancelFlags.has(callId)) enhanceCancelFlags.set(callId, true);
    return;
  }

  // ── voxel_grid ──────────────────────────────────────────────────────────
  // Evaluate voxel model code and return the grid itself (typed arrays) — for
  // Voxel Studio activation when the main thread has no up-to-date grid from
  // the last render. The main thread never evaluates model code (#1090).
  if (msg.type === 'voxel_grid') {
    const { callId, code, params, voxelSdfMaxSamples } = msg as unknown as { callId: string; code: string; params?: Record<string, unknown> | null; voxelSdfMaxSamples?: number };
    // Same v.sdf budget seed as `execute` — a respawned Worker may never have
    // seen an execute message before its first voxel_grid.
    if (typeof voxelSdfMaxSamples === 'number') applyWorkerImportConfig({ voxelSdfMaxSamples });
    try {
      const r = runVoxelGrid(code, params ?? undefined);
      if (!r.ok) {
        self.postMessage({ type: 'voxel_grid_result', callId, grid: null, error: r.error });
      } else {
        const grid = r.grid.toTransfer();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (self as any).postMessage({ type: 'voxel_grid_result', callId, grid, error: null }, [grid.keys.buffer, grid.colors.buffer]);
      }
    } catch (err) {
      self.postMessage({ type: 'voxel_grid_result', callId, grid: null, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  // ── detect_includes ──────────────────────────────────────────────────────
  // Fast import-time dependency probe: compile the SCAD source far enough to
  // resolve include/use targets and report the ones OpenSCAD can't open.
  if (msg.type === 'detect_includes') {
    const { callId, code } = msg as unknown as { callId: string; code: string };
    try {
      if (!openscadEngine.isReady()) await openscadEngine.init();
      const result = await detectUnresolvedIncludes(code);
      self.postMessage({ type: 'detect_includes_result', callId, result });
    } catch (err) {
      self.postMessage({
        type: 'error',
        callId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  // ── validate ───────────────────────────────────────────────────────────
  if (msg.type === 'validate') {
    const { callId, code, lang } = msg as unknown as {
      callId: string;
      code: string;
      lang?: Language;
    };
    try {
      const effectiveLang: Language =
        lang === 'scad' ? 'scad' :
        lang === 'replicad' ? 'replicad' :
        lang === 'voxel' ? 'voxel' :
        'manifold-js';
      let result;
      if (effectiveLang === 'voxel') {
        result = voxelEngine.validate(code);
      } else if (effectiveLang === 'scad') {
        if (!openscadEngine.isReady()) await openscadEngine.init();
        result = await openscadEngine.validate(code);
      } else if (effectiveLang === 'replicad') {
        // Validation = syntax-parse only; replicad shares the JS parser, so
        // we use a cheap Function-constructor check without booting OCCT.
        result = replicadEngine.validate(code);
      } else {
        result = manifoldJsEngine.validate(code);
      }
      self.postMessage({ type: 'validate_result', callId, result });
    } catch (err) {
      self.postMessage({
        type: 'error',
        callId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  // ── exportSTEP ─────────────────────────────────────────────────────────
  // Returns the STEP blob for the BREP shape produced by the most recent
  // replicad-engine run. Only meaningful in `replicad`-language sessions;
  // manifold-js code that ends with `api.BREP.toManifold(...)` doesn't
  // retain the BREP source past the mesh conversion, so STEP isn't
  // available for that path.
  if (msg.type === 'exportSTEP') {
    const { callId } = msg as unknown as { callId: string };
    try {
      const shape = getLastBrepShape();
      if (!shape) {
        self.postMessage({
          type: 'exportSTEP_result',
          callId,
          blob: null,
          error: 'No BREP shape available — switch to BREP language and run a model first.',
        });
        return;
      }
      const blob = shape.blobSTEP();
      self.postMessage({ type: 'exportSTEP_result', callId, blob, error: null });
    } catch (err) {
      self.postMessage({
        type: 'exportSTEP_result',
        callId,
        blob: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  // ── importSTEPToBrep ────────────────────────────────────────────────────
  // Parse a STEP file blob into a BrepShape and stash it on the worker's
  // pending-BREP-imports list. The replicad-language engine exposes the
  // list as `api.imports` on subsequent runs. Caller (the main thread)
  // then switches the active language to 'replicad' and seeds the editor
  // with `return api.imports[0];` so the user can immediately iterate.
  if (msg.type === 'importSTEPToBrep') {
    const { callId, bytes, filename } = msg as unknown as {
      callId: string;
      bytes: ArrayBuffer;
      filename: string;
    };
    try {
      const blob = new Blob([bytes]);
      const shape = await parseStepBlob(blob);
      pushPendingBrepImport(filename, shape);
      self.postMessage({ type: 'importSTEPToBrep_result', callId, filename, error: null });
    } catch (err) {
      self.postMessage({
        type: 'importSTEPToBrep_result',
        callId,
        filename,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  // ── importSTEPToMesh ────────────────────────────────────────────────────
  // Same parser as above, but immediately tessellate the result so the
  // main thread can land it through the existing ImportedMesh pipeline.
  // The BrepShape itself is discarded — this path is for users who want
  // to work with the import as mesh (paint, mesh-only ops). Tessellation
  // is welded so manifold-3d's `Manifold.ofMesh` accepts it.
  if (msg.type === 'importSTEPToMesh') {
    const { callId, bytes } = msg as unknown as {
      callId: string;
      bytes: ArrayBuffer;
    };
    try {
      const blob = new Blob([bytes]);
      const shape = await parseStepBlob(blob);
      const mesh = shape.toMesh();
      try { shape.delete(); } catch { /* already freed */ }
      // Transfer the typed-array buffers zero-copy back to the main thread.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (self as any).postMessage(
        { type: 'importSTEPToMesh_result', callId, mesh, error: null },
        [mesh.vertProperties.buffer, mesh.triVerts.buffer],
      );
    } catch (err) {
      self.postMessage({
        type: 'importSTEPToMesh_result',
        callId,
        mesh: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  // ── clearBrepImports ────────────────────────────────────────────────────
  if (msg.type === 'clearBrepImports') {
    const { callId } = msg as unknown as { callId: string };
    try {
      clearPendingBrepImports();
      self.postMessage({ type: 'clearBrepImports_result', callId, error: null });
    } catch (err) {
      self.postMessage({
        type: 'clearBrepImports_result',
        callId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  // ── clearBrepShape ───────────────────────────────────────────────────────
  // Drop (and free) the retained STEP-export shape from the most recent
  // replicad run. Called when leaving a replicad session (switch/close) or
  // switching the active language away from replicad, so exportSTEP can't
  // return a stale shape that belongs to a different session.
  if (msg.type === 'clearBrepShape') {
    const { callId } = msg as unknown as { callId: string };
    try {
      clearLastBrepShape();
      self.postMessage({ type: 'clearBrepShape_result', callId, error: null });
    } catch (err) {
      self.postMessage({
        type: 'clearBrepShape_result',
        callId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }
};
