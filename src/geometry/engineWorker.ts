// Web Worker for geometry code execution. Runs manifold-3d WASM and
// OpenSCAD off the main thread so complex boolean operations can't freeze
// the UI. The main thread keeps its own manifold-3d instance for
// lightweight queries (sliceAtZ, getBoundingBox, Manifold.ofMesh) and
// exports; this Worker owns the expensive execution path.
//
// Protocol — Main → Worker:
//   { type: 'init' }
//   { type: 'execute',           callId, code, lang?, imports?, circularSegments?, params? }
//   { type: 'validate',          callId, code, lang? }
//   { type: 'detect_includes',   callId, code }
//   { type: 'exportSTEP',        callId }
//   { type: 'importSTEPToBrep',  callId, bytes, filename }
//   { type: 'importSTEPToMesh',  callId, bytes }
//   { type: 'clearBrepImports',  callId }
//   { type: 'clearBrepShape',    callId }
//   { type: 'simplify',          callId, mesh, targetTriangles, maxTolerance }
//   { type: 'simplify_cancel',   callId }
//   { type: 'enhance',           callId, mesh, targetTriangles, maxEdgeLength }
//   { type: 'enhance_cancel',    callId }
//   { type: 'cut',               callId, mesh, shape, keepSide, mat4x3, scale, triColors? }
//
// Protocol — Worker → Main:
//   { type: 'ready' }
//   { type: 'execute_result',          callId, mesh, error, diagnostics, labelMapEntries, lostLabels, paramsSchema, workerMs }
//   { type: 'validate_result',         callId, result }
//   { type: 'detect_includes_result',  callId, result }
//   { type: 'exportSTEP_result',       callId, blob, error }
//   { type: 'importSTEPToBrep_result', callId, filename, error }
//   { type: 'importSTEPToMesh_result', callId, mesh, error }
//   { type: 'clearBrepImports_result', callId, error }
//   { type: 'clearBrepShape_result',   callId, error }
//   { type: 'simplify_progress',       callId, fraction }
//   { type: 'simplify_result',         callId, mesh, triangleCount, tolerance, cancelled, error }
//   { type: 'enhance_progress',        callId, fraction }
//   { type: 'enhance_result',          callId, mesh, triangleCount, cancelled, error }
//   { type: 'cut_result',              callId, mesh, meshes, triColors, triColorsList, error }
//
// Mesh typed arrays are transferred (zero-copy) to the main thread.
// labelMap (Map<string, Set<number>>) is serialised as [string, number[]][].

import { manifoldJsEngine, getManifoldModule } from './engines/manifoldJs';
import { runScadAsync, openscadEngine, detectUnresolvedIncludes } from './engines/openscad';
import { runReplicadAsync, replicadEngine, getLastBrepShape, clearLastBrepShape } from './engines/replicad';
import { voxelEngine } from './engines/voxel';
import { ensureBrepLoaded, sourceUsesBrep, parseStepBlob, pushPendingBrepImport, clearPendingBrepImports } from './brepRuntime';
import { sourceUsesManifoldText, preloadTextFonts } from './textGlyphs';
import { setActiveImports, type ImportedMesh } from '../import/importedMesh';
import { setCircularSegmentsOverride } from './qualitySettings';
import type { Language } from './engines/types';
import { simplifyToTriangleBudget, enhanceToTriangleBudget, simplifyToTolerance, refineToEdgeLength, isEnhanceExceeded, type SimplifyResult, type EnhanceResult, type EnhanceExceeded } from './simplify';
import type { MeshData } from './types';
import { performCut, type CutParams } from '../cut/cutWorker';

/** Per-callId cancel flags for in-flight simplify jobs. The simplify loop
 *  yields to the event loop between iterations, so a `simplify_cancel`
 *  message has a chance to land and flip this flag — the loop checks it on
 *  each iteration boundary and bails out cleanly. */
const simplifyCancelFlags = new Map<string, boolean>();
const enhanceCancelFlags = new Map<string, boolean>();

let manifoldReady = false;

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

self.onmessage = async (event: MessageEvent) => {
  const msg = event.data as { type: string } & Record<string, unknown>;

  // ── init ───────────────────────────────────────────────────────────────
  if (msg.type === 'init') {
    try {
      await manifoldJsEngine.init();
      manifoldReady = true;
      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({
        type: 'error',
        callId: null,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  // ── execute ────────────────────────────────────────────────────────────
  if (msg.type === 'execute') {
    const { callId, code, lang, imports, circularSegments, params, companionFiles } = msg as unknown as {
      callId: string;
      code: string;
      lang?: Language;
      imports?: ImportedMesh[];
      circularSegments?: number;
      params?: Record<string, unknown> | null;
      companionFiles?: Record<string, string>;
    };
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
      // Populate the per-run import registry so api.imports works in user code.
      setActiveImports(imports ?? []);

      const effectiveLang: Language =
        lang === 'scad' ? 'scad' :
        lang === 'replicad' ? 'replicad' :
        lang === 'voxel' ? 'voxel' :
        'manifold-js';
      let result;
      if (effectiveLang === 'voxel') {
        // Pure-JS voxel meshing — no WASM, no lazy init, synchronous.
        result = voxelEngine.run(code as string, params ?? undefined);
      } else if (effectiveLang === 'scad') {
        // Ensure the OpenSCAD engine is loaded (lazy init).
        if (!openscadEngine.isReady()) await openscadEngine.init();
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
        result = await runReplicadAsync(code as string, params ?? undefined);
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
        // Pre-load Liberation Sans fonts if the code calls api.text / api.textSection.
        // Same lazy-load pattern as BREP — fonts are cached after the first run.
        if (sourceUsesManifoldText(code as string)) {
          await preloadTextFonts();
        }
        result = manifoldJsEngine.run(code as string, params ?? undefined);
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
      const paramsSchema = result.paramsSchema ?? null;
      // Heap high-water for manifold-js runs (other engines own separate heaps).
      const engineHeapBytes = effectiveLang === 'manifold-js' ? manifoldHeapBytes() : undefined;

      const mesh = result.mesh;
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

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (self as any).postMessage(
          { type: 'execute_result', callId, mesh, error: null, diagnostics: [], labelMapEntries, labelColorEntries, lostLabels, paramsSchema, renderOnly: !!result.renderOnly, workerMs: Math.round(performance.now() - execStart), engineHeapBytes },
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
    const { callId, mesh, targetTriangles, maxTolerance, tolerance } = msg as unknown as {
      callId: string;
      mesh: MeshData;
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
        const transfer: Transferable[] = [
          result.mesh.vertProperties.buffer,
          result.mesh.triVerts.buffer,
        ];
        if (result.mesh.mergeFromVert) transfer.push(result.mesh.mergeFromVert.buffer);
        if (result.mesh.mergeToVert)   transfer.push(result.mesh.mergeToVert.buffer);
        if (result.mesh.runIndex)      transfer.push(result.mesh.runIndex.buffer);
        if (result.mesh.runOriginalID) transfer.push(result.mesh.runOriginalID.buffer);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (self as any).postMessage({
          type: 'simplify_result', callId,
          mesh: result.mesh, triangleCount: result.triangleCount, tolerance: result.tolerance,
          cancelled: false, error: null,
        }, transfer);
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
    const { callId, mesh, targetTriangles, maxEdgeLength, edgeLength, maxTriangles } = msg as unknown as {
      callId: string;
      mesh: MeshData;
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
        const transfer: Transferable[] = [
          result.mesh.vertProperties.buffer,
          result.mesh.triVerts.buffer,
        ];
        if (result.mesh.mergeFromVert) transfer.push(result.mesh.mergeFromVert.buffer);
        if (result.mesh.mergeToVert)   transfer.push(result.mesh.mergeToVert.buffer);
        if (result.mesh.runIndex)      transfer.push(result.mesh.runIndex.buffer);
        if (result.mesh.runOriginalID) transfer.push(result.mesh.runOriginalID.buffer);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (self as any).postMessage({
          type: 'enhance_result', callId,
          mesh: result.mesh, triangleCount: result.triangleCount,
          cancelled: false, error: null,
        }, transfer);
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

  // ── cut ──────────────────────────────────────────────────────────────────
  if (msg.type === 'cut') {
    const { callId, mesh, shape, keepSide, mat4x3, scale, triColors } = msg as unknown as {
      callId: string;
      mesh: MeshData;
      shape: CutParams['shape'];
      keepSide: CutParams['keepSide'];
      mat4x3: number[];
      scale: [number, number, number];
      triColors?: Uint8Array;
    };
    if (!manifoldReady) {
      self.postMessage({
        type: 'cut_result', callId, mesh: null, triColors: null,
        error: 'Geometry engine not initialised — try again after loading completes.',
      });
      return;
    }
    try {
      const mod = getManifoldModule();
      const result = performCut(mod, mesh, { shape, keepSide, mat4x3, scale, triColors });
      if (!result) {
        self.postMessage({ type: 'cut_result', callId, mesh: null, triColors: null, error: null });
        return;
      }
      const transfer: Transferable[] = [result.mesh.vertProperties.buffer, result.mesh.triVerts.buffer];
      if (result.mesh.mergeFromVert) transfer.push(result.mesh.mergeFromVert.buffer);
      if (result.mesh.mergeToVert)   transfer.push(result.mesh.mergeToVert.buffer);
      if (result.mesh.runIndex)      transfer.push(result.mesh.runIndex.buffer);
      if (result.mesh.runOriginalID) transfer.push(result.mesh.runOriginalID.buffer);
      if (result.triColors)          transfer.push(result.triColors.buffer);
      // Transfer all per-component mesh buffers (kept, complement, and flat list)
      function addMeshBuffers(m: MeshData): void {
        transfer.push(m.vertProperties.buffer, m.triVerts.buffer);
        if (m.mergeFromVert) transfer.push(m.mergeFromVert.buffer);
        if (m.mergeToVert)   transfer.push(m.mergeToVert.buffer);
        if (m.runIndex)      transfer.push(m.runIndex.buffer);
        if (m.runOriginalID) transfer.push(m.runOriginalID.buffer);
      }
      for (const m of result.keptMeshes) addMeshBuffers(m);
      for (const m of result.complementMeshes) addMeshBuffers(m);
      if (result.keptColorsList)        for (const c of result.keptColorsList)        transfer.push(c.buffer);
      if (result.complementColorsList)  for (const c of result.complementColorsList)  transfer.push(c.buffer);
      if (result.triColorsList)         for (const c of result.triColorsList)         transfer.push(c.buffer);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (self as any).postMessage(
        {
          type: 'cut_result', callId,
          mesh: result.mesh,
          keptMeshes: result.keptMeshes,
          complementMeshes: result.complementMeshes,
          meshes: result.meshes,
          triColors: result.triColors ?? null,
          keptColorsList: result.keptColorsList ?? null,
          complementColorsList: result.complementColorsList ?? null,
          triColorsList: result.triColorsList ?? null,
          error: null,
        },
        transfer,
      );
    } catch (err) {
      self.postMessage({
        type: 'cut_result', callId, mesh: null, triColors: null,
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
  }
};
