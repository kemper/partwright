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
import { knitTexture, type KnitTextureOptions } from './knitTexture';
import { cableKnit, type CableKnitOptions } from './cableKnit';
import { waffleStitch, type WaffleStitchOptions } from './waffleStitch';
import { furVelvet, type FurVelvetOptions } from './furVelvet';
import { wovenFabric, type WovenFabricOptions } from './wovenFabric';
import { smoothSurface, type SmoothOptions } from './smoothSurface';
import { voxelizeMesh, type VoxelizeOptions } from './voxelizeMesh';
import { extractPositions, bboxOf } from './meshSubdivide';
import { encodeGrid } from '../geometry/voxel/grid';
import { scaleMesh } from './scaleMesh';
import { meshGrid } from '../geometry/voxel/mesher';

export type SurfaceModifierId = 'fuzzy' | 'knit' | 'cable' | 'waffle' | 'fur' | 'woven' | 'smooth' | 'voxelize';

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
  return { amplitude: d * 0.01, scale: d * 0.04, octaves: 2, seed: 1, quality: 3, subdivide: true };
}

/** Size-relative starting parameters for knit texture (~3% amplitude, ~5% stitch width). */
export function defaultKnitOptions(mesh: MeshData): Required<KnitTextureOptions> {
  const d = modelDiagonal(mesh) || 10;
  const sw = d * 0.05;
  return {
    amplitude: d * 0.03,
    stitchWidth: sw,
    stitchHeight: sw * 1.4,
    rowOffset: 0.5,
    roundness: 0.5,
    grainAngleDeg: 0,
    variation: 0.1,
    seed: 1,
    quality: 3,
    subdivide: true,
  };
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

export { type KnitTextureOptions };
export { type CableKnitOptions };
export { type WaffleStitchOptions };
export { type FurVelvetOptions };
export { type WovenFabricOptions };

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

export function applyKnit(mesh: MeshData, opts: KnitTextureOptions): ModifierManifoldResult {
  const baked = knitTexture(mesh, opts);
  return {
    kind: 'manifold',
    label: 'knit texture',
    mesh: baked,
    code: manifoldWrapper([
      `Knit texture applied on ${today()} — stitch ${opts.stitchWidth.toFixed(2)} × ${(opts.stitchHeight ?? opts.stitchWidth * 1.4).toFixed(2)}, amplitude ${opts.amplitude}.`,
      `The textured mesh is baked onto api.imports[0]. Re-apply from the Surface panel to retune.`,
    ]),
  };
}

export function defaultCableOptions(mesh: MeshData): Required<CableKnitOptions> {
  const d = modelDiagonal(mesh) || 10;
  const cw = d * 0.08;
  return {
    amplitude: d * 0.03,
    cableWidth: cw,
    cablePitch: cw * 2.5,
    plyWidth: cw * 0.3,
    grainAngleDeg: 0,
    variation: 0.08,
    seed: 1,
    quality: 3,
    subdivide: true,
  };
}

export function defaultWaffleOptions(mesh: MeshData): Required<WaffleStitchOptions> {
  const d = modelDiagonal(mesh) || 10;
  return {
    amplitude: d * 0.025,
    cellWidth: d * 0.06,
    cellHeight: d * 0.06,
    sharpness: 3,
    rowOffset: 0,
    grainAngleDeg: 0,
    seed: 1,
    quality: 3,
    subdivide: true,
  };
}

export function defaultFurOptions(mesh: MeshData): Required<FurVelvetOptions> {
  const d = modelDiagonal(mesh) || 10;
  const fs = d * 0.02;
  return {
    amplitude: d * 0.025,
    fiberSpacing: fs,
    fiberLength: fs * 6,
    octaves: 2,
    grainAngleDeg: 0,
    seed: 1,
    quality: 3,
    subdivide: true,
  };
}

export function defaultWovenOptions(mesh: MeshData): Required<WovenFabricOptions> {
  const d = modelDiagonal(mesh) || 10;
  return {
    amplitude: d * 0.02,
    threadSpacing: d * 0.04,
    threadWidth: 0.4,
    underDepth: 0.3,
    grainAngleDeg: 0,
    seed: 1,
    quality: 3,
    subdivide: true,
  };
}

export function applyCable(mesh: MeshData, opts: CableKnitOptions): ModifierManifoldResult {
  const baked = cableKnit(mesh, opts);
  return {
    kind: 'manifold',
    label: 'cable knit',
    mesh: baked,
    code: manifoldWrapper([
      `Cable knit applied on ${today()} — cable width ${opts.cableWidth.toFixed(2)}, pitch ${(opts.cablePitch ?? opts.cableWidth * 2.5).toFixed(2)}.`,
      `The textured mesh is baked onto api.imports[0]. Re-apply from the Surface panel to retune.`,
    ]),
  };
}

export function applyWaffle(mesh: MeshData, opts: WaffleStitchOptions): ModifierManifoldResult {
  const baked = waffleStitch(mesh, opts);
  return {
    kind: 'manifold',
    label: 'waffle stitch',
    mesh: baked,
    code: manifoldWrapper([
      `Waffle stitch applied on ${today()} — cell ${opts.cellWidth.toFixed(2)} × ${(opts.cellHeight ?? opts.cellWidth).toFixed(2)}, sharpness ${opts.sharpness ?? 3}.`,
      `The textured mesh is baked onto api.imports[0]. Re-apply from the Surface panel to retune.`,
    ]),
  };
}

export function applyFur(mesh: MeshData, opts: FurVelvetOptions): ModifierManifoldResult {
  const baked = furVelvet(mesh, opts);
  return {
    kind: 'manifold',
    label: 'fur / velvet',
    mesh: baked,
    code: manifoldWrapper([
      `Fur/velvet texture applied on ${today()} — fiber spacing ${opts.fiberSpacing.toFixed(3)}, length ${(opts.fiberLength ?? opts.fiberSpacing * 6).toFixed(3)}.`,
      `The textured mesh is baked onto api.imports[0]. Re-apply from the Surface panel to retune.`,
    ]),
  };
}

export function applyWoven(mesh: MeshData, opts: WovenFabricOptions): ModifierManifoldResult {
  const baked = wovenFabric(mesh, opts);
  return {
    kind: 'manifold',
    label: 'woven fabric',
    mesh: baked,
    code: manifoldWrapper([
      `Woven fabric applied on ${today()} — thread spacing ${opts.threadSpacing.toFixed(3)}, width ${opts.threadWidth ?? 0.4}.`,
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

export function applyScale(
  mesh: MeshData,
  sx: number,
  sy: number,
  sz: number,
): ModifierManifoldResult {
  const baked = scaleMesh(mesh, sx, sy, sz);
  const uniform = sx === sy && sy === sz;
  const desc = uniform
    ? `${(sx * 100).toFixed(1)}%`
    : `X×${sx.toFixed(4)} Y×${sy.toFixed(4)} Z×${sz.toFixed(4)}`;
  return {
    kind: 'manifold',
    label: `scaled (${desc})`,
    mesh: baked,
    code: manifoldWrapper([
      `Scaled on ${today()} — ${desc}.`,
      `The resized mesh is baked onto api.imports[0]. Open the Resize panel to scale further.`,
    ]),
  };
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
