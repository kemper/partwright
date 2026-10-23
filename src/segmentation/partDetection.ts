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
import { errorLog } from '../diagnostics/errorLog';
import type { MeshData } from '../geometry/types';
import { rewriteImportsWithParts } from '../import/codegen';
import { normalizeImportParts } from '../import/importParts';
import type { ImportedMesh, ImportedMeshParts } from '../import/importedMesh';
import { nearestTriangleMap } from '../surface/colorTransfer';
import {
  ValidationError, assertArray, assertBoolean, assertEnum, assertNumber, assertNumberTuple,
  assertObject, assertNoUnknownKeys, assertString,
} from '../validation/apiValidation';
import { MAX_EDGE_SMOOTHING, acceptColors, hexToRgb, isHexColor, UNASSIGNED_COLOR, type BrushMode, type DraftSummary, type PartEditOp } from './draft';
import { medianEdgeLength, toSegMesh } from './features';
import { LABEL_PRESETS } from './labelPresets';
import { AbortedError } from './growth';
import { DEFAULT_PARTS_VIEWS, PARTS_RENDER_VIEWS, renderNumberedParts, renderPartsThumbnail } from './partsRender';
import { autoProposeDetectors, describeDetector, detectorIds, getDetector, listDetectors, resolveParams } from './registry';
import {
  adoptPartsAsync, detectPartsAsync, discardPartsDraft, edgeCutAsync, editPartsAsync, previewPartsAsync, type SegCallControl,
} from './segmentationClient';
import { buildCutMesh, cutPointProps, type EdgeCut } from './smoothEdges';
import type { FeatureOptions, SegMesh, SegSeed } from './types';

export interface PartDetectionHost {
  getImports(): ImportedMesh[];
  /** The mesh currently shown in the viewport (null when nothing rendered). */
  getDisplayedMesh(): MeshData | null;
  showOverlay(mesh: MeshData, triColors: Uint8Array): void;
  /** Repaint the shown overlay in place (same mesh, new colours); false when
   *  it can't, and the controller falls back to showOverlay. */
  recolorOverlay?(triColors: Uint8Array): boolean;
  clearOverlay(): void;
  getCode(): string;
  getLanguage(): string;
  /** Set active imports + code, run, and save a version. */
  commit(code: string, imports: ImportedMesh[], label: string): Promise<Record<string, unknown>>;
  /** Whether the model carries colour beyond part colours (brush paint) —
   *  a smooth-edge accept re-meshes the import, which can shift it. */
  modelHasPaint?(): boolean;
}

/** 'draft' = the draft changed; 'busy' = progress; 'seeds' = the pins
 *  changed; 'presets' = preset previews changed / which one is being
 *  previewed; 'view' = selection, hover or solo changed. */
export type PartDetectionEvent = 'draft' | 'busy' | 'seeds' | 'presets' | 'view';

const EDIT_OPS = [
  'merge', 'rename', 'setColor', 'delete', 'reassign', 'brush', 'split', 'absorbSmall', 'smoothBoundaries',
  'addSeed', 'removeSeed', 'moveSeed', 'seedsFromParts', 'lock', 'focus', 'setEdgeSmoothing', 'reorder', 'clear', 'rerun', 'undo',
] as const;

const BRUSH_MODES = ['triangles', 'patches'] as const satisfies readonly BrushMode[];

/** A brush stroke in progress, previewed on the overlay before it lands
 *  (the panel's Select-tool brush). */
export interface BrushGhost {
  points: [number, number, number][];
  radius: number;
  mode: BrushMode;
  /** `#rrggbb` the brushed area previews in (the target part's colour). */
  color: string;
  /** Triangles of the shown overlay mesh the stroke passed over (a dab
   *  smaller than the triangle it lands on still takes that triangle). */
  faces?: number[];
}

/** How the overlay draws parts: everything, or only a solo set (the rest
 *  greyed out). */
export type PartsViewMode = 'all' | 'solo';

/** Mix an RGB colour toward another (t = 0 keeps a, 1 gives b). */
function mixRgb(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
}
const WHITE: [number, number, number] = [255, 255, 255];
/** Solo view: parts outside the solo set are drawn in this grey. */
const SOLO_DIM_RGB: [number, number, number] = [88, 88, 92];

/** One preset's result in the filmstrip. */
export interface PresetPreview {
  name: string;
  algorithm: string;
  params: Record<string, unknown>;
  featureOptions?: FeatureOptions;
  summary: DraftSummary;
  triPart: Int32Array;
  /** Ranking score (higher = better): see presetScore. A heuristic, not
   *  ground truth. */
  score: number;
  image: string | null;
}

/** Ranking score for a candidate partition: the balance (F1) of groove
 *  coverage (are the real seams used as boundaries?) and groove fidelity
 *  (do boundaries sit on real seams?), discounted by stray islands and
 *  unassigned area. Groove strength alone would always favour merging
 *  everything (only the strongest seams survive); coverage alone would
 *  favour the finest split. */
export function presetScore(q: DraftSummary['quality']): number {
  const c = q.grooveCoverage, p = q.grooveFidelity;
  const f1 = c + p > 0 ? (2 * c * p) / (c + p) : 0;
  return f1 * (1 - Math.min(1, q.islandAreaFrac)) * (1 - Math.min(1, q.unassignedAreaFrac));
}

interface CutState { gen: number; cut: EdgeCut; splitIndex: Int32Array }

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
  /** Working seeds (what the panel's markers show and the next detection
   *  uses). Synced from the draft whenever an edit changes the draft's seeds. */
  let seeds: SegSeed[] = [];
  /** Bumped on every draft change so a late smooth-edge cut can't paint a
   *  newer draft. */
  let gen = 0;
  let cutState: CutState | null = null;
  let cutTimer: ReturnType<typeof setTimeout> | null = null;
  /** Part index per triangle of the mesh the overlay currently shows (for
   *  picking a part by clicking it). */
  let overlayLabels: { mesh: MeshData | null; labels: Int32Array } | null = null;
  /** Part per displayed triangle when the overlay is hidden (partAtFace
   *  hit-tests the plain model then); rebuilt only on a draft change. */
  let labelCache: { gen: number; mesh: MeshData; labels: Int32Array } | null = null;
  let presets: { importIndex: number; meshKey: string; algorithm: string; items: PresetPreview[] } | null = null;
  let previewIndex: number | null = null;
  let panelOpener: (() => void) | null = null;
  /** Selected parts (by name — ids shift when parts are merged/deleted). */
  let selection = new Set<string>();
  let hovered: string | null = null;
  let viewMode: PartsViewMode = 'all';
  /** Solo set; empty = solo the selection. */
  let soloNames = new Set<string>();
  let keepPresetsOnce = false;
  let presetRun: { stop: boolean } | null = null;
  /** Brush preview: the brushed overlay triangles (marked incrementally as
   *  the stroke grows) recoloured toward the target part. */
  let ghost: { g: BrushGhost; mesh: MeshData | null; labels: Int32Array; hit: Uint8Array; done: number; touched: Set<number> } | null = null;
  let centroidCache: { mesh: MeshData; c: Float32Array } | null = null;

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
    const hadDraft = draft !== null;
    draft = null;
    ghost = null;
    centroidCache = null;
    gen++;
    cutState = null;
    overlayLabels = null;
    labelCache = null;
    clearPresets();
    // The draft's pins and the view (selection, solo, hover) belong to it.
    // Pins placed before any detection (no draft yet) survive, e.g. a
    // cancelled first detection.
    const hadPins = hadDraft && seeds.length > 0;
    if (hadDraft) seeds = [];
    selection.clear(); soloNames.clear(); hovered = null; viewMode = 'all';
    host.clearOverlay();
    emit('draft');
    if (hadPins) emit('seeds');
    emit('view');
  }

  function clearPresets(): void {
    if (!presets && previewIndex === null) return;
    presets = null;
    previewIndex = null;
    emit('presets');
  }

  /** With no draft here, make sure the Worker holds none either: a draft
   *  dropped on this side (version switch, mesh change) still sits in the
   *  Worker, and detection would otherwise merge into it under its old
   *  locks and focus. */
  async function dropOrphanedWorkerDraft(): Promise<void> {
    if (!draft) await discardPartsDraft();
  }

  function sameSeeds(a: SegSeed[], b: SegSeed[]): boolean {
    return a.length === b.length && a.every((x, i) => x.label === b[i].label && !!x.auto === !!b[i].auto && x.color === b[i].color && x.point.every((v, k) => v === b[i].point[k]));
  }

  /** Copy a seed. A working (pre-detection) pin keeps its colour so the
   *  first detection can apply it; the draft's own pins never carry one. */
  function copySeed(x: SegSeed): SegSeed {
    const out: SegSeed = { label: x.label, point: [x.point[0], x.point[1], x.point[2]] };
    if (typeof x.triangle === 'number') out.triangle = x.triangle;
    if (x.auto) out.auto = true;
    if (x.color) out.color = x.color;
    return out;
  }

  /** Install a new draft state: bump the generation, sync working seeds when
   *  the draft's seeds changed, refresh the overlay and (re)schedule the
   *  smooth-edge cut. */
  function setDraft(next: DraftState): void {
    const prev = draft;
    const prevSeeds = prev?.summary.seeds ?? null;
    // A colour/name/lock edit leaves the partition alone: keep the smooth
    // cut instead of flashing back to stair-steps while it recomputes.
    const keepCut = !!cutState && cutState.gen === gen && !!prev && prev.meshKey === next.meshKey
      && prev.summary.edgeSmoothing === next.summary.edgeSmoothing && sameArray(prev.triPart, next.triPart);
    draft = next;
    ghost = null;
    gen++;
    if (keepCut) cutState!.gen = gen;
    else cutState = null;
    // Preset previews describe the draft they were computed against; applying
    // one of them keeps the strip so the user can keep flipping.
    if (keepPresetsOnce) { keepPresetsOnce = false; previewIndex = null; emit('presets'); } else clearPresets();
    // Parts own their pins: the pins are the draft's.
    if (!prevSeeds || !sameSeeds(prevSeeds, next.summary.seeds)) {
      seeds = next.summary.seeds.map(copySeed);
      emit('seeds');
    }
    // Selection and solo follow names; drop names that are gone.
    const names = new Set(next.summary.parts.map((p) => p.name));
    selection = new Set([...selection].filter((nm) => names.has(nm)));
    soloNames = new Set([...soloNames].filter((nm) => names.has(nm)));
    if (hovered && !names.has(hovered)) hovered = null;
    refreshOverlay();
    emit('draft');
    if (!keepCut) scheduleCut(0);
  }

  /** Fetch the smooth-edge cut for the current draft (background; the
   *  per-triangle overlay shows meanwhile). */
  function scheduleCut(delayMs: number): void {
    if (cutTimer) { clearTimeout(cutTimer); cutTimer = null; }
    if (!draft || draft.summary.edgeSmoothing <= 0) return;
    const want = gen;
    const meshKey = draft.meshKey;
    const run = async () => {
      cutTimer = null;
      if (want !== gen) return;
      try {
        const cut = await withBusy('Smoothing edges…', false, () => edgeCutAsync(meshKey));
        if (want !== gen || !cut) return;
        cutState = { gen: want, cut, splitIndex: splitIndexOf(cut, draft!.triPart.length) };
        refreshOverlay();
      } catch (e) {
        // A draft dropped meanwhile (cancel / discard) is expected — the
        // per-triangle overlay stays. Anything else is a real failure.
        const message = e instanceof Error ? e.message : String(e);
        if (!/No part draft/.test(message)) errorLog.capture({ level: 'warn', source: 'parts', message: `Smooth part edges failed: ${message}` });
      }
    };
    if (delayMs > 0) cutTimer = setTimeout(run, delayMs);
    else void run();
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
  /** RGB per part for the overlay. `styled` applies the view (solo, the
   *  selection and the hovered part); renders for the AI and preset tiles
   *  pass false. */
  function partPalette(d: DraftState, styled: boolean): { rgb: [number, number, number][]; un: [number, number, number] } {
    const base = d.summary.parts.map((p) => hexToRgb(p.displayColor));
    const un = hexToRgb(UNASSIGNED_COLOR);
    if (!styled) return { rgb: base, un };
    const solo = viewMode === 'solo' ? (soloNames.size ? soloNames : selection) : null;
    const rgb = d.summary.parts.map((p, i) => {
      let c = base[i];
      if (solo && solo.size && !solo.has(p.name)) c = SOLO_DIM_RGB;
      if (selection.has(p.name)) c = mixRgb(c, WHITE, 0.35);
      if (hovered === p.name) c = mixRgb(c, WHITE, 0.5);
      return c;
    });
    return { rgb, un: solo && solo.size ? SOLO_DIM_RGB : un };
  }

  function colorsFromLabels(labels: Int32Array, pal: { rgb: [number, number, number][]; un: [number, number, number] }): Uint8Array {
    const out = new Uint8Array(labels.length * 3);
    for (let t = 0; t < labels.length; t++) {
      const L = labels[t];
      const c = L >= 0 ? pal.rgb[L] ?? pal.un : pal.un;
      out[t * 3] = c[0]; out[t * 3 + 1] = c[1]; out[t * 3 + 2] = c[2];
    }
    return out;
  }

  /** Re-colour the shown overlay for a view change (selection, hover,
   *  solo) — in place when the host can, else a full refresh. */
  function applyView(): void {
    emit('view');
    // Nothing coloured to restyle: the overlay is hidden or not shown yet.
    if (!draft || !overlayVisible) return;
    if (previewIndex !== null || !overlayLabels) { refreshOverlay(); return; }
    const colors = colorsFromLabels(overlayLabels.labels, partPalette(draft, true));
    if (ghost) paintGhost(colors);
    if (!host.recolorOverlay?.(colors)) refreshOverlay();
  }

  /** Triangle centroids of the mesh the overlay shows (cached per mesh). */
  function centroidsOf(mesh: MeshData): Float32Array {
    if (centroidCache?.mesh === mesh) return centroidCache.c;
    const c = new Float32Array(mesh.numTri * 3);
    const vp = mesh.vertProperties, tv = mesh.triVerts, np = mesh.numProp;
    for (let t = 0; t < mesh.numTri; t++) {
      for (let k = 0; k < 3; k++) {
        const v = tv[t * 3 + k] * np;
        c[t * 3] += vp[v] / 3; c[t * 3 + 1] += vp[v + 1] / 3; c[t * 3 + 2] += vp[v + 2] / 3;
      }
    }
    centroidCache = { mesh, c };
    return c;
  }

  /** Mark the overlay triangles the ghost's new points cover, then tint
   *  them (or, in patches mode, every part they touch) in `colors`. */
  function paintGhost(colors: Uint8Array): void {
    if (!ghost) return;
    const { g, labels, hit } = ghost;
    const mesh = ghost.mesh ?? host.getDisplayedMesh();
    if (!mesh || mesh.numTri !== labels.length) return;
    const c = centroidsOf(mesh);
    const r2 = g.radius * g.radius;
    for (const f of g.faces ?? []) {
      if (f < 0 || f >= labels.length || hit[f]) continue;
      hit[f] = 1;
      if (labels[f] >= 0) ghost.touched.add(labels[f]);
    }
    for (; ghost.done < g.points.length; ghost.done++) {
      const p = g.points[ghost.done];
      for (let t = 0; t < labels.length; t++) {
        if (hit[t]) continue;
        const dx = c[t * 3] - p[0], dy = c[t * 3 + 1] - p[1], dz = c[t * 3 + 2] - p[2];
        if (dx * dx + dy * dy + dz * dz > r2) continue;
        hit[t] = 1;
        if (labels[t] >= 0) ghost.touched.add(labels[t]);
      }
    }
    const tint = mixRgb(hexToRgb(g.color), WHITE, 0.2);
    const patches = g.mode === 'patches';
    for (let t = 0; t < labels.length; t++) {
      if (!(hit[t] || (patches && ghost.touched.has(labels[t])))) continue;
      colors[t * 3] = tint[0]; colors[t * 3 + 1] = tint[1]; colors[t * 3 + 2] = tint[2];
    }
  }

  function displayedPartsAndColors(d: DraftState, styled = false): { mesh: MeshData; triPart: Int32Array; triColors: Uint8Array } | null {
    const displayed = host.getDisplayedMesh();
    if (!displayed) return null;
    const m = host.getImports()[d.importIndex];
    if (!m) return null;
    const map = sourceMap(m, displayed);
    const { rgb, un } = partPalette(d, styled);
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
    if (!overlayVisible) { overlayLabels = null; host.clearOverlay(); return; }
    const shownDraft = previewIndex !== null && presets?.items[previewIndex] ? previewDraftState(presets.items[previewIndex]) : draft;
    if (!shownDraft) { overlayLabels = null; host.clearOverlay(); return; }
    const d = displayedPartsAndColors(shownDraft, shownDraft === draft);
    if (!d) return;
    if (shownDraft === draft && cutState && cutState.gen === gen) {
      const smooth = smoothOverlay(shownDraft, d.mesh, cutState);
      if (smooth) {
        overlayLabels = { mesh: smooth.mesh, labels: smooth.labels };
        host.showOverlay(smooth.mesh, smooth.triColors);
        return;
      }
    }
    overlayLabels = { mesh: null, labels: d.triPart };
    host.showOverlay(d.mesh, d.triColors);
  }

  function previewDraftState(p: PresetPreview): DraftState | null {
    if (!presets) return null;
    return { importIndex: presets.importIndex, meshKey: presets.meshKey, summary: p.summary, triPart: p.triPart };
  }

  /** Overlay mesh with smooth part edges: the displayed mesh, with every
   *  triangle whose source triangle the cut splits replaced by the cut's
   *  sub-triangles (emitted once per source triangle). */
  function smoothOverlay(d: DraftState, displayed: MeshData, cs: CutState): { mesh: MeshData; triColors: Uint8Array; labels: Int32Array } | null {
    const m = host.getImports()[d.importIndex];
    if (!m) return null;
    const map = sourceMap(m, displayed);
    const cut = cs.cut;
    const { rgb, un } = partPalette(d, true);
    const emitted = new Uint8Array(cs.splitIndex.length);
    let outTri = 0;
    for (let t = 0; t < displayed.numTri; t++) {
      const s = map[t];
      const si = s >= 0 ? cs.splitIndex[s] : -1;
      if (si < 0) { outTri++; continue; }
      if (emitted[s]) continue;
      emitted[s] = 1;
      outTri += cut.subStart[si + 1] - cut.subStart[si];
    }
    emitted.fill(0);
    const nv = displayed.numVert;
    const pointVert = new Map<number, number>();
    const extraPos: number[] = [];
    const tmp = new Float32Array(m.numProp);
    const pv = (id: number): number => {
      let v = pointVert.get(id);
      if (v === undefined) {
        cutPointProps(cut, id, m.vertProperties, m.numProp, m.triVerts, tmp);
        v = nv + extraPos.length / 3;
        extraPos.push(tmp[0], tmp[1], tmp[2]);
        pointVert.set(id, v);
      }
      return v;
    };
    const triVerts = new Uint32Array(outTri * 3);
    const triColors = new Uint8Array(outTri * 3);
    const labels = new Int32Array(outTri);
    let o = 0;
    const put = (a: number, b: number, c: number, L: number) => {
      triVerts[o * 3] = a; triVerts[o * 3 + 1] = b; triVerts[o * 3 + 2] = c;
      const col = L >= 0 ? rgb[L] ?? un : un;
      triColors[o * 3] = col[0]; triColors[o * 3 + 1] = col[1]; triColors[o * 3 + 2] = col[2];
      labels[o++] = L;
    };
    for (let t = 0; t < displayed.numTri; t++) {
      const s = map[t];
      const si = s >= 0 ? cs.splitIndex[s] : -1;
      if (si < 0) {
        put(displayed.triVerts[t * 3], displayed.triVerts[t * 3 + 1], displayed.triVerts[t * 3 + 2], s >= 0 ? cut.triLabel[s] : -1);
        continue;
      }
      if (emitted[s]) continue;
      emitted[s] = 1;
      for (let k = cut.subStart[si]; k < cut.subStart[si + 1]; k++) {
        put(pv(cut.subPoints[k * 3]), pv(cut.subPoints[k * 3 + 1]), pv(cut.subPoints[k * 3 + 2]), cut.subLabel[k]);
      }
    }
    const vertProperties = new Float32Array((nv + extraPos.length / 3) * 3);
    for (let v = 0; v < nv; v++) {
      const i = v * displayed.numProp;
      vertProperties[v * 3] = displayed.vertProperties[i];
      vertProperties[v * 3 + 1] = displayed.vertProperties[i + 1];
      vertProperties[v * 3 + 2] = displayed.vertProperties[i + 2];
    }
    vertProperties.set(extraPos, nv * 3);
    return {
      mesh: { vertProperties, triVerts, numVert: vertProperties.length / 3, numTri: outTri, numProp: 3 },
      triColors, labels,
    };
  }

  /** Run a Worker call with the busy indicator. Cancellable calls (detect,
   *  compare) get their own AbortController; edits are not cancellable —
   *  aborting one would tear down the Worker mid-edit and orphan the draft. */
  /** `'soft'` shows Cancel without an AbortController: the caller polls its
   *  own stop flag between steps (the preset strip), so cancelling never
   *  tears the Worker — and the draft — down. */
  async function withBusy<T>(message: string, mode: boolean | 'soft', fn: (ctl: SegCallControl) => Promise<T>): Promise<T> {
    const cancellable = mode !== false;
    const ctl = mode === true ? new AbortController() : null;
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
      pins: p.pins,
      ...(p.locked ? { locked: true } : {}),
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
      ...(summary.focus ? { focus: summary.focus } : {}),
      edgeSmoothing: summary.edgeSmoothing,
      canUndo: summary.canUndo,
    };
  }

  // ------------------------------------------------------------ validation

  function parseSeeds(raw: unknown, where: string): SegSeed[] | undefined {
    if (raw === undefined) return undefined;
    return assertArray(raw, where).map((s, i) => {
      const o = assertObject(s, `${where}[${i}]`)!;
      assertNoUnknownKeys(o, ['label', 'point', 'triangle', 'auto', 'color'], `${where}[${i}]`);
      const label = assertString(o.label, `${where}[${i}].label`)!;
      const point = assertNumberTuple(o.point, 3, `${where}[${i}].point`) as [number, number, number];
      const triangle = assertNumber(o.triangle, `${where}[${i}].triangle`, { optional: true, integer: true, min: 0 });
      const auto = assertBoolean(o.auto, `${where}[${i}].auto`, { optional: true });
      const color = assertString(o.color, `${where}[${i}].color`, { optional: true });
      if (color !== undefined && !isHexColor(color)) throw new ValidationError(`${where}[${i}].color must be "#rrggbb", got ${JSON.stringify(color)}`);
      const out: SegSeed = triangle === undefined ? { label, point } : { label, point, triangle };
      if (auto) out.auto = true;
      if (color !== undefined) out.color = color.toLowerCase();
      return out;
    });
  }

  function parseFeatureOptions(raw: unknown): FeatureOptions | undefined {
    if (raw === undefined) return undefined;
    const o = assertObject(raw, 'featureOptions')!;
    assertNoUnknownKeys(o, ['normalSmoothRadius', 'normalSmoothEdgeLengths'], 'featureOptions');
    const r = assertNumber(o.normalSmoothRadius, 'featureOptions.normalSmoothRadius', { optional: true, min: 0 });
    const k = assertNumber(o.normalSmoothEdgeLengths, 'featureOptions.normalSmoothEdgeLengths', { optional: true, min: 0, max: 50 });
    return { ...(r === undefined ? {} : { normalSmoothRadius: r }), ...(k === undefined ? {} : { normalSmoothEdgeLengths: k }) };
  }

  function parseRef(v: unknown, where: string): number | string {
    if (typeof v === 'number' && Number.isInteger(v)) return v;
    if (typeof v === 'string' && v.trim()) return v;
    throw new ValidationError(`${where} must be a 1-based part id or a part name`);
  }

  /** Part refs (1-based ids or names) → current part names. */
  function resolveNames(refs: unknown[], where: string): string[] {
    const parts = draft?.summary.parts ?? [];
    return refs.map((r, i) => {
      const ref = parseRef(r, `${where}[${i}]`);
      const p = typeof ref === 'number' ? parts[ref - 1] : parts.find((x) => x.name === ref);
      if (!p) throw new ValidationError(`${where}[${i}]: no part ${JSON.stringify(ref)}`);
      return p.name;
    });
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
      case 'brush': {
        keys('to', 'points', 'triangles', 'radius', 'mode');
        const to = parseRef(x.to, `${where}.to`);
        const points = x.points === undefined ? undefined
          : assertArray(x.points, `${where}.points`).map((p, j) => assertNumberTuple(p, 3, `${where}.points[${j}]`) as [number, number, number]);
        const triangles = x.triangles === undefined ? undefined
          : assertArray(x.triangles, `${where}.triangles`).map((t, j) => assertNumber(t, `${where}.triangles[${j}]`, { integer: true, min: 0 })!);
        const radius = assertNumber(x.radius, `${where}.radius`, { optional: true, min: 0 });
        const mode = x.mode === undefined ? undefined : assertEnum(x.mode, BRUSH_MODES, `${where}.mode`);
        if (!points?.length && !triangles?.length) throw new ValidationError(`${where}: brush needs points (with a radius) or triangles`);
        if (points?.length && !(radius !== undefined && radius > 0)) throw new ValidationError(`${where}.radius must be > 0 when points are given`);
        return {
          op, to,
          ...(points ? { points } : {}), ...(triangles ? { triangles } : {}),
          ...(radius !== undefined ? { radius } : {}), ...(mode ? { mode } : {}),
        };
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
      case 'moveSeed': {
        keys('index', 'point', 'rerun');
        const rerun = assertBoolean(x.rerun, `${where}.rerun`, { optional: true });
        const index = assertNumber(x.index, `${where}.index`, { integer: true, min: 0 })!;
        const point = assertNumberTuple(x.point, 3, `${where}.point`) as [number, number, number];
        return rerun === undefined ? { op, index, point } : { op, index, point, rerun };
      }
      case 'lock': {
        keys('id', 'locked');
        const locked = assertBoolean(x.locked, `${where}.locked`, { optional: true });
        const id = parseRef(x.id, `${where}.id`);
        return locked === undefined ? { op, id } : { op, id, locked };
      }
      case 'focus':
        keys('id');
        return { op, id: x.id === null ? null : parseRef(x.id, `${where}.id`) };
      case 'setEdgeSmoothing':
        keys('iterations');
        return { op, iterations: assertNumber(x.iterations, `${where}.iterations`, { integer: true, min: 0, max: MAX_EDGE_SMOOTHING })! };
      case 'reorder':
        keys('id', 'position');
        return { op, id: parseRef(x.id, `${where}.id`), position: assertNumber(x.position, `${where}.position`, { integer: true, min: 1 })! };
      case 'clear': {
        keys('algorithm');
        if (x.algorithm === undefined) return { op };
        return { op, algorithm: assertEnum(x.algorithm, detectorIds(), `${where}.algorithm`) };
      }
      case 'seedsFromParts': {
        keys('minRegionFrac');
        const minRegionFrac = assertNumber(x.minRegionFrac, `${where}.minRegionFrac`, { optional: true, min: 0, max: 1 })
          ?? getConfig().segmentation.seedsFromPartsMinRegionFrac;
        return { op, minRegionFrac };
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

  /** acceptParts with a retry count: the smooth-edge cut is async, and a draft
   *  change landing meanwhile re-indexes the parts it was cut for. */
  async function acceptPartsAttempt(opts: unknown, attempt: number): Promise<Record<string, unknown>> {
    try {
      const o = opts === undefined ? {} : assertObject(opts, 'acceptParts(options)')!;
      assertNoUnknownKeys(o, ['label', 'smoothEdges', 'applyColors'], 'acceptParts(options)');
      const label = assertString(o.label, 'acceptParts(options).label', { optional: true }) ?? 'Detected parts';
      const applyColors = assertBoolean(o.applyColors, 'acceptParts(options).applyColors', { optional: true }) ?? true;
      const d = currentDraft();
      const smooth = (assertBoolean(o.smoothEdges, 'acceptParts(options).smoothEdges', { optional: true }) ?? true) && d.summary.edgeSmoothing > 0;
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
      const source: NonNullable<ImportedMeshParts['source']> = {
        detectorId: s.detectorId, params: { ...s.params }, featureOptions: { ...s.featureOptions }, seeds: s.seeds.map((x) => (x.auto ? { label: x.label, point: x.point, auto: true } : { label: x.label, point: x.point })),
      };
      let parts: ImportedMeshParts = {
        names: s.parts.map((p) => p.name),
        // Each part keeps the colour it shows (explicit, else overlay).
        colors: acceptColors(s.parts, applyColors),
        triPart: d.triPart.slice(),
        source,
      };
      let nextImport: ImportedMesh = { ...m, parts };
      let remeshed: { fromTris: number; toTris: number } | null = null;
      if (smooth) {
        // Smooth edges: re-mesh the import along the cut, so the part
        // boundaries the overlay showed are real triangle edges.
        const genAtStart = gen;
        const cut = await withBusy('Cutting smooth edges…', false, () => edgeCutAsync(d.meshKey));
        // The names/colours above index the draft as it was; an edit that
        // landed meanwhile (the AI and the user both active) re-indexes it.
        if (gen !== genAtStart) {
          // Background draft work (a detection or preset run finishing)
          // landed during the cut. Start over on the new draft rather than
          // handing the caller a retry; give up only if it keeps moving.
          if (attempt < 2) return acceptPartsAttempt(opts, attempt + 1);
          throw new ValidationError('The parts kept changing while accepting — wait for detection to finish, then accept again.');
        }
        if (cut) {
          const built = buildCutMesh({ vertProperties: m.vertProperties, triVerts: m.triVerts, numProp: m.numProp }, cut, parts.names, parts.colors);
          if (cut.splitTris.length > 0) {
            parts = { names: built.names, colors: built.colors, triPart: built.triPart, source: { ...source, edgeSmoothing: s.edgeSmoothing } };
            nextImport = { ...m, vertProperties: built.vertProperties, triVerts: built.triVerts, numVert: built.numVert, numTri: built.numTri, parts };
            remeshed = { fromTris: m.numTri, toTris: built.numTri };
          } else {
            // Nothing split, but smoothing can still relabel whole sliver
            // triangles — save what the overlay showed, on the same mesh.
            parts = { names: built.names, colors: built.colors, triPart: built.triPart, source };
            nextImport = { ...m, parts };
          }
        }
      }
      if (!normalizeImportParts(parts, nextImport.triVerts.length / 3)) {
        throw new ValidationError('The draft parts are inconsistent (duplicate or empty names?) — fix them with editParts before accepting.');
      }
      const nextImports = imports.map((x, i) => (i === d.importIndex ? nextImport : x));
      const hadPaint = remeshed !== null && (host.modelHasPaint?.() ?? false);
      const rewrite = rewriteImportsWithParts(code, d.importIndex);
      const usesHelper = rewrite.changed || new RegExp(`api\\.importWithParts\\(\\s*${d.importIndex}\\s*\\)`).test(code);
      const result = await host.commit(rewrite.code, nextImports, label);
      if ('error' in result) return result;
      await discardPartsDraft();
      clearDraftState();
      const notes: string[] = [];
      if (!usesHelper) notes.push(`The code does not load import ${d.importIndex} via Manifold.ofMesh(api.imports[${d.importIndex}]), so it was left unchanged. Call api.importWithParts(${d.importIndex}) in your code to get the parts as labels.`);
      if (hadPaint) notes.push('The import was re-meshed along the smooth part edges — check any brush paint on it; painted edges can shift slightly.');
      return {
        ok: true,
        parts: parts.names.map((name, i) => ({ name, color: parts.colors[i] ?? null, triCount: countPart(parts.triPart, i) })),
        ...(remeshed ? { smoothEdges: remeshed } : {}),
        ...result,
        ...(notes.length ? { note: notes.join(' ') } : {}),
      };
    } catch (e) {
      return err(e);
    }
  }

  const api = {
    subscribe(fn: (ev: PartDetectionEvent) => void): () => void {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    isBusy() { return busy; },
    hasDraft() { return draft !== null; },
    /** Cancel an in-flight detection (terminates the Worker; the draft is lost). */
    cancel(): void {
      if (presetRun) presetRun.stop = true;
      if (active.size === 0) return;
      for (const c of active) c.abort();
      // The Worker is torn down by the abort, taking its draft with it.
      clearDraftState();
    },
    /** Called by the panel module so openPartsPanel() (console / AI) can
     *  open the panel. */
    setPanelOpener(fn: (() => void) | null): void { panelOpener = fn; },
    openPartsPanel() {
      if (!panelOpener) return { error: 'The Part Detection panel is not available here.' };
      panelOpener();
      return { ok: true, hasDraft: draft !== null };
    },

    // ------------------------------------------------------- working seeds

    getSeeds(): SegSeed[] { return seeds.map(copySeed); },
    /** Replace the working seed list (the panel's markers; the next
     *  detection uses it). Does not re-run detection by itself. */
    setSeeds(list: unknown) {
      try {
        seeds = parseSeeds(list, 'setPartSeeds(seeds)') ?? [];
        emit('seeds');
        return { ok: true, seedCount: seeds.length };
      } catch (e) {
        return err(e);
      }
    },
    /** The draft part under a picked triangle of whatever mesh the viewport
     *  shows (overlay or model), or null. */
    partAtFace(triangleIndex: number): { id: number; name: string } | null {
      if (!draft) return null;
      let labels = previewIndex === null ? overlayLabels?.labels ?? null : null;
      if (!labels) {
        const shown = host.getDisplayedMesh();
        if (shown && (!labelCache || labelCache.gen !== gen || labelCache.mesh !== shown)) {
          const d = displayedPartsAndColors(draft);
          labelCache = d ? { gen, mesh: shown, labels: d.triPart } : null;
        }
        labels = labelCache?.labels ?? null;
      }
      const L = labels && triangleIndex >= 0 && triangleIndex < labels.length ? labels[triangleIndex] : -1;
      const p = L >= 0 ? draft.summary.parts[L] : undefined;
      return p ? { id: p.id, name: p.name } : null;
    },
    isOverlayVisible() { return overlayVisible; },

    listPartDetectors() {
      return {
        detectors: listDetectors().map(describeDetector),
        featureOptions: {
          normalSmoothRadius: 'World-unit radius for denoising normals before measuring creases. Omit/0 = raw (default, best on the benchmark); ~3× the median edge length can help very noisy scans.',
          normalSmoothEdgeLengths: 'The same denoise radius as a multiple of the median edge length (3 ≈ a noisy scan). Ignored when normalSmoothRadius is set.',
        },
        editOps: [...EDIT_OPS],
        /** The panel's label chips: part names with default colours, for
         *  seeds like {label, point, color}. */
        labelPresets: LABEL_PRESETS.map((p) => ({ id: p.id, title: p.title, labels: p.chips.map((c) => ({ ...c })) })),
      };
    },

    async detectParts(opts: unknown) {
      try {
        const o = parseDetect(opts);
        const m = importAt(o.importIndex);
        const meshKey = importMeshKey(m);
        // The Worker holds one draft: detecting on a different import
        // starts that import's draft fresh.
        if (draft && draft.meshKey !== meshKey) clearDraftState();
        await dropOrphanedWorkerDraft();
        const r = await withBusy('Detecting parts…', true, (ctl) => detectPartsAsync(meshKey, () => segMeshOf(m), {
          algorithm: o.algorithm, params: o.params, featureOptions: o.featureOptions, seeds: o.seeds,
        }, ctl));
        setDraft({ importIndex: o.importIndex, meshKey, summary: r.summary!, triPart: r.triPart! });
        return compact(r.summary!);
      } catch (e) {
        if (e instanceof AbortedError) return { error: 'Part detection cancelled.' };
        return err(e);
      } finally {
        keepPresetsOnce = false;
      }
    },

    /** Re-open the parts saved on an import (by acceptParts) as the draft,
     *  with their seeds, so they can be refined and accepted again. */
    async reopenParts(opts?: unknown) {
      try {
        const o = opts === undefined ? {} : assertObject(opts, 'reopenParts(options)')!;
        assertNoUnknownKeys(o, ['importIndex'], 'reopenParts(options)');
        const importIndex = assertNumber(o.importIndex, 'reopenParts(options).importIndex', { optional: true, integer: true, min: 0 }) ?? 0;
        const m = importAt(importIndex);
        if (!m.parts) throw new ValidationError(`Import ${importIndex} has no saved parts — run detectParts first.`);
        const meshKey = importMeshKey(m);
        const src = m.parts.source;
        // A mesh already cut along smooth edges would be cut again: start
        // with smoothing off there.
        const applied = typeof src?.edgeSmoothing === 'number' && src.edgeSmoothing > 0;
        if (draft) clearDraftState();
        const r = await withBusy('Opening parts…', false, () => adoptPartsAsync(meshKey, () => segMeshOf(m), {
          triPart: m.parts!.triPart, names: m.parts!.names, colors: m.parts!.colors,
          detectorId: src?.detectorId, params: src?.params, featureOptions: src?.featureOptions as FeatureOptions | undefined,
          seeds: src?.seeds, edgeSmoothing: applied ? 0 : getConfig().segmentation.defaultEdgeSmoothing,
        }));
        setDraft({ importIndex, meshKey, summary: r.summary!, triPart: r.triPart! });
        return compact(r.summary!);
      } catch (e) {
        return err(e);
      }
    },
    /** Imports in the current version that carry saved parts. */
    importsWithParts(): number[] {
      return host.getImports().flatMap((m, i) => (m.parts ? [i] : []));
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
          setDraft({ importIndex, meshKey, summary: r.summary!, triPart: r.triPart! });
          // setDraft's overlay refresh drops a draft whose import changed meanwhile.
          if (!draft) return { error: 'The imported mesh changed during part detection — run it again.' };
          return { proposed: true, proposedBy: d.id, tried, ...compact(r.summary!) };
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
        assertNoUnknownKeys(o, ['ops', 'stroke'], 'editParts(options)');
        const ops = assertArray(o.ops, 'editParts(options).ops').map((op, i) => parseEditOp(op, `ops[${i}]`));
        if (ops.length === 0) throw new ValidationError('editParts(options).ops must contain at least one op');
        // Batches sharing a stroke id (one brush drag) are one undo step.
        const stroke = assertString(o.stroke, 'editParts(options).stroke', { optional: true });
        const d = currentDraft();
        const r = await withBusy('Updating parts…', false, () => editPartsAsync(d.meshKey, ops, stroke));
        setDraft({ ...d, summary: r.summary!, triPart: r.triPart! });
        return compact(r.summary!);
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
        await dropOrphanedWorkerDraft();
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

    // ---------------------------------------------------- preset filmstrip

    getPresetPreviews() { return presets ? { algorithm: presets.algorithm, items: presets.items } : null; },
    getPreviewIndex() { return previewIndex; },

    /** Run every preset of a detector WITHOUT touching the draft (locks and
     *  focus are honoured), ranked by score. The panel's filmstrip and the
     *  console / AI share this. */
    async previewPartPresets(opts?: unknown) {
      try {
        const o = opts === undefined ? {} : assertObject(opts, 'previewPartPresets(options)')!;
        assertNoUnknownKeys(o, ['algorithm', 'seeds', 'importIndex', 'view', 'image'], 'previewPartPresets(options)');
        const algorithm = o.algorithm === undefined ? (draft?.summary.detectorId ?? 'auto-merge') : assertEnum(o.algorithm, detectorIds(), 'previewPartPresets(options).algorithm');
        const det = getDetector(algorithm)!;
        const list = det.presets ?? [];
        if (list.length === 0) throw new ValidationError(`Detector "${algorithm}" has no presets.`);
        const importIndex = assertNumber(o.importIndex, 'previewPartPresets(options).importIndex', { optional: true, integer: true, min: 0 }) ?? draft?.importIndex ?? 0;
        const view = o.view === undefined ? 'front' : assertEnum(o.view, Object.keys(PARTS_RENDER_VIEWS), 'previewPartPresets(options).view');
        const wantSheet = assertBoolean(o.image, 'previewPartPresets(options).image', { optional: true }) ?? true;
        const runSeeds = parseSeeds(o.seeds, 'previewPartPresets(options).seeds') ?? seeds;
        if (det.seeds === 'required' && runSeeds.length === 0) throw new ValidationError(`"${algorithm}" needs seeds — place some first (or pass seeds).`);
        const m = importAt(importIndex);
        const meshKey = importMeshKey(m);
        if (draft && draft.meshKey !== meshKey) clearDraftState();
        await dropOrphanedWorkerDraft();
        const size = getConfig().segmentation.presetThumbSize;
        presets = { importIndex, meshKey, algorithm, items: [] };
        previewIndex = null;
        emit('presets');
        const run = { stop: false };
        presetRun = run;
        const mine = presets;
        try {
          for (const [i, preset] of list.entries()) {
            if (run.stop || presets !== mine) break;
            const r = await withBusy(`Preset ${i + 1}/${list.length}: ${preset.name}…`, 'soft', () => previewPartsAsync(meshKey, () => segMeshOf(m), {
              algorithm, params: preset.params, featureOptions: preset.featureOptions, seeds: runSeeds,
            }));
            if (presets !== mine) break;
            const summary = r.summary!;
            const item: PresetPreview = {
              name: preset.name, algorithm, params: { ...summary.params }, featureOptions: preset.featureOptions,
              summary, triPart: r.triPart!, score: presetScore(summary.quality), image: null,
            };
            const shown = displayedPartsAndColors({ importIndex, meshKey, summary, triPart: item.triPart });
            if (shown) item.image = renderPartsThumbnail(shown.mesh, shown.triColors, view, size);
            // Keep the hovered preview on the same preset while the strip re-sorts.
            const hovered = previewIndex !== null ? mine.items[previewIndex] : null;
            mine.items.push(item);
            mine.items.sort((x, y) => y.score - x.score);
            if (hovered) previewIndex = mine.items.indexOf(hovered);
            emit('presets');
          }
        } finally {
          if (presetRun === run) presetRun = null;
        }
        if (presets !== mine) return { error: 'Preset previews were superseded.' };
        const items = mine.items;
        let image: string | undefined;
        if (wantSheet && items.some((x) => x.image)) {
          // Captions number presets by their index in `presets` (0-based, as applyPartPreset takes).
          const tiles = await Promise.all(items.flatMap((x, i) => (x.image ? [loadCanvas(x.image, `${i}. ${x.name}`)] : [])));
          image = contactSheet(tiles);
        }
        return {
          algorithm,
          presets: items.map((x, i) => ({ index: i, name: x.name, params: x.params, featureOptions: x.featureOptions, partCount: x.summary.parts.length, score: +x.score.toFixed(3), quality: x.summary.quality })),
          ...(run.stop ? { stopped: true } : {}),
          ...(image ? { image } : {}),
        };
      } catch (e) {
        return err(e);
      }
    },

    /** Show one preset preview in the viewport (null = back to the draft). */
    showPresetPreview(index: unknown) {
      try {
        let next: number | null = null;
        if (index !== null) {
          const i = assertNumber(index, 'showPresetPreview(index)', { integer: true, min: 0 })!;
          if (!presets || i >= presets.items.length) throw new ValidationError('No preset preview with that index — run previewPartPresets first.');
          next = i;
        }
        if (next === previewIndex) return { ok: true, previewing: previewIndex };
        previewIndex = next;
        refreshOverlay();
        emit('presets');
        return { ok: true, previewing: previewIndex };
      } catch (e) {
        return err(e);
      }
    },

    /** Make a previewed preset the draft (re-runs it; the strip stays). */
    async applyPartPreset(index: unknown) {
      try {
        const i = assertNumber(index, 'applyPartPreset(index)', { integer: true, min: 0 })!;
        if (!presets || i >= presets.items.length) throw new ValidationError('No preset preview with that index — run previewPartPresets first.');
        const item = presets.items[i];
        keepPresetsOnce = true;
        previewIndex = null;
        return await api.detectParts({
          algorithm: item.algorithm, params: item.params, importIndex: presets.importIndex,
          ...(item.featureOptions ? { featureOptions: item.featureOptions } : {}),
          ...(item.summary.seeds.length ? { seeds: item.summary.seeds.map(copySeed) } : {}),
        });
      } catch (e) {
        keepPresetsOnce = false;
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
      return acceptPartsAttempt(opts, 0);
    },

    async discardParts() {
      const had = draft !== null;
      await discardPartsDraft();
      // Discard starts over: pins, selection and view go too — including
      // pins placed before any detection.
      clearDraftState();
      if (seeds.length) { seeds = []; emit('seeds'); }
      return { ok: true, discarded: had };
    },

    // ------------------------------------------------- selection and view

    /** Selected parts (shared by the panel list and the model). */
    getPartSelection() {
      const parts = draft?.summary.parts ?? [];
      return { parts: parts.filter((p) => selection.has(p.name)).map((p) => ({ id: p.id, name: p.name })) };
    },
    /** Replace (or with `mode`, add to / toggle / remove from) the selection.
     *  Parts are 1-based ids or names; null clears. */
    setPartSelection(parts: unknown, opts?: unknown) {
      try {
        const o = opts === undefined ? {} : assertObject(opts, 'setPartSelection(parts, options)')!;
        assertNoUnknownKeys(o, ['mode'], 'setPartSelection(parts, options)');
        const mode = o.mode === undefined ? 'replace' : assertEnum(o.mode, ['replace', 'add', 'toggle', 'remove'] as const, 'setPartSelection options.mode');
        const names = parts === null ? [] : resolveNames(assertArray(parts, 'setPartSelection(parts)'), 'setPartSelection(parts)');
        if (mode === 'replace') selection = new Set(names);
        else for (const nm of names) {
          if (mode === 'add') selection.add(nm);
          else if (mode === 'remove') selection.delete(nm);
          else if (selection.has(nm)) selection.delete(nm); else selection.add(nm);
        }
        applyView();
        return api.getPartSelection();
      } catch (e) {
        return err(e);
      }
    },
    /** Overlay view: 'all' parts, or 'solo' — only the given parts (default:
     *  the selection) in colour, the rest greyed out. */
    setPartsView(opts: unknown) {
      try {
        const o = assertObject(opts, 'setPartsView(options)')!;
        assertNoUnknownKeys(o, ['mode', 'parts'], 'setPartsView(options)');
        viewMode = assertEnum(o.mode, ['all', 'solo'] as const, 'setPartsView(options).mode');
        soloNames = new Set(o.parts === undefined ? [] : resolveNames(assertArray(o.parts, 'setPartsView(options).parts'), 'setPartsView(options).parts'));
        applyView();
        return api.getPartsView();
      } catch (e) {
        return err(e);
      }
    },
    getPartsView() {
      if (viewMode === 'all') return { mode: viewMode, parts: [] as string[] };
      return { mode: viewMode, parts: [...(soloNames.size ? soloNames : selection)] };
    },
    /** Hover highlight (UI-only state; the panel drives it). */
    setHoveredPart(name: string | null): void {
      if (hovered === name) return;
      hovered = name;
      applyView();
    },
    getHoveredPart(): string | null { return hovered; },
    /** Preview a brush stroke on the overlay (the panel's Select-tool brush):
     *  the covered triangles — or, in `patches` mode, every part they touch —
     *  show in the target colour until the stroke lands. Pass the growing
     *  stroke on each move; null clears it. Not an edit: nothing changes
     *  until editParts({op:'brush'}). */
    setBrushGhost(g: BrushGhost | null): void {
      if (!g) {
        if (!ghost) return;
        ghost = null;
        applyView();
        return;
      }
      if (!draft || !overlayLabels || previewIndex !== null) return;
      const restart = !ghost || ghost.labels !== overlayLabels.labels || ghost.g.mode !== g.mode || ghost.g.radius !== g.radius
        || g.points.length < ghost.done;
      if (restart) {
        ghost = { g, mesh: overlayLabels.mesh, labels: overlayLabels.labels, hit: new Uint8Array(overlayLabels.labels.length), done: 0, touched: new Set() };
      } else ghost!.g = g;
      applyView();
    },
    /** The draft part nearest a world point (e.g. from probePixel). */
    partAt(point: unknown) {
      try {
        const p = assertNumberTuple(point, 3, 'partAt(point)') as [number, number, number];
        const d = currentDraft();
        const m = host.getImports()[d.importIndex];
        let best = -1, bestD = Infinity;
        for (let t = 0; t < m.numTri; t++) {
          let cx = 0, cy = 0, cz = 0;
          for (let k = 0; k < 3; k++) {
            const v = m.triVerts[t * 3 + k] * m.numProp;
            cx += m.vertProperties[v]; cy += m.vertProperties[v + 1]; cz += m.vertProperties[v + 2];
          }
          const dd = (cx / 3 - p[0]) ** 2 + (cy / 3 - p[1]) ** 2 + (cz / 3 - p[2]) ** 2;
          if (dd < bestD) { bestD = dd; best = t; }
        }
        const L = best >= 0 ? d.triPart[best] : -1;
        const part = L >= 0 ? d.summary.parts[L] : undefined;
        return part ? { id: part.id, name: part.name } : { id: null, name: null };
      } catch (e) {
        return err(e);
      }
    },
  };
  return api;
}

export type PartDetectionApi = ReturnType<typeof createPartDetection>;

function countPart(triPart: Int32Array, i: number): number {
  let n = 0;
  for (let t = 0; t < triPart.length; t++) if (triPart[t] === i) n++;
  return n;
}

function sameArray(a: Int32Array, b: Int32Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Source triangle → its index in cut.splitTris (−1 = not split). */
function splitIndexOf(cut: EdgeCut, triCount: number): Int32Array {
  const idx = new Int32Array(triCount).fill(-1);
  for (let i = 0; i < cut.splitTris.length; i++) idx[cut.splitTris[i]] = i;
  return idx;
}

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
