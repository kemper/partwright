// Shared main-thread runner for the import Workers (STL probe, 3MF parse).
// One short-lived Worker per job: lazy spawn, payload handed over only once
// the Worker says `ready` (so a Worker that can't start fails BEFORE a
// transferred buffer leaves the main thread, which can then still do the work
// itself), progress forwarding, terminate-on-abort (parsing is synchronous —
// terminate is the only true interrupt), terminate-on-settle (a big parse's
// heap never shrinks), and settled-guarded handlers.
//
// Protocol (worker → main): `{ type: 'ready' }` once, then any number of
// `{ type: 'progress', fraction, message }`, then exactly one
// `{ type: 'done', result }` or `{ type: 'error', message }`.

export class ImportCancelledError extends Error {
  constructor() {
    super('Import cancelled');
    this.name = 'ImportCancelledError';
  }
}

/** A Worker failure. `afterHandOff`: the payload had already reached the
 *  Worker — the job itself failed (e.g. an unreadable file), so redoing it on
 *  the main thread would only fail again, slowly. False: the Worker never got
 *  going (a stale chunk after a deploy, no Worker support) — a main-thread
 *  fallback is worth trying. */
export class ImportWorkerError extends Error {
  readonly afterHandOff: boolean;
  constructor(message: string, afterHandOff: boolean) {
    super(message);
    this.afterHandOff = afterHandOff;
    this.name = 'ImportWorkerError';
  }
}

export interface ImportWorkerControl {
  signal?: AbortSignal;
  onProgress?: (fraction: number, message: string) => void;
}

/** Transfer list for a byte view: its buffer only when the view owns it
 *  outright (zero-copy; cloning 100 MB stalls the UI). A view into a larger
 *  buffer is copied rather than detaching the caller's other data. */
export function transferableBytes(bytes: Uint8Array): Transferable[] {
  const whole = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength && bytes.buffer instanceof ArrayBuffer;
  return whole ? [bytes.buffer as ArrayBuffer] : [];
}

/** Run one job in a fresh Worker from `spawn`. Rejects with
 *  ImportCancelledError on abort, or an ImportWorkerError (`label` names the
 *  job) when the Worker or the job fails. */
export function runImportWorkerJob<T>(spawn: () => Worker, payload: object, transfer: Transferable[], label: string, ctl?: ImportWorkerControl): Promise<T> {
  return new Promise((resolve, reject) => {
    if (ctl?.signal?.aborted) { reject(new ImportCancelledError()); return; }
    let w: Worker;
    try {
      w = spawn();
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    let settled = false;
    let handedOff = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      ctl?.signal?.removeEventListener('abort', onAbort);
      w.terminate();
      reject(err);
    };
    const onAbort = () => fail(new ImportCancelledError());
    w.onmessage = (e: MessageEvent<{ type: string; fraction?: number; message?: string; result?: T }>) => {
      const m = e.data;
      if (settled) return;
      if (m.type === 'ready') {
        try {
          w.postMessage(payload, transfer);
          handedOff = true;
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
        resolve(m.result as T);
        return;
      }
      fail(new ImportWorkerError(m.message ?? `${label} failed`, handedOff));
    };
    w.onerror = (e) => fail(new ImportWorkerError(e.message || `${label} worker error`, handedOff));
    w.onmessageerror = () => fail(new ImportWorkerError(`${label} worker sent an unreadable message`, handedOff));
    ctl?.signal?.addEventListener('abort', onAbort, { once: true });
  });
}
