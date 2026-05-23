// Split-for-printing: cut a model that's too big for the build volume into
// bed-sized chunks, drilling matching dowel-pin holes that straddle each cut so
// the printed pieces register and glue back together. This is a design-stage
// operation (where to cut, how to align), deliberately NOT slicing.
//
// The cut is purely geometric: we drill the alignment holes into the whole
// model first (so each chunk inherits its half automatically), then intersect
// with a grid of bed-sized boxes. Holes are only placed where the cut plane
// actually passes through material, tested by intersecting a probe with the
// solid. The chunks are returned both individually and arranged in a row
// (a single multi-component mesh) for preview / baking as a version.

import type { MeshData } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface SplitConnector {
  type: 'none' | 'pin';
  /** Dowel-pin nominal diameter (mm). Default 5. */
  diameter?: number;
  /** How deep the hole goes into each side of the cut (mm). Default 8. */
  depth?: number;
  /** Extra radius added for assembly fit (mm). Default from printer clearance. */
  clearance?: number;
  /** Max holes per cut plane. Default 2. */
  count?: number;
}

export interface SplitOptions {
  bed: [number, number, number];
  /** Fraction of the bed kept as margin (0–0.5). Default 0. */
  margin?: number;
  connector?: SplitConnector;
  /** Spacing between laid-out chunks in the preview row (mm). Default 4. */
  gap?: number;
  /** Axes allowed to be cut. Default ['x', 'y'] (avoid Z so pieces keep flat
   *  bottoms for bed adhesion). */
  axes?: ('x' | 'y' | 'z')[];
}

export interface SplitResult {
  parts: MeshData[];
  /** All chunks arranged in a row as one multi-component mesh, for preview. */
  layout: MeshData;
  /** Cells per axis [x, y, z]. */
  grid: [number, number, number];
  partCount: number;
  holeCount: number;
  notes: string[];
}

type Vec3 = [number, number, number];

function meshBounds(mesh: MeshData): { min: Vec3; max: Vec3; dim: Vec3 } | null {
  if (mesh.numVert === 0) return null;
  const v = mesh.vertProperties;
  const n = mesh.numProp;
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < mesh.numVert; i++) {
    const x = v[i * n], y = v[i * n + 1], z = v[i * n + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ], dim: [maxX - minX, maxY - minY, maxZ - minZ] };
}

function toMeshDataCopy(m: any): MeshData {
  const mesh = m.getMesh();
  return {
    vertProperties: mesh.vertProperties.slice(),
    triVerts: mesh.triVerts.slice(),
    numVert: mesh.numVert,
    numTri: mesh.numTri,
    numProp: mesh.numProp,
  };
}

function del(m: any): void {
  if (m && typeof m.delete === 'function') { try { m.delete(); } catch { /* freed */ } }
}

/** Concatenate meshes into one buffer, applying a per-mesh XYZ offset. The
 *  pieces stay topologically separate (a valid multi-component manifold when
 *  they don't touch). Assumes a common numProp (always 3 from getMesh). */
function concatMeshes(items: { mesh: MeshData; offset: Vec3 }[]): MeshData {
  const numProp = items[0]?.mesh.numProp ?? 3;
  let totalVert = 0, totalTri = 0;
  for (const it of items) { totalVert += it.mesh.numVert; totalTri += it.mesh.numTri; }
  const vp = new Float32Array(totalVert * numProp);
  const tv = new Uint32Array(totalTri * 3);
  let vOff = 0, tOff = 0;
  for (const { mesh, offset } of items) {
    for (let i = 0; i < mesh.numVert; i++) {
      const s = i * mesh.numProp, d = (vOff + i) * numProp;
      vp[d] = mesh.vertProperties[s] + offset[0];
      vp[d + 1] = mesh.vertProperties[s + 1] + offset[1];
      vp[d + 2] = mesh.vertProperties[s + 2] + offset[2];
      for (let k = 3; k < numProp; k++) vp[d + k] = mesh.vertProperties[s + k] ?? 0;
    }
    for (let i = 0; i < mesh.numTri * 3; i++) tv[tOff * 3 + i] = mesh.triVerts[i] + vOff;
    vOff += mesh.numVert;
    tOff += mesh.numTri;
  }
  return { vertProperties: vp, triVerts: tv, numVert: totalVert, numTri: totalTri, numProp };
}

/** A cylinder centered on the origin with its axis along axis index `ai`. */
function orientedDowel(Manifold: any, ai: number, halfLen: number, r: number, segs: number): any {
  let c = Manifold.cylinder(2 * halfLen, r, r, segs).translate([0, 0, -halfLen]);
  if (ai === 0) c = c.rotate([0, 90, 0]);
  else if (ai === 1) c = c.rotate([90, 0, 0]);
  return c;
}

export function splitForPrinting(module: any, mesh: MeshData, opts: SplitOptions): SplitResult | { error: string } {
  const { Manifold } = module;
  const bb = meshBounds(mesh);
  if (!bb) return { error: 'no geometry to split' };

  const margin = Math.min(0.5, Math.max(0, opts.margin ?? 0));
  const usable: Vec3 = [opts.bed[0] * (1 - margin), opts.bed[1] * (1 - margin), opts.bed[2] * (1 - margin)];
  const allowed = new Set(opts.axes ?? ['x', 'y']);
  const axisIdx = { x: 0, y: 1, z: 2 } as const;

  // Cells per axis: only split an axis that's both allowed and oversized.
  const counts: [number, number, number] = [1, 1, 1];
  (['x', 'y', 'z'] as const).forEach(ax => {
    const i = axisIdx[ax];
    counts[i] = allowed.has(ax) ? Math.max(1, Math.ceil(bb.dim[i] / usable[i] - 1e-6)) : 1;
  });

  if (counts[0] * counts[1] * counts[2] <= 1) {
    return { error: 'Model already fits the build volume on the allowed axes — nothing to split. (Try enabling the Z axis, or scale up first.)' };
  }

  let M: any;
  try {
    M = Manifold.ofMesh({ numProp: mesh.numProp, vertProperties: mesh.vertProperties, triVerts: mesh.triVerts });
    if (!M || M.isEmpty()) { del(M); return { error: 'split needs a solid (manifold) model — this geometry is empty or render-only.' }; }
  } catch (e) {
    return { error: `split needs a solid (manifold) model: ${e instanceof Error ? e.message : String(e)}` };
  }

  const notes: string[] = [];
  const PAD = Math.max(1, bb.dim[0] + bb.dim[1] + bb.dim[2]); // generous outer overshoot

  // Per-axis boundary coordinates: outer faces padded, internal cuts exact.
  const bounds: number[][] = [0, 1, 2].map(i => {
    const arr: number[] = [];
    for (let k = 0; k <= counts[i]; k++) {
      if (k === 0) arr.push(bb.min[i] - PAD);
      else if (k === counts[i]) arr.push(bb.max[i] + PAD);
      else arr.push(bb.min[i] + (bb.dim[i] * k) / counts[i]);
    }
    return arr;
  });

  // ── Alignment dowel holes straddling each internal cut plane ──────────────
  const connector = opts.connector ?? { type: 'pin' };
  let holeCount = 0;
  if (connector.type === 'pin') {
    const dia = connector.diameter ?? 5;
    const depth = connector.depth ?? 8;
    const clr = connector.clearance ?? 0.2;
    const maxHoles = Math.max(1, connector.count ?? 2);
    const r = dia / 2 + clr;
    const segs = 24;
    const fracs = [[0.5, 0.5], [0.35, 0.5], [0.65, 0.5], [0.5, 0.35], [0.5, 0.65]];

    let holes: any = null;
    for (let ai = 0; ai < 3; ai++) {
      if (counts[ai] <= 1) continue;
      const o1 = (ai + 1) % 3, o2 = (ai + 2) % 3;
      for (let k = 1; k < counts[ai]; k++) {
        const c = bb.min[ai] + (bb.dim[ai] * k) / counts[ai];
        let placed = 0;
        for (const [f1, f2] of fracs) {
          if (placed >= maxHoles) break;
          const center: Vec3 = [0, 0, 0];
          center[ai] = c;
          center[o1] = bb.min[o1] + bb.dim[o1] * f1;
          center[o2] = bb.min[o2] + bb.dim[o2] * f2;
          const dowel = orientedDowel(Manifold, ai, depth, r, segs).translate(center);
          // Keep the hole only if the cut plane has material here (probe ∩ solid).
          let inMaterial = false;
          const probe = M.intersect(dowel);
          try { inMaterial = !probe.isEmpty(); } catch { inMaterial = false; }
          del(probe);
          if (inMaterial) {
            holes = holes === null ? dowel : holes.add(dowel);
            placed++;
            holeCount++;
          } else {
            del(dowel);
          }
        }
      }
    }
    if (holes) {
      const drilled = M.subtract(holes);
      del(holes);
      del(M);
      M = drilled;
    }
    if (holeCount === 0) notes.push('No alignment holes could be placed (thin geometry at the cut planes) — pieces will need manual alignment.');
    else notes.push(`${holeCount} ⌀${(dia)}mm dowel hole${holeCount === 1 ? '' : 's'} drilled across the cuts (print pins or use rod to align).`);
  }

  // ── Intersect with each cell box ──────────────────────────────────────────
  const parts: MeshData[] = [];
  for (let i = 0; i < counts[0]; i++) {
    for (let j = 0; j < counts[1]; j++) {
      for (let k = 0; k < counts[2]; k++) {
        const lo: Vec3 = [bounds[0][i], bounds[1][j], bounds[2][k]];
        const hi: Vec3 = [bounds[0][i + 1], bounds[1][j + 1], bounds[2][k + 1]];
        const size: Vec3 = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
        const box = Manifold.cube(size).translate(lo);
        const chunk = M.intersect(box);
        del(box);
        let empty = true;
        try { empty = chunk.isEmpty(); } catch { empty = true; }
        if (!empty) parts.push(toMeshDataCopy(chunk));
        del(chunk);
      }
    }
  }
  del(M);

  if (parts.length === 0) return { error: 'split produced no pieces — unexpected; the model may be degenerate.' };

  // ── Lay the chunks out in a row for preview / bake ────────────────────────
  const gap = opts.gap ?? 4;
  const items: { mesh: MeshData; offset: Vec3 }[] = [];
  let cursor = 0;
  for (const p of parts) {
    const pb = meshBounds(p)!;
    items.push({ mesh: p, offset: [cursor - pb.min[0], -pb.min[1], -pb.min[2]] });
    cursor += pb.dim[0] + gap;
  }
  const layout = concatMeshes(items);

  return {
    parts,
    layout,
    grid: counts,
    partCount: parts.length,
    holeCount,
    notes,
  };
}
