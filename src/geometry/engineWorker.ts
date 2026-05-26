// Web Worker for geometry code execution. Runs manifold-3d WASM and
// OpenSCAD off the main thread so complex boolean operations can't freeze
// the UI. The main thread keeps its own manifold-3d instance for
// lightweight queries (sliceAtZ, getBoundingBox, Manifold.ofMesh) and
// exports; this Worker owns the expensive execution path.
//
// Protocol — Main → Worker:
//   { type: 'init' }
//   { type: 'execute',     callId, code, lang?, imports? }
//   { type: 'validate',    callId, code, lang? }
//   { type: 'exportSTEP',  callId }
//
// Protocol — Worker → Main:
//   { type: 'ready' }
//   { type: 'execute_result',     callId, mesh, error, diagnostics, labelMapEntries }
//   { type: 'validate_result',    callId, result }
//   { type: 'exportSTEP_result',  callId, blob, error }
//   { type: 'error',              callId, message }
//
// Mesh typed arrays are transferred (zero-copy) to the main thread.
// labelMap (Map<string, Set<number>>) is serialised as [string, number[]][].

import { manifoldJsEngine } from './engines/manifoldJs';
import { runScadAsync, openscadEngine } from './engines/openscad';
import { runReplicadAsync, replicadEngine, getLastBrepShape } from './engines/replicad';
import { ensureBrepLoaded, sourceUsesBrep } from './brepRuntime';
import { setActiveImports, type ImportedMesh } from '../import/importedMesh';
import { setCircularSegmentsOverride } from './qualitySettings';
import type { Language } from './engines/types';

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
      // Propagate main-thread quality setting so Worker uses same segment count.
      // Reset in finally so a subsequent execution doesn't inherit a stale value
      // if this execution's circularSegments message arrives out of order.
      setCircularSegmentsOverride(typeof circularSegments === 'number' ? circularSegments : null);
      // Populate the per-run import registry so api.imports works in user code.
      setActiveImports(imports ?? []);

      const effectiveLang: Language =
        lang === 'scad' ? 'scad' :
        lang === 'replicad' ? 'replicad' :
        'manifold-js';
      let result;
      if (effectiveLang === 'scad') {
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

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (self as any).postMessage(
          { type: 'execute_result', callId, mesh, error: null, diagnostics: [], labelMapEntries },
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
        });
      }

      // Only the extracted mesh data crosses the thread boundary, so the live
      // result Manifold is no longer needed. Free it (manifold-js path only —
      // the SCAD and replicad engines own their own result lifecycle) so
      // repeated executions, including the editor's per-edit auto-run, don't
      // leak one Manifold each.
      if (effectiveLang === 'manifold-js') {
        const live = (result as { manifold?: { delete?: () => void } } | undefined)?.manifold;
        if (live && typeof live.delete === 'function') {
          try { live.delete(); } catch { /* already freed */ }
        }
      }
    } catch (err) {
      self.postMessage({
        type: 'error',
        callId,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      // Always reset so a subsequent execution doesn't inherit this run's value.
      setCircularSegmentsOverride(null);
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
        'manifold-js';
      let result;
      if (effectiveLang === 'scad') {
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
  }
};
