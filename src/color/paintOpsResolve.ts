// Resolve the `api.paint.*` descriptor subset (slab / box / cylinder / byLabel)
// to triangle sets WITHOUT any browser/editor state — a pure function over the
// mesh, the recorded ops, and the engine's labelMap. This is what lets the
// HEADLESS preview (src/tools/previewModel.ts, via `model:preview`) verify
// paint-in-code colours that previously could only be eyeballed in the browser.
//
// The browser-side resolver (`resolveDescriptorTriangles` in main.ts) handles
// the full RegionDescriptor union — seed floods, brush strokes, subdivision
// remaps — by delegating each spatial kind to the same pure helpers used here
// (slabPaint / boxPaint / cylinderPaint), so the geometry logic itself is not
// duplicated; only the four-way dispatch is. `api.paint.*` can only ever record
// these four kinds (see manifoldJs.ts), which is why this module doesn't need
// adjacency or a subdivision map.
import type { MeshData, MeshResult } from '../geometry/types';
import type { RegionDescriptor } from './regions';
import { findSlabTriangles } from './slabPaint';
import { findShapeTriangles } from './boxPaint';
import { findCylinderTriangles } from './cylinderPaint';

export interface ResolvedPaintOp {
  name: string;
  kind: string;
  /** RGB 0..1, as recorded by `api.paint.*`. */
  color: [number, number, number];
  triangles: Set<number>;
}

/** Resolve one `api.paint.*` descriptor against an un-subdivided engine mesh.
 *  Returns null for descriptor kinds `api.paint.*` never records. */
export function resolvePaintDescriptor(
  descriptor: RegionDescriptor,
  mesh: MeshData,
  labelMap?: Map<string, Set<number>> | null,
): Set<number> | null {
  switch (descriptor.kind) {
    case 'slab': {
      const { normal, offset, thickness } = descriptor;
      return findSlabTriangles(mesh, normal, offset, thickness);
    }
    case 'box': {
      const { center, size, quaternion, shape } = descriptor;
      return findShapeTriangles(mesh, shape ?? 'box', { center, size, quaternion });
    }
    case 'cylinder': {
      const { center, rMin, rMax, zMin, zMax, normalCone, coverageMode, maxTriangleArea, axis } = descriptor;
      return findCylinderTriangles(mesh, center, rMin, rMax, zMin, zMax, normalCone, coverageMode ?? 'centroid', maxTriangleArea, axis ?? 'z');
    }
    case 'byLabel':
      return labelMap?.get(descriptor.label) ?? new Set<number>();
    default:
      return null;
  }
}

/** Resolve every recorded `api.paint.*` op, in declaration order (later ops
 *  composite over earlier ones, matching the browser's model-colour underlay). */
export function resolvePaintOps(
  paintOps: NonNullable<MeshResult['paintOps']>,
  mesh: MeshData,
  labelMap?: Map<string, Set<number>> | null,
): ResolvedPaintOp[] {
  const out: ResolvedPaintOp[] = [];
  for (const op of paintOps) {
    const descriptor = op.descriptor as RegionDescriptor;
    const triangles = resolvePaintDescriptor(descriptor, mesh, labelMap);
    if (triangles === null) continue; // not an api.paint.* kind — shouldn't happen
    out.push({ name: op.name, kind: descriptor.kind, color: op.color, triangles });
  }
  return out;
}
