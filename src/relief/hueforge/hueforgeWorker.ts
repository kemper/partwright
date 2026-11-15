// HueForge solve Worker — runs the (multi-second) schedule search + height
// assignment off the main thread. One request per Worker lifetime: the client
// spawns a Worker per solve and terminates it after (cancel = terminate).

import { solveHueforge, type HueforgeOptions, type RgbaImage } from './solver';

export interface HueforgeWorkerRequest { image: RgbaImage; options: Partial<HueforgeOptions> }

self.onmessage = (e: MessageEvent<HueforgeWorkerRequest>) => {
  try {
    const r = solveHueforge(e.data.image, e.data.options);
    (self as unknown as Worker).postMessage({ ok: true, result: r }, [r.layerIndex.buffer, r.heightsMm.buffer, r.preview.buffer, r.target.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
