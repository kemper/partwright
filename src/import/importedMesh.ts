// Shared types + active-imports register for files imported as geometry.
//
// An ImportedMesh is a mesh parsed from an external file (STL today; OBJ/3MF/SVG
// in later phases) and attached to a Version. The sandbox exposes the mesh data
// to user code via `api.imports[i]`, so `Manifold.ofMesh(api.imports[i])` works.
//
// activeImports is a process-global register that holds the imports for the
// currently-loaded version. sessionManager updates it when versions load/save,
// and the manifold-js engine reads it when building the sandbox `api`.

import type { MeshData } from '../geometry/types';

export interface ImportedMesh {
  /** Stable id within this version's imports. */
  id: string;
  /** Original filename, for display. */
  filename: string;
  /** Source format. `'mesh'` marks geometry baked from another part (merge /
   *  add-to-part) rather than read from a file. */
  format: 'stl' | 'mesh';
  /** Mesh data — shape mirrors what `Manifold.ofMesh()` expects. */
  vertProperties: Float32Array;
  triVerts: Uint32Array;
  numVert: number;
  numTri: number;
  numProp: number;
}

function newMeshId(): string {
  return `mesh_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Convert a rendered {@link MeshData} into an {@link ImportedMesh}, keeping only
 *  the position properties (numProp 3). Used both for file imports (STL meshes
 *  are already 3-prop) and for baking a part's evaluated geometry back into an
 *  importable mesh when combining or merging parts — stripping any extra vertex
 *  properties guarantees a clean `Manifold.ofMesh()` round-trip. */
export function meshDataToImportedMesh(
  mesh: MeshData,
  filename: string,
  format: ImportedMesh['format'] = 'stl',
): ImportedMesh {
  const numVert = mesh.numVert;
  const sp = mesh.numProp;
  const src = mesh.vertProperties;
  let vertProperties: Float32Array;
  if (sp === 3) {
    vertProperties = src.slice(0, numVert * 3);
  } else {
    vertProperties = new Float32Array(numVert * 3);
    for (let i = 0; i < numVert; i++) {
      vertProperties[i * 3] = src[i * sp];
      vertProperties[i * 3 + 1] = src[i * sp + 1];
      vertProperties[i * 3 + 2] = src[i * sp + 2];
    }
  }
  return {
    id: newMeshId(),
    filename,
    format,
    vertProperties,
    triVerts: mesh.triVerts.slice(0, mesh.numTri * 3),
    numVert,
    numTri: mesh.numTri,
    numProp: 3,
  };
}

let active: ImportedMesh[] = [];

export function setActiveImports(next: ImportedMesh[] | undefined | null): void {
  active = Array.isArray(next) ? next : [];
}

export function getActiveImports(): ImportedMesh[] {
  return active;
}

export function clearActiveImports(): void {
  active = [];
}
