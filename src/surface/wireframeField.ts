// Wireframe / edge cage — a volumetric surface modifier.
//
// Keep ONLY the model's sharp feature edges, rebuilt as smooth round struts, so
// the result is a see-through cage (the classic "edge wireframe" of a boxy
// shape). Unlike the other volumetric modifiers, this does NOT use
// `sdfModifierMesh`'s signed distance `d` to the *surface* — a cage follows the
// model's EDGES, not its skin. So it builds its own scalar field and meshes it
// with the lower-level pieces the foundation exposes:
//
//   field(p) = distanceToNearestFeatureEdge(p) − strutRadius      (< 0 = inside)
//
// then `surfaceNetsField` (iso 0) → `largestMeshComponent` → `smoothSurface`,
// reusing `sdfModifier`'s grid / padding / rasterize-for-bounds recipe.
//
// The iso-0 surface of an unsigned distance-to-segments field is exactly the
// union of round capsules around each edge, so struts come out cylindrical with
// rounded joins where edges meet — no extra modelling. The field is splatted in
// a NARROW BAND around each segment (only lattice points within the strut
// radius are touched), so cost scales with the edge length, not the whole grid.
//
// Pure logic (no DOM/WASM) → unit-tested in the vitest tier.

import type { MeshData } from '../geometry/types';
import { rasterizeSolid } from './voxelizeMesh';
import { surfaceNetsField } from './surfaceNetsField';
import { largestMeshComponent } from './meshComponents';
import { smoothSurface } from './smoothSurface';
import { extractPositions, bboxOf } from './meshSubdivide';
import { MAX_FIELD_RESOLUTION } from './sdfModifier';

export interface WireframeOptions {
  /** Radius of each round strut (world units). The strut diameter is twice this. */
  strutRadius: number;
  /** An interior edge is a "feature" edge when its two faces meet at a dihedral
   *  angle steeper than this (degrees). Boundary / non-manifold edges always
   *  count. Default 25°. Lower → more edges kept (denser cage). */
  angleThresholdDeg?: number;
  /** Field resolution along the longest axis (clamped to [16, MAX]); auto-raised
   *  so each strut still spans enough cells to round. Default 96. */
  resolution?: number;
  /** Keep ONLY the largest connected strut web (default false). A cage's feature
   *  edges commonly form several disconnected loops — e.g. stacked rings on a
   *  smooth body — so the default keeps every loop; set true only when you need a
   *  single printable piece and are happy to drop the rest. */
  watertight?: boolean;
  /** Light Taubin passes to relax the strut surface (default 3, no subdivide). */
  smoothIterations?: number;
}

/** Strut diameter should resolve to at least this many field cells so the
 *  continuous field has room to round the strut; resolution auto-raises to honour it. */
const MIN_STRUT_VOXELS = 5;

/** Extract the model's feature edges as a flat segment list
 *  `[ax,ay,az, bx,by,bz, …]` (world coordinates). An undirected edge is a
 *  feature when it is a boundary / non-manifold edge, or its two adjacent faces
 *  meet at a dihedral angle greater than `angleThresholdDeg`. Vertices are welded
 *  by position first so shared edges are detected even on unwelded meshes. */
export function extractFeatureEdges(mesh: MeshData, angleThresholdDeg: number): Float32Array {
  if (mesh.numTri === 0) return new Float32Array();
  const pos = extractPositions(mesh);

  // Weld coincident vertices so the dihedral test sees the true face adjacency.
  const { size } = bboxOf(pos);
  const maxDim = Math.max(size[0], size[1], size[2], 1e-6);
  const eps = maxDim * 1e-5;
  const key = (v: number) =>
    `${Math.round(pos[v * 3] / eps)},${Math.round(pos[v * 3 + 1] / eps)},${Math.round(pos[v * 3 + 2] / eps)}`;
  const canonOf = new Map<string, number>();
  const canon = new Int32Array(mesh.numVert);
  const canonPos: number[] = [];
  for (let v = 0; v < mesh.numVert; v++) {
    const k = key(v);
    let c = canonOf.get(k);
    if (c === undefined) {
      c = canonPos.length / 3;
      canonOf.set(k, c);
      canonPos.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
    }
    canon[v] = c;
  }

  // Per-face unit normal (canonical positions). Zero for degenerate faces.
  const tv = mesh.triVerts;
  const faceN = new Float32Array(mesh.numTri * 3);
  for (let t = 0; t < mesh.numTri; t++) {
    const a = canon[tv[t * 3]], b = canon[tv[t * 3 + 1]], c = canon[tv[t * 3 + 2]];
    const ax = canonPos[a * 3], ay = canonPos[a * 3 + 1], az = canonPos[a * 3 + 2];
    const ux = canonPos[b * 3] - ax, uy = canonPos[b * 3 + 1] - ay, uz = canonPos[b * 3 + 2] - az;
    const vx = canonPos[c * 3] - ax, vy = canonPos[c * 3 + 1] - ay, vz = canonPos[c * 3 + 2] - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len > 1e-12) { nx /= len; ny /= len; nz /= len; } else { nx = ny = nz = 0; }
    faceN[t * 3] = nx; faceN[t * 3 + 1] = ny; faceN[t * 3 + 2] = nz;
  }

  // Gather the faces touching each undirected (welded) edge.
  const edgeFaces = new Map<string, number[]>();
  const addEdge = (u: number, v: number, t: number) => {
    const ek = u < v ? `${u}_${v}` : `${v}_${u}`;
    const arr = edgeFaces.get(ek);
    if (arr) arr.push(t); else edgeFaces.set(ek, [t]);
  };
  for (let t = 0; t < mesh.numTri; t++) {
    const a = canon[tv[t * 3]], b = canon[tv[t * 3 + 1]], c = canon[tv[t * 3 + 2]];
    addEdge(a, b, t); addEdge(b, c, t); addEdge(c, a, t);
  }

  // dot(n0,n1) < cosThresh  ⇔  the faces bend by more than the threshold angle.
  const cosThresh = Math.cos((Math.max(0, angleThresholdDeg) * Math.PI) / 180);
  const out: number[] = [];
  for (const [ek, faces] of edgeFaces) {
    let feature: boolean;
    if (faces.length === 2) {
      const f0 = faces[0], f1 = faces[1];
      const dot = faceN[f0 * 3] * faceN[f1 * 3] + faceN[f0 * 3 + 1] * faceN[f1 * 3 + 1] + faceN[f0 * 3 + 2] * faceN[f1 * 3 + 2];
      feature = dot < cosThresh;
    } else {
      feature = true; // boundary (1) or non-manifold (>2) edge
    }
    if (!feature) continue;
    const sep = ek.indexOf('_');
    const u = Number(ek.slice(0, sep)), v = Number(ek.slice(sep + 1));
    out.push(
      canonPos[u * 3], canonPos[u * 3 + 1], canonPos[u * 3 + 2],
      canonPos[v * 3], canonPos[v * 3 + 1], canonPos[v * 3 + 2],
    );
  }
  return Float32Array.from(out);
}

/** Squared distance from point p to segment a→b. */
function distSqToSegment(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
): number {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const denom = abx * abx + aby * aby + abz * abz;
  let t = denom > 1e-12 ? (apx * abx + apy * aby + apz * abz) / denom : 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const dx = apx - t * abx, dy = apy - t * aby, dz = apz - t * abz;
  return dx * dx + dy * dy + dz * dz;
}

/** Build the wireframe / edge-cage mesh from a solid model. Returns an empty
 *  mesh when the input is empty or has no qualifying feature edges. */
export function wireframeMesh(mesh: MeshData, opts: WireframeOptions): MeshData {
  const empty: MeshData = { vertProperties: new Float32Array(), triVerts: new Uint32Array(), numVert: 0, numTri: 0, numProp: 3 };
  if (mesh.numTri === 0) return empty;

  const strutRadius = Math.max(1e-4, opts.strutRadius);
  const angle = opts.angleThresholdDeg ?? 25;

  const segs = extractFeatureEdges(mesh, angle);
  if (segs.length === 0) return empty;

  // Auto-raise resolution so a strut diameter spans ≥ MIN_STRUT_VOXELS cells.
  const maxDim = Math.max(...bboxOf(extractPositions(mesh)).size, 1e-6);
  const resFloor = Math.ceil((maxDim / (2 * strutRadius)) * MIN_STRUT_VOXELS);
  const resolution = Math.min(MAX_FIELD_RESOLUTION, Math.max(Math.round(opts.resolution ?? 96), Math.min(resFloor, MAX_FIELD_RESOLUTION)));

  // Reuse the shared rasterize-for-bounds grid (we only need the bbox-derived
  // dims + voxel size; the occupancy is unused for an edge-distance field).
  const { nx, ny, nz, min, voxelSize } = rasterizeSolid(mesh, resolution, MAX_FIELD_RESOLUTION);

  // Padded lattice: enough "outside" rings that a strut's rounded cap closes even
  // when an edge sits on the model's bounding box.
  const pad = Math.ceil(strutRadius / voxelSize) + 3;
  const fnx = nx + 2 * pad, fny = ny + 2 * pad, fnz = nz + 2 * pad;
  const origin: [number, number, number] = [min[0] - pad * voxelSize, min[1] - pad * voxelSize, min[2] - pad * voxelSize];
  const fidx = (i: number, j: number, k: number) => (k * fny + j) * fnx + i;

  // Initialise the field to a sign-correct "well outside" value, then splat each
  // segment into the narrow band where it can carve material (dist < strutRadius).
  const BIG = strutRadius + (pad + 2) * voxelSize;
  const field = new Float32Array(fnx * fny * fnz).fill(BIG);
  const reach = strutRadius + 1.5 * voxelSize; // band half-width: cover the iso crossing
  const clampIdx = (v: number, hi: number) => (v < 0 ? 0 : v > hi ? hi : v);

  const nSeg = segs.length / 6;
  for (let s = 0; s < nSeg; s++) {
    const ax = segs[s * 6], ay = segs[s * 6 + 1], az = segs[s * 6 + 2];
    const bx = segs[s * 6 + 3], by = segs[s * 6 + 4], bz = segs[s * 6 + 5];
    const i0 = clampIdx(Math.floor((Math.min(ax, bx) - reach - origin[0]) / voxelSize), fnx - 1);
    const i1 = clampIdx(Math.ceil((Math.max(ax, bx) + reach - origin[0]) / voxelSize), fnx - 1);
    const j0 = clampIdx(Math.floor((Math.min(ay, by) - reach - origin[1]) / voxelSize), fny - 1);
    const j1 = clampIdx(Math.ceil((Math.max(ay, by) + reach - origin[1]) / voxelSize), fny - 1);
    const k0 = clampIdx(Math.floor((Math.min(az, bz) - reach - origin[2]) / voxelSize), fnz - 1);
    const k1 = clampIdx(Math.ceil((Math.max(az, bz) + reach - origin[2]) / voxelSize), fnz - 1);
    for (let k = k0; k <= k1; k++) {
      const wz = origin[2] + k * voxelSize;
      for (let j = j0; j <= j1; j++) {
        const wy = origin[1] + j * voxelSize;
        for (let i = i0; i <= i1; i++) {
          const wx = origin[0] + i * voxelSize;
          const d = Math.sqrt(distSqToSegment(wx, wy, wz, ax, ay, az, bx, by, bz)) - strutRadius;
          const fi = fidx(i, j, k);
          if (d < field[fi]) field[fi] = d;
        }
      }
    }
  }

  let m = surfaceNetsField({ field, dims: [fnx, fny, fnz], origin, spacing: voxelSize, iso: 0 });
  // Unlike the Voronoi lamp (one connected web), a cage's edges usually form
  // several disconnected loops, so keep them all by default — only collapse to
  // the largest piece when the caller explicitly asks (watertight === true).
  if (opts.watertight === true) m = largestMeshComponent(m);
  m = smoothSurface(m, { iterations: opts.smoothIterations ?? 3, subdivide: false });
  return m;
}
