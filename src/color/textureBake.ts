/**
 * UV-texture atlas baking (#885) — the continuous-color sibling of the
 * palette-region projection pipeline.
 *
 * Layout: every triangle owns one square cell of the atlas, derived purely
 * from its index (`cellForTriangle`) — overlap-free by construction, no
 * unwrap needed, and nothing about the parameterization has to persist:
 * the UVs are a formula over (triangleIndex, atlasSize, grid). Cell texels
 * map barycentrically onto the triangle (texels past the diagonal fold
 * back, doubling as the bilinear gutter).
 *
 * Sampling: each texel picks a source view by (strict visibility, priority,
 * facing) — strict visibility means the per-view triangle-ID buffer shows
 * THIS triangle at the texel's projected pixel, so occlusion is exact —
 * and samples the view image bilinearly in continuous RGB. No palette
 * snapping: this layer exists to carry the color detail palette regions
 * can't (print paint still comes from the region layer).
 *
 * Views are SCOPED (an island, a box selection, the whole mesh): a view
 * only ever colors triangles in its scope, and its camera framing/ID
 * buffer are computed on the scope subset — exactly how the source render
 * (renderIsland / renderSelection / renderView) framed it.
 */

import type { MeshData } from '../geometry/types';
import { subsetMesh } from './meshIslands';
import { buildScopeEdgeAdjacency } from './idProjection';
import { renderTriangleIdPixels } from '../renderer/multiview';
export { cellForTriangle, cellUVsForTriangle } from '../renderer/atlasUV';

export interface BakeViewInput {
  /** Decoded pixels of the AI-painted source image for this view. */
  image: { data: Uint8ClampedArray; w: number; h: number };
  elevation: number;
  azimuth: number;
  /** Scope triangles in FULL-mesh indices; insertion order defines the
   *  subset framing (must match how the source render was scoped). */
  scope: readonly number[];
  /** Higher-priority views win over lower ones wherever both see a texel —
   *  e.g. piece-scoped close-ups over whole-plate fallback shots. */
  priority: number;
}

export interface BakeResult {
  /** RGBA atlas, top-down rows. */
  atlas: Uint8Array;
  atlasSize: number;
  grid: number;
  stats: { numTri: number; strict: number; loose: number; holes: number };
}

interface ViewRuntime {
  input: BakeViewInput;
  localOf: Int32Array;
  id: { data: Uint8Array; width: number; height: number };
  center: [number, number, number];
  halfExtent: number;
  camDir: [number, number, number];
  right: [number, number, number];
  upv: [number, number, number];
  mapX: (x: number) => number;
  mapY: (y: number) => number;
}

function buildViewRuntime(mesh: MeshData, input: BakeViewInput, idSize: number): ViewRuntime {
  const subset = subsetMesh(mesh, input.scope);
  const localOf = new Int32Array(mesh.numTri).fill(-1);
  for (let i = 0; i < input.scope.length; i++) localOf[input.scope[i]] = i;

  const id = renderTriangleIdPixels(subset, { elevation: input.elevation, azimuth: input.azimuth, size: idSize });

  // Camera basis replicating buildViewCamera's ortho framing on the subset.
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  const { vertProperties, numVert, numProp } = subset;
  for (let i = 0; i < numVert; i++) {
    const x = vertProperties[i * numProp], y = vertProperties[i * numProp + 1], z = vertProperties[i * numProp + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const center: [number, number, number] = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
  const maxDim = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  const halfExtent = maxDim * 0.7;
  const el = (input.elevation * Math.PI) / 180, az = (input.azimuth * Math.PI) / 180;
  const camDir: [number, number, number] = [Math.cos(el) * Math.sin(az), -Math.cos(el) * Math.cos(az), Math.sin(el)];
  const isPolar = Math.abs(Math.sin(el)) > 0.999;
  const up0 = isPolar ? [0, 1, 0] : [0, 0, 1];
  const rx = up0[1] * camDir[2] - up0[2] * camDir[1];
  const ry = up0[2] * camDir[0] - up0[0] * camDir[2];
  const rz = up0[0] * camDir[1] - up0[1] * camDir[0];
  const rl = Math.hypot(rx, ry, rz) || 1;
  const right: [number, number, number] = [rx / rl, ry / rl, rz / rl];
  const upv: [number, number, number] = [
    camDir[1] * right[2] - camDir[2] * right[1],
    camDir[2] * right[0] - camDir[0] * right[2],
    camDir[0] * right[1] - camDir[1] * right[0],
  ];

  // Silhouette alignment: ID-buffer occupied bbox → image non-white bbox.
  let aMinX = Infinity, aMinY = Infinity, aMaxX = -Infinity, aMaxY = -Infinity;
  for (let y = 0; y < id.height; y++) {
    for (let x = 0; x < id.width; x++) {
      const i = (y * id.width + x) * 4;
      if (id.data[i] !== 0 || id.data[i + 1] !== 0 || id.data[i + 2] !== 0) {
        if (x < aMinX) aMinX = x; if (x > aMaxX) aMaxX = x;
        if (y < aMinY) aMinY = y; if (y > aMaxY) aMaxY = y;
      }
    }
  }
  const img = input.image;
  let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const i = (y * img.w + x) * 4;
      if (img.data[i] < 245 || img.data[i + 1] < 245 || img.data[i + 2] < 245) {
        if (x < bMinX) bMinX = x; if (x > bMaxX) bMaxX = x;
        if (y < bMinY) bMinY = y; if (y > bMaxY) bMaxY = y;
      }
    }
  }
  const sx = (bMaxX - bMinX) / Math.max(1, aMaxX - aMinX);
  const sy = (bMaxY - bMinY) / Math.max(1, aMaxY - aMinY);
  return {
    input, localOf, id, center, halfExtent, camDir, right, upv,
    mapX: (x: number) => bMinX + (x - aMinX) * sx,
    mapY: (y: number) => bMinY + (y - aMinY) * sy,
  };
}

/** Bake all views into one atlas. Synchronous heavy math (~10-60 s on big
 *  meshes) — callers surface progress/status around it. */
export function bakeTextureAtlas(mesh: MeshData, views: BakeViewInput[], opts?: {
  atlasSize?: number;
  grid?: number;
  idSize?: number;
  /** Per-triangle base colors (numTri*3, 0..255) — typically the current
   *  palette paint. Triangles no view strictly verifies fall back to their
   *  base color instead of neighbor dilation, so an unreliable or
   *  recomposed source image can never poison paint that is already
   *  correct. */
  baseTriColors?: Uint8Array | null;
  /** Fill texels of triangles no view covers with this RGB (0..255). */
  holeColor?: [number, number, number];
}): BakeResult {
  const atlasSize = opts?.atlasSize ?? 8192;
  const grid = opts?.grid ?? Math.floor(atlasSize / 8);
  const cell = atlasSize / grid;
  if (!Number.isInteger(cell) || cell < 2) throw new Error('atlasSize must be an integer multiple of grid with cells >= 2 texels');
  if (mesh.numTri > grid * grid) throw new Error(`mesh has ${mesh.numTri} triangles but the atlas grid holds ${grid * grid}`);
  const idSize = opts?.idSize ?? 2048;
  const hole = opts?.holeColor ?? [160, 160, 165];

  const runtimes = views.map(v => buildViewRuntime(mesh, v, idSize));
  const atlas = new Uint8Array(atlasSize * atlasSize * 4);
  const { triVerts, vertProperties, numProp, numTri } = mesh;
  let strictCount = 0, meanFilled = 0, holes = 0;

  // Per-triangle mean of its strictly-verified texels — the flat fallback
  // for texels (and whole triangles) no view PROVABLY sees. Sampling a view
  // where visibility can't be verified reads misprojected neighbors and
  // produces exactly the mottled noise this replaces.
  const meanR = new Float32Array(numTri);
  const meanG = new Float32Array(numTri);
  const meanB = new Float32Array(numTri);
  const strictOf = new Int32Array(numTri);
  const unbaked: number[] = [];

  const texelMask = new Uint8Array((atlasSize / grid) * (atlasSize / grid));
  for (let t = 0; t < numTri; t++) {
    const v0 = triVerts[t * 3], v1 = triVerts[t * 3 + 1], v2 = triVerts[t * 3 + 2];
    const ax = vertProperties[v0 * numProp], ay = vertProperties[v0 * numProp + 1], az = vertProperties[v0 * numProp + 2];
    const bx = vertProperties[v1 * numProp], by = vertProperties[v1 * numProp + 1], bz = vertProperties[v1 * numProp + 2];
    const cx = vertProperties[v2 * numProp], cy = vertProperties[v2 * numProp + 1], cz = vertProperties[v2 * numProp + 2];
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;

    const cellX = (t % grid) * cell, cellY = Math.floor(t / grid) * cell;
    let sumR = 0, sumG = 0, sumB = 0, n = 0;
    texelMask.fill(0);
    for (let py = 0; py < cell; py++) {
      for (let px = 0; px < cell; px++) {
        let u = (px + 0.5) / cell, w = (py + 0.5) / cell;
        if (u + w > 1) { u = 1 - u; w = 1 - w; }
        const wx = ax + e1x * u + e2x * w, wy = ay + e1y * u + e2y * w, wz = az + e1z * u + e2z * w;

        // Strictly-visible views only: the view's ID buffer must show THIS
        // triangle at the projected pixel. Among those, (priority, facing).
        let best = -1, bestPriority = -Infinity, bestFacing = 0.05;
        let bestSx = 0, bestSy = 0;
        for (let vi = 0; vi < runtimes.length; vi++) {
          const vd = runtimes[vi];
          const local = vd.localOf[t];
          if (local < 0) continue;
          const facing = nx * vd.camDir[0] + ny * vd.camDir[1] + nz * vd.camDir[2];
          if (facing <= 0.05) continue;
          const dx = wx - vd.center[0], dy = wy - vd.center[1], dz = wz - vd.center[2];
          const sxp = ((dx * vd.right[0] + dy * vd.right[1] + dz * vd.right[2]) / vd.halfExtent + 1) / 2 * idSize;
          const syp = (1 - (dx * vd.upv[0] + dy * vd.upv[1] + dz * vd.upv[2]) / vd.halfExtent) / 2 * idSize;
          const ix = Math.round(sxp), iy = Math.round(syp);
          if (ix < 0 || iy < 0 || ix >= idSize || iy >= idSize) continue;
          const idPx = (iy * idSize + ix) * 4;
          const idVal = (vd.id.data[idPx] << 16) | (vd.id.data[idPx + 1] << 8) | vd.id.data[idPx + 2];
          if (idVal !== local + 1) continue;
          const better = (vd.input.priority !== bestPriority) ? vd.input.priority > bestPriority : facing > bestFacing;
          if (!better) continue;
          best = vi; bestPriority = vd.input.priority; bestFacing = facing;
          bestSx = sxp; bestSy = syp;
        }
        if (best < 0) continue;
        const vd = runtimes[best];
        const tx = vd.mapX(bestSx), ty = vd.mapY(bestSy);
        const img = vd.input.image;
        const x0 = Math.max(0, Math.min(img.w - 2, Math.floor(tx))), y0 = Math.max(0, Math.min(img.h - 2, Math.floor(ty)));
        const fx = Math.max(0, Math.min(1, tx - x0)), fy = Math.max(0, Math.min(1, ty - y0));
        const ai = ((cellY + py) * atlasSize + (cellX + px)) * 4;
        for (let ch = 0; ch < 3; ch++) {
          const p00 = img.data[(y0 * img.w + x0) * 4 + ch];
          const p10 = img.data[(y0 * img.w + x0 + 1) * 4 + ch];
          const p01 = img.data[((y0 + 1) * img.w + x0) * 4 + ch];
          const p11 = img.data[((y0 + 1) * img.w + x0 + 1) * 4 + ch];
          atlas[ai + ch] = (p00 * (1 - fx) + p10 * fx) * (1 - fy) + (p01 * (1 - fx) + p11 * fx) * fy;
        }
        atlas[ai + 3] = 255;
        texelMask[py * cell + px] = 1;
        sumR += atlas[ai]; sumG += atlas[ai + 1]; sumB += atlas[ai + 2];
        n++;
        strictCount++;
      }
    }
    strictOf[t] = n;
    if (n > 0) {
      meanR[t] = sumR / n; meanG[t] = sumG / n; meanB[t] = sumB / n;
      // Unverifiable texels of a partially-seen triangle take its strict
      // mean — flat beats misprojected noise.
      for (let py = 0; py < cell; py++) {
        for (let px = 0; px < cell; px++) {
          if (texelMask[py * cell + px]) continue;
          const ai = ((cellY + py) * atlasSize + (cellX + px)) * 4;
          atlas[ai] = meanR[t]; atlas[ai + 1] = meanG[t]; atlas[ai + 2] = meanB[t]; atlas[ai + 3] = 255;
          meanFilled++;
        }
      }
    } else {
      unbaked.push(t);
    }
  }

  // Triangles no view verified at all: fall back to the palette paint when
  // provided (flat and already correct), else inherit the mean color of
  // their nearest baked neighbor (multi-source BFS over edge adjacency).
  const base = opts?.baseTriColors ?? null;
  if (base && unbaked.length > 0) {
    for (const t of unbaked) {
      const cellX = (t % grid) * cell, cellY = Math.floor(t / grid) * cell;
      const r = base[t * 3], g = base[t * 3 + 1], b = base[t * 3 + 2];
      for (let py = 0; py < cell; py++) {
        for (let px = 0; px < cell; px++) {
          const ai = ((cellY + py) * atlasSize + (cellX + px)) * 4;
          atlas[ai] = r; atlas[ai + 1] = g; atlas[ai + 2] = b; atlas[ai + 3] = 255;
        }
      }
    }
  } else if (unbaked.length > 0) {
    const allTris = Array.from({ length: numTri }, (_, i) => i);
    const adjacency = buildScopeEdgeAdjacency(mesh, allTris);
    const queue: number[] = [];
    const state = new Int8Array(numTri); // 1 = has color
    for (let t = 0; t < numTri; t++) if (strictOf[t] > 0) { state[t] = 1; queue.push(t); }
    for (let head = 0; head < queue.length; head++) {
      const t = queue[head];
      for (let e = 0; e < 3; e++) {
        const nb = adjacency[t * 3 + e];
        if (nb < 0 || state[nb] === 1) continue;
        meanR[nb] = meanR[t]; meanG[nb] = meanG[t]; meanB[nb] = meanB[t];
        state[nb] = 1;
        queue.push(nb);
      }
    }
    for (const t of unbaked) {
      const cellX = (t % grid) * cell, cellY = Math.floor(t / grid) * cell;
      const has = state[t] === 1;
      if (!has) holes += cell * cell;
      const r = has ? meanR[t] : hole[0], g = has ? meanG[t] : hole[1], b = has ? meanB[t] : hole[2];
      for (let py = 0; py < cell; py++) {
        for (let px = 0; px < cell; px++) {
          const ai = ((cellY + py) * atlasSize + (cellX + px)) * 4;
          atlas[ai] = r; atlas[ai + 1] = g; atlas[ai + 2] = b; atlas[ai + 3] = 255;
        }
      }
    }
  }

  const loose = meanFilled;
  return { atlas, atlasSize, grid, stats: { numTri, strict: strictCount, loose, holes } };
}
