// Main-thread client for the engrave Worker (`engraveWorker.ts`).
//
// `engraveInWorker` mirrors the signature of the in-process `engraveMesh` carve
// (mesh + options + an `SdfRunControl` for progress/abort) so `main.ts` can swap
// the heavy SDF sweep off the UI thread without touching the result-assembly
// (`buildEngraveResult`). Progress messages drive the same inline "Rendering… Xs"
// indicator; an abort terminates the Worker (terminate+respawn — the only true
// interrupt for the effectively-synchronous lattice sweep) and rejects with the
// shared `SdfAbortError`, so the existing cancel-vs-error handling is unchanged.

import type { MeshData } from '../geometry/types';
import type { EngraveModifierOptions } from './modifiers';
import { SdfAbortError, type SdfRunControl } from './sdfModifier';

let worker: Worker | null = null;

function initWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./engraveWorker.ts', import.meta.url), { type: 'module' });
  return worker;
}

/** Tear the Worker down so an in-flight carve stops immediately; it respawns
 *  lazily on the next call. */
function teardown(): void {
  worker?.terminate();
  worker = null;
}

/** Run the engrave SDF carve in the Worker. Resolves with the carved mesh;
 *  rejects with {@link SdfAbortError} when `ctl.signal` aborts, or a plain Error
 *  on a carve failure. */
export function engraveInWorker(
  mesh: MeshData,
  opts: EngraveModifierOptions,
  ctl?: SdfRunControl,
): Promise<MeshData> {
  return new Promise<MeshData>((resolve, reject) => {
    if (ctl?.signal?.aborted) { reject(new SdfAbortError()); return; }
    const w = initWorker();

    let settled = false;
    const cleanup = () => {
      ctl?.signal?.removeEventListener('abort', onAbort);
      w.onmessage = null;
      w.onerror = null;
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      teardown(); // a terminated worker can't fire its handlers, so clean up here
      ctl?.signal?.removeEventListener('abort', onAbort);
      reject(new SdfAbortError());
    };

    w.onmessage = (e: MessageEvent<{ type: string; fraction?: number; mesh?: MeshData; message?: string }>) => {
      const m = e.data;
      if (m.type === 'progress') { ctl?.onProgress?.(m.fraction ?? 0); return; }
      if (settled) return;
      settled = true;
      cleanup();
      if (m.type === 'done' && m.mesh) resolve(m.mesh);
      else reject(new Error(m.message ?? 'engrave failed'));
    };
    w.onerror = (e) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(e.message || 'engrave worker error'));
    };

    if (ctl?.signal) ctl.signal.addEventListener('abort', onAbort, { once: true });
    // The input mesh is structured-cloned (not transferred): the caller still
    // needs it for paint transfer in buildEngraveResult.
    w.postMessage({ type: 'engrave', mesh, opts });
  });
}
