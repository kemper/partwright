// 3MF parse Worker — runs `parse3MF` (unzip + XML scan + mesh build) off the
// main thread. A multi-million-triangle 3MF expands to hundreds of MB of XML
// and took ~20 s of solid main-thread work, freezing the page (and stacking
// its peak memory on top of whatever model was already open). Also runs the
// quick oriented-edge manifold check (~1 s on a 3.7M-triangle mesh) so the
// main thread can skip it. Protocol: `importWorkerJob.ts`.

import { parse3MF, type ThreeMFParseOptions, type ThreeMFParseResult } from './parsers/threemf';
import { isOrientedEdgeManifold } from './stlProbe';

type ParseMsg = { bytes: Uint8Array; options: Omit<ThreeMFParseOptions, 'onProgress'> };

/** What the Worker sends back. */
export interface ThreeMFWorkerResult {
  result: ThreeMFParseResult;
  /** `isOrientedEdgeManifold(result.mesh)`, computed here. */
  orientedEdgeManifold: boolean;
}

// Nothing to load — ready at once (the client hands the bytes over on this).
self.postMessage({ type: 'ready' });

self.onmessage = async (e: MessageEvent<ParseMsg>) => {
  try {
    const result = await parse3MF(e.data.bytes, {
      ...e.data.options,
      onProgress: (fraction, message) => self.postMessage({ type: 'progress', fraction, message }),
    });
    self.postMessage({ type: 'progress', fraction: 0.97, message: 'Checking mesh…' });
    const done: ThreeMFWorkerResult = { result, orientedEdgeManifold: isOrientedEdgeManifold(result.mesh) };
    const { mesh, triColor } = result;
    self.postMessage({ type: 'done', result: done }, { transfer: [mesh.vertProperties.buffer, mesh.triVerts.buffer, triColor.buffer] });
  } catch (err) {
    self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
