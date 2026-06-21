// Dedicated Worker for the engrave / emboss SDF carve.
//
// `engraveMesh` sweeps a dense distance-field lattice (often 180³+) and builds a
// BVH for the true signed distance — seconds of synchronous-ish math that used
// to run on the main thread behind cooperative `setTimeout` yields, still able
// to jank the UI on a big carve. The kernel (`engraveSdf` → `sdfModifier`) is
// pure JS (THREE + three-mesh-bvh, no DOM/WebGL), so it runs unchanged here.
//
// The client (`engraveWorkerClient.ts`) posts the base mesh + engrave options
// (everything structured-cloneable — the stamp mask is typed arrays) and gets
// progress messages plus the carved mesh back by zero-copy transfer. The combine
// closure is rebuilt inside `engraveMesh` from the serializable options, so no
// function ever has to cross the Worker boundary.
//
// Cancellation is terminate+respawn (the geometry-Worker idiom the surface
// Worker uses): the sweep is effectively synchronous, so terminating is the only
// true interrupt — the client tears the Worker down on abort.

import type { MeshData } from '../geometry/types';
import { engraveMesh } from './engraveSdf';
import type { EngraveModifierOptions } from './modifiers';

interface EngraveRequest {
  type: 'engrave';
  mesh: MeshData;
  opts: EngraveModifierOptions;
}

/** Buffers backing a mesh, for the transfer list (deduped). */
function meshBuffers(mesh: MeshData): ArrayBuffer[] {
  const out: ArrayBuffer[] = [mesh.vertProperties.buffer as ArrayBuffer, mesh.triVerts.buffer as ArrayBuffer];
  if (mesh.triColors) out.push(mesh.triColors.buffer as ArrayBuffer);
  return [...new Set(out)];
}

self.onmessage = (e: MessageEvent<EngraveRequest>) => {
  const msg = e.data;
  if (msg.type !== 'engrave') return;
  void (async () => {
    try {
      const baked = await engraveMesh(msg.mesh, msg.opts, {
        onProgress: (fraction) => self.postMessage({ type: 'progress', fraction }),
      });
      self.postMessage({ type: 'done', mesh: baked }, { transfer: meshBuffers(baked) });
    } catch (err) {
      self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  })();
};
