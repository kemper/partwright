export interface MeshData {
  vertProperties: Float32Array;
  triVerts: Uint32Array;
  numVert: number;
  numTri: number;
  numProp: number;
  triColors?: Uint8Array; // numTri * 3 (RGB per triangle), optional
  mergeFromVert?: Uint32Array; // vertex merge pairs from manifold-3d (for export dedup)
  mergeToVert?: Uint32Array;
  /** Per-triangle-run provenance from manifold-3d, used to resolve
   *  `api.label(shape, name)` calls back to triangle sets after boolean
   *  ops. `runIndex` has length `numRun + 1`; run `i` covers triangles
   *  in `[runIndex[i]/3, runIndex[i+1]/3)`. `runOriginalID` has length
   *  `numRun` and gives the `originalID()` of the input that produced
   *  each run. Optional because not every engine populates it. */
  runIndex?: Uint32Array;
  runOriginalID?: Uint32Array;
}

export type DiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint';

export interface SourceDiagnostic {
  message: string;
  severity: DiagnosticSeverity;
  source?: string;
  hint?: string;
  from?: number;
  to?: number;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
}

export interface MeshResult {
  mesh: MeshData | null;
  manifold: unknown | null;
  error: string | null;
  diagnostics?: SourceDiagnostic[];
  /** Map from `api.label(shape, name)` calls in the user's code to the
   *  triangle ids in the result mesh that came from that labelled input.
   *  Resolved by walking `mesh.runOriginalID` + `runIndex`. Empty / absent
   *  when no labels were registered. */
  labelMap?: Map<string, Set<number>>;
  /** Names that the user wrote `label("X")` for but didn't survive into
   *  `labelMap`. Typical causes (SCAD): the label sat inside a `{ ... }`
   *  block, so CGAL stripped provenance; a for-loop expanded one source
   *  label into N anonymous AMF objects; the labelled component was rejected
   *  as non-manifold. Surfaced so tools can show a "expected X but
   *  paintByLabel("X") would fail" warning without forcing the caller to
   *  diff the labelMap themselves. Absent / undefined when nothing was lost. */
  lostLabels?: string[];
}

export interface CrossSectionResult {
  polygons: number[][][];
  svg: string;
  boundingBox: { minX: number; minY: number; maxX: number; maxY: number };
  area: number;
}
