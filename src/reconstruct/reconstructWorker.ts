// Reconstruction Worker — runs the mesh→code transpile and the mesh-distance
// eval off the main thread. Both are pure synchronous math over triangle
// soups (src/reconstruct/*), so the Worker keeps a 200k-triangle slicing pass
// or a 2×4000-sample k-d sweep from freezing the UI. Mirrors the message
// protocol of `surface/engraveWorker.ts`: progress messages while running,
// one `done`/`error` terminal message per request.

import type { SectionCodeOptions } from './sectionCode';
import { buildReconstructionCode } from './sectionCode';
import { meshDistance } from './meshDistance';

interface GenerateMsg {
  type: 'generate';
  triangles: Float32Array;
  opts: Omit<SectionCodeOptions, 'onProgress'>;
}

interface EvaluateMsg {
  type: 'evaluate';
  targetTriangles: Float32Array;
  candidateTriangles: Float32Array;
  samples?: number;
}

self.onmessage = (e: MessageEvent<GenerateMsg | EvaluateMsg>) => {
  const msg = e.data;
  try {
    if (msg.type === 'generate') {
      const result = buildReconstructionCode(
        { triangles: msg.triangles },
        {
          ...msg.opts,
          onProgress: (fraction) => self.postMessage({ type: 'progress', fraction }),
        },
      );
      self.postMessage({ type: 'done', result });
    } else if (msg.type === 'evaluate') {
      const report = meshDistance(
        { triangles: msg.targetTriangles },
        { triangles: msg.candidateTriangles },
        { samples: msg.samples },
      );
      self.postMessage({ type: 'done', result: report });
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
