// Part detection — main-thread controller shared by the Part Detection panel
// and the window.partwright / AI surfaces (UI↔API parity by construction:
// both call the same methods).
//
// Lifecycle: detect → (edit …) → accept | discard. Detection never mutates
// the session; acceptParts commits the parts on the import (schema 1.20
// `ImportedMesh.parts`) and rewrites the import code to
// `api.importWithParts(i)`, which turns them into real labels.
//
// Detection always runs on the IMPORT's own mesh (source-triangle order), so
// part identity is stable and persistable. The viewport shows a different
// triangle order (manifold re-sorts on ofMesh, paint may refine), so the
// overlay maps displayed triangles back to source triangles by nearest
// centroid.

import { getConfig } from '../config/appConfig';
import type { MeshData } from '../geometry/types';
import { rewriteImportsWithParts } from '../import/codegen';
import { normalizeImportParts } from '../import/importParts';
import type { ImportedMesh, ImportedMeshParts } from '../import/importedMesh';
import { nearestTriangleMap } from '../surface/colorTransfer';
import {
  ValidationError, assertArray, assertBoolean, assertEnum, assertNumber, assertNumberTuple,
  assertObject, assertNoUnknownKeys, assertString,
} from '../validation/apiValidation';
import { hexToRgb, UNASSIGNED_COLOR, type DraftSummary, type PartEditOp } from './draft';
import { medianEdgeLength, toSegMesh } from './features';
import { AbortedError } from './growth';
import { DEFAULT_PARTS_VIEWS, PARTS_RENDER_VIEWS, renderNumberedParts } from './partsRender';
import { autoProposeDetectors, describeDetector, detectorIds, getDetector, listDetectors, resolveParams } from './registry';
import {
  detectPartsAsync, discardPartsDraft, editPartsAsync, previewPartsAsync, type SegCallControl,
} from './segmentationClient';
import type { FeatureOptions, SegMesh, SegSeed } from './types';

export interface PartDetectionHost {
  getImports(): ImportedMesh[];
  /** The mesh currently shown in the viewport (null when nothing rendered). */
  getDisplayedMesh(): MeshData | null;
  showOverlay(mesh: MeshData, triColors: Uint8Array): void;
  clearOverlay(): void;
  getCode(): string;
  getLanguage(): string;
  /** Set active imports + code, run, and save a version. */
  commit(code: string, imports: ImportedMesh[], label: string): Promise<Record<string, unknown>>;
}

export type PartDetectionEvent = 'draft' | 'busy';

const EDIT_OPS = [
  'merge', 'rename', 'setColor', 'delete', 'reassign', 'split', 'absorbSmall', 'smoothBoundaries',
  'addSeed', 'removeSeed', 'rerun', 'undo',
] as const;

interface DraftState {
  importIndex: number;
  meshKey: string;
  summary: DraftSummary;
  triPart: Int32Array;
}

export function importMeshKey(m: ImportedMesh): string {
  const vp = m.vertProperties;
  return `${m.id}:${m.numTri}:${m.numVert}:${vp[0]}:${vp[vp.length - 1]}`;
}

function err(e: unknown): { error: string } {
  return { error: e instanceof Error ? e.message : String(e) };
}

export function createPartDetection(host: PartDetectionHost) {
  let draft: DraftState | null = null;
  let busy: { message: string; fraction: number; cancellable: boolean } | null = null;
  /** Controllers of in-flight cancellable calls (detect / compare). */
  const active = new Set<AbortController>();
  let pending = 0;
  let overlayVisible = true;
  const listeners = new Set<(ev: PartDetectionEvent) => void>();
  const emit = (ev: PartDetectionEvent) => listeners.forEach((fn) => { try { fn(ev); } catch { /* listener must not break detection */ } });
  // Displayed-triangle → source-triangle map, per displayed mesh object.
  let mapCache: { key: string; mesh: MeshData; map: Int32Array } | null = null;

  function importAt(index: number): ImportedMesh {
    const imports = host.getImports();
    const m = imports[index];
    if (!m) {
      throw new ValidationError(imports.length === 0
        ? 'No imported mesh in this version — import an STL first (part detection works on imports).'
        : `importIndex ${index} out of range (0–${imports.length - 1})`);
    }
    return m;
  }

  function segMeshOf(m: ImportedMesh): SegMesh {
    return toSegMesh(m.vertProperties, m.triVerts, m.numProp);
  }

  function currentDraft(): DraftState {
    if (!draft) throw new ValidationError('No part draft — call detectParts first.');
    const m = host.getImports()[draft.importIndex];
    if (!m || importMeshKey(m) !== draft.meshKey) {
      clearDraftState();
      throw new ValidationError('The imported mesh changed since detection — run detectParts again.');
    }
    return draft;
  }

  function clearDraftState(): void {
    draft = null;
    host.clearOverlay();
    emit('draft');
  }

  function sourceMap(m: ImportedMesh, displayed: MeshData): Int32Array {
    const key = importMeshKey(m);
    if (mapCache && mapCache.key === key && mapCache.mesh === displayed) return mapCache.map;
    const src: MeshData = { vertProperties: m.vertProperties, triVerts: m.triVerts, numVert: m.numVert, numTri: m.numTri, numProp: m.numProp };
    const map = nearestTriangleMap(src, displayed);
    // Displayed triangles far from every import triangle (geometry the code
    // added beyond the import) map to nothing rather than a random part.
    const floor = 2 * medianEdgeLength(segMeshOf(m)) || 1e-6;
    // Per matched source triangle: a big flat CAD triangle (or a paint-refined
    // child far from its parent's centroid) is still a match.
    const reach = (mesh: MeshData, t: number, c: number[]) => {
      let r = 0;
      for (let k = 0; k < 3; k++) {
        const v = mesh.triVerts[t * 3 + k] * mesh.numProp;
        r = Math.max(r, Math.hypot(mesh.vertProperties[v] - c[0], mesh.vertProperties[v + 1] - c[1], mesh.vertProperties[v + 2] - c[2]));
      }
      return r;
    };
    const c = (mesh: MeshData, t: number, out: number[]) => {
      out[0] = out[1] = out[2] = 0;
      for (let k = 0; k < 3; k++) {
        const v = mesh.triVerts[t * 3 + k] * mesh.numProp;
        out[0] += mesh.vertProperties[v] / 3; out[1] += mesh.vertProperties[v + 1] / 3; out[2] += mesh.vertProperties[v + 2] / 3;
      }
    };
    const a = [0, 0, 0], b = [0, 0, 0];
    for (let t = 0; t < map.length; t++) {
      if (map[t] < 0) continue;
      c(displayed, t, a); c(src, map[t], b);
      if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > Math.max(floor, 1.5 * reach(src, map[t], b))) map[t] = -1;
    }
    mapCache = { key, mesh: displayed, map };
    return map;
  }

  /** Part index per displayed triangle + overlay colours for the displayed mesh. */
  function displayedPartsAndColors(d: DraftState): { mesh: MeshData; triPart: Int32Array; triColors: Uint8Array } | null {
    const displayed = host.getDisplayedMesh();
    if (!displayed) return null;
    const m = host.getImports()[d.importIndex];
    if (!m) return null;
    const map = sourceMap(m, displayed);
    const rgb = d.summary.parts.map((p) => hexToRgb(p.displayColor));
    const un = hexToRgb(UNASSIGNED_COLOR);
    const triPart = new Int32Array(displayed.numTri);
    const triColors = new Uint8Array(displayed.numTri * 3);
    for (let t = 0; t < displayed.numTri; t++) {
      const s = map[t];
      const L = s >= 0 ? d.triPart[s] : -1;
      triPart[t] = L;
      const c = L >= 0 ? rgb[L] : un;
      triColors[t * 3] = c[0]; triColors[t * 3 + 1] = c[1]; triColors[t * 3 + 2] = c[2];
    }
    return { mesh: displayed, triPart, triColors };
  }

  function refreshOverlay(): void {
    if (draft) {
      // A version/session switch can put a different mesh at the same import
      // index — the draft's triangle ids no longer mean anything there.
      const m = host.getImports()[draft.importIndex];
      if (!m || importMeshKey(m) !== draft.meshKey) { clearDraftState(); return; }
    }
    if (!draft || !overlayVisible) { host.clearOverlay(); return; }
    const d = displayedPartsAndColors(draft);
    if (d) host.showOverlay(d.mesh, d.triColors);
  }

  /** Run a Worker call with the busy indicator. Cancellable calls (detect,
   *  compare) get their own AbortController; edits are not cancellable —
   *  aborting one would tear down the Worker mid-edit and orphan the draft. */
  async function withBusy<T>(message: string, cancellable: boolean, fn: (ctl: SegCallControl) => Promise<T>): Promise<T> {
    const ctl = cancellable ? new AbortController() : null;
    if (ctl) active.add(ctl);
    pending++;
    busy = { message, fraction: 0, cancellable };
    emit('busy');
    try {
      return await fn({
        signal: ctl?.signal,
        onProgress: (fraction, msg) => { busy = { message: msg ?? message, fraction, cancellable }; emit('busy'); },
      });
    } finally {
      if (ctl) active.delete(ctl);
      if (--pending === 0) busy = null;
      emit('busy');
    }
  }

  function compact(summary: DraftSummary) {
    const MAX_LISTED_PARTS = getConfig().segmentation.maxListedParts;
    const parts = summary.parts.slice(0, MAX_LISTED_PARTS).map((p) => ({
      id: p.id, name: p.name, color: p.color, displayColor: p.displayColor, triCount: p.triCount,
      areaFrac: p.areaFrac, regions: p.regions, neighbors: p.neighbors, anchor: p.anchor, bbox: p.bbox,
    }));
    return {
      detector: summary.detectorId,
      params: summary.params,
      featureOptions: summary.featureOptions,
      seedCount: summary.seeds.length,
      seeds: summary.seeds,
      parts,
      ...(summary.parts.length > MAX_LISTED_PARTS ? { partsTruncated: summary.parts.length - MAX_LISTED_PARTS } : {}),
      unassigned: summary.unassigned,
      quality: summary.quality,
      ...(summary.diagnostics ? { diagnostics: summary.diagnostics } : {}),
      canUndo: summary.canUndo,
    };
  }

  // ------------------------------------------------------------ validation

  function parseSeeds(raw: unknown, where: string): SegSeed[] | undefined {
    if (raw === undefined) return undefined;
    return assertArray(raw, where).map((s, i) => {
      const o = assertObject(s, `${where}[${i}]`)!;
      assertNoUnknownKeys(o, ['label', 'point', 'triangle'], `${where}[${i}]`);
      const label = assertString(o.label, `${where}[${i}].label`)!;
      const point = assertNumberTuple(o.point, 3, `${where}[${i}].point`) as [number, number, number];
      const triangle = assertNumber(o.triangle, `${where}[${i}].triangle`, { optional: true, integer: true, min: 0 });
      return triangle === undefined ? { label, point } : { label, point, triangle };
    });
  }

  function parseFeatureOptions(raw: unknown): FeatureOptions | undefined {
    if (raw === undefined) return undefined;
    const o = assertObject(raw, 'featureOptions')!;
    assertNoUnknownKeys(o, ['normalSmoothRadius'], 'featureOptions');
    const r = assertNumber(o.normalSmoothRadius, 'featureOptions.normalSmoothRadius', { optional: true, min: 0 });
    return r === undefined ? {} : { normalSmoothRadius: r };
  }

  function parseRef(v: unknown, where: string): number | string {
    if (typeof v === 'number' && Number.isInteger(v)) return v;
    if (typeof v === 'string' && v.trim()) return v;
    throw new ValidationError(`${where} must be a 1-based part id or a part name`);
  }

  function parseSeed(v: unknown, where: string): SegSeed {
    return parseSeeds([v], where)![0];
  }

  /** Strict per-op validation: known keys only, typed fields. */
  function parseEditOp(raw: unknown, where: string): PartEditOp {
    const x = assertObject(raw, where)!;
    const op = assertEnum(x.op, EDIT_OPS, `${where}.op`);
    const keys = (...k: string[]) => assertNoUnknownKeys(x, ['op', ...k], where);
    switch (op) {
      case 'merge': {
        keys('ids', 'name');
        const ids = assertArray(x.ids, `${where}.ids`).map((r, j) => parseRef(r, `${where}.ids[${j}]`));
        const name = assertString(x.name, `${where}.name`, { optional: true });
        return name === undefined ? { op, ids } : { op, ids, name };
      }
      case 'rename':
        keys('id', 'name');
        return { op, id: parseRef(x.id, `${where}.id`), name: assertString(x.name, `${where}.name`)! };
      case 'setColor':
        keys('id', 'color');
        return { op, id: parseRef(x.id, `${where}.id`), color: x.color === null ? null : assertString(x.color, `${where}.color`)! };
      case 'delete':
        keys('id');
        return { op, id: parseRef(x.id, `${where}.id`) };
      case 'reassign': {
        keys('point', 'to', 'radius');
        const radius = assertNumber(x.radius, `${where}.radius`, { optional: true, min: 0 });
        const base = { op, point: assertNumberTuple(x.point, 3, `${where}.point`) as [number, number, number], to: parseRef(x.to, `${where}.to`) };
        return radius === undefined ? base : { ...base, radius };
      }
      case 'split':
        keys('id', 'seeds');
        return { op, id: parseRef(x.id, `${where}.id`), seeds: parseSeeds(x.seeds, `${where}.seeds`) ?? [] };
      case 'absorbSmall':
        keys('minAreaFrac');
        return { op, minAreaFrac: assertNumber(x.minAreaFrac, `${where}.minAreaFrac`, { min: 0, max: 0.999 })! };
      case 'smoothBoundaries': {
        keys('iterations');
        const iterations = assertNumber(x.iterations, `${where}.iterations`, { optional: true, integer: true, min: 1, max: 50 });
        return iterations === undefined ? { op } : { op, iterations };
      }
      case 'addSeed': {
        keys('seed', 'rerun');
        const rerun = assertBoolean(x.rerun, `${where}.rerun`, { optional: true });
        const seed = parseSeed(x.seed, `${where}.seed`);
        return rerun === undefined ? { op, seed } : { op, seed, rerun };
      }
      case 'removeSeed': {
        keys('index', 'rerun');
        const rerun = assertBoolean(x.rerun, `${where}.rerun`, { optional: true });
        const index = assertNumber(x.index, `${where}.index`, { integer: true, min: 0 })!;
        return rerun === undefined ? { op, index } : { op, index, rerun };
      }
      case 'rerun':
      case 'undo':
        keys();
        return { op };
    }
  }

  function parseDetect(opts: unknown) {
    const o = assertObject(opts, 'detectParts(options)')!;
    assertNoUnknownKeys(o, ['algorithm', 'params', 'featureOptions', 'seeds', 'importIndex'], 'detectParts(options)');
    const algorithm = assertEnum(o.algorithm, detectorIds(), 'detectParts(options).algorithm');
    const params = o.params === undefined ? undefined : assertObject(o.params, 'detectParts(options).params')!;
    // Validate params eagerly so a typo errors here, not in the Worker.
    try { resolveParams(getDetector(algorithm)!, params); } catch (e) { throw new ValidationError((e as Error).message); }
    const importIndex = assertNumber(o.importIndex, 'detectParts(options).importIndex', { optional: true, integer: true, min: 0 }) ?? 0;
    return {
      algorithm, params, importIndex,
      featureOptions: parseFeatureOptions(o.featureOptions),
      seeds: parseSeeds(o.seeds, 'detectParts(options).seeds'),
    };
  }

  // -------------------------------------------------------------------- API

  const api = {
    subscribe(fn: (ev: PartDetectionEvent) => void): () => void {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    isBusy() { return busy; },
    hasDraft() { return draft !== null; },
    /** Cancel an in-flight detection (terminates the Worker; the draft is lost). */
    cancel(): void {
      if (active.size === 0) return;
      for (const c of active) c.abort();
      // The Worker is torn down by the abort, taking its draft with it.
      clearDraftState();
    },
    isOverlayVisible() { return overlayVisible; },

    listPartDetectors() {
      return {
        detectors: listDetectors().map(describeDetector),
        featureOptions: {
          normalSmoothRadius: 'World-unit radius for denoising normals before measuring creases. Omit/0 = raw (default, best on the benchmark); ~3× the median edge length can help very noisy scans.',
        },
        editOps: [...EDIT_OPS],
      };
    },

    async detectParts(opts: unknown) {
      try {
        const o = parseDetect(opts);
        const m = importAt(o.importIndex);
        const meshKey = importMeshKey(m);
        const r = await withBusy('Detecting parts…', true, (ctl) => detectPartsAsync(meshKey, () => segMeshOf(m), {
          algorithm: o.algorithm, params: o.params, featureOptions: o.featureOptions, seeds: o.seeds,
        }, ctl));
        draft = { importIndex: o.importIndex, meshKey, summary: r.summary!, triPart: r.triPart! };
        refreshOverlay();
        // refreshOverlay drops a draft whose import changed meanwhile.
        if (!draft) return { error: 'The imported mesh changed during part detection — run it again.' };
        emit('draft');
        return compact(draft.summary);
      } catch (e) {
        if (e instanceof AbortedError) return { error: 'Part detection cancelled.' };
        return err(e);
      }
    },

    /** Unattended proposal (import-time auto-detect, the autoDetectParts
     *  console/AI method): try every detector that opted into `autoPropose`,
     *  cheapest first. The trials are previews, so a run that proposes
     *  nothing leaves any existing draft alone; the first result with 2 to
     *  `segmentation.autoDetectMaxParts` parts is re-run as the draft (it
     *  replaces the current one; features are cached, so that is cheap). A
     *  mesh none of them can split (one fused solid, until a seedless
     *  detector for fused shells registers) says to use a seeded detector. */
    async autoDetectParts(opts?: unknown) {
      try {
        const o = opts === undefined ? {} : assertObject(opts, 'autoDetectParts(options)')!;
        assertNoUnknownKeys(o, ['importIndex'], 'autoDetectParts(options)');
        const importIndex = assertNumber(o.importIndex, 'autoDetectParts(options).importIndex', { optional: true, integer: true, min: 0 }) ?? 0;
        const m = importAt(importIndex);
        const meshKey = importMeshKey(m);
        const maxParts = getConfig().segmentation.autoDetectMaxParts;
        // The Worker holds one mesh: previewing another import drops a draft
        // on a different one there, so drop it here too (as compare does).
        if (draft && draft.meshKey !== meshKey) clearDraftState();
        const tried: { detector: string; partCount: number }[] = [];
        let tooMany: { detector: string; partCount: number } | null = null;
        for (const d of autoProposeDetectors()) {
          const p = await withBusy(`Detecting parts (${d.name})…`, true, (ctl) => previewPartsAsync(meshKey, () => segMeshOf(m), { algorithm: d.id }, ctl));
          const partCount = p.summary!.parts.length;
          tried.push({ detector: d.id, partCount });
          if (partCount < 2) continue;
          if (partCount > maxParts) { tooMany ??= { detector: d.id, partCount }; continue; }
          const r = await withBusy(`Detecting parts (${d.name})…`, true, (ctl) => detectPartsAsync(meshKey, () => segMeshOf(m), { algorithm: d.id }, ctl));
          draft = { importIndex, meshKey, summary: r.summary!, triPart: r.triPart! };
          refreshOverlay();
          // refreshOverlay drops a draft whose import changed meanwhile.
          if (!draft) return { error: 'The imported mesh changed during part detection — run it again.' };
          emit('draft');
          return { proposed: true, proposedBy: d.id, tried, ...compact(draft.summary) };
        }
        return {
          proposed: false,
          tried,
          reason: tried.length === 0
            ? 'No automatic detector is registered.'
            : tooMany
              ? `"${tooMany.detector}" found ${tooMany.partCount} parts, more than segmentation.autoDetectMaxParts (${maxParts}), so nothing was proposed (likely an assembly or loose debris). Run detectParts({algorithm: "${tooMany.detector}"}) to use them anyway.`
              : 'The mesh is one solid piece, so automatic detection found nothing to split. Place named seeds and use a seeded detector, e.g. detectParts({algorithm: "crease-watershed", seeds: [{label, point}]}).',
        };
      } catch (e) {
        if (e instanceof AbortedError) return { error: 'Part detection cancelled.' };
        return err(e);
      }
    },

    getPartDraft() {
      if (!draft) return { draft: null };
      return compact(draft.summary);
    },

    async editParts(opts: unknown) {
      try {
        const o = assertObject(opts, 'editParts(options)')!;
        assertNoUnknownKeys(o, ['ops'], 'editParts(options)');
        const ops = assertArray(o.ops, 'editParts(options).ops').map((op, i) => parseEditOp(op, `ops[${i}]`));
        if (ops.length === 0) throw new ValidationError('editParts(options).ops must contain at least one op');
        const d = currentDraft();
        const r = await withBusy('Updating parts…', false, () => editPartsAsync(d.meshKey, ops));
        draft = { ...d, summary: r.summary!, triPart: r.triPart! };
        refreshOverlay();
        emit('draft');
        return compact(draft.summary);
      } catch (e) {
        return err(e);
      }
    },

    renderParts(opts?: unknown) {
      try {
        const o = opts === undefined ? {} : assertObject(opts, 'renderParts(options)')!;
        assertNoUnknownKeys(o, ['views', 'size', 'numbered'], 'renderParts(options)');
        const views = o.views === undefined ? DEFAULT_PARTS_VIEWS
          : assertArray(o.views, 'renderParts(options).views').map((v, i) => assertEnum(v, Object.keys(PARTS_RENDER_VIEWS), `views[${i}]`));
        if (views.length === 0 || views.length > 8) throw new ValidationError('renderParts(options).views: 1–8 views');
        const size = assertNumber(o.size, 'renderParts(options).size', { optional: true, integer: true, min: 128, max: 1600 }) ?? 480;
        const numbered = assertBoolean(o.numbered, 'renderParts(options).numbered', { optional: true }) ?? true;
        const d = currentDraft();
        const shown = displayedPartsAndColors(d);
        if (!shown) throw new ValidationError('Nothing is rendered — run the model first.');
        const legend = d.summary.parts.map((p) => ({ id: p.id, name: p.name, color: p.displayColor }));
        const r = renderNumberedParts(shown.mesh, shown.triColors, shown.triPart, legend, { views, size, numbered });
        const hidden = d.summary.parts.filter((p) => !r.visibleIn[p.id]).map((p) => p.id);
        return {
          image: r.dataUrl,
          legend: d.summary.parts.map((p) => ({ id: p.id, name: p.name, color: p.displayColor, visibleIn: r.visibleIn[p.id] ?? [] })),
          ...(hidden.length ? { hiddenParts: hidden } : {}),
        };
      } catch (e) {
        return err(e);
      }
    },

    async comparePartDetectors(configs: unknown, opts?: unknown) {
      try {
        const list = assertArray(configs, 'comparePartDetectors(configs)');
        if (list.length < 1 || list.length > 6) throw new ValidationError('comparePartDetectors(configs): 1–6 configurations');
        const o = opts === undefined ? {} : assertObject(opts, 'comparePartDetectors(options)')!;
        assertNoUnknownKeys(o, ['view', 'size'], 'comparePartDetectors(options)');
        const view = o.view === undefined ? 'front' : assertEnum(o.view, Object.keys(PARTS_RENDER_VIEWS), 'comparePartDetectors(options).view');
        const size = assertNumber(o.size, 'comparePartDetectors(options).size', { optional: true, integer: true, min: 128, max: 800 }) ?? 360;
        const parsed = list.map((c) => parseDetect(c));
        // The Worker holds one mesh: previewing a different import reloads it
        // and drops the draft there, so drop it here too rather than strand it.
        let draftDiscarded = false;
        if (draft && parsed.some((c) => importMeshKey(importAt(c.importIndex)) !== draft!.meshKey)) {
          clearDraftState();
          draftDiscarded = true;
        }
        const displayed = host.getDisplayedMesh();
        const results: Record<string, unknown>[] = [];
        const tiles: HTMLCanvasElement[] = [];
        for (const [i, c] of parsed.entries()) {
          const m = importAt(c.importIndex);
          const meshKey = importMeshKey(m);
          const r = await withBusy(`Comparing ${i + 1}/${parsed.length}…`, true, (ctl) => previewPartsAsync(meshKey, () => segMeshOf(m), {
            algorithm: c.algorithm, params: c.params, featureOptions: c.featureOptions, seeds: c.seeds,
          }, ctl));
          const s = r.summary!;
          results.push({ index: i + 1, detector: s.detectorId, params: s.params, partCount: s.parts.length, quality: s.quality, parts: s.parts.slice(0, 20).map((p) => `${p.id}:${p.name}`) });
          if (displayed) {
            const tmp: DraftState = { importIndex: c.importIndex, meshKey, summary: s, triPart: r.triPart! };
            const shown = displayedPartsAndColors(tmp);
            if (shown) {
              const legend = s.parts.map((p) => ({ id: p.id, name: p.name, color: p.displayColor }));
              const img = renderNumberedParts(shown.mesh, shown.triColors, shown.triPart, legend, { views: [view], size, numbered: true });
              tiles.push(await loadCanvas(img.dataUrl, `${i + 1}. ${s.detectorId}`));
            }
          }
        }
        return { results, ...(tiles.length ? { image: contactSheet(tiles) } : {}), ...(draftDiscarded ? { draftDiscarded: true } : {}) };
      } catch (e) {
        if (e instanceof AbortedError) return { error: 'Comparison cancelled.' };
        return err(e);
      }
    },

    setPartsOverlay(visible: unknown) {
      try {
        overlayVisible = assertBoolean(visible, 'setPartsOverlay(visible)')!;
        refreshOverlay();
        return { ok: true, visible: overlayVisible, hasDraft: draft !== null };
      } catch (e) {
        return err(e);
      }
    },

    /** Re-apply the overlay after the viewport re-rendered the model. */
    refreshOverlay,

    async acceptParts(opts?: unknown) {
      try {
        const o = opts === undefined ? {} : assertObject(opts, 'acceptParts(options)')!;
        assertNoUnknownKeys(o, ['label'], 'acceptParts(options)');
        const label = assertString(o.label, 'acceptParts(options).label', { optional: true }) ?? 'Detected parts';
        const d = currentDraft();
        if (host.getLanguage() !== 'manifold-js') {
          throw new ValidationError('acceptParts needs a JavaScript (manifold-js) session — imports load through api.importWithParts there.');
        }
        const code = host.getCode();
        if (/api\.renderMesh\(\s*api\.imports\[/.test(code)) {
          throw new ValidationError('This import is render-only (not manifold), so it cannot carry labels yet. Repair it to a manifold first.');
        }
        const s = d.summary;
        const imports = host.getImports();
        const m = imports[d.importIndex];
        const parts: ImportedMeshParts = {
          names: s.parts.map((p) => p.name),
          colors: s.parts.map((p) => p.color),
          triPart: d.triPart.slice(),
          source: { detectorId: s.detectorId, params: { ...s.params }, featureOptions: { ...s.featureOptions }, seeds: s.seeds.map((x) => ({ label: x.label, point: x.point })) },
        };
        if (!normalizeImportParts(parts, m.triVerts.length / 3)) {
          throw new ValidationError('The draft parts are inconsistent (duplicate or empty names?) — fix them with editParts before accepting.');
        }
        const nextImports = imports.map((x, i) => (i === d.importIndex ? { ...m, parts } : x));
        const rewrite = rewriteImportsWithParts(code, d.importIndex);
        const usesHelper = rewrite.changed || new RegExp(`api\\.importWithParts\\(\\s*${d.importIndex}\\s*\\)`).test(code);
        const result = await host.commit(rewrite.code, nextImports, label);
        if ('error' in result) return result;
        await discardPartsDraft();
        clearDraftState();
        return {
          ok: true,
          parts: s.parts.map((p) => ({ name: p.name, color: p.color, triCount: p.triCount })),
          ...result,
          ...(usesHelper ? {} : {
            note: `The code does not load import ${d.importIndex} via Manifold.ofMesh(api.imports[${d.importIndex}]), so it was left unchanged. Call api.importWithParts(${d.importIndex}) in your code to get the parts as labels.`,
          }),
        };
      } catch (e) {
        return err(e);
      }
    },

    async discardParts() {
      const had = draft !== null;
      await discardPartsDraft();
      clearDraftState();
      return { ok: true, discarded: had };
    },
  };
  return api;
}

export type PartDetectionApi = ReturnType<typeof createPartDetection>;

function loadCanvas(dataUrl: string, caption: string): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height + 22;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#1e1e1e'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 22);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 13px sans-serif';
      ctx.fillText(caption, 8, 16);
      resolve(c);
    };
    img.onerror = () => reject(new Error('compare: failed to compose tile'));
    img.src = dataUrl;
  });
}

function contactSheet(tiles: HTMLCanvasElement[]): string {
  const cols = Math.min(3, tiles.length);
  const rows = Math.ceil(tiles.length / cols);
  const w = Math.max(...tiles.map((t) => t.width)), h = Math.max(...tiles.map((t) => t.height));
  const out = document.createElement('canvas');
  out.width = cols * w; out.height = rows * h;
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#1e1e1e'; ctx.fillRect(0, 0, out.width, out.height);
  tiles.forEach((t, i) => ctx.drawImage(t, (i % cols) * w, Math.floor(i / cols) * h));
  return out.toDataURL('image/png');
}
