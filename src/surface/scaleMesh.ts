import type { MeshData } from '../geometry/types';

/** Scale vertex positions in-place by per-axis factors and return the modified mesh. */
export function scaleMesh(mesh: MeshData, sx: number, sy: number, sz: number): MeshData {
  const props = new Float32Array(mesh.vertProperties);
  const np = mesh.numProp;
  for (let i = 0; i < mesh.numVert; i++) {
    props[i * np]     *= sx;
    props[i * np + 1] *= sy;
    props[i * np + 2] *= sz;
  }
  return {
    ...mesh,
    vertProperties: props,
    triVerts: new Uint32Array(mesh.triVerts),
  };
}
