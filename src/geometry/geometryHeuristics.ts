// Pure, dependency-free geometry heuristics shared by the headless
// model:preview CLI and the in-app stats pipeline. These are cheap numeric
// signals — they substitute for an expensive render, letting an AI agent catch
// a class of defects (sub-extrusion detail, runaway triangle counts, sliver
// proportions, un-fused overlapping parts) from stats alone. Keeping them here
// (no WASM, no browser deps) means both `src/tools/previewModel.ts` and
// `src/geometry/statsComputation.ts` can import them, and the fast vitest tier
// can cover them directly.

import { componentsOverlap } from '../tools/bboxOverlap';

export { componentsOverlap };

/** Shortest and mean triangle-edge length over a mesh. `vertProperties` is the
 *  interleaved vertex buffer with stride `numProp` (xyz are the first three
 *  components); `triVerts` indexes it. Returns rounded mm. */
export function edgeStats(
  vertProperties: Float32Array | number[],
  numProp: number,
  triVerts: Uint32Array | number[],
  numTri: number,
): { min: number; mean: number } {
  let min = Infinity, sum = 0, n = 0;
  const vp = vertProperties;
  const d = (a: number, b: number): number => Math.hypot(
    vp[a * numProp] - vp[b * numProp],
    vp[a * numProp + 1] - vp[b * numProp + 1],
    vp[a * numProp + 2] - vp[b * numProp + 2],
  );
  for (let t = 0; t < numTri; t++) {
    const a = triVerts[t * 3], b = triVerts[t * 3 + 1], c = triVerts[t * 3 + 2];
    for (const e of [d(a, b), d(b, c), d(c, a)]) { if (e < min) min = e; sum += e; n++; }
  }
  return { min: n ? +min.toFixed(4) : 0, mean: n ? +(sum / n).toFixed(4) : 0 };
}

/** Bounding-box aspect ratio: longest dimension ÷ shortest non-zero dimension.
 *  Null when there are no positive dimensions (empty / degenerate). */
export function aspectRatioOf(dimensions: number[] | null | undefined): number | null {
  if (!dimensions || dimensions.length === 0) return null;
  const positive = dimensions.filter((d) => d > 0);
  if (positive.length === 0) return null;
  return +(Math.max(...dimensions) / Math.min(...positive)).toFixed(2);
}

export interface GeometryHeuristicInput {
  triangleCount: number;
  /** From aspectRatioOf(); null when not measurable. */
  aspectRatio: number | null;
  /** Shortest edge length in world units; 0 when not measured. */
  minEdgeLength: number;
  /** componentCount minus fully-enclosed interior voids — the number of
   *  genuinely separate solids. */
  floatingComponentCount: number;
  /** True when two separate components' bounding boxes overlap (a boolean that
   *  didn't fuse, or an assembly to clearance-check). */
  componentsInterpenetrate: boolean;
}

export interface GeometryHeuristicThresholds {
  triCountWarnBudget: number;
  minEdgeLengthWarn: number;
  aspectRatioWarn: number;
}

/** Build the cheap-signal warnings the in-app AI was previously blind to
 *  (model:preview already emitted these). Mirrors the numeric checks in
 *  previewModel.ts's buildWarnings, minus the preview-only label/voxel cases.
 *  Returns actionable strings to append to the geometry `warnings[]`. */
export function buildGeometryHeuristicWarnings(
  input: GeometryHeuristicInput,
  t: GeometryHeuristicThresholds,
): string[] {
  const w: string[] = [];
  if (input.triangleCount > t.triCountWarnBudget) {
    w.push(
      `High triangle count (${Math.round(input.triangleCount / 1000)}k > ~${Math.round(t.triCountWarnBudget / 1000)}k budget) — ` +
      'heavy to slice and over the catalog budget. Lower circular segments (setCircularSegments / $fn / nDivisions) or feature density.',
    );
  }
  if (input.aspectRatio !== null && input.aspectRatio > t.aspectRatioWarn) {
    w.push(
      `Extreme aspect ratio (${input.aspectRatio.toFixed(1)}:1) — tall/thin parts are fragile and tip-prone on an FDM bed. ` +
      'Add a base, thicken the slender axis, or print it lying down.',
    );
  }
  if (input.minEdgeLength > 0 && input.minEdgeLength < t.minEdgeLengthWarn) {
    w.push(
      `Smallest mesh edge is ${input.minEdgeLength}mm (< ${t.minEdgeLengthWarn}mm) — ` +
      'features this fine fall below a typical FDM extrusion width and silently vanish on the print. ' +
      'Thicken the detail or scale the model up.',
    );
  }
  // Only meaningful alongside ≥2 genuinely separate solids; complements (does
  // not duplicate) the "disconnected components" warning by adding the spatial
  // cue that the parts overlap rather than sit apart.
  if (input.floatingComponentCount >= 2 && input.componentsInterpenetrate) {
    w.push(
      `Separate components have overlapping bounding boxes — they interpenetrate rather than sit apart. ` +
      'If this should be ONE solid, a boolean did not fuse (operands must overlap by ≥ 0.5 units, not merely touch); ' +
      'if it is an intentional multi-part / print-in-place assembly, verify the clearance gap (~0.3–0.5 mm).',
    );
  }
  return w;
}
