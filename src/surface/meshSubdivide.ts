// Pure-logic mesh helpers shared by the surface modifiers (fuzzy skin, smooth).
//
// These operate on the renderer-friendly `MeshData` (position-first vertex
// properties + triangle index list) and never touch the DOM/WASM, so they live
// in — and are unit-tested by — the vitest tier alongside `voxel/smooth.ts`.
//
// `subdivideToMaxEdge` does watertight 1→4 midpoint subdivision: every shared
// edge gets a single deduped midpoint, so the result stays edge-manifold and is
// accepted by `Manifold.ofMesh`. Per-triangle colors are inherited by all four
// children, so painted regions survive the densification.

import type { MeshData } from '../geometry/types';

/** Extract a tightly-packed position-only Float32Array (x,y,z per vertex) from
 *  a possibly wider vertProperties buffer. */
export function extractPositions(mesh: MeshData): Float32Array {
  const { vertProperties, numVert, numProp } = mesh;
  if (numProp === 3) return Float32Array.from(vertProperties.subarray(0, numVert * 3));
  const out = new Float32Array(numVert * 3);
  for (let v = 0; v < numVert; v++) {
    out[v * 3] = vertProperties[v * numProp];
    out[v * 3 + 1] = vertProperties[v * numProp + 1];
    out[v * 3 + 2] = vertProperties[v * numProp + 2];
  }
  return out;
}

/** Longest edge length across all triangles (sampled from positions). */
export function maxEdgeLength(positions: Float32Array, triVerts: Uint32Array): number {
  let max = 0;
  for (let t = 0; t < triVerts.length; t += 3) {
    const a = triVerts[t], b = triVerts[t + 1], c = triVerts[t + 2];
    max = Math.max(max, edgeLen(positions, a, b), edgeLen(positions, b, c), edgeLen(positions, c, a));
  }
  return max;
}

function edgeLen(p: Float32Array, i: number, j: number): number {
  const dx = p[i * 3] - p[j * 3];
  const dy = p[i * 3 + 1] - p[j * 3 + 1];
  const dz = p[i * 3 + 2] - p[j * 3 + 2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Bounding box of position-only buffer. */
export function bboxOf(positions: Float32Array): { min: [number, number, number]; max: [number, number, number]; size: [number, number, number] } {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  if (!Number.isFinite(minX)) { minX = minY = minZ = 0; maxX = maxY = maxZ = 0; }
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    size: [maxX - minX, maxY - minY, maxZ - minZ],
  };
}

export interface SubdivideOptions {
  /** Stop once the longest edge is at or below this world-space length. */
  maxEdge: number;
  /** Hard cap on subdivision passes (each pass quadruples the triangle count). */
  maxRounds?: number;
  /** Stop early if a pass would exceed this triangle count. */
  maxTriangles?: number;
}

type PaintedMask = Uint8Array & { _painted?: Uint8Array };

/** One 1→4 midpoint subdivision pass over a position-only mesh. */
function subdivideOnce(
  positions: Float32Array,
  triVerts: Uint32Array,
  triColors: Uint8Array | undefined,
  painted: Uint8Array | undefined,
): { positions: Float32Array; triVerts: Uint32Array; triColors: Uint8Array | undefined; painted: Uint8Array | undefined } {
  const numTri = triVerts.length / 3;
  const verts: number[] = Array.from(positions);
  const midCache = new Map<number, number>();
  const newTris = new Uint32Array(numTri * 4 * 3);
  const newColors = triColors ? new Uint8Array(numTri * 4 * 3) : undefined;
  const newPainted = painted ? new Uint8Array(numTri * 4) : undefined;

  const midpoint = (i: number, j: number): number => {
    const key = i < j ? i * positions.length + j : j * positions.length + i;
    const cached = midCache.get(key);
    if (cached !== undefined) return cached;
    const idx = verts.length / 3;
    verts.push(
      (positions[i * 3] + positions[j * 3]) / 2,
      (positions[i * 3 + 1] + positions[j * 3 + 1]) / 2,
      (positions[i * 3 + 2] + positions[j * 3 + 2]) / 2,
    );
    midCache.set(key, idx);
    return idx;
  };

  let w = 0;
  for (let t = 0; t < numTri; t++) {
    const a = triVerts[t * 3], b = triVerts[t * 3 + 1], c = triVerts[t * 3 + 2];
    const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
    const children = [a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca];
    for (const v of children) newTris[w++] = v;
    if (newColors && triColors) {
      const r = triColors[t * 3], g = triColors[t * 3 + 1], bl = triColors[t * 3 + 2];
      for (let k = 0; k < 4; k++) {
        const o = (t * 4 + k) * 3;
        newColors[o] = r; newColors[o + 1] = g; newColors[o + 2] = bl;
      }
    }
    if (newPainted && painted) {
      const p = painted[t];
      for (let k = 0; k < 4; k++) newPainted[t * 4 + k] = p;
    }
  }

  return { positions: Float32Array.from(verts), triVerts: newTris, triColors: newColors, painted: newPainted };
}

/** Repeatedly midpoint-subdivide until the longest edge is `<= maxEdge`, bounded
 *  by `maxRounds` and `maxTriangles`. Returns a position-only (`numProp === 3`)
 *  MeshData; per-triangle colors and the `_painted` mask are carried forward when
 *  present. */
export function subdivideToMaxEdge(mesh: MeshData, opts: SubdivideOptions): MeshData {
  const maxRounds = opts.maxRounds ?? 4;
  const maxTriangles = opts.maxTriangles ?? 400_000;
  let positions = extractPositions(mesh);
  let triVerts = Uint32Array.from(mesh.triVerts);
  let triColors = mesh.triColors ? Uint8Array.from(mesh.triColors) : undefined;
  // `_painted` is an expando on triColors (not part of the typed array), so
  // Uint8Array.from() above silently drops it — carry it separately.
  let painted: Uint8Array | undefined = triColors
    ? (mesh.triColors as PaintedMask)._painted?.slice()
    : undefined;

  for (let round = 0; round < maxRounds; round++) {
    if (maxEdgeLength(positions, triVerts) <= opts.maxEdge) break;
    if ((triVerts.length / 3) * 4 > maxTriangles) break;
    const next = subdivideOnce(positions, triVerts, triColors, painted);
    positions = next.positions; triVerts = next.triVerts; triColors = next.triColors; painted = next.painted;
  }

  if (triColors && painted) (triColors as PaintedMask)._painted = painted;
  return {
    vertProperties: positions,
    triVerts,
    numVert: positions.length / 3,
    numTri: triVerts.length / 3,
    numProp: 3,
    triColors,
  };
}

/** Area-weighted per-vertex normals for a position-only mesh. Returns a
 *  Float32Array of `numVert * 3` unit normals (degenerate verts get [0,0,1]). */
export function computeVertexNormals(positions: Float32Array, triVerts: Uint32Array): Float32Array {
  const numVert = positions.length / 3;
  const normals = new Float32Array(numVert * 3);
  for (let t = 0; t < triVerts.length; t += 3) {
    const a = triVerts[t], b = triVerts[t + 1], c = triVerts[t + 2];
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2];
    const cx = positions[c * 3], cy = positions[c * 3 + 1], cz = positions[c * 3 + 2];
    // Cross product of two edges — magnitude is twice the triangle area, so the
    // accumulation is naturally area-weighted.
    const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    for (const v of [a, b, c]) {
      normals[v * 3] += nx; normals[v * 3 + 1] += ny; normals[v * 3 + 2] += nz;
    }
  }
  for (let v = 0; v < numVert; v++) {
    const x = normals[v * 3], y = normals[v * 3 + 1], z = normals[v * 3 + 2];
    const len = Math.sqrt(x * x + y * y + z * z);
    if (len > 1e-9) {
      normals[v * 3] = x / len; normals[v * 3 + 1] = y / len; normals[v * 3 + 2] = z / len;
    } else {
      normals[v * 3] = 0; normals[v * 3 + 1] = 0; normals[v * 3 + 2] = 1;
    }
  }
  return normals;
}
