// Colour-seed Worker — runs `matchImportColors` off the main thread. Matching
// a big coloured import's triangles to their source colours is seconds of
// synchronous work (a spatial hash over the source plus one lookup per output
// triangle), which froze the page right after the model appeared.
// Protocol: `importWorkerJob.ts`.

import { matchImportColors } from './colorSeed';
import type { CentroidMesh } from '../surface/colorTransfer';

type SeedMsg = { source: CentroidMesh; out: CentroidMesh; triColor: Int32Array };

// Nothing to load — ready at once (the client hands the meshes over on this).
self.postMessage({ type: 'ready' });

self.onmessage = (e: MessageEvent<SeedMsg>) => {
  try {
    const groups = matchImportColors(e.data.source, e.data.out, e.data.triColor);
    self.postMessage({ type: 'done', result: groups }, { transfer: groups.map(g => g.triangleIds.buffer) });
  } catch (err) {
    self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
