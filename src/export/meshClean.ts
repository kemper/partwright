// Shared mesh cleanup and color helpers for export

import type { MeshData } from '../geometry/types';
import { isPainted as checkPainted } from '../color/regions';

/** Default model color used when faces have no paint. */
export const DEFAULT_COLOR_HEX = '#4a9eff';

/** Get the hex color string for a triangle (e.g. '#ff3333'), or DEFAULT_COLOR_HEX if unpainted. */
export function triColorHex(triColors: Uint8Array, t: number): string {
  if (!checkPainted(triColors, t)) return DEFAULT_COLOR_HEX;
  const r = triColors[t * 3].toString(16).padStart(2, '0');
  const g = triColors[t * 3 + 1].toString(16).padStart(2, '0');
  const b = triColors[t * 3 + 2].toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

/** Check if any triangle in a list is painted. */
export function hasAnyPainted(triColors: Uint8Array, tris: number[]): boolean {
  for (const t of tris) {
    if (checkPainted(triColors, t)) return true;
  }
  return false;
}

export interface CleanMesh {
  remap: Uint32Array;        // old vertex index → new (deduplicated) index
  uniquePositions: number[]; // flat xyz of unique vertices
  validTris: number[];       // indices into original triangle list (degenerates removed)
}

/**
 * Build a vertex remap table that merges duplicate vertices into canonical indices,
 * and filter out degenerate triangles that collapse after merging.
 *
 * Uses merge vectors from manifold-3d (authoritative) when available, otherwise
 * falls back to quantized position dedup (same tolerance as scadToManifold.ts).
 *
 * IMPORTANT: Quantized dedup only runs when merge vectors are absent. Running it
 * on top of merge vectors can over-merge vertices that manifold-3d intentionally
 * kept separate (e.g. sharp edges), collapsing triangles and creating holes.
 */
export function cleanMeshForExport(meshData: MeshData): CleanMesh {
  const { vertProperties, triVerts, numVert, numTri, numProp, mergeFromVert, mergeToVert } = meshData;

  // Union-find for vertex merging
  const parent = new Uint32Array(numVert);
  for (let i = 0; i < numVert; i++) parent[i] = i;

  function find(x: number): number {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  }
  function union(a: number, b: number) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  // Phase 1: merge vectors from manifold-3d (exact pairs)
  if (mergeFromVert && mergeToVert && mergeFromVert.length === mergeToVert.length) {
    for (let i = 0; i < mergeFromVert.length; i++) {
      union(mergeFromVert[i], mergeToVert[i]);
    }
  }

  // Phase 2: quantized position dedup — ONLY when merge vectors are absent.
  const hasMergeVectors = mergeFromVert && mergeToVert && mergeFromVert.length > 0;
  if (!hasMergeVectors) {
    const quantize = (v: number) => Math.round(v * 1e5);
    const posMap = new Map<string, number>();
    for (let i = 0; i < numVert; i++) {
      const x = quantize(vertProperties[i * numProp]);
      const y = quantize(vertProperties[i * numProp + 1]);
      const z = quantize(vertProperties[i * numProp + 2]);
      const key = `${x},${y},${z}`;
      const existing = posMap.get(key);
      if (existing !== undefined) {
        union(i, existing);
      } else {
        posMap.set(key, i);
      }
    }
  }

  // Flatten: assign sequential indices to unique roots
  const rootToIndex = new Map<number, number>();
  const uniquePositions: number[] = [];
  const remap = new Uint32Array(numVert);

  for (let i = 0; i < numVert; i++) {
    const root = find(i);
    let idx = rootToIndex.get(root);
    if (idx === undefined) {
      idx = uniquePositions.length / 3;
      rootToIndex.set(root, idx);
      uniquePositions.push(
        vertProperties[root * numProp],
        vertProperties[root * numProp + 1],
        vertProperties[root * numProp + 2],
      );
    }
    remap[i] = idx;
  }

  // Filter degenerate triangles (collapsed after merging)
  const validTris: number[] = [];
  for (let t = 0; t < numTri; t++) {
    const a = remap[triVerts[t * 3]];
    const b = remap[triVerts[t * 3 + 1]];
    const c = remap[triVerts[t * 3 + 2]];
    if (a !== b && b !== c && a !== c) {
      validTris.push(t);
    }
  }

  return { remap, uniquePositions, validTris };
}
