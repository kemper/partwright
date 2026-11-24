// Main-thread client for the layered-print (HueForge-style) solver. Runs the solve in a dedicated
// Worker (terminated after each solve, or on abort); falls back to solving
// in-process where Workers don't exist.

import { solveLayeredPrint, type LayeredPrintOptions, type LayeredPrintResult, type RgbaImage } from './solver';

export function solveLayeredPrintAsync(image: RgbaImage, options: Partial<LayeredPrintOptions>, signal?: AbortSignal): Promise<LayeredPrintResult> {
  if (typeof Worker === 'undefined') return Promise.resolve(solveLayeredPrint(image, options));
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
    const w = new Worker(new URL('./layeredPrintWorker.ts', import.meta.url), { type: 'module' });
    const done = () => { w.terminate(); signal?.removeEventListener('abort', onAbort); };
    const onAbort = () => { done(); reject(new DOMException('Aborted', 'AbortError')); };
    signal?.addEventListener('abort', onAbort);
    w.onmessage = (e: MessageEvent<{ ok: true; result: LayeredPrintResult } | { ok: false; error: string }>) => {
      done();
      if (e.data.ok) resolve(e.data.result); else reject(new Error(e.data.error));
    };
    w.onerror = (e) => { done(); reject(new Error(e.message || 'Layered-print worker failed')); };
    // Copy the pixels so the caller's ImageData stays usable.
    const data = new Uint8ClampedArray(image.data);
    w.postMessage({ image: { width: image.width, height: image.height, data }, options }, [data.buffer]);
  });
}
