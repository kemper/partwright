// Carry part labels through ops that REMESH a solid (`api.round`,
// `api.smoothWeld`): their output is a fresh `levelSet` surface with one new
// originalID, so every `api.label` part on the input is lost. With
// `keepLabels: true` each output triangle takes the originalID of the input
// triangle whose SURFACE is nearest its centroid (point-to-triangle, so long
// thin input triangles — a cylinder cap's fan — still claim the faces right
// next to them), and the output is re-sorted into runs so
// `Manifold.ofMesh` re-attaches the provenance. Labels then survive exactly as
// they do through a boolean: `byLabel` paint, `withinPart`, `listObjectParts`
// and selectors keep working on the rounded / welded result.
//
// Pure (no WASM) and unit-tested; the sandbox op does the Manifold round-trip.

import { nearestSurfaceTriangleMap } from '../surface/colorTransfer';
import type { MeshData } from './types';

export interface RunMesh {
  vertProperties: Float32Array;
  triVerts: Uint32Array;
  numProp: number;
  numTri: number;
  runIndex?: Uint32Array;
  runOriginalID?: Uint32Array;
}

/** Positions-only copy of `mesh` as `MeshData` (what the nearest map reads). */
function positionsMesh(mesh: RunMesh): MeshData {
  const np = mesh.numProp;
  const nv = mesh.vertProperties.length / np;
  const vp = np === 3 ? mesh.vertProperties : new Float32Array(nv * 3);
  if (np !== 3) for (let v = 0; v < nv; v++) for (let k = 0; k < 3; k++) vp[v * 3 + k] = mesh.vertProperties[v * np + k];
  return { vertProperties: vp, triVerts: mesh.triVerts, numVert: nv, numTri: mesh.numTri, numProp: 3 };
}

/** The input meshes concatenated (positions only), with each triangle's
 *  originalID (-1 when its mesh carries no run info, or `keep` rejects it). */
function combineSources(sources: RunMesh[], keep: (id: number) => boolean): { mesh: MeshData; ids: Int32Array; anyRuns: boolean } {
  let nv = 0, nt = 0;
  for (const s of sources) { nv += s.vertProperties.length / s.numProp; nt += s.numTri; }
  const vp = new Float32Array(nv * 3);
  const tv = new Uint32Array(nt * 3);
  const ids = new Int32Array(nt).fill(-1);
  let vOff = 0, tOff = 0, anyRuns = false;
  for (const s of sources) {
    const p = positionsMesh(s);
    vp.set(p.vertProperties, vOff * 3);
    for (let i = 0; i < s.numTri * 3; i++) tv[tOff * 3 + i] = s.triVerts[i] + vOff;
    if (s.runIndex && s.runOriginalID) {
      for (let r = 0; r < s.runOriginalID.length; r++) {
        if (!keep(s.runOriginalID[r])) continue;
        anyRuns = true;
        const t0 = Math.floor(s.runIndex[r] / 3), t1 = Math.min(s.numTri, Math.floor(s.runIndex[r + 1] / 3));
        for (let t = t0; t < t1; t++) ids[tOff + t] = s.runOriginalID[r];
      }
    }
    vOff += p.numVert;
    tOff += s.numTri;
  }
  return { mesh: { vertProperties: vp, triVerts: tv, numVert: nv, numTri: nt, numProp: 3 }, ids, anyRuns };
}

/** Re-sort `out`'s triangles into runs keyed by the originalID of each one's
 *  nearest source triangle. Only ids `keep` accepts are carried (the sandbox
 *  passes "is a label", so plain primitive ids aren't); triangles whose nearest
 *  source id isn't carried keep `fallbackId` (the remeshed surface's own).
 *  Returns the new triVerts + run tables, or null when no source has an id to
 *  carry — the caller then keeps `out` as is. */
export function carryRunsByNearest(
  sources: RunMesh[],
  out: RunMesh,
  fallbackId: number,
  keep: (id: number) => boolean = () => true,
): { triVerts: Uint32Array; runIndex: Uint32Array; runOriginalID: Uint32Array } | null {
  const src = combineSources(sources, keep);
  if (!src.anyRuns || out.numTri === 0) return null;
  const outPos = positionsMesh(out);
  const centroids = new Float64Array(out.numTri * 3);
  for (let t = 0; t < out.numTri; t++) {
    for (let k = 0; k < 3; k++) {
      centroids[t * 3 + k] = (outPos.vertProperties[out.triVerts[t * 3] * 3 + k]
        + outPos.vertProperties[out.triVerts[t * 3 + 1] * 3 + k]
        + outPos.vertProperties[out.triVerts[t * 3 + 2] * 3 + k]) / 3;
    }
  }
  const map = nearestSurfaceTriangleMap(src.mesh, centroids);
  const idOf = new Int32Array(out.numTri);
  // Runs in order of first appearance, so the result is deterministic.
  const order: number[] = [];
  const count = new Map<number, number>();
  for (let t = 0; t < out.numTri; t++) {
    const id = map[t] >= 0 && src.ids[map[t]] >= 0 ? src.ids[map[t]] : fallbackId;
    idOf[t] = id;
    const c = count.get(id);
    if (c === undefined) { count.set(id, 1); order.push(id); } else count.set(id, c + 1);
  }
  const start = new Map<number, number>();
  let acc = 0;
  for (const id of order) { start.set(id, acc); acc += count.get(id)!; }
  const triVerts = new Uint32Array(out.numTri * 3);
  const cursor = new Map(start);
  for (let t = 0; t < out.numTri; t++) {
    const dst = cursor.get(idOf[t])!;
    cursor.set(idOf[t], dst + 1);
    triVerts[dst * 3] = out.triVerts[t * 3];
    triVerts[dst * 3 + 1] = out.triVerts[t * 3 + 1];
    triVerts[dst * 3 + 2] = out.triVerts[t * 3 + 2];
  }
  const runIndex = new Uint32Array(order.length + 1);
  const runOriginalID = new Uint32Array(order.length);
  order.forEach((id, r) => {
    runIndex[r] = start.get(id)! * 3;
    runOriginalID[r] = id;
  });
  runIndex[order.length] = out.numTri * 3;
  return { triVerts, runIndex, runOriginalID };
}
