// The Assembly view — shows every part of the active session at once, laid out
// in a non-overlapping grid in the interactive viewport, and (Phase 3) a shared
// parameter panel that drives the union of all parts' parameters.
//
// Flow:
//  • Enter viewport assembly mode (hides the single-part mesh).
//  • Load each part's latest version, then build its mesh — the current part
//    from the seed cache (instant), the rest in PARALLEL via the engine pool.
//  • As each mesh lands, compute its footprint, (re)lay the uniform grid, and
//    drop it into place — the grid fills progressively and reflows if a bigger
//    part arrives.
//  • Once all schemas are known, populate the shared parameter panel.
//
// Orchestration only: the Three.js scene/materials/framing live in the viewport
// (renderer layer); the grid math and param union are pure sibling modules.

import { getState } from '../storage/sessionManager';
import { getLatestVersion, updateVersionParamValues, type Version } from '../storage/db';
import type { Language } from '../geometry/engines/types';
import type { MeshData } from '../geometry/types';
import type { ParamSpec, ParamValue, ParamValues } from '../geometry/params';
import { pruneParamValues } from '../geometry/params';
import type { ImportedMesh } from '../import/importedMesh';
import { buildInPool, disposeEnginePool } from '../geometry/enginePool';
import {
  enterAssemblyMode, exitAssemblyMode, setAssemblyPart, moveAssemblyPart, frameAssembly,
} from '../renderer/viewport';
import { getConfig } from '../config/appConfig';
import { showToast } from '../ui/toast';
import { computeAssemblyGrid, type PartFootprint } from './layout';
import { buildSharedParams, type PartParams, type SharedParam } from './sharedParams';
import { createAssemblyParamsPanel, type AssemblyParamsPanelController } from './assemblyParamsPanel';

export interface AssemblyHost {
  /** Where to append the shared-parameter panel (the viewport pane). */
  mount: HTMLElement;
  /** True for a read-only session viewer — disables Save. */
  isReadOnly: () => boolean;
  /** Instant mesh for a version already built on the main thread (the current
   *  part), so it appears without a rebuild. Return null to build via the pool. */
  seedMesh?: (versionId: string) => MeshData | null;
  /** The declared param schema for a seeded version (the current part already
   *  knows it from its last run), so a seeded part still contributes to the
   *  shared-parameter union without a rebuild. */
  seedSchema?: (versionId: string) => ParamSpec[] | null;
  /** Called once the view has fully closed, so the host can restore the
   *  single-part editor state. */
  onClosed: () => void;
}

interface PartRecord {
  partId: string;
  partName: string;
  versionId: string;
  code: string;
  lang: Language;
  imports: ImportedMesh[];
  companionFiles: Record<string, string> | undefined;
  /** The part's own (persisted) parameter values, plus any live shared edits. */
  values: ParamValues;
  /** Declared schema, filled once the part first builds. */
  schema: ParamSpec[];
  /** Latest footprint, 0 until built (so pending cells still separate). */
  footprint: PartFootprint;
  placed: boolean;
}

let open = false;
let host: AssemblyHost | null = null;
let panel: AssemblyParamsPanelController | null = null;
let records: PartRecord[] = [];
/** Baseline persisted values per part, to detect unsaved shared edits. */
const baseline = new Map<string, ParamValues>();
let framedOnce = false;
/** Bumped on each open so a stale async build from a previous session is dropped. */
let generation = 0;

export function isAssemblyViewOpen(): boolean {
  return open;
}

/** XY footprint (width along X, depth along Y) of a mesh, from its raw verts. */
function meshFootprint(mesh: MeshData): { width: number; depth: number } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const { vertProperties, numVert, numProp } = mesh;
  for (let i = 0; i < numVert; i++) {
    const x = vertProperties[i * numProp];
    const y = vertProperties[i * numProp + 1];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return { width: 0, depth: 0 };
  return { width: maxX - minX, depth: maxY - minY };
}

export async function openAssemblyView(h: AssemblyHost): Promise<void> {
  if (open) return;
  const state = getState();
  if (!state.session || state.parts.length < 2) {
    showToast('Add a second part to view all parts together.', { variant: 'neutral' });
    return;
  }
  open = true;
  host = h;
  framedOnce = false;
  const gen = ++generation;

  enterAssemblyMode();

  panel = createAssemblyParamsPanel({
    onChange: (key, value) => applySharedChange(key, value),
    onSave: () => saveSharedParams(),
    onClose: () => { panel?.element.classList.add('hidden'); },
  });
  host.mount.appendChild(panel.element);

  // Load every part's latest version in parallel.
  const parts = state.parts;
  const versions = await Promise.all(parts.map(p => getLatestVersion(p.id)));
  if (gen !== generation) return; // closed (or reopened) while loading

  records = [];
  baseline.clear();
  for (let i = 0; i < parts.length; i++) {
    const v = versions[i];
    if (!v || !v.code) continue; // a part with no saved geometry yet — skip
    const values = { ...(v.paramValues ?? {}) } as ParamValues;
    baseline.set(parts[i].id, { ...values });
    records.push({
      partId: parts[i].id,
      partName: parts[i].name,
      versionId: v.id,
      code: v.code,
      lang: languageOf(v),
      imports: (v.importedMeshes as ImportedMesh[] | undefined) ?? [],
      companionFiles: v.companionFiles,
      values,
      schema: [],
      footprint: { id: parts[i].id, width: 0, depth: 0 },
      placed: false,
    });
  }

  // Build each part: seed the current part instantly, pool-build the rest.
  await Promise.all(records.map(async (rec) => {
    const seeded = host?.seedMesh?.(rec.versionId) ?? null;
    if (seeded) {
      onPartBuilt(gen, rec, seeded, host?.seedSchema?.(rec.versionId) ?? undefined);
      return;
    }
    try {
      const res = await buildInPool({
        code: rec.code, lang: rec.lang, params: rec.values,
        imports: rec.imports, companionFiles: rec.companionFiles,
      });
      if (gen !== generation) return;
      if (res.mesh) onPartBuilt(gen, rec, res.mesh, res.paramsSchema);
      else if (res.paramsSchema) rec.schema = res.paramsSchema;
    } catch {
      /* build failed or pool disposed — leave the cell empty */
    }
  }));
  if (gen !== generation) return;
  refreshSharedParams();
  frameAssembly();
}

function languageOf(v: Version): Language {
  return (v.language as Language | undefined) ?? 'manifold-js';
}

/** Place a freshly-built part into the grid and reflow the layout. */
function onPartBuilt(gen: number, rec: PartRecord, mesh: MeshData, schema: ParamSpec[] | undefined): void {
  if (gen !== generation) return;
  if (schema) rec.schema = schema;
  const fp = meshFootprint(mesh);
  rec.footprint = { id: rec.partId, width: fp.width, depth: fp.depth };
  const grid = layoutGrid();
  const cell = grid.cells.get(rec.partId) ?? { x: 0, y: 0 };
  setAssemblyPart(rec.partId, mesh, cell.x, cell.y, rec.partName);
  rec.placed = true;
  // Reflow already-placed parts whose cell shifted (a bigger part grew the pitch).
  for (const other of records) {
    if (other === rec || !other.placed) continue;
    const c = grid.cells.get(other.partId);
    if (c) moveAssemblyPart(other.partId, c.x, c.y);
  }
  if (!framedOnce) { frameAssembly(); framedOnce = true; }
}

function layoutGrid() {
  return computeAssemblyGrid(records.map(r => r.footprint), getConfig().renderer.assemblyGridGutter);
}

// === Shared parameters (Phase 3) ===

function refreshSharedParams(): void {
  if (!panel) return;
  const parts: PartParams[] = records
    .filter(r => r.schema.length > 0)
    .map(r => ({ partId: r.partId, partName: r.partName, schema: r.schema, values: r.values }));
  const { params } = buildSharedParams(parts);
  panel.update(params);
  panel.setDirty(isDirty());
}

/** A shared widget changed — apply it to every part that declares the key and
 *  rebuild those parts (live preview). */
function applySharedChange(key: string, value: ParamValue): void {
  const gen = generation;
  const affected = records.filter(r => r.schema.some(s => s.key === key));
  for (const rec of affected) {
    rec.values = { ...rec.values, [key]: value };
    void rebuildPart(gen, rec);
  }
  panel?.setDirty(isDirty());
}

async function rebuildPart(gen: number, rec: PartRecord): Promise<void> {
  try {
    const res = await buildInPool({
      code: rec.code, lang: rec.lang, params: rec.values,
      imports: rec.imports, companionFiles: rec.companionFiles,
    });
    if (gen !== generation || !res.mesh) return;
    onPartBuilt(gen, rec, res.mesh, res.paramsSchema);
  } catch {
    /* rebuild failed — keep the previous mesh in place */
  }
}

function isDirty(): boolean {
  for (const rec of records) {
    const base = baseline.get(rec.partId) ?? {};
    const pruned = pruneParamValues(rec.schema, rec.values);
    if (JSON.stringify(pruned) !== JSON.stringify(pruneKeys(base, rec.schema))) return true;
  }
  return false;
}

/** Prune a stored value bag to the given schema's keys (drops stale/defaulted). */
function pruneKeys(values: ParamValues, schema: ParamSpec[]): ParamValues {
  return pruneParamValues(schema, values);
}

async function saveSharedParams(): Promise<void> {
  if (!host || host.isReadOnly()) {
    showToast('Read-only session — parameters can’t be saved here.', { variant: 'warn' });
    return;
  }
  panel?.setSaving(true);
  const gen = generation;
  let saved = 0;
  try {
    for (const rec of records) {
      const base = baseline.get(rec.partId) ?? {};
      const pruned = pruneParamValues(rec.schema, rec.values);
      if (JSON.stringify(pruned) === JSON.stringify(pruneKeys(base, rec.schema))) continue;
      await updateVersionParamValues(rec.versionId, pruned);
      baseline.set(rec.partId, { ...rec.values });
      saved++;
    }
  } finally {
    if (gen === generation) {
      panel?.setSaving(false);
      panel?.setDirty(isDirty());
    }
  }
  showToast(saved > 0 ? `Saved parameters to ${saved} part${saved === 1 ? '' : 's'}.` : 'No changes to save.', {
    variant: saved > 0 ? 'success' : 'neutral',
    source: 'assembly',
  });
}

export function closeAssemblyView(): void {
  if (!open) return;
  generation++; // invalidate any in-flight builds
  exitAssemblyMode();
  disposeEnginePool();
  panel?.element.remove();
  panel = null;
  records = [];
  baseline.clear();
  const h = host;
  open = false;
  host = null;
  h?.onClosed();
}

/** For diagnostics / the console API: a snapshot of the current assembly. */
export function getAssemblySnapshot(): {
  open: boolean;
  parts: { id: string; name: string; placed: boolean }[];
  sharedParams: SharedParam[];
} {
  const parts = records.map(r => ({ id: r.partId, name: r.partName, placed: r.placed }));
  const partParams: PartParams[] = records
    .filter(r => r.schema.length > 0)
    .map(r => ({ partId: r.partId, partName: r.partName, schema: r.schema, values: r.values }));
  return { open, parts, sharedParams: buildSharedParams(partParams).params };
}
