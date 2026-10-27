// Headless part-detection entry for the CLI (`partwright segment`) and the
// detector benchmark (`npm run segment:bench`). Loaded under Vite SSR in Node,
// exactly like previewModel.ts — no browser, no Worker.
//
// The benchmark gets ground truth for free: catalog/example models declare
// their parts with api.label, so running one yields a fused mesh PLUS the
// true part of every triangle. Detectors see only the bare mesh and are
// scored against those labels.

import { getConfig } from '../config/appConfig';
import { manifoldJsEngine } from '../geometry/engines/manifoldJs';
import { preloadTextFonts, sourceUsesManifoldText } from '../geometry/textGlyphs';
import { sourceUsesHuman, preloadHumanAsset } from '../human/humanAsset';
import { parseSTL } from '../import/parsers/stl';
import { computeMeshFeatures, toSegMesh } from '../segmentation/features';
import { SegmentationRunner, type DetectRequest } from '../segmentation/runner';
import type { MeshFeatures, SegMesh } from '../segmentation/types';

// Bench scoring helpers live in a pure module (unit-testable without WASM).
export { jitterMesh, scorePartition, seedsFromTruth } from '../segmentation/scoring';

export interface SegmentOutput {
  summary: ReturnType<SegmentationRunner['detect']>;
  /** Part index per triangle (−1 unassigned). */
  triPart: Int32Array;
  positions: Float32Array;
  triVerts: Uint32Array;
  /** RGB per triangle in the draft's overlay colours. */
  triColors: Uint8Array;
  bbox: { min: number[]; max: number[] };
  ms: { features: number; detect: number };
}

function bboxOf(p: Float32Array): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) for (let d = 0; d < 3; d++) {
    if (p[i + d] < min[d]) min[d] = p[i + d];
    if (p[i + d] > max[d]) max[d] = p[i + d];
  }
  return { min, max };
}

/** Run a detector on a welded mesh. */
export function segmentMesh(mesh: SegMesh, req: Omit<DetectRequest, 'signal' | 'progress'>): SegmentOutput {
  // Same speck pass as the browser (appConfig defaults here: no localStorage).
  const runner = new SegmentationRunner(mesh, { autoAbsorbFrac: getConfig().segmentation.autoAbsorbSpeckFrac });
  const t0 = performance.now();
  runner.features(req.featureOptions);
  const t1 = performance.now();
  const summary = runner.detect(req);
  const t2 = performance.now();
  return {
    summary,
    triPart: runner.draft!.triPart,
    positions: mesh.positions,
    triVerts: mesh.triVerts,
    triColors: runner.draft!.triColors(),
    bbox: bboxOf(mesh.positions),
    ms: { features: Math.round(t1 - t0), detect: Math.round(t2 - t1) },
  };
}

/** Parse STL bytes (binary or ASCII; vertices are welded by the parser). */
export function stlToSegMesh(bytes: Uint8Array): SegMesh {
  const m = parseSTL(bytes);
  if (!m) throw new Error('Not a readable STL file');
  return toSegMesh(m.vertProperties, m.triVerts, m.numProp);
}

export interface LabelledMesh {
  mesh: SegMesh;
  /** True part index per triangle (−1 = unlabelled). */
  truth: Int32Array;
  names: string[];
}

/** Run model code and return its mesh + per-triangle ground-truth labels. */
export async function labelledMeshFromCode(code: string): Promise<LabelledMesh> {
  await manifoldJsEngine.init();
  if (sourceUsesManifoldText(code)) await preloadTextFonts();
  if (sourceUsesHuman(code)) {
    try { await preloadHumanAsset(); } catch { /* api.human reports the missing asset itself */ }
  }
  const r = manifoldJsEngine.run(code, {}) as {
    error?: string;
    mesh?: { vertProperties: Float32Array; triVerts: Uint32Array; numTri: number; numProp: number } | null;
    labelMap?: Map<string, Set<number>>;
  };
  if (r.error || !r.mesh) throw new Error(r.error ?? 'model produced no mesh');
  const names = [...(r.labelMap?.keys() ?? [])];
  const truth = new Int32Array(r.mesh.numTri).fill(-1);
  names.forEach((n, i) => { for (const t of r.labelMap!.get(n)!) truth[t] = i; });
  return { mesh: toSegMesh(r.mesh.vertProperties, r.mesh.triVerts, r.mesh.numProp), truth, names };
}

/** Feature computation exposed for the bench's seed placement. */
export function featuresFor(mesh: SegMesh): MeshFeatures {
  return computeMeshFeatures(mesh);
}
