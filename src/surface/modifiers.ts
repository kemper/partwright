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
import { knitTextureUV, knitTextureUVAsync, knitTextureUVPatch, knitTextureUVPatchAsync, type KnitTextureOptions } from './knitTexture';
import { cableKnit, type CableKnitOptions } from './cableKnit';
import { waffleStitch, type WaffleStitchOptions } from './waffleStitch';
import { furVelvet, type FurVelvetOptions } from './furVelvet';
import { wovenFabric, type WovenFabricOptions } from './wovenFabric';
import { voronoiShell, type VoronoiShellOptions } from './voronoiShell';
import { voronoiLattice, type VoronoiLampOptions } from './voronoiLattice';
import { smoothSurface, type SmoothOptions } from './smoothSurface';
import { voxelizeMesh, type VoxelizeOptions } from './voxelizeMesh';
import { extractPositions, bboxOf, subdivideWithMask, subdivideToMaxEdge } from './meshSubdivide';
import { encodeGrid } from '../geometry/voxel/grid';
import { formatSurfacingCall } from '../geometry/voxel/editCodegen';
import { scaleMesh } from './scaleMesh';
import { applySteps, type TransformStep } from './placement';
import { meshGrid } from '../geometry/voxel/mesher';
import { voronoiLampSdfMesh } from './voronoiLampSdf';
import { engraveMesh, type EngraveSdfOptions } from './engraveSdf';
import { type EngraveProjection } from './engraveStamp';
import { type SdfRunControl } from './sdfModifier';

export type SurfaceModifierId = 'fuzzy' | 'knit' | 'cable' | 'waffle' | 'fur' | 'woven' | 'voronoi' | 'voronoiLamp' | 'engrave' | 'smooth' | 'voxelize';

export interface ModifierManifoldResult {
  kind: 'manifold';
  /** Short version label, e.g. "fuzzy skin". */
  label: string;
  /** Editor code that rebuilds the baked mesh from `api.imports[0]`. */
  code: string;
  /** Baked mesh to attach to the new version as an imported mesh. */
  mesh: MeshData;
  /** Optional painted source mesh for color carry when the baked `mesh` itself
   *  carries no per-triangle color — i.e. a fully re-meshed result (engrave,
   *  voronoi lamp) where colors can only be transferred spatially from the
   *  original. The commit falls back to a nearest-triangle transfer from this. */
  colorSource?: MeshData;
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

/** A dense color-source for a fully re-meshed result (engrave / voronoi lamp).
 *  The color carry maps each new triangle to the *nearest old triangle centroid*,
 *  which is unreliable when the source has a few huge faces (a plain cube): a new
 *  top-face triangle near a corner can be closer to a side-face centroid. We
 *  subdivide the painted input to small triangles first (carrying triColors and
 *  the `_painted` mask) so the centroids are dense and the transfer is faithful.
 *  Returns undefined when the input carries no paint. */
function denseColorSource(mesh: MeshData): MeshData | undefined {
  if (mesh.triColors == null) return undefined;
  const maxEdge = (modelDiagonal(mesh) || 10) / 80;
  return subdivideToMaxEdge(mesh, { maxEdge, maxRounds: 5 });
}

/** Size-relative starting parameters for fuzzy skin (subtle ~1% displacement). */
export function defaultFuzzyOptions(mesh: MeshData): Required<FuzzySkinOptions> {
  const d = modelDiagonal(mesh) || 10;
  return { amplitude: d * 0.01, scale: d * 0.04, octaves: 2, seed: 1, quality: 3, subdivide: true };
}

/** Compute the target max-edge-length for a quality-based subdivision pass.
 *  Mirrors the formula used by fuzzySkin and other whole-model paths so the
 *  patch path reaches the same vertex density for a given quality setting.
 *  maxRounds is always 4 (same as the whole-model path in fuzzySkin/cableKnit/etc.)
 *  so that a coarse mesh like a cube reaches the same subdivision depth as the
 *  whole-model Apply would. */
function patchSubdivTarget(diag: number, featureSize: number, quality: number): { maxEdge: number; maxRounds: number } {
  const q = Math.max(1, Math.min(5, Math.round(quality)));
  const qScale = 2 ** ((q - 3) / 2);
  const maxEdge = Math.max(featureSize / (2 * qScale), diag / (200 * qScale));
  return { maxEdge, maxRounds: 4 };
}

/** Size-relative starting parameters for knit texture (~3.5% amplitude, ~5% stitch width). */
export function defaultKnitOptions(mesh: MeshData): Required<KnitTextureOptions> {
  const d = modelDiagonal(mesh) || 10;
  const sw = d * 0.05;
  return {
    amplitude: d * 0.035,
    stitchWidth: sw,
    stitchHeight: sw * 1.4,
    rowOffset: 0.5,
    roundness: 0.5,
    grainAngleDeg: 0,
    variation: 0.1,
    seed: 1,
    quality: 3,
    subdivide: true,
    algorithm: 'bfs',
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
export { type VoronoiShellOptions };
export { type VoronoiLampOptions };
export { type EngraveProjection, type StampMask } from './engraveStamp';
export { type SdfRunControl, SdfAbortError } from './sdfModifier';

/** Wrap a hand-sculpted mesh (from the interactive Mesh Sculpt session) as a
 *  baked manifold result — same commit shape as fuzzy skin / smooth, so it
 *  reuses the whole color-carry + save path. The mesh already has its final
 *  vertex positions; we only emit the rebuild wrapper. */
export function buildSculptResult(mesh: MeshData, dabs: number): ModifierManifoldResult {
  return {
    kind: 'manifold',
    label: 'sculpted',
    mesh,
    code: manifoldWrapper([
      `Sculpted on ${today()} — ${dabs} brush ${dabs === 1 ? 'dab' : 'dabs'} baked.`,
      `The sculpted mesh is baked onto api.imports[0]. Re-open Mesh Sculpt to keep shaping.`,
    ]),
  };
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

export function applyKnit(mesh: MeshData, opts: KnitTextureOptions): ModifierManifoldResult {
  const baked = knitTextureUV(mesh, opts);
  return knitManifoldResult(opts, baked);
}

/** Async variant used by the applyKnitTexture API — runs displacement on the GPU when available. */
export async function applyKnitAsync(mesh: MeshData, opts: KnitTextureOptions): Promise<ModifierManifoldResult> {
  const baked = await knitTextureUVAsync(mesh, opts);
  return knitManifoldResult(opts, baked);
}

function knitManifoldResult(opts: KnitTextureOptions, mesh: MeshData, label = 'knit texture'): ModifierManifoldResult {
  return {
    kind: 'manifold',
    label,
    mesh,
    code: manifoldWrapper([
      `Knit texture applied on ${today()} — stitch ${opts.stitchWidth.toFixed(2)} × ${(opts.stitchHeight ?? opts.stitchWidth * 1.4).toFixed(2)}, amplitude ${opts.amplitude}.`,
      `The textured mesh is baked onto api.imports[0]. Re-apply from the Surface panel to retune.`,
    ]),
  };
}

/** Densify the selected region before the knit patch is unwrapped and
 *  displaced. The knit patch path has its own bespoke extractor (boundary-
 *  falloff BFS), so unlike the other modifiers it can't go through runOnPatch —
 *  and it was the ONE patch modifier that skipped subdivision entirely, leaving
 *  a coarse selection (e.g. a couple of cube faces) with too few vertices to
 *  carry stitch geometry, so the texture came out faint or invisible. Mirror
 *  the sibling patches: subdivide the masked region to the same per-quality
 *  density (gated on amplitude, like the whole-model knit path) and remap the
 *  selection onto the denser mesh, then run the normal patch knit on that. */
function densifyKnitPatch(mesh: MeshData, opts: KnitTextureOptions, selectedTris: Set<number>): { mesh: MeshData; tris: Set<number> } {
  if (Math.max(0, opts.amplitude) <= 0) return { mesh, tris: selectedTris };
  const diag = modelDiagonal(mesh) || 10;
  const stitchW = Math.max(1e-4, opts.stitchWidth);
  const stitchH = Math.max(1e-4, opts.stitchHeight ?? stitchW * 1.4);
  const pre = patchSubdivTarget(diag, Math.min(stitchW, stitchH), opts.quality ?? 3);
  const r = subdivideWithMask(mesh, pre, selectedTris);
  return { mesh: r.mesh, tris: r.selectedTris };
}

export function applyKnitPatch(mesh: MeshData, opts: KnitTextureOptions, selectedTris: Set<number>): ModifierManifoldResult {
  const { mesh: dense, tris } = densifyKnitPatch(mesh, opts, selectedTris);
  const baked = knitTextureUVPatch(dense, opts, tris);
  return knitManifoldResult(opts, baked, 'knit texture (patch)');
}

export async function applyKnitPatchAsync(mesh: MeshData, opts: KnitTextureOptions, selectedTris: Set<number>): Promise<ModifierManifoldResult> {
  const { mesh: dense, tris } = densifyKnitPatch(mesh, opts, selectedTris);
  const baked = await knitTextureUVPatchAsync(dense, opts, tris);
  return knitManifoldResult(opts, baked, 'knit texture (patch)');
}

// --- General patch helper (all non-knit modifiers) ---

function extractPatchMesh(mesh: MeshData, selectedTris: Set<number>): {
  patchMesh: MeshData;
  localToGlobal: number[];
  hopDist: Float32Array;
} {
  const patchVertSet = new Set<number>();
  for (const t of selectedTris) {
    patchVertSet.add(mesh.triVerts[t * 3]);
    patchVertSet.add(mesh.triVerts[t * 3 + 1]);
    patchVertSet.add(mesh.triVerts[t * 3 + 2]);
  }
  const localToGlobal = Array.from(patchVertSet);
  const globalToLocal = new Map<number, number>();
  for (let i = 0; i < localToGlobal.length; i++) globalToLocal.set(localToGlobal[i], i);
  const numPatchVert = localToGlobal.length;

  const fullPos = mesh.numProp === 3 ? mesh.vertProperties : extractPositions(mesh);
  const patchPos = new Float32Array(numPatchVert * 3);
  for (let i = 0; i < numPatchVert; i++) {
    const g = localToGlobal[i];
    patchPos[i * 3]     = fullPos[g * 3];
    patchPos[i * 3 + 1] = fullPos[g * 3 + 1];
    patchPos[i * 3 + 2] = fullPos[g * 3 + 2];
  }

  const patchTriVerts = new Uint32Array(selectedTris.size * 3);
  let tIdx = 0;
  for (const t of selectedTris) {
    patchTriVerts[tIdx++] = globalToLocal.get(mesh.triVerts[t * 3])!;
    patchTriVerts[tIdx++] = globalToLocal.get(mesh.triVerts[t * 3 + 1])!;
    patchTriVerts[tIdx++] = globalToLocal.get(mesh.triVerts[t * 3 + 2])!;
  }

  // BFS hop distance from boundary vertices for displacement falloff
  const patchNeighbors: Set<number>[] = Array.from({ length: numPatchVert }, () => new Set());
  for (let i = 0; i < selectedTris.size; i++) {
    const v0 = patchTriVerts[i * 3], v1 = patchTriVerts[i * 3 + 1], v2 = patchTriVerts[i * 3 + 2];
    patchNeighbors[v0].add(v1); patchNeighbors[v0].add(v2);
    patchNeighbors[v1].add(v0); patchNeighbors[v1].add(v2);
    patchNeighbors[v2].add(v0); patchNeighbors[v2].add(v1);
  }
  const hopDist = new Float32Array(numPatchVert).fill(Infinity);
  const bfsQueue: number[] = [];
  for (let t = 0; t < mesh.numTri; t++) {
    if (selectedTris.has(t)) continue;
    for (let k = 0; k < 3; k++) {
      const l = globalToLocal.get(mesh.triVerts[t * 3 + k]);
      if (l !== undefined && hopDist[l] === Infinity) { hopDist[l] = 0; bfsQueue.push(l); }
    }
  }
  for (let qi = 0; qi < bfsQueue.length; qi++) {
    const v = bfsQueue[qi];
    for (const nb of patchNeighbors[v]) {
      if (hopDist[nb] === Infinity) { hopDist[nb] = hopDist[v] + 1; bfsQueue.push(nb); }
    }
  }

  return {
    patchMesh: { vertProperties: patchPos, triVerts: patchTriVerts, numVert: numPatchVert, numTri: selectedTris.size, numProp: 3 },
    localToGlobal,
    hopDist,
  };
}

const PATCH_FALLOFF_HOPS = 2;

/** Apply any displacement modifier to a selected patch only.
 *  Runs the modifier without subdivision so vertex count stays 1:1.
 *  Displacement fades to zero over PATCH_FALLOFF_HOPS topology hops for seamless blending.
 *  When `preSubdivide` is provided the full mesh is densified first (same target
 *  as the whole-model path) so coarse meshes show the same texture detail as the
 *  whole-model path does. */
function runOnPatch(
  mesh: MeshData,
  selectedTris: Set<number>,
  modFn: (sub: MeshData) => MeshData,
  preSubdivide?: { maxEdge: number; maxRounds: number },
): MeshData {
  let baseMesh = mesh;
  let baseTris = selectedTris;
  if (preSubdivide) {
    const result = subdivideWithMask(mesh, preSubdivide, selectedTris);
    baseMesh = result.mesh;
    baseTris = result.selectedTris;
  }
  const { patchMesh, localToGlobal, hopDist } = extractPatchMesh(baseMesh, baseTris);
  const numPatchVert = localToGlobal.length;
  const origPos = patchMesh.vertProperties as Float32Array;

  const modified = modFn(patchMesh);
  if (modified.numVert !== numPatchVert) return baseMesh; // unexpected subdivision — bail cleanly

  const modPos = modified.numProp === 3
    ? modified.vertProperties as Float32Array
    : extractPositions(modified);

  const fullPos = baseMesh.numProp === 3
    ? Float32Array.from(baseMesh.vertProperties)
    : extractPositions(baseMesh);

  // When the selection is very small or the mesh is coarse, every patch vertex
  // may also appear in a non-selected triangle (all hopDist = 0). Normal falloff
  // would give weight 0 everywhere → invisible result. Detect this and apply
  // full displacement instead; the slight boundary ripple is far less bad than
  // seeing nothing.
  let maxFiniteHop = 0;
  for (let i = 0; i < numPatchVert; i++) {
    if (hopDist[i] !== Infinity && hopDist[i] > maxFiniteHop) maxFiniteHop = hopDist[i];
  }
  const allBoundary = maxFiniteHop === 0;

  for (let i = 0; i < numPatchVert; i++) {
    const w = allBoundary ? 1 : Math.min(1, hopDist[i] / PATCH_FALLOFF_HOPS);
    const g = localToGlobal[i];
    fullPos[g * 3]     = origPos[i * 3]     + (modPos[i * 3]     - origPos[i * 3])     * w;
    fullPos[g * 3 + 1] = origPos[i * 3 + 1] + (modPos[i * 3 + 1] - origPos[i * 3 + 1]) * w;
    fullPos[g * 3 + 2] = origPos[i * 3 + 2] + (modPos[i * 3 + 2] - origPos[i * 3 + 2]) * w;
  }

  return { vertProperties: fullPos, triVerts: baseMesh.triVerts, numVert: baseMesh.numVert, numTri: baseMesh.numTri, numProp: 3, triColors: baseMesh.triColors };
}

export function applyFuzzyPatch(mesh: MeshData, opts: FuzzySkinOptions, selectedTris: Set<number>): ModifierManifoldResult {
  const diag = modelDiagonal(mesh) || 10;
  const pre = patchSubdivTarget(diag, Math.max(1e-4, opts.scale), opts.quality ?? 3);
  const patched = runOnPatch(mesh, selectedTris, (sub) => fuzzySkin(sub, { ...opts, subdivide: false }), pre);
  return { kind: 'manifold', label: 'fuzzy skin (patch)', mesh: patched, code: manifoldWrapper([`Fuzzy skin patch applied on ${today()}.`, `The textured mesh is baked onto api.imports[0].`]) };
}

export function applyCablePatch(mesh: MeshData, opts: CableKnitOptions, selectedTris: Set<number>): ModifierManifoldResult {
  const diag = modelDiagonal(mesh) || 10;
  const pre = patchSubdivTarget(diag, Math.max(1e-4, opts.cableWidth), opts.quality ?? 3);
  const patched = runOnPatch(mesh, selectedTris, (sub) => cableKnit(sub, { ...opts, subdivide: false }), pre);
  return { kind: 'manifold', label: 'cable knit (patch)', mesh: patched, code: manifoldWrapper([`Cable knit patch applied on ${today()}.`, `The textured mesh is baked onto api.imports[0].`]) };
}

export function applyWafflePatch(mesh: MeshData, opts: WaffleStitchOptions, selectedTris: Set<number>): ModifierManifoldResult {
  const diag = modelDiagonal(mesh) || 10;
  const pre = patchSubdivTarget(diag, Math.max(1e-4, opts.cellWidth), opts.quality ?? 3);
  const patched = runOnPatch(mesh, selectedTris, (sub) => waffleStitch(sub, { ...opts, subdivide: false }), pre);
  return { kind: 'manifold', label: 'waffle stitch (patch)', mesh: patched, code: manifoldWrapper([`Waffle stitch patch applied on ${today()}.`, `The textured mesh is baked onto api.imports[0].`]) };
}

export function applyFurPatch(mesh: MeshData, opts: FurVelvetOptions, selectedTris: Set<number>): ModifierManifoldResult {
  const diag = modelDiagonal(mesh) || 10;
  const pre = patchSubdivTarget(diag, Math.max(1e-4, opts.fiberSpacing), opts.quality ?? 3);
  const patched = runOnPatch(mesh, selectedTris, (sub) => furVelvet(sub, { ...opts, subdivide: false }), pre);
  return { kind: 'manifold', label: 'fur / velvet (patch)', mesh: patched, code: manifoldWrapper([`Fur/velvet patch applied on ${today()}.`, `The textured mesh is baked onto api.imports[0].`]) };
}

export function applyWovenPatch(mesh: MeshData, opts: WovenFabricOptions, selectedTris: Set<number>): ModifierManifoldResult {
  const diag = modelDiagonal(mesh) || 10;
  const pre = patchSubdivTarget(diag, Math.max(1e-4, opts.threadSpacing), opts.quality ?? 3);
  const patched = runOnPatch(mesh, selectedTris, (sub) => wovenFabric(sub, { ...opts, subdivide: false }), pre);
  return { kind: 'manifold', label: 'woven fabric (patch)', mesh: patched, code: manifoldWrapper([`Woven fabric patch applied on ${today()}.`, `The textured mesh is baked onto api.imports[0].`]) };
}

export function applyVoronoiPatch(mesh: MeshData, opts: VoronoiShellOptions, selectedTris: Set<number>): ModifierManifoldResult {
  const diag = modelDiagonal(mesh) || 10;
  // The wall band is the thin feature — size the pre-subdivision to it.
  const wall = Math.min(0.95, Math.max(0.02, opts.wallWidth ?? 0.25));
  const pre = patchSubdivTarget(diag, Math.max(1e-4, opts.cellSize * wall), opts.quality ?? 3);
  const patched = runOnPatch(mesh, selectedTris, (sub) => voronoiShell(sub, { ...opts, subdivide: false }), pre);
  return { kind: 'manifold', label: 'voronoi shell (patch)', mesh: patched, code: manifoldWrapper([`Voronoi shell patch applied on ${today()}.`, `The textured mesh is baked onto api.imports[0].`]) };
}

export function applySmoothPatch(mesh: MeshData, opts: SmoothOptions, selectedTris: Set<number>): ModifierManifoldResult {
  const diag = modelDiagonal(mesh) || 10;
  // Smooth has no feature size — use diagonal/20 as the target (coarse-mesh safety net only)
  const pre = patchSubdivTarget(diag, diag / 20, 3);
  const patched = runOnPatch(mesh, selectedTris, (sub) => smoothSurface(sub, { ...opts, subdivide: false }), pre);
  return { kind: 'manifold', label: 'smoothed (patch)', mesh: patched, code: manifoldWrapper([`Smooth patch applied on ${today()}.`, `The rounded mesh is baked onto api.imports[0].`]) };
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

export function defaultVoronoiOptions(mesh: MeshData): Required<VoronoiShellOptions> {
  const d = modelDiagonal(mesh) || 10;
  return {
    amplitude: d * 0.03,
    cellSize: d * 0.12,
    wallWidth: 0.25,
    raised: true,
    jitter: 1,
    grainAngleDeg: 0,
    seed: 1,
    quality: 3,
    subdivide: true,
  };
}

export interface VoronoiLampModifierOptions extends VoronoiLampOptions {
  /** Output form. 'mesh' (default) bakes a smooth manifold-js mesh (no engine
   *  change); 'voxel' switches the session to the voxel engine (paintable / .vox). */
  output?: 'mesh' | 'voxel';
  /** Voxel output only: emit a `.smooth()` call so the struts render rounded.
   *  Default true. (Mesh output is always Taubin-smoothed.) */
  smooth?: boolean;
}

export function defaultVoronoiLampOptions(mesh: MeshData): Required<VoronoiLampModifierOptions> {
  const d = modelDiagonal(mesh) || 10;
  return {
    cellSize: d * 0.1,
    wallThickness: d * 0.04,
    strutWidth: 0.32,
    resolution: 110,
    jitter: 1,
    grainAngleDeg: 0,
    seed: 1,
    watertight: true,
    output: 'mesh',
    smooth: true,
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

export function applyVoronoi(mesh: MeshData, opts: VoronoiShellOptions): ModifierManifoldResult {
  const baked = voronoiShell(mesh, opts);
  return {
    kind: 'manifold',
    label: 'voronoi shell',
    mesh: baked,
    code: manifoldWrapper([
      `Voronoi shell applied on ${today()} — cell ${opts.cellSize.toFixed(2)}, wall ${(opts.wallWidth ?? 0.25).toFixed(2)}, ${opts.raised === false ? 'engraved' : 'raised'}.`,
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
  // A negative factor mirrors the mesh (inverting triangle winding → inside-out,
  // non-manifold) and a zero factor collapses an axis to a degenerate sheet.
  // Guard at this engine-agnostic boundary so the public scaleModel/previewScale
  // API (which takes raw numbers from callers/AI) can't produce broken geometry.
  for (const [name, f] of [['sx', sx], ['sy', sy], ['sz', sz]] as const) {
    if (!Number.isFinite(f) || f <= 0) {
      throw new Error(`scale: ${name} must be a positive, finite factor (got ${f}). Use a value > 0 — a negative or zero scale would mirror or collapse the mesh into non-manifold geometry.`);
    }
  }
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

/** Bake a rigid transform chain (rotate/translate) into the mesh (used by the
 *  Place/Rotate tools when the user opts to flatten the result to a mesh rather
 *  than keep parametric code). Mirrors applyScale: the moved mesh rides
 *  api.imports[0]. */
export function applyTransform(
  mesh: MeshData,
  steps: TransformStep[],
  label: string,
): ModifierManifoldResult {
  const baked = applySteps(mesh, steps);
  return {
    kind: 'manifold',
    label,
    mesh: baked,
    code: manifoldWrapper([
      `${label} on ${today()}.`,
      `The transformed mesh is baked onto api.imports[0].`,
    ]),
  };
}

export async function applyVoronoiLamp(mesh: MeshData, opts: VoronoiLampModifierOptions, ctl?: SdfRunControl): Promise<ModifierResult> {
  // Default: a smooth manifold-js mesh built from a CONTINUOUS signed-distance
  // field (the principle behind Manifold.levelSet, done pure-JS on the main
  // thread). The wall follows the true distance to the *smooth* original surface
  // sub-voxel, so there's no voxel "corduroy" — and resolution genuinely sharpens
  // it. See voronoiLampSdf.ts.
  if ((opts.output ?? 'mesh') === 'mesh') {
    const baked = await voronoiLampSdfMesh(mesh, opts, ctl);
    return {
      kind: 'manifold',
      label: 'voronoi lamp',
      mesh: baked,
      // Re-meshed shell carries no colors; transfer them spatially from a dense
      // version of the painted input (coarse faces would map unreliably).
      colorSource: denseColorSource(mesh),
      code: manifoldWrapper([
        `Voronoi lamp (perforated shell) from the current model on ${today()} — cell ~${opts.cellSize.toFixed(2)}, wall ${opts.wallThickness.toFixed(2)}.`,
        `Smooth (SDF) mesh baked onto api.imports[0]. Re-apply from the Surface panel to retune.`,
      ]),
    };
  }

  // Voxel output: switch the session to the voxel engine (paintable / .vox).
  const { grid } = voronoiLattice(mesh, opts);
  // Encode occupancy + colors first, then flip to smooth so the preview mesh
  // matches the emitted `v.smooth()` at runtime (mirrors applyVoxelize).
  const encoded = encodeGrid(grid);
  const smooth = opts.smooth !== false;
  if (smooth) grid.smooth();
  const smoothCall = smooth ? `\nv.smooth();` : '';
  const code = `// Voronoi lamp (perforated shell) from the current model on ${today()}.
// Cell ~${opts.cellSize.toFixed(2)}, wall ${opts.wallThickness.toFixed(2)}, ${(grid.size).toLocaleString()} voxels.
// Edit below — toggle smoothing, paint the struts, or .vox export.
const { voxels } = api;
const v = voxels.decode(${JSON.stringify(encoded)});${smoothCall}
return v;
`;
  return {
    kind: 'voxel',
    label: smooth ? 'voronoi lamp (smooth voxels)' : 'voronoi lamp (voxels)',
    code,
    previewMesh: meshGrid(grid),
  };
}

export interface EngraveModifierOptions extends Omit<EngraveSdfOptions, 'mask'> {
  /** The pre-rasterized ink mask (built by the host from text or an image). */
  mask: EngraveSdfOptions['mask'];
  /** Short human label for the version (e.g. the text or "image"). */
  source?: string;
}

/** Size-relative starting parameters for engrave (a square-ish stamp on the top
 *  face, recessed ~6% of the diagonal). The mask + projection are supplied by
 *  the caller; this only fills the geometric knobs. */
export function defaultEngraveOptions(mesh: MeshData): {
  projection: EngraveProjection; through: boolean; depth: number; size: number; resolution: number; watertight: boolean;
} {
  const { size } = bboxOf(extractPositions(mesh));
  const span = Math.max(size[0], size[1], 1e-6);
  const d = modelDiagonal(mesh) || 10;
  return {
    projection: { mode: 'planar', axis: 'z', side: 'max' },
    through: false,
    depth: d * 0.06,
    size: span * 0.7,
    resolution: 180,
    watertight: true,
  };
}

export async function applyEngrave(mesh: MeshData, opts: EngraveModifierOptions, ctl?: SdfRunControl): Promise<ModifierManifoldResult> {
  const baked = await engraveMesh(mesh, opts, ctl);
  const proj = opts.projection.mode === 'planar'
    ? `${opts.projection.side === 'max' ? '+' : '-'}${opts.projection.axis.toUpperCase()} face`
    : opts.projection.mode === 'free'
      ? 'a clicked face'
      : `${opts.projection.side} cylinder`;
  const what = opts.source ? `"${opts.source}"` : 'stamp';
  return {
    kind: 'manifold',
    label: opts.through ? 'engrave (cut through)' : 'engrave',
    mesh: baked,
    // The carved mesh is a fresh surface-nets surface with no per-triangle
    // colors; carry the original paint by spatial transfer from a dense version
    // of the painted input (coarse faces would map unreliably).
    colorSource: denseColorSource(mesh),
    code: manifoldWrapper([
      `Engraved ${what} on ${today()} — ${opts.through ? 'cut clean through' : `recessed ${opts.depth.toFixed(2)} deep`} on the ${proj}.`,
      `The carved mesh is baked onto api.imports[0]. Re-apply from the Surface panel to retune.`,
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
  const call = formatSurfacingCall(grid.surfacing());
  const smoothCall = call ? `\nv${call};` : '';
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
