// The Manifold-dependent half of the geometry-data stats: bbox, volume,
// surface area, genus, manifold status and the component census. Dependency-
// free (no engine/main-thread imports) so BOTH sides can compute it: the main
// thread over its own Manifold (statsComputation.ts), and the engine Worker over
// the live result Manifold of a big run — which lets the main thread skip
// rebuilding that Manifold (a multi-second, UI-freezing `Manifold.ofMesh` on a
// multi-million-triangle import) until something actually needs it.

import { componentsOverlap, edgeStats } from './geometryHeuristics';
import { computeMeshPieces, type MeshPieces } from './meshPieces';

/** Manifold runtime type — the manifold-3d package does not export precise TS
 *  types for the WASM-backed object, so it's an opaque value with method probes. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Manifold = any;

export interface ManifoldFacts {
  bbox: { min: [number, number, number]; max: [number, number, number] } | null;
  volume: number;
  surfaceArea: number;
  genus: number | null;
  isManifold: boolean;
  manifoldStatus: string | null;
  componentCount: number;
  containedComponents: number;
  componentsInterpenetrate: boolean;
  /** Shortest / mean triangle edge length of the result mesh — not a
   *  Manifold figure, but a full pass over a big mesh, so the Worker computes
   *  it alongside. Absent when computed on the main thread. */
  edges?: { min: number; mean: number };
  /** The mesh's connected components (`computeMeshPieces`), for the object
   *  list's Pieces section — also a full pass, so computed alongside. */
  pieces?: { count: number; pieceOfTri: Int32Array };
}

export function manifoldBoundingBox(manifold: Manifold): ManifoldFacts['bbox'] {
  try {
    const bbox = manifold.boundingBox();
    return {
      min: [bbox.min[0], bbox.min[1], bbox.min[2]],
      max: [bbox.max[0], bbox.max[1], bbox.max[2]],
    };
  } catch {
    return null;
  }
}

/** The mesh fields the mesh-based census reads (a subset of `MeshData`). */
export interface FactsMesh {
  vertProperties: Float32Array;
  triVerts: Uint32Array;
  numVert: number;
  numTri: number;
  numProp: number;
  mergeFromVert?: Uint32Array;
  mergeToVert?: Uint32Array;
}

interface Census {
  componentCount: number;
  containedComponents: number;
  componentsInterpenetrate: boolean;
}

interface PieceInfo { vol: number; bb: ManifoldFacts['bbox'] }

/** For each piece, the larger pieces that could enclose it: bigger volume and
 *  a bbox that holds its bbox. The cheap pre-filter both censuses share. */
function containmentCandidates(infos: PieceInfo[]): number[][] {
  return infos.map((smaller, j) => {
    const out: number[] = [];
    if (smaller.vol <= 0 || !smaller.bb) return out;
    for (let i = 0; i < infos.length; i++) {
      const larger = infos[i];
      if (i === j || larger.vol <= smaller.vol || !larger.bb) continue;
      let inside = true;
      for (let ax = 0; ax < 3 && inside; ax++) {
        if (smaller.bb.min[ax] < larger.bb.min[ax] - 0.01 ||
            smaller.bb.max[ax] > larger.bb.max[ax] + 0.01) inside = false;
      }
      if (inside) out.push(i);
    }
    return out;
  });
}

/** Count enclosed pieces (fully inside another solid, or negative-volume
 *  artifacts) — they won't detach in print and shouldn't trip floater
 *  warnings — given a per-pair "does piece i enclose piece j" test. */
function countContained(infos: PieceInfo[], candidates: number[][], encloses: (i: number, j: number) => boolean): number {
  let contained = 0;
  for (let j = 0; j < infos.length; j++) {
    if (infos[j].vol <= 0 || candidates[j].some(i => encloses(i, j))) contained++;
  }
  return contained;
}

function overlapOf(infos: PieceInfo[]): boolean {
  return componentsOverlap(infos.filter((i) => i.bb).map((i) => ({ bbox: i.bb! })));
}

/** The census from `manifold.decompose()`, with an exact (boolean intersect)
 *  containment test — used for ordinary-sized models. */
function censusFromManifold(manifold: Manifold): Census {
  const census: Census = { componentCount: 1, containedComponents: 0, componentsInterpenetrate: false };
  try {
    const parts = manifold.decompose();
    census.componentCount = parts.length;
    if (parts.length > 1) {
      const infos: PieceInfo[] = parts.map((p: Manifold) => ({
        bb: manifoldBoundingBox(p),
        vol: (() => { try { return p.volume() as number; } catch { return 0; } })(),
      }));
      // Cheap AABB-overlap pass over the decomposed parts (bboxes already in hand).
      census.componentsInterpenetrate = overlapOf(infos);
      // The volume + bbox pre-filters reject most pairs, so the expensive WASM
      // intersect() is only reached for plausible containment candidates.
      census.containedComponents = countContained(infos, containmentCandidates(infos), (i, j) => {
        try {
          const ix = parts[i].intersect(parts[j]);
          const ixVol = ix.volume() as number;
          ix.delete();
          // intersection volume ≈ smaller's volume → fully enclosed
          return Math.abs(ixVol - infos[j].vol) <= infos[j].vol * 0.05;
        } catch { return false; /* boolean failed, skip this pair */ }
      });
    }
    for (const p of parts) p.delete();
  } catch {
    // fallback
  }
  return census;
}

/** Sample points per enclosure test in the mesh census. */
const CONTAINMENT_SAMPLES = 12;

/** The census from the mesh itself — the piece split, per-piece signed volume
 *  and bbox in one pass — with containment judged by casting rays from a few
 *  points of the smaller piece through the larger (inside = odd crossings for
 *  every sample). `decompose()` + boolean `intersect()` took ~8.5 s on a
 *  3.7M-triangle mesh; this is a couple of linear passes. Approximate only in
 *  the containment test (a sliver poking out between samples), which feeds the
 *  floater warning, not geometry. */
function censusFromMesh(mesh: FactsMesh, pieces: MeshPieces): Census {
  const { vertProperties: vp, triVerts: tv, numTri, numProp: np } = mesh;
  const n = pieces.count;
  const census: Census = { componentCount: n, containedComponents: 0, componentsInterpenetrate: false };
  if (n <= 1) return census;
  const vol = new Float64Array(n);
  const lo = new Float64Array(n * 3).fill(Infinity), hi = new Float64Array(n * 3).fill(-Infinity);
  for (let t = 0; t < numTri; t++) {
    const p = pieces.pieceOfTri[t];
    if (p < 0) continue;
    const a = tv[t * 3] * np, b = tv[t * 3 + 1] * np, c = tv[t * 3 + 2] * np;
    vol[p] += (vp[a] * (vp[b + 1] * vp[c + 2] - vp[b + 2] * vp[c + 1])
      - vp[a + 1] * (vp[b] * vp[c + 2] - vp[b + 2] * vp[c])
      + vp[a + 2] * (vp[b] * vp[c + 1] - vp[b + 1] * vp[c])) / 6;
    for (const o of [a, b, c]) {
      for (let k = 0; k < 3; k++) {
        const x = vp[o + k];
        if (x < lo[p * 3 + k]) lo[p * 3 + k] = x;
        if (x > hi[p * 3 + k]) hi[p * 3 + k] = x;
      }
    }
  }
  const infos: PieceInfo[] = Array.from({ length: n }, (_, p) => ({
    vol: vol[p],
    bb: Number.isFinite(lo[p * 3])
      ? { min: [lo[p * 3], lo[p * 3 + 1], lo[p * 3 + 2]], max: [hi[p * 3], hi[p * 3 + 1], hi[p * 3 + 2]] }
      : null,
  }));
  census.componentsInterpenetrate = overlapOf(infos);
  const candidates = containmentCandidates(infos);

  // Sample points: centroids of evenly spaced triangles of each candidate
  // piece, nudged off-axis so the +X rays don't graze edges exactly.
  const needSamples = new Set<number>();
  candidates.forEach((c, j) => { if (c.length > 0) needSamples.add(j); });
  if (needSamples.size === 0) return census;
  const trisOf = new Map<number, number[]>();
  const count = new Uint32Array(n);
  for (let t = 0; t < numTri; t++) { const p = pieces.pieceOfTri[t]; if (p >= 0) count[p]++; }
  const seen = new Uint32Array(n);
  for (let t = 0; t < numTri; t++) {
    const p = pieces.pieceOfTri[t];
    if (p < 0 || !needSamples.has(p)) continue;
    const stride = Math.max(1, Math.floor(count[p] / CONTAINMENT_SAMPLES));
    if (seen[p]++ % stride !== 0) continue;
    const list = trisOf.get(p) ?? [];
    if (list.length < CONTAINMENT_SAMPLES) { list.push(t); trisOf.set(p, list); }
  }
  const diag = Math.hypot(...[0, 1, 2].map(k => Math.max(...infos.map(i => i.bb ? i.bb.max[k] : -Infinity)) - Math.min(...infos.map(i => i.bb ? i.bb.min[k] : Infinity))));
  const nudge = (Number.isFinite(diag) ? diag : 1) * 1e-7;
  // One test = (larger piece i, smaller piece j); its samples' crossing counts.
  interface Test { j: number; pts: Float64Array; crossings: Uint32Array }
  const testsByLarger = new Map<number, Test[]>();
  for (const j of needSamples) {
    const tris = trisOf.get(j) ?? [];
    const pts = new Float64Array(tris.length * 3);
    tris.forEach((t, s) => {
      for (let k = 0; k < 3; k++) {
        pts[s * 3 + k] = (vp[tv[t * 3] * np + k] + vp[tv[t * 3 + 1] * np + k] + vp[tv[t * 3 + 2] * np + k]) / 3;
      }
      pts[s * 3 + 1] += nudge * 0.7071;
      pts[s * 3 + 2] += nudge * 0.3183;
    });
    for (const i of candidates[j]) {
      const list = testsByLarger.get(i) ?? [];
      list.push({ j, pts, crossings: new Uint32Array(tris.length) });
      testsByLarger.set(i, list);
    }
  }
  for (let t = 0; t < numTri; t++) {
    const tests = testsByLarger.get(pieces.pieceOfTri[t]);
    if (!tests) continue;
    const a = tv[t * 3] * np, b = tv[t * 3 + 1] * np, c = tv[t * 3 + 2] * np;
    const ay = vp[a + 1], az = vp[a + 2], by = vp[b + 1], bz = vp[b + 2], cy = vp[c + 1], cz = vp[c + 2];
    for (const test of tests) {
      const { pts, crossings } = test;
      for (let s = 0; s < crossings.length; s++) {
        const py = pts[s * 3 + 1], pz = pts[s * 3 + 2];
        // Does the +X ray from the point pass through the triangle's YZ shadow?
        const d1 = (by - ay) * (pz - az) - (bz - az) * (py - ay);
        const d2 = (cy - by) * (pz - bz) - (cz - bz) * (py - by);
        const d3 = (ay - cy) * (pz - cz) - (az - cz) * (py - cy);
        if (!((d1 > 0 && d2 > 0 && d3 > 0) || (d1 < 0 && d2 < 0 && d3 < 0))) continue;
        const x = (d2 * vp[a] + d3 * vp[b] + d1 * vp[c]) / (d1 + d2 + d3);
        if (x > pts[s * 3]) crossings[s]++;
      }
    }
  }
  census.containedComponents = countContained(infos, candidates, (i, j) => {
    const test = testsByLarger.get(i)?.find(x => x.j === j);
    return !!test && test.crossings.length > 0 && test.crossings.every(c => c % 2 === 1);
  });
  return census;
}

/** The Manifold-dependent stats. With `mesh` (the engine Worker's big-run
 *  path — `mesh` is the manifold's own getMesh()), the component census comes
 *  from the mesh instead of decompose() + booleans, and the mesh-wide extras
 *  (edge stats, the piece split) ride along. */
export function computeManifoldFacts(manifold: Manifold, mesh?: FactsMesh): ManifoldFacts {
  let volume = 0;
  let surfaceArea = 0;
  try {
    volume = manifold.volume();
    surfaceArea = manifold.surfaceArea();
  } catch {
    // fallback if methods unavailable
  }

  const pieces = mesh ? computeMeshPieces(mesh) : null;
  const census = mesh && pieces ? censusFromMesh(mesh, pieces) : censusFromManifold(manifold);

  let isManifold = true;
  let manifoldStatus: string | null = null;
  try {
    const s = manifold.status();
    isManifold = s === 0 || s === 'NoError';
    if (!isManifold) manifoldStatus = String(s);
  } catch {
    // fallback
  }

  let genus: number | null = null;
  try { genus = manifold.genus(); } catch { genus = null; }

  return {
    bbox: manifoldBoundingBox(manifold),
    volume,
    surfaceArea,
    genus,
    isManifold,
    manifoldStatus,
    ...census,
    ...(mesh && pieces ? {
      edges: edgeStats(mesh.vertProperties, mesh.numProp, mesh.triVerts, mesh.numTri),
      pieces: { count: pieces.count, pieceOfTri: pieces.pieceOfTri },
    } : {}),
  };
}
