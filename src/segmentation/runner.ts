// SegmentationRunner — feature cache + current draft for one mesh.
//
// The single entry point the Worker, the headless CLI and the unit tests
// share: detect → summary, edit → summary, read triPart/triColors. Features
// are cached per resolved FeatureOptions so re-running with new seeds or a
// different detector is cheap.

import { PartDraftModel, type DraftSummary, type PartEditOp } from './draft';
import { computeMeshFeatures, featureOptionsKey, resolveFeatureOptions } from './features';
import { getDetector, resolveParams } from './registry';
import type { FeatureOptions, MeshFeatures, SegMesh, SegSeed } from './types';

export interface DetectRequest {
  algorithm: string;
  params?: Record<string, unknown>;
  featureOptions?: FeatureOptions;
  seeds?: SegSeed[];
  signal?: AbortSignal;
  progress?: (frac: number, msg?: string) => void;
}

export class SegmentationRunner {
  readonly mesh: SegMesh;
  private cache = new Map<string, MeshFeatures>();
  draft: PartDraftModel | null = null;

  constructor(mesh: SegMesh) {
    this.mesh = mesh;
  }

  features(opts: FeatureOptions = {}): MeshFeatures {
    const resolved = resolveFeatureOptions(opts);
    const key = featureOptionsKey(resolved);
    let f = this.cache.get(key);
    if (!f) {
      f = computeMeshFeatures(this.mesh, resolved);
      if (this.cache.size >= 3) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, f);
    }
    return f;
  }

  detect(req: DetectRequest): DraftSummary {
    this.draft = this.build(req);
    return this.draft.summary();
  }

  /** Run a detector WITHOUT replacing the current draft (comparisons). */
  preview(req: DetectRequest): { summary: DraftSummary; triPart: Int32Array } {
    const m = this.build(req);
    return { summary: m.summary(), triPart: m.triPart };
  }

  private build(req: DetectRequest): PartDraftModel {
    const d = getDetector(req.algorithm);
    if (!d) throw new Error(`Unknown detector "${req.algorithm}"`);
    const params = resolveParams(d, req.params);
    const seeds = req.seeds ?? [];
    if (d.seeds === 'required' && seeds.length === 0) {
      throw new Error(`Detector "${d.id}" needs seeds: [{ label, point: [x,y,z] }, …] — one or more per part.`);
    }
    const featureOptions = { ...d.featureOptions, ...req.featureOptions };
    req.progress?.(0, 'Analysing surface…');
    const f = this.features(featureOptions);
    req.progress?.(0.15, 'Detecting parts…');
    const result = d.run(this.mesh, f, {
      params, seeds, signal: req.signal,
      progress: (frac, msg) => req.progress?.(0.15 + 0.85 * frac, msg),
    });
    return new PartDraftModel(this.mesh, f, { detectorId: d.id, params, featureOptions, seeds }, result);
  }

  edit(ops: PartEditOp[]): DraftSummary {
    if (!this.draft) throw new Error('No part draft — call detectParts first.');
    this.draft.edit(ops);
    return this.draft.summary();
  }
}
