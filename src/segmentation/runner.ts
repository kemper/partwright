// SegmentationRunner — feature cache + current draft for one mesh.
//
// The single entry point the Worker, the headless CLI and the unit tests
// share: detect → summary, edit → summary, read triPart/triColors. Features
// are cached per resolved FeatureOptions so re-running with new seeds or a
// different detector is cheap.

import { DEFAULT_EDGE_SMOOTHING, MAX_EDGE_SMOOTHING, PartDraftModel, type DraftSummary, type PartEditOp } from './draft';
import { computeMeshFeatures, featureOptionsKey, medianEdgeLength, resolveFeatureOptions } from './features';
import { getDetector, resolveParams } from './registry';
import { computeEdgeCut, DEFAULT_PIN_CREASE_DEG, type EdgeCut } from './smoothEdges';
import type { FeatureOptions, MeshFeatures, ParamValues, SavedPartsPayload, SegMesh, SegSeed } from './types';

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
  private featureCache = new Map<string, MeshFeatures>();
  /** Detector scratch cache (DetectorContext.cache), per mesh. */
  private detectorCache: Map<string, unknown> = new BoundedCache(4);
  draft: PartDraftModel | null = null;
  private undoDepth: number;
  private medianEdge = -1;
  private cutCache: { key: string; cut: EdgeCut } | null = null;
  /** Bumped on every draft change (detect / edit / adopt): the cut cache key. */
  private revision = 0;

  /** Edge-smoothing passes a fresh draft starts with (appConfig, threaded
   *  in because the runner lives in a Worker). */
  private defaultEdgeSmoothing: number;

  /** Automatic pins skip regions under this fraction of their part. */
  private anchorMinRegionFrac: number;

  /** Detection folds unpinned regions under this fraction of the surface
   *  into their neighbours (0 = off). */
  private autoAbsorbFrac: number;

  constructor(mesh: SegMesh, opts: { undoDepth?: number; defaultEdgeSmoothing?: number; anchorMinRegionFrac?: number; autoAbsorbFrac?: number } = {}) {
    this.mesh = mesh;
    this.undoDepth = opts.undoDepth ?? 20;
    this.defaultEdgeSmoothing = opts.defaultEdgeSmoothing ?? DEFAULT_EDGE_SMOOTHING;
    this.anchorMinRegionFrac = opts.anchorMinRegionFrac ?? 0.01;
    this.autoAbsorbFrac = opts.autoAbsorbFrac ?? 0;
  }

  features(opts: FeatureOptions = {}): MeshFeatures {
    // Resolve edge-length-relative options against this mesh so the cache
    // key is the actual radius.
    if (this.medianEdge < 0) this.medianEdge = medianEdgeLength(this.mesh);
    const resolved = resolveFeatureOptions(opts, this.medianEdge);
    const key = featureOptionsKey(resolved);
    let f = this.featureCache.get(key);
    if (!f) {
      f = computeMeshFeatures(this.mesh, resolved);
      if (this.featureCache.size >= 3) this.featureCache.delete(this.featureCache.keys().next().value!);
      this.featureCache.set(key, f);
    }
    return f;
  }

  /**
   * Run a detector and make it the draft. With an existing draft the result
   * goes into it as an undoable step: locked parts and triangles outside a
   * focus keep their parts, colours carry over by name, and the
   * edge-smoothing setting stays.
   */
  detect(req: DetectRequest): DraftSummary {
    const { d, params, seeds, featureOptions, f } = this.prepare(req);
    if (this.draft) {
      this.revision++;
      this.draft.detectUndoable(d.id, params, featureOptions, seeds, f, {
        signal: req.signal, progress: (frac, msg) => req.progress?.(0.15 + 0.85 * frac, msg),
      });
      return this.draft.summary();
    }
    this.revision++;
    this.draft = this.newModel(d.id, params, featureOptions, seeds, f, req);
    return this.draft.summary();
  }

  /** Run a detector WITHOUT replacing the current draft (comparisons and the
   *  preset filmstrip). Locks and focus of the current draft are honoured. */
  preview(req: DetectRequest): { summary: DraftSummary; triPart: Int32Array } {
    const { d, params, seeds, featureOptions, f } = this.prepare(req);
    const m = this.draft && this.draft.detectionMask()
      ? this.draft.clone()
      : this.newModel(d.id, params, featureOptions, seeds, f, req);
    if (m !== this.draft && this.draft?.detectionMask()) m.applyDetection(d.id, params, featureOptions, seeds, f);
    return { summary: m.summary(), triPart: m.triPart };
  }

  /** Re-open parts saved on an import as the draft. */
  adopt(saved: SavedPartsPayload): DraftSummary {
    if (saved.triPart.length !== this.mesh.triVerts.length / 3) throw new Error('Saved parts do not match this mesh.');
    const d = getDetector(saved.detectorId ?? '') ?? getDetector('crease-watershed')!;
    let params;
    try { params = resolveParams(d, saved.params); } catch { params = resolveParams(d, {}); }
    const featureOptions = saved.featureOptions ?? {};
    const model = PartDraftModel.fromSaved(this.mesh, this.features(featureOptions), {
      triPart: saved.triPart, names: saved.names, colors: saved.colors, detectorId: d.id, params, featureOptions,
      seeds: saved.seeds ?? [],
    });
    model.cache = this.detectorCache;
    model.undoDepth = this.undoDepth;
    model.anchorMinRegionFrac = this.anchorMinRegionFrac;
    model.autoAbsorbFrac = this.autoAbsorbFrac;
    model.edgeSmoothing = this.defaultEdgeSmoothing;
    if (typeof saved.edgeSmoothing === 'number') model.edgeSmoothing = Math.max(0, Math.min(MAX_EDGE_SMOOTHING, Math.round(saved.edgeSmoothing)));
    this.revision++;
    this.draft = model;
    return model.summary();
  }

  private prepare(req: DetectRequest) {
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
    return { d, params, seeds, featureOptions, f };
  }

  private newModel(detectorId: string, params: ParamValues, featureOptions: FeatureOptions, seeds: SegSeed[], f: MeshFeatures, req: DetectRequest): PartDraftModel {
    const d = getDetector(detectorId)!;
    const result = d.run(this.mesh, f, {
      params, seeds, signal: req.signal, cache: this.detectorCache,
      progress: (frac, msg) => req.progress?.(0.15 + 0.85 * frac, msg),
    });
    // A seedless detector's parts get automatic pins, not the caller's seeds.
    const model = new PartDraftModel(this.mesh, f, { detectorId: d.id, params, featureOptions, seeds: d.seeds === 'none' ? [] : seeds }, result);
    model.undoDepth = this.undoDepth;
    model.anchorMinRegionFrac = this.anchorMinRegionFrac;
    model.autoAbsorbFrac = this.autoAbsorbFrac;
    model.edgeSmoothing = this.defaultEdgeSmoothing;
    model.cache = this.detectorCache;
    model.absorbSpecksNow();
    return model;
  }

  /** Smooth (sub-triangle) part edges for the current draft at its
   *  edge-smoothing setting; null when smoothing is off. Boundaries on
   *  creases at least `pinCreaseDeg` sharp stay put. Cached per draft
   *  revision so the overlay and accept share one computation. */
  cut(iterations?: number, pinCreaseDeg = DEFAULT_PIN_CREASE_DEG): EdgeCut | null {
    if (!this.draft) throw new Error('No part draft — call detectParts first.');
    const it = iterations ?? this.draft.edgeSmoothing;
    if (it <= 0) return null;
    const key = `${it}:${pinCreaseDeg}:${this.revision}`;
    if (this.cutCache?.key !== key) {
      this.cutCache = { key, cut: computeEdgeCut(this.mesh, this.draft.triPart, it, { adjacency: this.draft.features, pinCreaseDeg }) };
    }
    return this.cutCache.cut;
  }

  edit(ops: PartEditOp[], stroke?: string): DraftSummary {
    if (!this.draft) throw new Error('No part draft — call detectParts first.');
    this.revision++;
    this.draft.edit(ops, stroke);
    return this.draft.summary();
  }
}

/** Map that evicts its oldest entry beyond `max` entries. */
class BoundedCache<K, V> extends Map<K, V> {
  private max: number;
  constructor(max: number) { super(); this.max = max; }
  override set(key: K, value: V): this {
    if (!this.has(key) && this.size >= this.max) this.delete(this.keys().next().value as K);
    return super.set(key, value);
  }
}
