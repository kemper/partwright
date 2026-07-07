// Reconstruction Worker — runs the mesh→code transpile and the mesh-distance
// eval off the main thread. Both are pure synchronous math over triangle
// soups (src/reconstruct/*), so the Worker keeps a 200k-triangle slicing pass
// or a 2×4000-sample k-d sweep from freezing the UI. Mirrors the message
// protocol of `surface/engraveWorker.ts`: progress messages while running,
// one `done`/`error` terminal message per request.

import type { SectionCodeOptions } from './sectionCode';
import { buildReconstructionCode } from './sectionCode';
import { meshDistance } from './meshDistance';
import { profileMesh, probeSection, type ProfileOptions } from './profileMesh';
import { voxelDiff, type VoxelDiffOptions } from './voxelDiff';
import { fitInscribedBox, fitInscribedCylinder, type InscribedOptions } from './inscribed';
import type { SliceAxis } from './slice2d';
import { meshBBox } from './meshComponents';

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

interface ProfileMsg {
  type: 'profile';
  triangles: Float32Array;
  opts: Omit<ProfileOptions, 'onProgress'> & { axis?: SliceAxis; at?: number };
}

interface CompareMsg {
  type: 'compare';
  targetTriangles: Float32Array;
  candidateTriangles: Float32Array;
  opts?: VoxelDiffOptions;
}

interface InscribedMsg {
  type: 'inscribed';
  triangles: Float32Array;
  kind: 'box' | 'cylinder';
  opts?: InscribedOptions;
}

type Msg = GenerateMsg | EvaluateMsg | ProfileMsg | CompareMsg | InscribedMsg;

self.onmessage = (e: MessageEvent<Msg>) => {
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
    } else if (msg.type === 'profile') {
      const soup = { triangles: msg.triangles };
      if (msg.opts.axis && msg.opts.at !== undefined) {
        // Targeted single-section measurement (full fits incl. holes).
        const bbox = meshBBox(soup);
        const diag = Math.hypot(
          bbox.max[0] - bbox.min[0],
          bbox.max[1] - bbox.min[1],
          bbox.max[2] - bbox.min[2],
        );
        self.postMessage({ type: 'done', result: probeSection(soup, msg.opts.axis, msg.opts.at, diag / 1500) });
      } else {
        const result = profileMesh(soup, {
          ...msg.opts,
          onProgress: (fraction) => self.postMessage({ type: 'progress', fraction }),
        });
        self.postMessage({ type: 'done', result });
      }
    } else if (msg.type === 'compare') {
      const report = voxelDiff(
        { triangles: msg.targetTriangles },
        { triangles: msg.candidateTriangles },
        msg.opts,
      );
      self.postMessage({ type: 'done', result: report });
    } else if (msg.type === 'inscribed') {
      const soup = { triangles: msg.triangles };
      const result = msg.kind === 'box' ? fitInscribedBox(soup, msg.opts) : fitInscribedCylinder(soup, msg.opts);
      self.postMessage({ type: 'done', result });
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
