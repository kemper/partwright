// Main-thread client for the 3MF parse Worker (`threemfParseWorker.ts`).

import type { ThreeMFParseOptions } from './parsers/threemf';
import type { ThreeMFWorkerResult } from './threemfParseWorker';
import { runImportWorkerJob, transferableBytes, type ImportWorkerControl } from './importWorkerJob';

/** Parse a 3MF in a Worker. Rejects with ImportCancelledError on abort, or an
 *  Error carrying the parser's message. `transfer: true` hands the bytes'
 *  buffer over (zero-copy — the caller's `bytes` are detached once the Worker
 *  is up); otherwise they're copied and the caller keeps them. A Worker that
 *  never starts leaves `bytes` intact either way. */
export function parse3MFInWorker(
  bytes: Uint8Array,
  options: Omit<ThreeMFParseOptions, 'onProgress'>,
  ctl?: ImportWorkerControl & { transfer?: boolean },
): Promise<ThreeMFWorkerResult> {
  return runImportWorkerJob<ThreeMFWorkerResult>(
    () => new Worker(new URL('./threemfParseWorker.ts', import.meta.url), { type: 'module' }),
    { bytes, options },
    ctl?.transfer ? transferableBytes(bytes) : [],
    '3MF parse',
    ctl,
  );
}
