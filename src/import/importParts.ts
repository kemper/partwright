// Pure helpers for parts committed on an imported mesh (part detection,
// #1025): validation, and ordering triangles into per-part runs so
// `Manifold.ofMesh` can carry each part as its own `runOriginalID` — the same
// provenance mechanism `api.label` uses, which survives booleans.

import type { ImportedMeshParts } from './importedMesh';
import type { MeshData } from '../geometry/types';
import { nearestSurfaceTriangleMap } from '../surface/colorTransfer';

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
  if (r.source && typeof r.source === 'object' && typeof r.source.detectorId === 'string') {
    out.source = { ...r.source };
    if (r.source.seeds !== undefined) {
      const seeds = Array.isArray(r.source.seeds) ? r.source.seeds.flatMap((s) => normalizeSeed(s)) : [];
      out.source.seeds = seeds;
    }
  }
  return out;
}

type SavedSeed = NonNullable<NonNullable<ImportedMeshParts['source']>['seeds']>[number];

/** Keep a saved pin's known fields (incl. `maxRadius` and `color`) when they
 *  are well-formed; drop the pin when its label/point are not. */
function normalizeSeed(raw: unknown): SavedSeed[] {
  if (!raw || typeof raw !== 'object') return [];
  const s = raw as Partial<SavedSeed>;
  if (typeof s.label !== 'string' || !s.label.trim()) return [];
  if (!Array.isArray(s.point) || s.point.length !== 3 || s.point.some((v) => typeof v !== 'number' || !Number.isFinite(v))) return [];
  const out: SavedSeed = { label: s.label, point: [s.point[0], s.point[1], s.point[2]] };
  if (s.auto === true) out.auto = true;
  if (typeof s.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(s.color)) out.color = s.color.toLowerCase();
  if (typeof s.maxRadius === 'number' && Number.isFinite(s.maxRadius) && s.maxRadius > 0) out.maxRadius = s.maxRadius;
  return [out];
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

/** Drop the triangles of the parts whose indices are in `remove`, then cap
 *  every opening that leaves with a fan of triangles to the opening's centroid,
 *  so the mesh stays closed for `Manifold.ofMesh` — the import half of
 *  `api.removePart`. A part that was its own closed shell leaves no opening.
 *  Each cap joins the part that owns most of its opening's rim (the surface it
 *  closes), and its centroid vertex averages the loop's vertex properties. The mesh must be welded (shared vertices), as
 *  every import is. */
export function removeImportPartTriangles(
  mesh: { numProp: number; vertProperties: Float32Array; triVerts: Uint32Array },
  triPart: Int32Array,
  remove: ReadonlySet<number>,
): { vertProperties: Float32Array; triVerts: Uint32Array; triPart: Int32Array; openings: number } {
  const { numProp, vertProperties, triVerts } = mesh;
  const numTri = triVerts.length / 3;
  const numVert = vertProperties.length / numProp;
  const kept: number[] = [];
  const keptPart: number[] = [];
  for (let t = 0; t < numTri; t++) {
    if (remove.has(triPart[t])) continue;
    kept.push(triVerts[t * 3], triVerts[t * 3 + 1], triVerts[t * 3 + 2]);
    keptPart.push(triPart[t]);
  }

  // Directed edges of what's left; an edge whose reverse is missing borders
  // an opening. Boundary edges keep the kept triangle's direction (a → b).
  const edgeKey = (a: number, b: number) => a * numVert + b;
  const edges = new Set<number>();
  for (let i = 0; i < kept.length; i += 3) {
    for (let k = 0; k < 3; k++) edges.add(edgeKey(kept[i + k], kept[i + (k + 1) % 3]));
  }
  const next = new Map<number, number[]>();
  const rimPart = new Map<number, number>(); // boundary edge → its triangle's part
  for (let i = 0; i < kept.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const a = kept[i + k], b = kept[i + (k + 1) % 3];
      if (edges.has(edgeKey(b, a))) continue;
      const out = next.get(a);
      if (out) out.push(b); else next.set(a, [b]);
      rimPart.set(edgeKey(a, b), keptPart[i / 3]);
    }
  }

  const props = Array.from(vertProperties);
  let openings = 0;
  for (const start of [...next.keys()]) {
    while ((next.get(start)?.length ?? 0) > 0) {
      // Walk one loop of boundary edges back to `start`.
      const loop: number[] = [start];
      let cur = start;
      for (let guard = 0; ; guard++) {
        const outs = next.get(cur);
        if (!outs || outs.length === 0 || guard > numVert) {
          throw new Error('api.removePart: could not close the opening left by the removed part (its edge is not a simple loop).');
        }
        const nxt = outs.pop()!;
        if (nxt === start) break;
        loop.push(nxt);
        cur = nxt;
      }
      // Fan the loop to a new vertex at its centroid. The boundary edge a → b
      // belongs to a kept triangle, so the cap triangle runs b → a.
      const c = props.length / numProp;
      for (let p = 0; p < numProp; p++) {
        let sum = 0;
        for (const v of loop) sum += vertProperties[v * numProp + p];
        props.push(sum / loop.length);
      }
      const votes = new Map<number, number>();
      for (let i = 0; i < loop.length; i++) {
        const part = rimPart.get(edgeKey(loop[i], loop[(i + 1) % loop.length])) ?? -1;
        votes.set(part, (votes.get(part) ?? 0) + 1);
      }
      let capPart = -1;
      let most = 0;
      for (const [part, n] of votes) if (n > most) { most = n; capPart = part; }
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i], b = loop[(i + 1) % loop.length];
        kept.push(b, a, c);
        keptPart.push(capPart);
      }
      openings++;
    }
  }
  return {
    vertProperties: new Float32Array(props),
    triVerts: new Uint32Array(kept),
    triPart: new Int32Array(keptPart),
    openings,
  };
}

/** True when two meshes share one triangle list (a rigid transform or a
 *  recolour of the same mesh), so triangle indices carry over directly. */
function sameTriangles(a: MeshData, b: MeshData): boolean {
  if (a === b) return true;
  if (a.triVerts.length !== b.triVerts.length) return false;
  for (let i = 0; i < a.triVerts.length; i++) if (a.triVerts[i] !== b.triVerts[i]) return false;
  return true;
}

/** Move label triangle sets from `from` onto `to`: each triangle of `to`
 *  takes the label of the `from` triangle whose SURFACE is nearest its
 *  centroid (not the nearest centroid, which a coarse mesh's few large
 *  triangles get badly wrong). */
function remapBySurface(labels: Map<string, Set<number>>, from: MeshData, to: MeshData): Map<string, Set<number>> {
  const owner = new Int32Array(from.triVerts.length / 3).fill(-1);
  const names = [...labels.keys()];
  names.forEach((name, i) => { for (const t of labels.get(name)!) if (t >= 0 && t < owner.length && owner[t] < 0) owner[t] = i; });
  const vp = to.vertProperties, tv = to.triVerts, np = to.numProp;
  const n = tv.length / 3;
  const centroids = new Float64Array(n * 3);
  for (let t = 0; t < n; t++) {
    for (let k = 0; k < 3; k++) centroids[t * 3 + k] = (vp[tv[t * 3] * np + k] + vp[tv[t * 3 + 1] * np + k] + vp[tv[t * 3 + 2] * np + k]) / 3;
  }
  const nearest = nearestSurfaceTriangleMap(from, centroids);
  const out = new Map<string, Set<number>>(names.map(name => [name, new Set<number>()]));
  for (let t = 0; t < n; t++) {
    const o = nearest[t] >= 0 ? owner[nearest[t]] : -1;
    if (o >= 0) out.get(names[o])!.add(t);
  }
  return out;
}

/** Turn a run's labels into parts on a baked mesh, so a bake (surface
 *  texture, scale, rotate, place) keeps them: the baked mesh is saved as an
 *  import and `api.importWithParts` restores the labels (#1025).
 *
 *  `labels` index `labelMesh` (the run's own mesh); `input` is the mesh the
 *  bake started from (the displayed mesh, which may be re-tessellated) and
 *  `baked` its result. Triangle ids carry across a shared triangle list and
 *  by nearest surface otherwise — a texture keeps the surface in place,
 *  while a rigid transform keeps the triangle list. `colors` ('#rrggbb' by
 *  name) become the parts' colours. Returns null when no label covers any
 *  baked triangle. */
export function partsFromLabels(
  labels: Map<string, Set<number>>,
  labelMesh: MeshData,
  input: MeshData,
  baked: MeshData,
  colors: Map<string, string> = new Map(),
): ImportedMeshParts | null {
  const onInput = sameTriangles(labelMesh, input) ? labels : remapBySurface(labels, labelMesh, input);
  const onBaked = sameTriangles(input, baked) ? onInput : remapBySurface(onInput, input, baked);
  const numTri = baked.triVerts.length / 3;
  const triPart = new Int32Array(numTri).fill(-1);
  const names: string[] = [];
  for (const [name, tris] of onBaked) {
    let used = false;
    for (const t of tris) {
      if (t < 0 || t >= numTri || triPart[t] !== -1) continue;
      triPart[t] = names.length;
      used = true;
    }
    if (used) names.push(name);
  }
  if (names.length === 0) return null;
  return normalizeImportParts({ names, colors: names.map(n => colors.get(n) ?? null), triPart }, numTri);
}
