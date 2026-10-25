// Shared paint-subdivision pipeline — pure functions used both on the main
// thread and inside the subdivision Web Worker (`subdivisionWorker.ts`).
//
// Everything in here is dependency-free w.r.t. DOM / the regions store / Three
// (Three is pulled in indirectly through `boxPaint`, but only its Vector3 /
// Quaternion math — safe in workers). Anything that touches stateful main-
// thread caches lives in `main.ts` and just wraps these helpers.

import type { MeshData } from '../geometry/types';
import type { RegionDescriptor } from './regions';
import {
  brushRefineRegion,
  buildGeodesicField,
  buildRefinedMesh,
  deriveSampleNormals,
  strokeFootprintTriangles,
  tangentBasis,
  wrapAngleGate,
  type BrushStroke,
  type RefineRegion,
} from './subdivide';
import { slabRefineRegion } from './slabPaint';
import { shapeRefineRegion } from './boxPaint';
import { cylinderRefineRegion } from './cylinderPaint';
import { patternRefineRegion, patternSupportsSmooth, type PatternContext } from './colorPattern';

type PatternDescriptor = Extract<RegionDescriptor, { kind: 'pattern' }>;

/** Supplies a smooth pattern descriptor's context (fitted sphere, scope mask —
 *  resolved against the base mesh, see `PatternContext`). The main thread
 *  computes it from labels/parts; the Worker reads the copy the main thread
 *  sent. Null ⇒ the pattern is skipped (no refinement). */
export type PatternContextProvider = (d: PatternDescriptor, index: number) => PatternContext | null;

/** True when a descriptor drives mesh subdivision: any brush stroke, or a slab /
 *  oriented shape / cylinder / smooth-capable pattern with smoothing enabled
 *  (`smooth` + a positive `maxEdge`). Descriptors saved before smoothing
 *  existed omit those fields and refine nothing, preserving their blocky edges.
 *  The single predicate shared by main.ts and the Worker. */
export function descriptorRefines(d: RegionDescriptor): boolean {
  if (d.kind === 'brushStroke') return true;
  if (d.kind === 'slab' || d.kind === 'box' || d.kind === 'cylinder') {
    return !!d.smooth && (d.maxEdge ?? 0) > 0;
  }
  if (d.kind === 'pattern') {
    return !!d.smooth && (d.maxEdge ?? 0) > 0 && patternSupportsSmooth(d.pattern);
  }
  return false;
}

/** Build a fully-resolved `BrushStroke` from a brushStroke region descriptor.
 *  Pure: depends only on the descriptor + the pristine base mesh, so it produces
 *  the same stroke on the main thread and inside the subdivision worker. The
 *  expensive part — geodesic flood-fill or per-sample base-normal lookup — is
 *  done eagerly here; callers that want to amortise re-runs (e.g. main.ts's
 *  WeakMap cache) wrap this. */
export function buildBrushStrokeFromDescriptor(
  d: Extract<RegionDescriptor, { kind: 'brushStroke' }>,
  base: MeshData,
): BrushStroke {
  // Surface mode is whatever the stroke was painted with (slab by default);
  // old descriptors — and old geodesic-forced sprays — resolve from their
  // stored `surface`, falling back to slab for back-compat.
  const surface = d.surface ?? 'slab';
  const stroke: BrushStroke = {
    samples: d.samples,
    radius: d.radius,
    shape: d.shape,
    maxEdge: d.maxEdge > 0 ? d.maxEdge : d.radius / 256,
    surface,
    depth: d.depth !== undefined && d.depth > 0 ? d.depth : d.radius * 0.5,
    spray: d.spray,
  };
  // Wrap tolerance: gate the surface flood-fill by dihedral angle. Absent ⇒ 180°
  // (no gate) for strokes saved before the slider. A finite gate (< 180°) needs
  // the geodesic reachability field even in slab mode, so it's built alongside
  // the slab prism's per-sample normals there.
  const wrapAngleDeg = d.wrapAngleDeg ?? 180;
  const maxBendCos = wrapAngleGate(wrapAngleDeg);
  if (surface === 'geodesic') {
    stroke.geoField = buildGeodesicField(base, d.samples, d.radius, maxBendCos);
  } else {
    stroke.sampleNormals = deriveSampleNormals(d.samples, base);
    stroke.sampleTangents = stroke.sampleNormals.map(tangentBasis);
    if (wrapAngleDeg < 180) {
      stroke.geoField = buildGeodesicField(base, d.samples, d.radius, maxBendCos);
    }
  }
  return stroke;
}

/** Build the ordered refine regions (brush footprints, slab / oriented-shape /
 *  cylinder boundaries, smooth pattern boundaries) for a descriptor list. Brush
 *  strokes go through `brushBuilder` (default `buildBrushStrokeFromDescriptor`);
 *  patterns need a `patternContext` provider (their scope lives in labels the
 *  Worker can't see). Descriptors that don't drive subdivision are skipped.
 *  The ONE implementation: main.ts and the Worker both call this. */
export function collectRefineRegions(
  descriptors: RegionDescriptor[],
  base: MeshData,
  brushBuilder: (d: Extract<RegionDescriptor, { kind: 'brushStroke' }>) => BrushStroke = (d) => buildBrushStrokeFromDescriptor(d, base),
  patternContext?: PatternContextProvider,
): RefineRegion[] {
  const regions: RefineRegion[] = [];
  for (let i = 0; i < descriptors.length; i++) {
    const d = descriptors[i];
    if (d.kind === 'brushStroke') {
      regions.push(brushRefineRegion(brushBuilder(d)));
    } else if (d.kind === 'slab' && descriptorRefines(d)) {
      regions.push(slabRefineRegion(d.normal, d.offset, d.thickness, d.maxEdge!));
    } else if (d.kind === 'box' && descriptorRefines(d)) {
      regions.push(shapeRefineRegion(d.shape ?? 'box', { center: d.center, size: d.size, quaternion: d.quaternion }, d.maxEdge!));
    } else if (d.kind === 'cylinder' && descriptorRefines(d)) {
      regions.push(cylinderRefineRegion(d.center, d.rMin, d.rMax, d.zMin, d.zMax, d.maxEdge!, d.axis ?? 'z'));
    } else if (d.kind === 'pattern' && descriptorRefines(d) && patternContext) {
      const ctx = patternContext(d, i);
      const region = ctx ? patternRefineRegion(d, ctx, d.maxEdge!) : null;
      if (region) regions.push(region);
    }
  }
  return regions;
}

export interface RefinePipelineResult {
  /** Refined mesh — same identity as `input` when no descriptor refines. */
  mesh: MeshData;
  /** Per-output-triangle, the index of the input-mesh triangle it came from
   *  (identity map when nothing refined). */
  childToParent: Int32Array;
  /** For each brushStroke in `descriptors` (by descriptor-array index), the
   *  refined-mesh triangle ids the stroke's footprint paints. Only brushStroke
   *  entries are populated — main thread resolves the other descriptor kinds
   *  (coplanar / slab / box / etc.) itself since those are cheap and need
   *  the regions store + adjacency it already owns. */
  brushStrokeTriangles: Map<number, Uint32Array>;
}

/** Progress callback for a refine: `done` of `total` steps finished, with a
 *  short human-readable label for the step now running. A step is one refining
 *  descriptor's stroke build, its subdivision pass, or its footprint lookup. */
export type RefineProgress = (done: number, total: number, label: string) => void;

/** Refine `input` under `descriptors` (built against `base` for stroke
 *  resolution) and resolve every brushStroke descriptor's footprint triangles
 *  on the refined mesh.
 *
 *  `base` is the pristine base mesh — used for geodesic / sample-normal
 *  resolution of brush strokes so the result is identical to what a reload
 *  would compute. `input` is the mesh to actually subdivide (the pristine
 *  base on a full rebuild, or the current refined mesh for an incremental
 *  append). On the empty-descriptor path the function is a no-op identity. */
export function refineMeshPipeline(
  base: MeshData,
  input: MeshData,
  descriptors: RegionDescriptor[],
  patternContext?: PatternContextProvider,
  onProgress?: RefineProgress,
): RefinePipelineResult {
  const refining = descriptors.filter(descriptorRefines).length;
  const strokeCount = descriptors.filter(d => d.kind === 'brushStroke').length;
  const total = strokeCount + refining + strokeCount;
  let done = 0;
  // Build refine regions once, remembering the resolved brush strokes so we
  // can resolve their footprint triangles on the refined mesh below without
  // rebuilding the geodesic field / normals a second time.
  const brushStrokes = new Map<number, BrushStroke>();
  const regions = collectRefineRegions(descriptors, base, (d) => {
    onProgress?.(done, total, `Tracing stroke ${brushStrokes.size + 1} of ${strokeCount}`);
    const stroke = buildBrushStrokeFromDescriptor(d, base);
    done++;
    const idx = descriptors.indexOf(d);
    brushStrokes.set(idx, stroke);
    return stroke;
  }, patternContext);

  if (regions.length === 0) {
    return {
      mesh: input,
      childToParent: identityMap(input.numTri),
      brushStrokeTriangles: new Map(),
    };
  }

  const { mesh, childToParent } = buildRefinedMesh(input, regions, onProgress && ((i, n) => {
    onProgress(done + i, total, `Smoothing edge ${i + 1} of ${n}`);
  }));
  done += regions.length;

  const brushStrokeTriangles = new Map<number, Uint32Array>();
  for (const [idx, stroke] of brushStrokes) {
    onProgress?.(done++, total, 'Finding painted triangles');
    const tris = strokeFootprintTriangles(mesh, stroke);
    brushStrokeTriangles.set(idx, Uint32Array.from(tris));
  }

  return { mesh, childToParent, brushStrokeTriangles };
}

function identityMap(n: number): Int32Array {
  const out = new Int32Array(n);
  for (let i = 0; i < n; i++) out[i] = i;
  return out;
}
