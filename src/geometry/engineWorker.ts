// Web Worker for geometry code execution. Runs manifold-3d WASM and
// OpenSCAD off the main thread so complex boolean operations can't freeze
// the UI. The main thread keeps its own manifold-3d instance for
// lightweight queries (sliceAtZ, getBoundingBox, Manifold.ofMesh) and
// exports; this Worker owns the expensive execution path.
//
// Protocol — Main → Worker:
//   { type: 'init' }
//   { type: 'execute',           callId, code, lang?, imports? }
//   { type: 'validate',          callId, code, lang? }
//   { type: 'exportSTEP',        callId }
//   { type: 'importSTEPToBrep',  callId, bytes, filename }
//   { type: 'importSTEPToMesh',  callId, bytes }
//   { type: 'clearBrepImports',  callId }
//   { type: 'simplify',          callId, mesh, targetTriangles, maxTolerance }
//   { type: 'simplify_cancel',   callId }
//
// Protocol — Worker → Main:
//   { type: 'ready' }
//   { type: 'execute_result',          callId, mesh, error, diagnostics, labelMapEntries }
//   { type: 'validate_result',         callId, result }
//   { type: 'exportSTEP_result',       callId, blob, error }
//   { type: 'importSTEPToBrep_result', callId, filename, error }
//   { type: 'importSTEPToMesh_result', callId, mesh, error }
//   { type: 'clearBrepImports_result', callId, error }
//   { type: 'simplify_progress',       callId, fraction }
//   { type: 'simplify_result',         callId, mesh, triangleCount, tolerance, cancelled, error }
//   { type: 'error',                   callId, message }
//
// Mesh typed arrays are transferred (zero-copy) to the main thread.
// labelMap (Map<string, Set<number>>) is serialised as [string, number[]][].

import { manifoldJsEngine, getManifoldModule } from './engines/manifoldJs';
import { runScadAsync, openscadEngine } from './engines/openscad';
import { runReplicadAsync, replicadEngine, getLastBrepShape } from './engines/replicad';
import { voxelEngine } from './engines/voxel';
import { ensureBrepLoaded, sourceUsesBrep, parseStepBlob, pushPendingBrepImport, clearPendingBrepImports } from './brepRuntime';
import { setActiveImports, type ImportedMesh } from '../import/importedMesh';
import { setCircularSegmentsOverride } from './qualitySettings';
import type { Language } from './engines/types';
import { simplifyToTriangleBudget } from './simplify';
import type { MeshData } from './types';

/** Per-callId cancel flags for in-flight simplify jobs. The simplify loop
 *  yields to the event loop between iterations, so a `simplify_cancel`
 *  message has a chance to land and flip this flag — the loop checks it on
 *  each iteration boundary and bails out cleanly. */
const simplifyCancelFlags = new Map<string, boolean>();

let manifoldReady = false;

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
    const { callId, code, lang, imports, circularSegments } = msg as unknown as {
      callId: string;
      code: string;
      lang?: Language;
      imports?: ImportedMesh[];
      circularSegments?: number;
    };
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
        result = voxelEngine.run(code as string);
      } else if (effectiveLang === 'scad') {
        // Ensure the OpenSCAD engine is loaded (lazy init).
        if (!openscadEngine.isReady()) await openscadEngine.init();
        result = await runScadAsync(code as string);
      } else if (effectiveLang === 'replicad') {
        // Full replicad-language session — lazy-init OCCT then evaluate as
        // BREP. Tessellation happens inside the engine before returning.
        if (!replicadEngine.isReady()) await replicadEngine.init();
        result = await runReplicadAsync(code as string);
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
        result = manifoldJsEngine.run(code as string);
      }

      // labelMap is Map<string, Set<number>> — not directly serialisable.
      const labelMapEntries: [string, number[]][] | null = result.labelMap
        ? Array.from(result.labelMap.entries()).map(([k, v]) => [k, Array.from(v)])
        : null;
      const lostLabels = result.lostLabels ?? null;

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
          { type: 'execute_result', callId, mesh, error: null, diagnostics: [], labelMapEntries, lostLabels },
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
    const { callId, mesh, targetTriangles, maxTolerance } = msg as unknown as {
      callId: string;
      mesh: MeshData;
      targetTriangles: number;
      maxTolerance: number;
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
      const result = await simplifyToTriangleBudget(
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
  }
};
