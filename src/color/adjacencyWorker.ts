// Adjacency Worker — builds the paint tools' triangle adjacency graph
// (`buildAdjacency`) off the main thread for big meshes, where it takes over a
// second and would freeze the app while it looks idle (paint prepares it right
// after every run) or the moment Paint opens. One request per message; the
// result's typed arrays are transferred back.

import { buildAdjacency } from './adjacency';
import type { MeshData } from '../geometry/types';

self.onmessage = (e: MessageEvent<{ id: number; mesh: Pick<MeshData, 'vertProperties' | 'triVerts' | 'numVert' | 'numTri' | 'numProp'> }>) => {
  const { id, mesh } = e.data;
  try {
    const g = buildAdjacency(mesh as MeshData);
    self.postMessage({ id, graph: g }, { transfer: [g.nbStart.buffer, g.nbFlat.buffer, g.normals.buffer, g.centroids.buffer] });
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
