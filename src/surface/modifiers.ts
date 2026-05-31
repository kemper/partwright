// Surface modifiers: high-level, UI-agnostic operations that take the current
// model's mesh and produce a *commit descriptor* — the editor code plus any
// baked geometry — for the host (main.ts) to run and save as a new version.
//
// Two commit shapes mirror how existing features land geometry:
//   - 'manifold' — the result is baked to a mesh carried on `api.imports[0]`
//     and rebuilt with `Manifold.ofMesh(...)`, exactly like an STL import. Used
//     by fuzzy skin and smooth, which need per-vertex work the code can't do.
//   - 'voxel'    — the result is a sparse grid inlined as `voxels.decode("…")`,
//     exactly like the image→voxel import. Used by voxelize.
//
// The geometry math lives in sibling pure modules; this file only orchestrates
// and emits code, so it stays dependency-light and unit-testable.

import type { MeshData } from '../geometry/types';
import { fuzzySkin, type FuzzySkinOptions } from './fuzzySkin';
import { smoothSurface, type SmoothOptions } from './smoothSurface';
import { voxelizeMesh, type VoxelizeOptions } from './voxelizeMesh';
import { extractPositions, bboxOf } from './meshSubdivide';
import { encodeGrid } from '../geometry/voxel/grid';
import { meshGrid } from '../geometry/voxel/mesher';

export type SurfaceModifierId = 'fuzzy' | 'smooth' | 'voxelize';

export interface ModifierManifoldResult {
  kind: 'manifold';
  /** Short version label, e.g. "fuzzy skin". */
  label: string;
  /** Editor code that rebuilds the baked mesh from `api.imports[0]`. */
  code: string;
  /** Baked mesh to attach to the new version as an imported mesh. */
  mesh: MeshData;
}

export interface ModifierVoxelResult {
  kind: 'voxel';
  label: string;
  /** Editor code that rebuilds the grid via `voxels.decode(...)`. */
  code: string;
  /** The meshed grid (with per-voxel colors), for non-destructive preview —
   *  what the voxel engine would render once the code runs. */
  previewMesh: MeshData;
}

export type ModifierResult = ModifierManifoldResult | ModifierVoxelResult;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Bounding-box diagonal of a mesh — the basis for size-relative defaults. */
export function modelDiagonal(mesh: MeshData): number {
  const { size } = bboxOf(extractPositions(mesh));
  return Math.hypot(size[0], size[1], size[2]);
}

/** Size-relative starting parameters for fuzzy skin (subtle ~1% displacement). */
export function defaultFuzzyOptions(mesh: MeshData): Required<FuzzySkinOptions> {
  const d = modelDiagonal(mesh) || 10;
  return { amplitude: d * 0.01, scale: d * 0.04, octaves: 2, seed: 1, subdivide: true };
}

/** Starting parameters for the smooth/round modifier. */
export function defaultSmoothOptions(): Required<Omit<SmoothOptions, 'maxEdge'>> {
  return { iterations: 4, subdivide: true };
}

/** Wrapper code for a baked manifold result. Mirrors the STL-import codegen:
 *  a human-readable header and one self-contained `return`. */
function manifoldWrapper(headerLines: string[]): string {
  return `${headerLines.map(l => `// ${l}`).join('\n')}
const { Manifold } = api;
return Manifold.ofMesh(api.imports[0]);
`;
}

export function applyFuzzy(mesh: MeshData, opts: FuzzySkinOptions): ModifierManifoldResult {
  const baked = fuzzySkin(mesh, opts);
  return {
    kind: 'manifold',
    label: 'fuzzy skin',
    mesh: baked,
    code: manifoldWrapper([
      `Fuzzy skin applied on ${today()} — amplitude ${opts.amplitude}, feature ~${opts.scale}.`,
      `The textured mesh is baked onto api.imports[0]. Re-apply from the Surface panel to retune.`,
    ]),
  };
}

export function applySmooth(mesh: MeshData, opts: SmoothOptions): ModifierManifoldResult {
  const baked = smoothSurface(mesh, opts);
  return {
    kind: 'manifold',
    label: 'smoothed',
    mesh: baked,
    code: manifoldWrapper([
      `Smoothed on ${today()} — ${opts.iterations ?? 4} Taubin pass pairs.`,
      `The rounded mesh is baked onto api.imports[0]. Re-apply from the Surface panel to retune.`,
    ]),
  };
}

export interface VoxelizeModifierOptions extends VoxelizeOptions {
  /** Emit a `.smooth()` call so the voxels render with rounded corners. */
  smooth?: boolean;
}

export function applyVoxelize(mesh: MeshData, opts: VoxelizeModifierOptions): ModifierVoxelResult {
  const grid = voxelizeMesh(mesh, opts);
  // encodeGrid serializes only occupancy + colors (not the surfacing flag), so
  // encode first, then flip the in-memory grid to smooth purely so the preview
  // mesh below matches what the emitted `v.smooth()` produces at runtime.
  const encoded = encodeGrid(grid);
  if (opts.smooth) grid.smooth();
  const smoothCall = opts.smooth ? `\nv.smooth();` : '';
  const code = `// Voxelized from the current model on ${today()} (resolution ${opts.resolution ?? 32}).
// Edit below — toggle "Smooth voxels" for rounded corners, or v.fillBox(...) to extend.
const { voxels } = api;
const v = voxels.decode(${JSON.stringify(encoded)});${smoothCall}
return v;
`;
  // `meshGrid` honors the grid's surfacing flag (blocks/smooth) and carries
  // per-voxel colors, so the preview matches what the emitted code renders.
  return {
    kind: 'voxel',
    label: opts.smooth ? 'voxelized (smooth)' : 'voxelized',
    code,
    previewMesh: meshGrid(grid),
  };
}
