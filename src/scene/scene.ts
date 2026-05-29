// Scene orchestration + critique.
//
// buildScene runs the layout then codegen, returning the SceneGraph and the
// generated manifold-js code (which the caller hands to runAndSave). It is the
// single pure entry point used by main.ts's generateScene.
//
// critiqueMetrics is a pure scoring function: given the SceneGraph plus the
// geometry stats and per-component bounds (which main.ts gathers from the live
// engine after the scene runs), it computes structural metrics an agent can use
// to decide whether to re-roll / lower density / widen scaleRange / fix
// floating or clipping. No WASM/DOM here — main.ts supplies the live numbers.

import type { SceneGraph, SceneSpec, Vec2 } from './types';
import { generateSceneGraph } from './layout';
import { discsOverlap } from './layout';
import { generateSceneCode } from './codegen';

export function buildScene(spec: SceneSpec): { graph: SceneGraph; code: string } {
  const graph = generateSceneGraph(spec);
  const code = generateSceneCode(spec, graph);
  return { graph, code };
}

/** One connected component's bounding box, as returned by partwright.componentBounds(). */
export interface ComponentBound {
  index: number;
  volume: number;
  bbox: {
    min: [number, number, number];
    max: [number, number, number];
    size: [number, number, number];
    center: [number, number, number];
  };
}

export interface CritiqueInput {
  graph: SceneGraph;
  /** Live geometry stats (from getGeometryData) — read for componentCount. */
  geometry: { componentCount?: number } | null;
  /** Per-component bounds (from componentBounds), or null when unavailable. */
  components: ComponentBound[] | null;
}

export interface SceneMetrics {
  instanceCount: number;
  componentCount: number;
  /** Pairs of placed instances whose footprint discs overlap. */
  overlapCount: number;
  /** Population variance of per-instance scale. */
  scaleVariance: number;
  /** Population variance of component Z-extent (height spread). */
  heightVariance: number;
  /** Sum of instance footprint areas / layout bounds area. */
  footprintCoverage: number;
  /** Components whose bbox sits entirely above z≈0 (floating). */
  floatingCount: number;
  /** Components whose bbox dips below z≈0 (clipping into the ground). */
  clippingCount: number;
}

const Z_EPS = 1e-3;

function variance(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const v = values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / values.length;
  return v;
}

export function critiqueMetrics(input: CritiqueInput): SceneMetrics {
  const { graph, geometry, components } = input;
  const instances = graph.instances;

  // Overlap count: re-derive from the placed footprint discs (effective radius
  // = footprintRadius would require the asset; the graph stores position+scale,
  // so we approximate with a per-instance disc whose radius is the scaled
  // footprint encoded indirectly — fall back to a small constant when unknown).
  // We use the layout-independent test: any two instances closer than the sum
  // of their (scale-weighted) unit radii. The graph doesn't carry footprint,
  // so we treat scale as the radius proxy (monotonic), which still flags the
  // crowding the layout's own rejection missed.
  let overlapCount = 0;
  for (let i = 0; i < instances.length; i++) {
    for (let j = i + 1; j < instances.length; j++) {
      const a = instances[i];
      const b = instances[j];
      const ra = a.scale;
      const rb = b.scale;
      if (discsOverlap(a.position as Vec2, ra, b.position as Vec2, rb)) overlapCount++;
    }
  }

  const scales = instances.map(i => i.scale);
  const scaleVariance = variance(scales);

  let heightVariance = 0;
  let floatingCount = 0;
  let clippingCount = 0;
  if (components && components.length > 0) {
    const heights = components.map(c => c.bbox.max[2] - c.bbox.min[2]);
    heightVariance = variance(heights);
    for (const c of components) {
      if (c.bbox.min[2] > Z_EPS) floatingCount++;
      else if (c.bbox.min[2] < -Z_EPS) clippingCount++;
    }
  }

  // Footprint coverage: sum of disc areas (radius = scale proxy) over bounds.
  const { min, max } = graph.stats.bounds;
  const boundsArea = Math.max(1e-9, (max[0] - min[0]) * (max[1] - min[1]));
  let footprintSum = 0;
  for (const inst of instances) {
    const r = inst.scale;
    footprintSum += Math.PI * r * r;
  }
  const footprintCoverage = footprintSum / boundsArea;

  const componentCount = geometry?.componentCount ?? (components ? components.length : instances.length);

  return {
    instanceCount: instances.length,
    componentCount,
    overlapCount,
    scaleVariance,
    heightVariance,
    footprintCoverage,
    floatingCount,
    clippingCount,
  };
}
