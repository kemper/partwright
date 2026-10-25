// STL probe Worker — runs `probeSTL` (parse + weld-tolerance ladder +
// `Manifold.ofMesh` trials) off the main thread, so importing a
// multi-million-triangle STL never freezes the UI. Loads its own manifold-3d
// instance lazily on the first request. Same message protocol as
// `reconstruct/reconstructWorker.ts`: progress messages while running, one
// `done`/`error` terminal message per request.

import { probeSTL, type ManifoldTrial } from './stlProbe';
import type { MeshData } from '../geometry/types';

interface ProbeMsg {
  type: 'probe';
  bytes: Uint8Array;
  configuredTolerance: number;
}

type ManifoldModule = {
  Manifold: { ofMesh(m: { numProp: number; vertProperties: Float32Array; triVerts: Uint32Array }): { isEmpty(): boolean; delete(): void } };
};

let modPromise: Promise<ManifoldModule> | null = null;

function loadManifold(): Promise<ManifoldModule> {
  modPromise ??= (async () => {
    const Module = await import('manifold-3d');
    const mod = await Module.default();
    mod.setup();
    return mod as unknown as ManifoldModule;
  })();
  return modPromise;
}

function tryManifold(mod: ManifoldModule, mesh: MeshData): ManifoldTrial {
  let m: { isEmpty(): boolean; delete(): void } | null = null;
  try {
    m = mod.Manifold.ofMesh({ numProp: mesh.numProp, vertProperties: mesh.vertProperties, triVerts: mesh.triVerts });
    return m.isEmpty() ? { ok: false, error: 'constructed manifold is empty' } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    try { m?.delete(); } catch { /* already gone */ }
  }
}

self.onmessage = async (e: MessageEvent<ProbeMsg>) => {
  const msg = e.data;
  try {
    const mod = await loadManifold();
    const result = probeSTL(msg.bytes, {
      configuredTolerance: msg.configuredTolerance,
      tryManifold: (mesh) => tryManifold(mod, mesh),
      onProgress: (fraction, message) => self.postMessage({ type: 'progress', fraction, message }),
    });
    const transfer = result ? [result.mesh.vertProperties.buffer, result.mesh.triVerts.buffer] : [];
    self.postMessage({ type: 'done', result }, { transfer });
  } catch (err) {
    self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
