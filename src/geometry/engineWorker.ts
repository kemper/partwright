// Web Worker for geometry code execution. Runs manifold-3d WASM and
// OpenSCAD off the main thread so complex boolean operations can't freeze
// the UI. The main thread keeps its own manifold-3d instance for
// lightweight queries (sliceAtZ, getBoundingBox, Manifold.ofMesh) and
// exports; this Worker owns the expensive execution path.
//
// Protocol — Main → Worker:
//   { type: 'init' }
//   { type: 'execute',  callId, code, lang?, imports? }
//   { type: 'validate', callId, code, lang? }
//   { type: 'simplify', callId, mesh, targetTriangles, maxTolerance }
//   { type: 'simplify_cancel', callId }
//
// Protocol — Worker → Main:
//   { type: 'ready' }
//   { type: 'execute_result',  callId, mesh, error, diagnostics, labelMapEntries }
//   { type: 'validate_result', callId, result }
//   { type: 'simplify_progress', callId, fraction }
//   { type: 'simplify_result',   callId, mesh, triangleCount, tolerance, cancelled, error }
//   { type: 'error',             callId, message }
//
// Mesh typed arrays are transferred (zero-copy) to the main thread.
// labelMap (Map<string, Set<number>>) is serialised as [string, number[]][].

import { manifoldJsEngine, getManifoldModule } from './engines/manifoldJs';
import { runScadAsync, openscadEngine } from './engines/openscad';
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
      // Propagate main-thread quality setting so Worker uses same segment count.
      // Reset in finally so a subsequent execution doesn't inherit a stale value
      // if this execution's circularSegments message arrives out of order.
      setCircularSegmentsOverride(typeof circularSegments === 'number' ? circularSegments : null);
      // Populate the per-run import registry so api.imports works in user code.
      setActiveImports(imports ?? []);

      const effectiveLang: Language = lang === 'scad' ? 'scad' : 'manifold-js';
      let result;
      if (effectiveLang === 'scad') {
        // Ensure the OpenSCAD engine is loaded (lazy init).
        if (!openscadEngine.isReady()) await openscadEngine.init();
        result = await runScadAsync(code as string);
      } else {
        if (!manifoldReady) {
          self.postMessage({
            type: 'error',
            callId,
            message: 'Geometry engine not initialised — try again after loading completes.',
          });
          return;
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
      // the SCAD engine owns its own result) so repeated executions, including
      // the editor's per-edit auto-run, don't leak one Manifold each.
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
      const effectiveLang: Language = lang === 'scad' ? 'scad' : 'manifold-js';
      let result;
      if (effectiveLang === 'scad') {
        if (!openscadEngine.isReady()) await openscadEngine.init();
        result = await openscadEngine.validate(code);
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
  }
};
