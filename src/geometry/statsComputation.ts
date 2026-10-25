// Pure helpers that compute the machine-readable geometry-data payload
// surfaced via window.partwright. Separated from main.ts so the math /
// shape / fields can be tested and edited without touching the editor
// glue. All functions take their inputs as arguments — no closures over
// editor state.

import { sliceMetrics } from './crossSection';
import { getUnits } from './units';
import { edgeStats, aspectRatioOf } from './geometryHeuristics';
import { computeManifoldFacts, type ManifoldFacts } from './manifoldFacts';
import type { MeshData } from './types';

/** Manifold runtime type — the manifold-3d package does not export
 *  precise TS types for the WASM-backed object, so we treat it as an
 *  opaque value with method probes. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Manifold = any;

// simpleHash lives in its own dependency-free leaf (./simpleHash) so Node
// scripts can import it without this module's transitive browser deps;
// re-exported here for the existing browser-side importers.
import { simpleHash } from './simpleHash';
export { simpleHash };

/** Bounding box scanned directly from a MeshData's vertex buffer. Used when no
 *  Manifold is available (e.g. render-only STL imports) so the rest of the
 *  stats pipeline still has a bbox to work with. Also used by the STL import
 *  path to size a scale-aware weld tolerance. */
export function bboxFromMesh(mesh: MeshData): { min: [number, number, number]; max: [number, number, number] } | null {
  if (mesh.numVert === 0) return null;
  const v = mesh.vertProperties;
  const n = mesh.numProp;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < mesh.numVert; i++) {
    const x = v[i * n], y = v[i * n + 1], z = v[i * n + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

/** Triangle count past which the per-run stats skip the three auto-quartile
 *  slices. Slicing is a synchronous main-thread Manifold op; on very dense
 *  meshes it stalls the UI right after the geometry appears. The on-demand
 *  slice tools (sliceAtZ/sliceAtZVisual/inspect) still work when the user or
 *  agent explicitly asks for a section. */
const STATS_SLICE_TRI_BUDGET = 250_000;

/** Geometry-data stats for a mesh. The Manifold-dependent figures (volume,
 *  genus, components, …) come from `facts` when given — computed by the
 *  engine Worker over its live result for a big run — else from `manifold`.
 *  With neither (render-only imports), they degrade to "not manifold". */
export function computeGeometryStats(
  manifold: Manifold | null,
  meshData: MeshData,
  executionTimeMs?: number,
  sourceCode?: string,
  facts?: ManifoldFacts | null,
): Record<string, unknown> {
  const f = facts ?? (manifold ? computeManifoldFacts(manifold) : null);
  // Bounding box: prefer the manifold's own, but fall back to scanning the mesh
  // verts so render-only imports (manifold==null) still get usable bbox/dims/slices.
  const bbox = f?.bbox || bboxFromMesh(meshData);
  const volume = f?.volume ?? 0;
  const surfaceArea = f?.surfaceArea ?? 0;

  const centroid = bbox
    ? [(bbox.min[0] + bbox.max[0]) / 2, (bbox.min[1] + bbox.max[1]) / 2, (bbox.min[2] + bbox.max[2]) / 2]
    : null;

  const dimensions = bbox
    ? [bbox.max[0] - bbox.min[0], bbox.max[1] - bbox.min[1], bbox.max[2] - bbox.min[2]]
    : null;

  const componentCount = f?.componentCount ?? 1;
  const containedComponents = f?.containedComponents ?? 0;
  const componentsInterpenetrate = f?.componentsInterpenetrate ?? false;

  // Render-only imports lack a manifold; surface that fact in stats so the
  // status panel can show "not manifold" instead of a misleading default.
  const isManifold = f ? f.isManifold : false;
  const manifoldStatus: string | null = f ? f.manifoldStatus : 'render-only (not manifold)';

  const quartileSlices: Record<string, { z: number; area: number; contours: number }> = {};
  if (bbox && manifold && meshData.numTri <= STATS_SLICE_TRI_BUDGET) {
    const zRange = bbox.max[2] - bbox.min[2];
    for (const pct of [25, 50, 75]) {
      const z = bbox.min[2] + zRange * (pct / 100);
      const s = sliceMetrics(manifold, z);
      if (s) {
        quartileSlices[`z${pct}`] = { z, area: s.area, contours: s.contours };
      }
    }
  }

  // Cheap mesh-quality signals (mirrors model:preview): shortest/mean edge for
  // sub-extrusion detail, and bbox aspect ratio for sliver/fragility checks.
  const edges = meshData.numTri > 0
    ? edgeStats(meshData.vertProperties, meshData.numProp, meshData.triVerts, meshData.numTri)
    : { min: 0, mean: 0 };
  const aspectRatio = aspectRatioOf(dimensions);

  return {
    status: 'ok' as const,
    vertexCount: meshData.numVert,
    triangleCount: meshData.numTri,
    minEdgeLength: edges.min,
    meanEdgeLength: edges.mean,
    ...(aspectRatio !== null ? { aspectRatio } : {}),
    ...(componentsInterpenetrate ? { componentsInterpenetrate: true } : {}),
    boundingBox: bbox ? {
      x: [bbox.min[0], bbox.max[0]],
      y: [bbox.min[1], bbox.max[1]],
      z: [bbox.min[2], bbox.max[2]],
      dimensions,
    } : null,
    centroid,
    volume,
    surfaceArea,
    genus: f ? f.genus : null,
    isManifold,
    ...(manifoldStatus ? { manifoldStatus } : {}),
    componentCount,
    ...(containedComponents > 0 ? { containedComponents } : {}),
    crossSections: quartileSlices,
    unit: getUnits(),
    executionTimeMs: executionTimeMs ?? null,
    codeHash: sourceCode ? simpleHash(sourceCode) : null,
  };
}

/** Synthesise a printability verdict from existing geometry stats.
 *  A model is printable when it is a single watertight solid (isManifold + one floating component).
 *  Fully-enclosed interior components (containedComponents) are excluded — they are sealed voids
 *  that won't detach in print, matching the logic in geometryWarnings().
 *  Returns a short structured result the AI agent can check without parsing warning strings. */
export function computePrintability(geo: Record<string, unknown>): { printable: boolean; issues: string[] } {
  if (!geo || geo.status !== 'ok') return { printable: false, issues: ['no geometry'] };
  const issues: string[] = [];
  // Render-only imports (e.g. colour reliefs, which keep their per-colour seed
  // ids by skipping Manifold.ofMesh) carry no Manifold to measure, so isManifold
  // is false purely for lack of measurement — not because the mesh was found
  // non-watertight. Claiming "not watertight" here is a false positive (a relief
  // mesh is verified watertight at build time). Treat printability as unverified
  // rather than failed in that case so we don't surface a bogus warning.
  const renderOnly = geo.manifoldStatus === 'render-only (not manifold)';
  if (geo.isManifold === false && !renderOnly) issues.push('non-manifold mesh (not watertight)');
  if (typeof geo.componentCount === 'number' && geo.componentCount > 1) {
    const enclosed = typeof geo.containedComponents === 'number' ? geo.containedComponents : 0;
    const floating = geo.componentCount - enclosed;
    if (floating > 1) issues.push(`${floating} disconnected components`);
  }
  return { printable: issues.length === 0, issues };
}

export function computeStatDiff(prev: Record<string, unknown>, next: Record<string, unknown>): Record<string, unknown> {
  const diff: Record<string, unknown> = {};

  const numericFields = ['volume', 'surfaceArea', 'vertexCount', 'triangleCount', 'genus', 'componentCount'];
  for (const field of numericFields) {
    const from = prev[field] as number;
    const to = next[field] as number;
    if (from !== undefined && to !== undefined) {
      const delta = to - from;
      if (delta === 0) {
        diff[field] = { from, to, delta: 'unchanged' };
      } else {
        const pct = from !== 0 ? ((delta / from) * 100).toFixed(1) : null;
        diff[field] = {
          from, to,
          delta: `${delta > 0 ? '+' : ''}${Math.round(delta)}${pct ? ` (${delta > 0 ? '+' : ''}${pct}%)` : ''}`,
        };
      }
    }
  }

  const prevBB = prev.boundingBox as Record<string, unknown> | null;
  const nextBB = next.boundingBox as Record<string, unknown> | null;
  if (prevBB?.dimensions && nextBB?.dimensions) {
    diff.boundingBox = { dimensions: { from: prevBB.dimensions, to: nextBB.dimensions } };
  }

  return diff;
}

export interface GeometryAssertions {
  minVolume?: number;
  maxVolume?: number;
  isManifold?: boolean;
  maxComponents?: number;
  genus?: number;
  minGenus?: number;
  maxGenus?: number;
  minBounds?: [number, number, number];
  maxBounds?: [number, number, number];
  minTriangles?: number;
  maxTriangles?: number;
  /** Proportion range assertions: { widthToDepth: [min, max], widthToHeight: [min, max], depthToHeight: [min, max] } */
  boundsRatio?: {
    widthToDepth?: [number, number];
    widthToHeight?: [number, number];
    depthToHeight?: [number, number];
  };
  /** Optional notes to attach to this version (design rationale, user feedback, etc.) */
  notes?: string;
}

export function checkAssertions(stats: Record<string, unknown>, assertions: GeometryAssertions): string[] {
  const failures: string[] = [];
  const v = stats.volume as number;
  const tc = stats.triangleCount as number;
  const cc = stats.componentCount as number;
  const g = stats.genus as number | null;
  const im = stats.isManifold as boolean;
  const bb = stats.boundingBox as { dimensions?: number[] } | null;

  if (assertions.minVolume !== undefined && v < assertions.minVolume)
    failures.push(`volume ${v.toFixed(1)} < minVolume ${assertions.minVolume}`);
  if (assertions.maxVolume !== undefined && v > assertions.maxVolume)
    failures.push(`volume ${v.toFixed(1)} > maxVolume ${assertions.maxVolume}`);
  if (assertions.isManifold !== undefined && im !== assertions.isManifold)
    failures.push(`isManifold is ${im}, expected ${assertions.isManifold}`);
  if (assertions.maxComponents !== undefined) {
    const enclosed = (stats.containedComponents as number | undefined) ?? 0;
    const freeFloating = cc - enclosed;
    if (freeFloating > assertions.maxComponents)
      failures.push(
        `componentCount ${cc} > maxComponents ${assertions.maxComponents}` +
        (enclosed > 0 ? ` (${enclosed} fully-enclosed interior component${enclosed > 1 ? 's' : ''} excluded from check)` : ''),
      );
  }
  if (assertions.genus !== undefined && g !== assertions.genus)
    failures.push(`genus ${g} !== expected ${assertions.genus}`);
  if (assertions.minGenus !== undefined && (g === null || g < assertions.minGenus))
    failures.push(`genus ${g} < minGenus ${assertions.minGenus}`);
  if (assertions.maxGenus !== undefined && (g === null || g > assertions.maxGenus))
    failures.push(`genus ${g} > maxGenus ${assertions.maxGenus}`);
  if (assertions.minTriangles !== undefined && tc < assertions.minTriangles)
    failures.push(`triangleCount ${tc} < minTriangles ${assertions.minTriangles}`);
  if (assertions.maxTriangles !== undefined && tc > assertions.maxTriangles)
    failures.push(`triangleCount ${tc} > maxTriangles ${assertions.maxTriangles}`);
  if (assertions.minBounds && bb?.dimensions) {
    const d = bb.dimensions;
    for (let i = 0; i < 3; i++) {
      if (d[i] < assertions.minBounds[i])
        failures.push(`dimension ${['X', 'Y', 'Z'][i]} ${d[i].toFixed(1)} < minBounds ${assertions.minBounds[i]}`);
    }
  }
  if (assertions.maxBounds && bb?.dimensions) {
    const d = bb.dimensions;
    for (let i = 0; i < 3; i++) {
      if (d[i] > assertions.maxBounds[i])
        failures.push(`dimension ${['X', 'Y', 'Z'][i]} ${d[i].toFixed(1)} > maxBounds ${assertions.maxBounds[i]}`);
    }
  }
  if (assertions.boundsRatio && bb?.dimensions) {
    const [w, dep, h] = bb.dimensions;
    const ratios: { name: string; value: number; range?: [number, number] }[] = [
      { name: 'widthToDepth', value: w / dep, range: assertions.boundsRatio.widthToDepth },
      { name: 'widthToHeight', value: w / h, range: assertions.boundsRatio.widthToHeight },
      { name: 'depthToHeight', value: dep / h, range: assertions.boundsRatio.depthToHeight },
    ];
    for (const r of ratios) {
      if (r.range) {
        if (r.value < r.range[0]) failures.push(`${r.name} ratio ${r.value.toFixed(2)} < min ${r.range[0]}`);
        if (r.value > r.range[1]) failures.push(`${r.name} ratio ${r.value.toFixed(2)} > max ${r.range[1]}`);
      }
    }
  }
  return failures;
}
