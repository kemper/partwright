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
import { buildConnector, type ConnectorSpec, type ConnectorType } from './splitConnectors';

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface SplitConnector {
  /** Connector kind across each cut. 'pin' is accepted as a legacy alias for 'dowel'. */
  type: ConnectorType | 'pin';
  /** Pin / peg / screw ⌀ (mm). Default 5. */
  diameter?: number;
  /** How deep the connector reaches into each side (mm). Default 8. */
  depth?: number;
  /** Dovetail key width (mm). Default 12. */
  width?: number;
  /** Extra radius/clearance added for assembly fit (mm). Default from printer clearance. */
  clearance?: number;
  /** Max connectors per cut plane. Default 2. */
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
  /** Total connectors placed across all internal cut planes. Alias of holeCount for back-compat. */
  connectorCount: number;
  /** @deprecated use connectorCount */
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

  // ── Connectors straddling each internal cut plane ─────────────────────────
  // Drill-style connectors (dowel, screw) are unioned and subtracted from M
  // before cell extraction so both halves inherit the cut. Add/sub-style
  // connectors (peg, dovetail) need to know which neighbouring cell is
  // positive vs. negative of the plane, so they're queued per-cell and
  // applied after the chunk is extracted.
  const rawConnector = opts.connector ?? { type: 'dowel' as const };
  const connectorType: ConnectorType = rawConnector.type === 'pin' ? 'dowel' : rawConnector.type;
  const spec: ConnectorSpec = {
    type: connectorType,
    diameter: rawConnector.diameter,
    depth: rawConnector.depth,
    width: rawConnector.width,
    clearance: rawConnector.clearance,
  };
  let connectorCount = 0;
  const cellEdits = new Map<string, { adds: any[]; subs: any[] }>();
  const editsFor = (i: number, j: number, k: number): { adds: any[]; subs: any[] } => {
    const key = `${i},${j},${k}`;
    let e = cellEdits.get(key);
    if (!e) { e = { adds: [], subs: [] }; cellEdits.set(key, e); }
    return e;
  };

  if (connectorType !== 'none') {
    const maxConnectors = Math.max(1, rawConnector.count ?? 2);
    const fracs: [number, number][] = [[0.5, 0.5], [0.35, 0.5], [0.65, 0.5], [0.5, 0.35], [0.5, 0.65]];
    const probeSize = Math.max(2, spec.diameter ?? spec.width ?? 5);

    let drillUnion: any = null;
    for (let ai = 0; ai < 3; ai++) {
      if (counts[ai] <= 1) continue;
      const o1 = (ai + 1) % 3, o2 = (ai + 2) % 3;
      const normal: Vec3 = [0, 0, 0]; normal[ai] = 1;
      const cellWidthO1 = bb.dim[o1] / counts[o1];
      const cellWidthO2 = bb.dim[o2] / counts[o2];

      for (let kPlane = 1; kPlane < counts[ai]; kPlane++) {
        const planeCoord = bb.min[ai] + (bb.dim[ai] * kPlane) / counts[ai];
        let placed = 0;
        for (const [f1, f2] of fracs) {
          if (placed >= maxConnectors) break;
          const pos: Vec3 = [0, 0, 0];
          pos[ai] = planeCoord;
          pos[o1] = bb.min[o1] + bb.dim[o1] * f1;
          pos[o2] = bb.min[o2] + bb.dim[o2] * f2;
          // Probe for material at this point on the cut plane.
          const probe = Manifold.cube([probeSize, probeSize, probeSize], true).translate(pos);
          let inMaterial = false;
          const inter = M.intersect(probe);
          try { inMaterial = !inter.isEmpty(); } catch { inMaterial = false; }
          del(inter); del(probe);
          if (!inMaterial) continue;

          const g = buildConnector(module, pos, normal, spec);
          if (!g) continue;

          if (g.drillBoth) {
            if (drillUnion === null) drillUnion = g.drillBoth;
            else { const m = drillUnion.add(g.drillBoth); del(drillUnion); del(g.drillBoth); drillUnion = m; }
          }
          if (g.addPositive || g.subNegative) {
            // The positive side along ai is the cell at index kPlane (cells 0..counts-1).
            const idxO1 = Math.max(0, Math.min(counts[o1] - 1, Math.floor((pos[o1] - bb.min[o1]) / cellWidthO1)));
            const idxO2 = Math.max(0, Math.min(counts[o2] - 1, Math.floor((pos[o2] - bb.min[o2]) / cellWidthO2)));
            if (g.addPositive) {
              const ci: [number, number, number] = [0, 0, 0];
              ci[ai] = kPlane; ci[o1] = idxO1; ci[o2] = idxO2;
              editsFor(ci[0], ci[1], ci[2]).adds.push(g.addPositive);
            }
            if (g.subNegative) {
              const ci: [number, number, number] = [0, 0, 0];
              ci[ai] = kPlane - 1; ci[o1] = idxO1; ci[o2] = idxO2;
              editsFor(ci[0], ci[1], ci[2]).subs.push(g.subNegative);
            }
          }
          placed++;
          connectorCount++;
        }
      }
    }
    if (drillUnion) { const drilled = M.subtract(drillUnion); del(drillUnion); del(M); M = drilled; }

    if (connectorCount === 0) {
      notes.push('No connectors could be placed (thin geometry at the cut planes) — pieces will need manual alignment.');
    } else {
      notes.push(`${connectorCount} ${connectorType} connector${connectorCount === 1 ? '' : 's'} across the cuts.`);
    }
  }

  // ── Intersect with each cell box and apply per-cell connector edits ───────
  const parts: MeshData[] = [];
  for (let i = 0; i < counts[0]; i++) {
    for (let j = 0; j < counts[1]; j++) {
      for (let k = 0; k < counts[2]; k++) {
        const lo: Vec3 = [bounds[0][i], bounds[1][j], bounds[2][k]];
        const hi: Vec3 = [bounds[0][i + 1], bounds[1][j + 1], bounds[2][k + 1]];
        const size: Vec3 = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
        const box = Manifold.cube(size).translate(lo);
        let chunk = M.intersect(box);
        del(box);
        let empty = true;
        try { empty = chunk.isEmpty(); } catch { empty = true; }
        if (!empty) {
          const e = cellEdits.get(`${i},${j},${k}`);
          if (e) {
            for (const a of e.adds) { const m = chunk.add(a); del(chunk); chunk = m; }
            for (const s of e.subs) { const m = chunk.subtract(s); del(chunk); chunk = m; }
          }
          parts.push(toMeshDataCopy(chunk));
        }
        del(chunk);
      }
    }
  }
  // Free the queued add/sub manifolds (chunk.add/subtract returns new manifolds; sources still need to be freed).
  for (const e of cellEdits.values()) {
    for (const a of e.adds) del(a);
    for (const s of e.subs) del(s);
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
    connectorCount,
    holeCount: connectorCount,
    notes,
  };
}

// ── Arbitrary-plane split (manual cut) ──────────────────────────────────────

export interface PlaneSpec {
  /** A point the cut plane passes through. */
  point: Vec3;
  /** Plane normal (need not be unit). */
  normal: Vec3;
}

export interface PlaneSplitResult {
  parts: MeshData[];
  partCount: number;
  connectorCount: number;
  notes: string[];
}

function dot(a: Vec3, b: Vec3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a: Vec3, b: Vec3): Vec3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function len3(a: Vec3): number { return Math.hypot(a[0], a[1], a[2]); }
function norm3(a: Vec3): Vec3 | null { const l = len3(a); if (l < 1e-9) return null; return [a[0] / l, a[1] / l, a[2] / l]; }

function meshCentroid(mesh: MeshData): Vec3 {
  const b = meshBounds(mesh)!;
  return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
}

/** Distribute up to `count` connector points across the cut plane, keeping only
 *  those that fall inside the solid (tested by intersecting a probe with M),
 *  ordered nearest-to-centre first. */
function pickPlanePositions(Manifold: any, M: any, plane: PlaneSpec, n: Vec3, extent: number, count: number, probeSize: number): Vec3[] {
  const ref: Vec3 = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = norm3(cross(ref, n))!;
  const v = cross(n, u); // unit (n, u orthonormal)
  const fracs = [0, -0.35, 0.35, -0.6, 0.6];
  const candidates: { p: Vec3; d: number }[] = [];
  for (const fu of fracs) {
    for (const fv of fracs) {
      const p: Vec3 = [
        plane.point[0] + (u[0] * fu + v[0] * fv) * extent,
        plane.point[1] + (u[1] * fu + v[1] * fv) * extent,
        plane.point[2] + (u[2] * fu + v[2] * fv) * extent,
      ];
      candidates.push({ p, d: Math.hypot(fu, fv) });
    }
  }
  candidates.sort((a, b) => a.d - b.d);
  const out: Vec3[] = [];
  for (const c of candidates) {
    if (out.length >= count) break;
    const probe = Manifold.cube([probeSize, probeSize, probeSize], true).translate(c.p);
    let inside = false;
    const inter = M.intersect(probe);
    try { inside = !inter.isEmpty(); } catch { inside = false; }
    del(inter); del(probe);
    if (inside) out.push(c.p);
  }
  return out;
}

/** Cut a manifold along one arbitrary plane into two parts, applying the chosen
 *  connector (dowel / peg / screw / dovetail) across the cut. */
export function planeSplit(
  module: any,
  mesh: MeshData,
  plane: PlaneSpec,
  spec: ConnectorSpec,
  opts?: { count?: number },
): PlaneSplitResult | { error: string } {
  const { Manifold } = module;
  const bb = meshBounds(mesh);
  if (!bb) return { error: 'no geometry to split' };
  const n = norm3(plane.normal);
  if (!n) return { error: 'split plane normal must be non-zero' };

  let M: any;
  try {
    M = Manifold.ofMesh({ numProp: mesh.numProp, vertProperties: mesh.vertProperties, triVerts: mesh.triVerts });
    if (!M || M.isEmpty()) { del(M); return { error: 'split needs a solid (manifold) model — this geometry is empty or render-only.' }; }
  } catch (e) {
    return { error: `split needs a solid (manifold) model: ${e instanceof Error ? e.message : String(e)}` };
  }

  const notes: string[] = [];
  const offset = dot(plane.point, n);
  const extent = len3(bb.dim) / 2;

  // ── Connectors ────────────────────────────────────────────────────────────
  const count = Math.max(0, Math.min(8, opts?.count ?? 2));
  const positions = spec.type === 'none' || count === 0
    ? []
    : pickPlanePositions(Manifold, M, plane, n, extent, count, Math.max(2, (spec.diameter ?? 5)));

  let drillUnion: any = null;
  const addPositive: any[] = [];
  const subNegative: any[] = [];
  for (const p of positions) {
    const g = buildConnector(module, p, n, spec);
    if (!g) continue;
    if (g.drillBoth) drillUnion = drillUnion === null ? g.drillBoth : (() => { const m = drillUnion.add(g.drillBoth); del(drillUnion); del(g.drillBoth); return m; })();
    if (g.addPositive) addPositive.push(g.addPositive);
    if (g.subNegative) subNegative.push(g.subNegative);
  }
  if (drillUnion) { const m = M.subtract(drillUnion); del(drillUnion); del(M); M = m; }

  // ── Cut ─────────────────────────────────────────────────────────────────
  let halves: any[];
  try {
    halves = M.splitByPlane(n, offset);
  } catch (e) {
    del(M);
    for (const a of addPositive) del(a);
    for (const s of subNegative) del(s);
    return { error: `plane cut failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  del(M);

  // Apply per-side connector geometry to whichever half is positive.
  const out: MeshData[] = [];
  let connectorCount = positions.length;
  for (let i = 0; i < halves.length; i++) {
    let half = halves[i];
    let empty = true;
    try { empty = half.isEmpty(); } catch { empty = true; }
    if (empty) { del(half); continue; }
    const positive = dot(meshCentroid(toMeshDataCopy(half)), n) > offset;
    if (positive) {
      for (const a of addPositive) { const m = half.add(a); del(half); half = m; }
    } else {
      for (const s of subNegative) { const m = half.subtract(s); del(half); half = m; }
    }
    out.push(toMeshDataCopy(half));
    del(half);
  }
  for (const a of addPositive) del(a);
  for (const s of subNegative) del(s);

  if (out.length < 2) {
    notes.push('The plane did not divide the model into two pieces — reposition it so it passes through the solid.');
  }
  if (spec.type !== 'none') {
    notes.push(connectorCount > 0
      ? `${connectorCount} ${spec.type} connector${connectorCount === 1 ? '' : 's'} across the cut.`
      : 'No connectors placed (plane missed the solid at the sampled points).');
  }

  return { parts: out, partCount: out.length, connectorCount, notes };
}
