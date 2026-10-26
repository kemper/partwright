// Main-thread client for the STL probe Worker (`stlProbeWorker.ts`). Lazy
// spawn, terminate-on-abort (parsing and `Manifold.ofMesh` are synchronous —
// terminate+respawn is the only true interrupt), settled-guarded handlers.
// Each probe gets its own short-lived Worker, terminated when it settles: a
// WASM heap never shrinks, so a Worker that just checked a 2M-triangle mesh
// would otherwise sit on hundreds of MB. (Spawning + loading manifold-3d is
// ~0.2 s, small next to the probe of any mesh big enough to matter.)

import type { STLProbeResult } from './stlProbe';

export class STLProbeAbortError extends Error {
  constructor() {
    super('STL import cancelled');
    this.name = 'STLProbeAbortError';
  }
}

export interface STLProbeControl {
  signal?: AbortSignal;
  onProgress?: (fraction: number, message: string) => void;
}


/** Probe STL bytes in the Worker. Rejects with STLProbeAbortError on abort,
 *  or a plain Error when the Worker fails. The bytes' buffer is TRANSFERRED
 *  (zero-copy; cloning 100 MB stalls the UI for ~0.4 s) once the Worker has
 *  loaded manifold-3d, so a Worker that fails to start leaves `bytes` intact
 *  for a main-thread fallback; after the hand-off they are detached. */
export function probeSTLInWorker(bytes: Uint8Array, configuredTolerance: number, ctl?: STLProbeControl): Promise<STLProbeResult | null> {
  return new Promise((resolve, reject) => {
    if (ctl?.signal?.aborted) { reject(new STLProbeAbortError()); return; }
    let w: Worker;
    try {
      w = new Worker(new URL('./stlProbeWorker.ts', import.meta.url), { type: 'module' });
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      ctl?.signal?.removeEventListener('abort', onAbort);
      w.terminate();
      reject(err);
    };
    const onAbort = () => fail(new STLProbeAbortError());
    w.onmessage = (e: MessageEvent<{ type: string; fraction?: number; message?: string; result?: STLProbeResult | null }>) => {
      const m = e.data;
      if (settled) return;
      if (m.type === 'ready') {
        // Transfer only a buffer the view owns outright; a view into a larger
        // buffer is copied rather than detaching the caller's other data.
        const whole = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength && bytes.buffer instanceof ArrayBuffer;
        try {
          w.postMessage({ type: 'probe', bytes, configuredTolerance }, whole ? [bytes.buffer as ArrayBuffer] : []);
        } catch (err) {
          fail(err instanceof Error ? err : new Error(String(err)));
        }
        return;
      }
      if (m.type === 'progress') { ctl?.onProgress?.(m.fraction ?? 0, m.message ?? ''); return; }
      if (m.type === 'done') {
        settled = true;
        ctl?.signal?.removeEventListener('abort', onAbort);
        w.terminate();
        resolve(m.result ?? null);
        return;
      }
      fail(new Error(m.message ?? 'STL probe failed'));
    };
    w.onerror = (e) => fail(new Error(e.message || 'STL probe worker error'));
    w.onmessageerror = () => fail(new Error('STL probe worker sent an unreadable message'));
    ctl?.signal?.addEventListener('abort', onAbort, { once: true });
  });
}
