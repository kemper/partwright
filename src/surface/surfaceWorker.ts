// Dedicated Worker for `api.surface.*` texture computation.
//
// The chain math (subdivision + normal displacement, optionally WebGPU for
// knit) is CPU-heavy — seconds on dense meshes — and used to run on the main
// thread, freezing the UI for the duration. This Worker hosts the same pure
// kernel (`applyChain.ts`); the client (`surfaceOps.ts`) posts the base mesh
// + remaining op chain, receives each completed prefix back for memoization,
// and the final mesh by zero-copy transfer.
//
// Cancellation is terminate+respawn (the geometry-Worker idiom): the math is
// synchronous per-op, so a cooperative abort flag could only be observed at
// op boundaries — terminating is the only true interrupt. The Worker holds
// no state worth preserving besides the cached WebGPU device/pipelines, which
// rebuild on first use after a respawn.

import type { MeshData } from '../geometry/types';
import { applyChainOps, type ChainOp } from './applyChain';

interface ComputeRequest {
  type: 'computeChain';
  callId: number;
  base: MeshData;
  ops: ChainOp[];
}

/** Buffers backing a mesh, for the transfer list. triColors and the other
 *  optional arrays ride along when present. */
function meshBuffers(mesh: MeshData): ArrayBuffer[] {
  const out: ArrayBuffer[] = [mesh.vertProperties.buffer as ArrayBuffer, mesh.triVerts.buffer as ArrayBuffer];
  if (mesh.triColors) out.push(mesh.triColors.buffer as ArrayBuffer);
  if (mesh.runIndex) out.push(mesh.runIndex.buffer as ArrayBuffer);
  if (mesh.runOriginalID) out.push(mesh.runOriginalID.buffer as ArrayBuffer);
  return [...new Set(out)];
}

self.onmessage = (e: MessageEvent<ComputeRequest>) => {
  const msg = e.data;
  if (msg.type !== 'computeChain') return;
  void (async () => {
    try {
      const final = await applyChainOps(msg.base, msg.ops, (index, mesh) => {
        // Intermediate prefixes are structured-clone copies (the Worker still
        // needs the mesh for the next op); only the final result transfers.
        if (index < msg.ops.length - 1) {
          self.postMessage({ type: 'prefix', callId: msg.callId, index, mesh });
        }
      });
      self.postMessage(
        { type: 'done', callId: msg.callId, index: msg.ops.length - 1, mesh: final },
        { transfer: meshBuffers(final) },
      );
    } catch (err) {
      self.postMessage({
        type: 'error',
        callId: msg.callId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  })();
};
