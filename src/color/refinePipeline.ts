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
  type BrushStroke,
  type RefineRegion,
} from './subdivide';
import { slabRefineRegion } from './slabPaint';
import { shapeRefineRegion } from './boxPaint';
import { cylinderRefineRegion } from './cylinderPaint';

/** True when a descriptor drives mesh subdivision — see the same predicate in
 *  main.ts for the user-facing notion. */
export function descriptorRefines(d: RegionDescriptor): boolean {
  if (d.kind === 'brushStroke') return true;
  if (d.kind === 'slab' || d.kind === 'box' || d.kind === 'cylinder') {
    return !!d.smooth && (d.maxEdge ?? 0) > 0;
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
  // A spray is always geodesic (surface-following, no through-wall).
  const surface = d.spray ? 'geodesic' : (d.surface ?? 'slab');
  const stroke: BrushStroke = {
    samples: d.samples,
    radius: d.radius,
    shape: d.shape,
    maxEdge: d.maxEdge > 0 ? d.maxEdge : d.radius / 256,
    surface,
    depth: d.depth !== undefined && d.depth > 0 ? d.depth : d.radius * 0.5,
    spray: d.spray,
  };
  if (surface === 'geodesic') {
    stroke.geoField = buildGeodesicField(base, d.samples, d.radius);
  } else {
    stroke.sampleNormals = deriveSampleNormals(d.samples, base);
    stroke.sampleTangents = stroke.sampleNormals.map(tangentBasis);
  }
  return stroke;
}

/** Build the ordered refine regions (brush footprints, slab / oriented-shape
 *  boundaries) for a descriptor list. Brush strokes go through
 *  `buildBrushStrokeFromDescriptor`; slabs / shapes call their own region
 *  builders. Descriptors that don't drive subdivision are skipped. */
export function collectRefineRegions(
  descriptors: RegionDescriptor[],
  base: MeshData,
  brushBuilder: (d: Extract<RegionDescriptor, { kind: 'brushStroke' }>) => BrushStroke = (d) => buildBrushStrokeFromDescriptor(d, base),
): RefineRegion[] {
  const regions: RefineRegion[] = [];
  for (const d of descriptors) {
    if (d.kind === 'brushStroke') {
      regions.push(brushRefineRegion(brushBuilder(d)));
    } else if (d.kind === 'slab' && descriptorRefines(d)) {
      regions.push(slabRefineRegion(d.normal, d.offset, d.thickness, d.maxEdge!));
    } else if (d.kind === 'box' && descriptorRefines(d)) {
      regions.push(shapeRefineRegion(d.shape ?? 'box', { center: d.center, size: d.size, quaternion: d.quaternion }, d.maxEdge!));
    } else if (d.kind === 'cylinder' && descriptorRefines(d)) {
      regions.push(cylinderRefineRegion(d.center, d.rMin, d.rMax, d.zMin, d.zMax, d.maxEdge!));
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
): RefinePipelineResult {
  // Build refine regions once, remembering the resolved brush strokes so we
  // can resolve their footprint triangles on the refined mesh below without
  // rebuilding the geodesic field / normals a second time.
  const brushStrokes = new Map<number, BrushStroke>();
  const regions = collectRefineRegions(descriptors, base, (d) => {
    const stroke = buildBrushStrokeFromDescriptor(d, base);
    const idx = descriptors.indexOf(d);
    brushStrokes.set(idx, stroke);
    return stroke;
  });

  if (regions.length === 0) {
    return {
      mesh: input,
      childToParent: identityMap(input.numTri),
      brushStrokeTriangles: new Map(),
    };
  }

  const { mesh, childToParent } = buildRefinedMesh(input, regions);

  const brushStrokeTriangles = new Map<number, Uint32Array>();
  for (const [idx, stroke] of brushStrokes) {
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
