import type { Engine, MeshResult, ValidateResult } from './types';
import { javaScriptSyntaxDiagnostics, runtimeDiagnostic } from '../sourceDiagnostics';
import { VoxelGrid, decodeGrid, normalizeColor } from '../voxel/grid';
import { meshGrid, gridToMeshWithProvenance, type VoxelMesh } from '../voxel/mesher';
import { createParamCapture, type ParamCapture } from '../params';
import { createSdfNamespace } from '../sdf';
import { ValidationError } from '../../validation/apiValidation';
import { assertModelCodeRealm } from '../workerLockdown';

// The `voxel` engine: user code builds a sparse VoxelGrid and returns it; we
// mesh the exposed faces into welded `MeshData` (with per-voxel colors) that
// flows through the rest of the app exactly like a Manifold mesh. Pure JS —
// no WASM — so init is a no-op and execution stays synchronous.

/** The sandbox `voxels` handle: callable factory plus `.decode()` for grids
 *  produced by an image import. */
interface VoxelsHandle {
  (): VoxelGrid;
  /** Rebuild a grid from an `encodeGrid` string (used by image-import code). */
  decode(data: string): VoxelGrid;
  /** Normalize any accepted color form to a packed `0xRRGGBB` number. */
  color(c: Parameters<typeof normalizeColor>[0]): number;
}

// In a voxel session there is no Manifold engine, so an SDF node can't be
// lowered to a mesh via levelSet — it's sampled into the grid with v.sdf()
// instead. The SDF primitive/combinator methods never touch Manifold (only
// `.build()` does), so we hand createSdfNamespace a guard that throws a
// pointed message the moment anyone reaches for build()/levelSet.
const SDF_BUILD_GUARD = new Proxy({}, {
  get() {
    throw new ValidationError("api.sdf.build() isn't available in a voxel session (no Manifold engine). Sample the SDF into the grid instead: `v.sdf(node, { res, color })`. See /ai/voxel.md#sdf");
  },
});

// `api.paint.*` / `api.surface.*` are manifold-js-only sandbox APIs (they
// record ops against the run's triangle mesh). Without these guards a voxel
// session calling them gets an opaque "Cannot read properties of undefined" —
// throw a pointed message instead, same pattern as SDF_BUILD_GUARD above.
const manifoldOnlyNamespaceGuard = (ns: 'paint' | 'surface') => new Proxy({}, {
  get() {
    throw new ValidationError(ns === 'paint'
      ? 'api.paint.* is only available in manifold-js (JS) sessions. In a voxel session, color voxels directly: v.set(x, y, z, color) / v.fillBox(..., color). See /ai/voxel.md'
      : 'api.surface.* is only available in manifold-js (JS) sessions — a voxel grid has no triangle skin to texture. Switch to a manifold-js session (or bake via voxelizeModel from one). See /ai/textures.md');
  },
});

/** `removedPieces` collects `api.removePiece([x, y, z])` calls — what the
 *  object list's ✕ writes; each run path applies them to the returned grid. */
function createVoxelApi(params: ParamCapture['params'] | undefined, removedPieces: [number, number, number][]) {
  const voxels = (() => new VoxelGrid()) as VoxelsHandle;
  voxels.decode = (data: string) => decodeGrid(data);
  voxels.color = (c) => normalizeColor(c);
  // `api.sdf` is the same declarative SDF namespace as manifold-js sessions —
  // gyroids, TPMS lattices, smooth blends, twists — but here it feeds
  // `v.sdf(node)` (rasterize into the grid) rather than `.build()` (mesh via
  // levelSet). Authors reuse one API across both engines.
  const sdf = createSdfNamespace(SDF_BUILD_GUARD, (shape) => shape);
  // `api.params({...})` is exposed identically across all JS-sandbox engines
  // (manifold-js, voxel, replicad) so a Customizer-driven voxel model gets the
  // same live slider/toggle panel. Omitted only on paths that don't capture a
  // schema (none currently — both run paths pass it).
  const removePiece = (point: unknown): void => {
    if (!Array.isArray(point) || point.length !== 3 || point.some(n => typeof n !== 'number' || !Number.isFinite(n))) {
      throw new ValidationError('api.removePiece(point): point must be [x, y, z] — a point on the separate piece to remove.');
    }
    removedPieces.push(point as [number, number, number]);
  };
  return {
    voxels, VoxelGrid, sdf, removePiece,
    paint: manifoldOnlyNamespaceGuard('paint'),
    surface: manifoldOnlyNamespaceGuard('surface'),
    ...(params ? { params } : {}),
  };
}

function isVoxelGrid(v: unknown): v is VoxelGrid {
  return v instanceof VoxelGrid
    || (v != null && typeof v === 'object' && (v as { __isVoxelGrid?: unknown }).__isVoxelGrid === true);
}

export const voxelEngine: Engine = {
  id: 'voxel',

  // Pure JS — nothing to load.
  async init() { /* no-op */ },

  isReady() { return true; },

  run(jsCode: string, paramOverrides?: Record<string, unknown>): MeshResult {
    assertModelCodeRealm('voxel code');
    const capture = createParamCapture(paramOverrides);
    const removedPieces: [number, number, number][] = [];
    const api = createVoxelApi(capture.params, removedPieces);
    let result: unknown;
    try {
      const fn = new Function('api', `"use strict";\n${jsCode}`);
      result = fn(api);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const isSyntaxError = e instanceof SyntaxError;
      // The schema rides on error returns too (matching manifold-js) so a
      // model that declared params before throwing keeps its Customizer panel
      // live for correction. `collectSchema()` returns whatever was captured
      // before the throw — possibly undefined, which is the right answer.
      return {
        mesh: null,
        manifold: null,
        error: msg,
        diagnostics: isSyntaxError
          ? javaScriptSyntaxDiagnostics(jsCode, msg, e)
          : runtimeDiagnostic(msg, undefined, 'JavaScript'),
        paramsSchema: capture.collectSchema(),
      };
    }

    if (!isVoxelGrid(result)) {
      const error = 'Voxel code must `return` a grid. Build one with `const v = api.voxels(); v.fillBox([0,0,0],[9,9,9], "#88aaff"); return v;`. See /ai/voxel.md';
      return {
        mesh: null,
        manifold: null,
        error,
        diagnostics: runtimeDiagnostic(error, 'Add a final `return` that returns the grid from api.voxels().', 'JavaScript'),
        paramsSchema: capture.collectSchema(),
      };
    }

    const grid = result as VoxelGrid;
    for (const p of removedPieces) grid.removePieceAt(p);
    if (grid.size === 0) {
      const error = 'The voxel grid is empty — set some voxels (e.g. v.set(0,0,0,"#fff") or v.fillBox(...)) before returning it.';
      return {
        mesh: null,
        manifold: null,
        error,
        diagnostics: runtimeDiagnostic(error, 'Occupy at least one voxel before returning the grid.', 'JavaScript'),
        paramsSchema: capture.collectSchema(),
      };
    }

    try {
      const mesh = meshGrid(grid);
      return {
        mesh, manifold: null, error: null, paramsSchema: capture.collectSchema(),
        // The grid itself, as transferable data: the main thread keeps it for
        // VOX / greedy-mesh export and Voxel Studio instead of re-running the
        // model code itself (model code only ever runs in the engine Worker).
        voxelGrid: grid.toTransfer(),
        voxelCount: grid.size, voxelPieceCount: grid.faceComponentCount(),
        ...(grid.sdfRes !== null ? { voxelRes: grid.sdfRes } : {}),
        ...(grid.sdfResMixed ? { voxelResMixed: true } : {}),
        ...(grid.sdfLabelCounts ? { sdfLabelCounts: grid.sdfLabelCounts } : {}),
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { mesh: null, manifold: null, error: msg, diagnostics: runtimeDiagnostic(msg, undefined, 'JavaScript'), paramsSchema: capture.collectSchema() };
    }
  },

  validate(jsCode: string): ValidateResult {
    try {
      new Function('api', `"use strict";\n${jsCode}`);
      return { valid: true };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      return {
        valid: false,
        error,
        diagnostics: e instanceof SyntaxError ? javaScriptSyntaxDiagnostics(jsCode, error, e) : undefined,
      };
    }
  },
};

/** Result of {@link voxelPaintRunFromGrid}: the grid voxel paint edits plus its
 *  block mesh and per-triangle voxel provenance. */
export interface VoxelPaintRun extends VoxelMesh { grid: VoxelGrid }

/** Evaluate voxel model code and return the resulting grid (removePiece calls
 *  applied). ENGINE-WORKER ONLY — it runs model code, so it refuses to run on
 *  the main thread (#1090). The main thread asks the Worker for a grid via the
 *  `voxel_grid` message (engine.ts `runVoxelGridInWorker`) and rebuilds it from
 *  data with `VoxelGrid.fromTransfer`. */
export function runVoxelGrid(jsCode: string, paramOverrides?: Record<string, unknown>): { ok: true; grid: VoxelGrid } | { ok: false; error: string } {
  assertModelCodeRealm('voxel code');
  const removedPieces: [number, number, number][] = [];
  const api = createVoxelApi(createParamCapture(paramOverrides).params, removedPieces);
  let result: unknown;
  try {
    const fn = new Function('api', `"use strict";\n${jsCode}`);
    result = fn(api);
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (!isVoxelGrid(result)) return { ok: false, error: 'Voxel code must return a grid.' };
  const grid = result as VoxelGrid;
  for (const p of removedPieces) grid.removePieceAt(p);
  if (grid.size === 0) return { ok: false, error: 'The voxel grid is empty.' };
  return { ok: true, grid };
}

/** Block mesh + tri→voxel provenance for voxel paint, from an already-built
 *  grid (pure data — no model code runs). Paint operations mutate `grid` and
 *  re-mesh in place on the main thread. Smooth surfacing is honored for
 *  rendering only — paint operates on the un-supersampled, block-meshed grid
 *  so triangle indices map cleanly to user-authored voxels. */
export function voxelPaintRunFromGrid(grid: VoxelGrid): VoxelPaintRun {
  const { mesh, triVoxel, triNormal } = gridToMeshWithProvenance(grid);
  return { grid, mesh, triVoxel, triNormal };
}
