// Shared types + active-imports register for files imported as geometry.
//
// An ImportedMesh is a mesh parsed from an external file (STL today; OBJ/3MF/SVG
// in later phases) and attached to a Version. The sandbox exposes the mesh data
// to user code via `api.imports[i]`, so `Manifold.ofMesh(api.imports[i])` works.
//
// activeImports is a process-global register that holds the imports for the
// currently-loaded version. sessionManager updates it when versions load/save,
// and the manifold-js engine reads it when building the sandbox `api`.

export interface ImportedMesh {
  /** Stable id within this version's imports. */
  id: string;
  /** Original filename, for display. */
  filename: string;
  /** Source format. */
  format: 'stl';
  /** Mesh data — shape mirrors what `Manifold.ofMesh()` expects. */
  vertProperties: Float32Array;
  triVerts: Uint32Array;
  numVert: number;
  numTri: number;
  numProp: number;
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
