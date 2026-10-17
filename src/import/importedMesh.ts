// Shared types + active-imports register for files imported as geometry.
//
// An ImportedMesh is a mesh attached to a Version: parsed from an external file
// (STL today; OBJ/3MF/SVG in later phases) or generated in-app (a `relief`
// heightmap built from an image). The sandbox exposes the mesh data to user code
// via `api.imports[i]`, so `Manifold.ofMesh(api.imports[i])` works.
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
  format: 'stl' | 'relief' | 'step';
  /** Mesh data — shape mirrors what `Manifold.ofMesh()` expects. */
  vertProperties: Float32Array;
  triVerts: Uint32Array;
  numVert: number;
  numTri: number;
  numProp: number;
  /** Named parts detected on this mesh (part detection, #1025). Committed by
   *  `acceptParts`; `api.importWithParts(i)` turns them into real labels.
   *  @since schema 1.20 */
  parts?: ImportedMeshParts;
}

/** Detected parts committed on an import. Identity is per *source* triangle
 *  (this mesh's `triVerts` order). An accept with smooth edges stores the
 *  mesh re-meshed along the part boundaries, with parts for the new
 *  triangles (see `source.edgeSmoothing`). */
export interface ImportedMeshParts {
  /** Part name per part index (unique, non-empty). */
  names: string[];
  /** Optional colour per part ('#rrggbb'), applied like `api.label` colours. */
  colors: (string | null)[];
  /** Part index per source triangle, −1 = unassigned. */
  triPart: Int32Array;
  /** How the parts were produced — enough to re-run the detector later
   *  (e.g. to recompute smooth-edge cost fields, or after a detector
   *  improves). Informational; never required to use the parts. */
  source?: {
    detectorId: string;
    params: Record<string, unknown>;
    featureOptions?: Record<string, unknown>;
    seeds?: { label: string; point: [number, number, number] }[];
    /** Edge-smoothing passes the accept cut the mesh along (the stored
     *  mesh is then the refined one); absent/0 = not re-meshed. */
    edgeSmoothing?: number;
  };
}

let active: ImportedMesh[] = [];

export function setActiveImports(next: ImportedMesh[] | undefined | null): void {
  active = Array.isArray(next) ? next : [];
}

export function getActiveImports(): ImportedMesh[] {
  return active;
}


/** Copy an import for posting to an engine Worker: typed arrays are copied so
 *  the main thread keeps ownership, and every field (including detected
 *  `parts`) is carried. Shared by the single engine and the engine pool so
 *  neither path can silently drop a field. */
export function cloneImportForWorker(m: ImportedMesh): ImportedMesh {
  return {
    id: m.id,
    filename: m.filename,
    format: m.format,
    numProp: m.numProp,
    numVert: m.numVert,
    numTri: m.numTri,
    vertProperties: m.vertProperties.slice(),
    triVerts: m.triVerts.slice(),
    ...(m.parts ? { parts: { ...m.parts, triPart: m.parts.triPart.slice() } } : {}),
  };
}
