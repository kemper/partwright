// Main-thread client for the colour-seed Worker (`colorSeedWorker.ts`).

import type { ColorSeedGroup } from './colorSeed';
import type { CentroidMesh } from '../surface/colorTransfer';
import { runImportWorkerJob, type ImportWorkerControl } from './importWorkerJob';

/** The fields the match reads, copied so the caller keeps its mesh (both the
 *  import and the live model are still in use on the main thread). */
function copyForWorker(m: CentroidMesh): CentroidMesh {
  return { vertProperties: m.vertProperties.slice(), triVerts: m.triVerts.slice(), numProp: m.numProp, numTri: m.numTri };
}

/** `matchImportColors` in a short-lived Worker. Rejects with
 *  ImportCancelledError when `ctl.signal` aborts, or an ImportWorkerError when
 *  the Worker or the match fails. */
export function matchImportColorsInWorker(source: CentroidMesh, out: CentroidMesh, triColor: Int32Array, ctl?: Pick<ImportWorkerControl, 'signal'>): Promise<ColorSeedGroup[]> {
  const payload = { source: copyForWorker(source), out: copyForWorker(out), triColor: triColor.slice() };
  return runImportWorkerJob<ColorSeedGroup[]>(
    () => new Worker(new URL('./colorSeedWorker.ts', import.meta.url), { type: 'module' }),
    payload,
    [payload.source.vertProperties.buffer, payload.source.triVerts.buffer, payload.out.vertProperties.buffer, payload.out.triVerts.buffer, payload.triColor.buffer],
    'Colour match',
    ctl,
  );
}
