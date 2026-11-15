// Main-thread client for the HueForge solver. Runs the solve in a dedicated
// Worker (terminated after each solve, or on abort); falls back to solving
// in-process where Workers don't exist.

import { solveHueforge, type HueforgeOptions, type HueforgeResult, type RgbaImage } from './solver';

export function solveHueforgeAsync(image: RgbaImage, options: Partial<HueforgeOptions>, signal?: AbortSignal): Promise<HueforgeResult> {
  if (typeof Worker === 'undefined') return Promise.resolve(solveHueforge(image, options));
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
    const w = new Worker(new URL('./hueforgeWorker.ts', import.meta.url), { type: 'module' });
    const done = () => { w.terminate(); signal?.removeEventListener('abort', onAbort); };
    const onAbort = () => { done(); reject(new DOMException('Aborted', 'AbortError')); };
    signal?.addEventListener('abort', onAbort);
    w.onmessage = (e: MessageEvent<{ ok: true; result: HueforgeResult } | { ok: false; error: string }>) => {
      done();
      if (e.data.ok) resolve(e.data.result); else reject(new Error(e.data.error));
    };
    w.onerror = (e) => { done(); reject(new Error(e.message || 'HueForge worker failed')); };
    // Copy the pixels so the caller's ImageData stays usable.
    const data = new Uint8ClampedArray(image.data);
    w.postMessage({ image: { width: image.width, height: image.height, data }, options }, [data.buffer]);
  });
}
