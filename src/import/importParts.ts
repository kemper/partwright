// Pure helpers for parts committed on an imported mesh (part detection,
// #1025): validation, and ordering triangles into per-part runs so
// `Manifold.ofMesh` can carry each part as its own `runOriginalID` — the same
// provenance mechanism `api.label` uses, which survives booleans.

import type { ImportedMeshParts } from './importedMesh';

/** Validate/normalize parts against the mesh's triangle count. Returns null
 *  (parts dropped, mesh still usable) when malformed. */
export function normalizeImportParts(raw: unknown, numTri: number): ImportedMeshParts | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<ImportedMeshParts>;
  if (!Array.isArray(r.names) || !(r.triPart instanceof Int32Array) || r.triPart.length !== numTri) return null;
  const names = r.names.map((n) => (typeof n === 'string' && n.trim() ? n : null));
  if (names.some((n) => n === null) || new Set(names).size !== names.length) return null;
  for (let t = 0; t < r.triPart.length; t++) {
    const p = r.triPart[t];
    if (p < -1 || p >= names.length) return null;
  }
  const colors = names.map((_, i) => {
    const c = Array.isArray(r.colors) ? r.colors[i] : null;
    return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : null;
  });
  const out: ImportedMeshParts = { names: names as string[], colors, triPart: r.triPart };
  if (r.source && typeof r.source === 'object' && typeof r.source.detectorId === 'string') out.source = r.source;
  return out;
}

export interface PartRun {
  /** Part index, or −1 for the unassigned run. */
  part: number;
  /** Triangle range [startTri, endTri) in the reordered triVerts. */
  startTri: number;
  endTri: number;
}

/** Reorder triangles so each part's triangles are contiguous (parts in index
 *  order, unassigned last). Returns the new triVerts and the non-empty runs. */
export function orderTrianglesByPart(
  triVerts: Uint32Array,
  triPart: Int32Array,
  partCount: number,
): { triVerts: Uint32Array; runs: PartRun[] } {
  const nTri = triPart.length;
  // Bucket k = part index, partCount = unassigned.
  const counts = new Int32Array(partCount + 1);
  for (let t = 0; t < nTri; t++) counts[triPart[t] < 0 ? partCount : triPart[t]]++;
  const starts = new Int32Array(partCount + 2);
  for (let k = 0; k <= partCount; k++) starts[k + 1] = starts[k] + counts[k];
  const fill = starts.slice(0, partCount + 1);
  const out = new Uint32Array(nTri * 3);
  for (let t = 0; t < nTri; t++) {
    const k = triPart[t] < 0 ? partCount : triPart[t];
    const d = fill[k]++ * 3;
    out[d] = triVerts[t * 3]; out[d + 1] = triVerts[t * 3 + 1]; out[d + 2] = triVerts[t * 3 + 2];
  }
  const runs: PartRun[] = [];
  for (let k = 0; k <= partCount; k++) {
    if (counts[k] === 0) continue;
    runs.push({ part: k === partCount ? -1 : k, startTri: starts[k], endTri: starts[k + 1] });
  }
  return { triVerts: out, runs };
}
