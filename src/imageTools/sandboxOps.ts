// Image tools as code ops (#1256, Stage B) — the Worker-side runners behind
// `api.imageTile` / `api.silhouetteTile` / `api.steppedRelief` /
// `api.lithophane` (manifold-js) and `api.voxelsFromImage` (voxel).
//
// They run the same pure generators the bake path uses (generateRelief,
// imageDataToVoxelGrid) on an `api.image(id)` handle's pixels, so a call and a
// baked tool with the same params make the same geometry. Relief results are
// memoized on image content + resolved options (like runLayeredPrint), so a
// re-run that changes neither is instant.
//
// Relief colour clusters come back as triangle RUNS (one contiguous run per
// cluster, the triangles reordered to match) so the engine can register each
// run as an `api.label` part with its colour — the code-native replacement for
// the bake's seeded paint regions, which keyed paint to triangle ids.

import { resolveModelImageArg, type ModelImage } from '../geometry/modelImages';
import { generateRelief } from '../relief/imageToRelief';
import { imageDataToVoxelGrid } from '../import/imageToVoxel';
import { encodeGrid, decodeGrid, type VoxelGrid } from '../geometry/voxel/grid';
import { orderTrianglesByPart } from '../import/importParts';
import { parseReliefOpParams, parseVoxelOpParams } from './params';
import { RELIEF_OP_FUNCTIONS, VOXEL_OP_FUNCTION, type ReliefToolId } from './descriptor';

/** Name of the i-th (0-based) colour part, largest region first. */
function colourPartName(i: number): string {
  return `colour-${i + 1}`;
}

export interface ReliefOpRun {
  numProp: number;
  vertProperties: Float32Array;
  /** Triangles reordered so each colour part is one contiguous run. */
  triVerts: Uint32Array;
  /** Runs in triangle order; `name`/`color` null for the unlabelled rest
   *  (tile sides and bottom, relief walls, a lithophane's whole surface). */
  runs: Array<{ startTri: number; endTri: number; name: string | null; color: [number, number, number] | null }>;
  /** True when the mesh is closed and edge-manifold (Manifold.ofMesh-able). */
  watertight: boolean;
}

const reliefCache = new Map<string, ReliefOpRun>();
const voxelCache = new Map<string, string>();
const CACHE_MAX = 4;

function remember<T>(cache: Map<string, T>, key: string, value: T): void {
  cache.set(key, value);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
}

function recall<T>(cache: Map<string, T>, key: string): T | undefined {
  const hit = cache.get(key);
  if (hit !== undefined) { cache.delete(key); cache.set(key, hit); }
  return hit;
}

function buildReliefRun(im: ModelImage, tool: ReliefToolId, opts: ReturnType<typeof parseReliefOpParams>): ReliefOpRun {
  // generateRelief reads only width / height / data, which a ModelImage has.
  const result = generateRelief(im as unknown as ImageData, opts);
  const { mesh } = result;
  if (mesh.numTri === 0) throw new Error(`api.${RELIEF_OP_FUNCTIONS[tool]}: the image is too small (or entirely background) to build anything — use a larger image or turn off removeBackground.`);
  const numTri = mesh.triVerts.length / 3;
  const regions = (result.seedRegions ?? [])
    .map((r) => ({ color: r.color, tris: r.triangleIds.filter((t) => t >= 0 && t < numTri) }))
    .filter((r) => r.tris.length > 0)
    .sort((a, b) => b.tris.length - a.tris.length);
  if (regions.length === 0) {
    return { numProp: mesh.numProp, vertProperties: mesh.vertProperties, triVerts: mesh.triVerts, runs: [{ startTri: 0, endTri: numTri, name: null, color: null }], watertight: mesh.watertight };
  }
  const triPart = new Int32Array(numTri).fill(-1);
  regions.forEach((r, k) => { for (const t of r.tris) triPart[t] = k; });
  const ordered = orderTrianglesByPart(mesh.triVerts, triPart, regions.length);
  return {
    numProp: mesh.numProp,
    vertProperties: mesh.vertProperties,
    triVerts: ordered.triVerts,
    runs: ordered.runs.map((run) => ({
      startTri: run.startTri,
      endTri: run.endTri,
      name: run.part < 0 ? null : colourPartName(run.part),
      color: run.part < 0 ? null : regions[run.part].color,
    })),
    watertight: mesh.watertight,
  };
}

/** Run a relief tool on an `api.image` handle (memoized). The returned arrays
 *  are shared with the cache — copy them before handing them anywhere that
 *  could mutate or transfer them. */
export function runReliefImageOp(tool: ReliefToolId, image: unknown, rawParams: unknown): ReliefOpRun {
  const fn = `api.${RELIEF_OP_FUNCTIONS[tool]}`;
  const im = resolveModelImageArg(image, fn);
  const opts = parseReliefOpParams(tool, rawParams);
  const key = `${im.hash}|${tool}|${JSON.stringify(opts)}`;
  let hit = recall(reliefCache, key);
  if (!hit) {
    hit = buildReliefRun(im, tool, opts);
    remember(reliefCache, key, hit);
  }
  return hit;
}

/** Run the voxel tool on an `api.image` handle: a fresh grid each call (model
 *  code may edit it), rebuilt from a memoized encoding. */
export function runVoxelImageOp(image: unknown, rawParams: unknown): VoxelGrid {
  const fn = `api.${VOXEL_OP_FUNCTION}`;
  const im = resolveModelImageArg(image, fn);
  const opts = parseVoxelOpParams(rawParams);
  const key = `${im.hash}|${JSON.stringify(opts)}`;
  let enc = recall(voxelCache, key);
  if (enc === undefined) {
    const grid = imageDataToVoxelGrid(im, opts);
    if (grid.size === 0) throw new Error(`${fn}: no pixel survived — the image is fully transparent (lower alphaThreshold) or all background (turn off removeBackground).`);
    enc = encodeGrid(grid);
    remember(voxelCache, key, enc);
  }
  return decodeGrid(enc);
}
