// Main-thread client for the adjacency Worker (`adjacencyWorker.ts`). One
// lazily-spawned Worker, requests matched by id; the mesh's arrays are copied
// (structured clone) so the caller keeps them. Rejects when the Worker fails,
// so callers can fall back to building on the main thread.

import type { AdjacencyGraph } from './adjacency';
import type { MeshData } from '../geometry/types';

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (g: AdjacencyGraph) => void; reject: (e: Error) => void }>();

function failAll(err: Error): void {
  for (const p of pending.values()) p.reject(err);
  pending.clear();
  worker?.terminate();
  worker = null;
}

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./adjacencyWorker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent<{ id: number; graph?: AdjacencyGraph; error?: string }>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.graph) p.resolve(e.data.graph);
    else p.reject(new Error(e.data.error ?? 'adjacency worker failed'));
  };
  w.onerror = (e) => failAll(new Error(e.message || 'adjacency worker error'));
  w.onmessageerror = () => failAll(new Error('adjacency worker sent an unreadable message'));
  worker = w;
  return w;
}

/** Build `buildAdjacency(mesh)` in the Worker. */
export function buildAdjacencyInWorker(mesh: MeshData): Promise<AdjacencyGraph> {
  return new Promise((resolve, reject) => {
    let w: Worker;
    try { w = getWorker(); } catch (e) { reject(e instanceof Error ? e : new Error(String(e))); return; }
    const id = nextId++;
    pending.set(id, { resolve, reject });
    const { vertProperties, triVerts, numVert, numTri, numProp } = mesh;
    w.postMessage({ id, mesh: { vertProperties, triVerts, numVert, numTri, numProp } });
  });
}
