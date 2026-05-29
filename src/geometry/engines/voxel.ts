import type { Engine, MeshResult, ValidateResult } from './types';
import { javaScriptSyntaxDiagnostics, runtimeDiagnostic } from '../sourceDiagnostics';
import { VoxelGrid, decodeGrid, normalizeColor } from '../voxel/grid';
import { meshGrid } from '../voxel/mesher';

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

function createVoxelApi() {
  const voxels = (() => new VoxelGrid()) as VoxelsHandle;
  voxels.decode = (data: string) => decodeGrid(data);
  voxels.color = (c) => normalizeColor(c);
  return { voxels, VoxelGrid };
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

  run(jsCode: string): MeshResult {
    const api = createVoxelApi();
    let result: unknown;
    try {
      const fn = new Function('api', `"use strict";\n${jsCode}`);
      result = fn(api);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const isSyntaxError = e instanceof SyntaxError;
      return {
        mesh: null,
        manifold: null,
        error: msg,
        diagnostics: isSyntaxError
          ? javaScriptSyntaxDiagnostics(jsCode, msg, e)
          : runtimeDiagnostic(msg, undefined, 'JavaScript'),
      };
    }

    if (!isVoxelGrid(result)) {
      const error = 'Voxel code must `return` a grid. Build one with `const v = api.voxels(); v.fillBox([0,0,0],[9,9,9], "#88aaff"); return v;`. See /ai/voxel.md';
      return {
        mesh: null,
        manifold: null,
        error,
        diagnostics: runtimeDiagnostic(error, 'Add a final `return` that returns the grid from api.voxels().', 'JavaScript'),
      };
    }

    const grid = result as VoxelGrid;
    if (grid.size === 0) {
      const error = 'The voxel grid is empty — set some voxels (e.g. v.set(0,0,0,"#fff") or v.fillBox(...)) before returning it.';
      return {
        mesh: null,
        manifold: null,
        error,
        diagnostics: runtimeDiagnostic(error, 'Occupy at least one voxel before returning the grid.', 'JavaScript'),
      };
    }

    try {
      const mesh = meshGrid(grid);
      return { mesh, manifold: null, error: null };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { mesh: null, manifold: null, error: msg, diagnostics: runtimeDiagnostic(msg, undefined, 'JavaScript') };
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
