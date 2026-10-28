// Pure layout math over part bounding boxes — the numbers behind the Parts
// panel's Arrange / Align / Distribute / Array / Lay-flat buttons. Every layout
// function returns the per-part TRANSLATION to apply (name -> [dx, dy, dz]); a
// part that doesn't move is left out of the map (an all-zero delta is omitted),
// so callers read `moves.get(name) ?? [0, 0, 0]`. Rotation is never part of a
// layout: `layFlatRotation` is the one function that returns an angle, for the
// caller to apply with a rotate op.
//
// Dependency-light (only the pure `alignDeltas`) so it runs in the vitest unit
// tier. Names are assumed unique within one call.

import { alignDeltas, type AlignAxis, type AlignMode } from './arrangeMath';
import type { RegistryEntry } from './spatial';

export type Vec3 = [number, number, number];

export interface PartBox { name: string; min: Vec3; max: Vec3 }

/** Deltas smaller than this are treated as "didn't move" and left out. */
const MOVE_EPS = 1e-9;

function put(out: Map<string, Vec3>, name: string, d: Vec3): void {
  if (Math.abs(d[0]) < MOVE_EPS && Math.abs(d[1]) < MOVE_EPS && Math.abs(d[2]) < MOVE_EPS) return;
  out.set(name, d);
}

/** The combined XY centre of the boxes (null when there are none). */
function combinedXYCentre(boxes: PartBox[]): [number, number] | null {
  if (boxes.length === 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.min[0]); y0 = Math.min(y0, b.min[1]);
    x1 = Math.max(x1, b.max[0]); y1 = Math.max(y1, b.max[1]);
  }
  return [(x0 + x1) / 2, (y0 + y1) / 2];
}

/** Shelf packing, shared with `layoutMultiFileSource`: fill rows left to right
 *  (in the order given) up to `rowWidth`, rows running from the back (+Y)
 *  toward the viewer like reading order. Returns each rectangle's CENTRE with
 *  the whole packed layout centred on the origin, plus the packed extents.
 *  `rowWidth` defaults to the width that makes the layout roughly square (never
 *  narrower than the widest rectangle). */
export function shelfPack(
  dims: readonly (readonly [number, number])[],
  gap: number,
  rowWidth?: number,
): { centers: [number, number][]; width: number; depth: number } {
  const totalArea = dims.reduce((sum, [w, d]) => sum + (w + gap) * (d + gap), 0);
  const limit = rowWidth ?? Math.max(Math.sqrt(totalArea), ...dims.map(([w]) => w));
  const placed: { x: number; y: number }[] = [];
  let x = 0, y = 0, rowDepth = 0, maxX = 0;
  dims.forEach(([w, d]) => {
    if (x > 0 && x + w > limit) { x = 0; y += rowDepth + gap; rowDepth = 0; }
    placed.push({ x: x + w / 2, y: y + d / 2 });
    maxX = Math.max(maxX, x + w);
    x += w + gap;
    rowDepth = Math.max(rowDepth, d);
  });
  const totalDepth = y + rowDepth;
  return {
    centers: placed.map(p => [p.x - maxX / 2, totalDepth / 2 - p.y] as [number, number]),
    width: maxX,
    depth: totalDepth,
  };
}

const footprint = (b: PartBox): [number, number] => [b.max[0] - b.min[0], b.max[1] - b.min[1]];
const centreXY = (b: PartBox): [number, number] => [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2];

/** Uniform cells (the largest footprint plus `gap`), ceil(sqrt(n)) columns in
 *  input order, the first row at the back (+Y); the whole grid is centred on the
 *  boxes' combined XY centre and every part is dropped to z = 0. */
export function gridLayout(boxes: PartBox[], opts: { gap: number }): Map<string, Vec3> {
  const out = new Map<string, Vec3>();
  const centre = combinedXYCentre(boxes);
  if (!centre) return out;
  let maxW = 0, maxD = 0;
  for (const b of boxes) {
    const [w, d] = footprint(b);
    maxW = Math.max(maxW, w); maxD = Math.max(maxD, d);
  }
  const cellW = maxW + opts.gap, cellD = maxD + opts.gap;
  const cols = Math.ceil(Math.sqrt(boxes.length));
  const rows = Math.ceil(boxes.length / cols);
  boxes.forEach((b, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const tx = centre[0] + (col - (cols - 1) / 2) * cellW;
    const ty = centre[1] + ((rows - 1) / 2 - row) * cellD;
    const [cx, cy] = centreXY(b);
    put(out, b.name, [tx - cx, ty - cy, -b.min[2]]);
  });
  return out;
}

/** Shelf pack, deepest footprints first (ties keep input order), the row width
 *  about sqrt(total padded area) but never narrower than the widest part; the
 *  result is centred on the boxes' combined XY centre with every part at z = 0. */
export function packLayout(boxes: PartBox[], opts: { gap: number }): Map<string, Vec3> {
  const out = new Map<string, Vec3>();
  const centre = combinedXYCentre(boxes);
  if (!centre) return out;
  const order = boxes.map((_b, i) => i).sort((a, b) => footprint(boxes[b])[1] - footprint(boxes[a])[1] || a - b);
  const { centers } = shelfPack(order.map(i => footprint(boxes[i])), opts.gap);
  order.forEach((i, k) => {
    const b = boxes[i];
    const [cx, cy] = centreXY(b);
    put(out, b.name, [centre[0] + centers[k][0] - cx, centre[1] + centers[k][1] - cy, -b.min[2]]);
  });
  return out;
}

/** Shelf pack inside a bed of `bed[0]` x `bed[1]` (plate 0 centred on the
 *  origin). Parts that don't fit spill onto plate 1, 2, … laid out side by side
 *  along +X at a pitch of 1.1 bed widths. Within a plate the packed parts are
 *  centred as a group. A part that doesn't fit the bed unrotated gets a plate
 *  of its own, centred on it: when a quarter turn would make it fit it is listed
 *  in `rotateToFit` (the footprint is symmetric about the plate centre, so
 *  turning it 90° about z there fits), otherwise in `tooBig` (it overhangs).
 *  Every part is dropped to z = 0. `plates` is the number of plates used. */
export function bedLayout(
  boxes: PartBox[],
  opts: { gap: number; bed: [number, number] },
): { moves: Map<string, Vec3>; plates: number; tooBig: string[]; rotateToFit: string[] } {
  const moves = new Map<string, Vec3>();
  const tooBig: string[] = [];
  const rotateToFit: string[] = [];
  const [bedW, bedD] = opts.bed;
  const eps = 1e-9;
  const pitch = bedW * 1.1;
  const { gap } = opts;

  const normal: PartBox[] = [];
  const special: PartBox[] = [];
  for (const b of boxes) {
    const [w, d] = footprint(b);
    if (w <= bedW + eps && d <= bedD + eps) normal.push(b);
    else {
      special.push(b);
      (w <= bedD + eps && d <= bedW + eps ? rotateToFit : tooBig).push(b.name);
    }
  }

  // Next-fit shelf packing, deepest first: a part that would run off the row
  // starts a new row, and one that would run off the bed starts a new plate.
  const order = normal.map((_b, i) => i).sort((a, b) => footprint(normal[b])[1] - footprint(normal[a])[1] || a - b);
  const plates: { items: { b: PartBox; x: number; y: number }[]; width: number; depth: number }[] = [];
  let cur: (typeof plates)[number] | null = null;
  let x = 0, y = 0, rowDepth = 0;
  for (const i of order) {
    const b = normal[i];
    const [w, d] = footprint(b);
    if (cur && x > 0 && x + w > bedW + eps) { x = 0; y += rowDepth + gap; rowDepth = 0; }
    if (!cur || y + d > bedD + eps) {
      cur = { items: [], width: 0, depth: 0 };
      plates.push(cur);
      x = 0; y = 0; rowDepth = 0;
    }
    cur.items.push({ b, x: x + w / 2, y: y + d / 2 });
    cur.width = Math.max(cur.width, x + w);
    x += w + gap;
    rowDepth = Math.max(rowDepth, d);
    cur.depth = y + rowDepth;
  }
  plates.forEach((plate, p) => {
    const px = p * pitch;
    for (const { b, x: ix, y: iy } of plate.items) {
      const [cx, cy] = centreXY(b);
      // Rows run from the back (+Y) toward the viewer; the packed extents are centred on the plate.
      const tx = px + ix - plate.width / 2, ty = plate.depth / 2 - iy;
      put(moves, b.name, [tx - cx, ty - cy, -b.min[2]]);
    }
  });
  special.forEach((b, k) => {
    const [cx, cy] = centreXY(b);
    put(moves, b.name, [(plates.length + k) * pitch - cx, -cy, -b.min[2]]);
  });
  return { moves, plates: plates.length + special.length, tooBig, rotateToFit };
}

/** Align every box to the selection's combined min / centre / max on `axis`
 *  (the same Tinkercad-style rule Arrange mode uses — `alignDeltas`). */
export function alignLayout(boxes: PartBox[], axis: AlignAxis, mode: AlignMode): Map<string, Vec3> {
  const registry = new Map<string, RegistryEntry>();
  for (const b of boxes) {
    registry.set(b.name, {
      box: { min: [...b.min], max: [...b.max] },
      center: [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2],
    });
  }
  return alignDeltas(boxes.map(b => b.name), registry, axis, mode);
}

/** Keep the first and last box (by centre on `axis`) where they are and space
 *  the others so the GAPS between consecutive boxes are equal. Needs at least
 *  three boxes; fewer returns an empty map. */
export function distributeLayout(boxes: PartBox[], axis: 'x' | 'y' | 'z'): Map<string, Vec3> {
  const out = new Map<string, Vec3>();
  if (boxes.length < 3) return out;
  const a = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  const sorted = boxes
    .map((b, i) => ({ b, i }))
    .sort((p, q) => (p.b.min[a] + p.b.max[a]) - (q.b.min[a] + q.b.max[a]) || p.i - q.i)
    .map(e => e.b);
  const first = sorted[0], last = sorted[sorted.length - 1];
  const span = last.max[a] - first.min[a];
  const sizes = sorted.reduce((sum, b) => sum + (b.max[a] - b.min[a]), 0);
  const gap = (span - sizes) / (sorted.length - 1);
  let cursor = first.min[a];
  for (const b of sorted) {
    const d: Vec3 = [0, 0, 0];
    d[a] = cursor - b.min[a];
    put(out, b.name, d);
    cursor += (b.max[a] - b.min[a]) + gap;
  }
  return out;
}

/** Each part's lowest point to z = 0. */
export function dropToPlate(boxes: PartBox[]): Map<string, Vec3> {
  const out = new Map<string, Vec3>();
  for (const b of boxes) put(out, b.name, [0, 0, -b.min[2]]);
  return out;
}

/** Move the selection AS A GROUP so its combined XY centre is at the origin and
 *  its combined lowest point is at z = 0 (relative positions are kept). */
export function centerOnOrigin(boxes: PartBox[]): Map<string, Vec3> {
  const out = new Map<string, Vec3>();
  const centre = combinedXYCentre(boxes);
  if (!centre) return out;
  const minZ = Math.min(...boxes.map(b => b.min[2]));
  const d: Vec3 = [-centre[0], -centre[1], -minZ];
  for (const b of boxes) put(out, b.name, [...d]);
  return out;
}

/** Snap each part's min x / min y to the nearest multiple of `step` (z is left
 *  alone). A non-positive step moves nothing. */
export function snapToGrid(boxes: PartBox[], step: number): Map<string, Vec3> {
  const out = new Map<string, Vec3>();
  if (!(step > 0)) return out;
  for (const b of boxes) {
    put(out, b.name, [Math.round(b.min[0] / step) * step - b.min[0], Math.round(b.min[1] / step) * step - b.min[1], 0]);
  }
  return out;
}

/** Offsets for `count` copies (the original excluded): step, 2*step, … */
export function arrayOffsets(count: number, step: Vec3): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 1; i <= count; i++) out.push([step[0] * i, step[1] * i, step[2] * i]);
  return out;
}

/** The offsets of a `cols` x `rows` grid of copies — the original sits in cell
 *  (0, 0) and is left out, so this returns the other cols*rows-1 offsets
 *  (columns along +X, rows along +Y; row-major). */
export function gridArrayOffsets(cols: number, rows: number, step: [number, number]): Vec3[] {
  const out: Vec3[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (r === 0 && c === 0) continue;
      out.push([step[0] * c, step[1] * r, 0]);
    }
  }
  return out;
}

/** Euler degrees [x, y, z] (applied x then y then z, matrix Rz·Ry·Rx — like
 *  manifold's `rotate([x, y, z])`) that turn the largest flat face of the
 *  triangle set `tris` to point straight down (-Z), so the part lies on it.
 *  Triangle normals within `toleranceDeg` of each other count as one flat face,
 *  weighted by area. Returns [0, 0, 0] when that face already points down (or
 *  there is nothing to lay flat). `positions` is xyz with stride 3. */
export function layFlatRotation(
  positions: Float32Array,
  triVerts: Uint32Array,
  tris: ArrayLike<number>,
  toleranceDeg = 2,
): Vec3 {
  const n = tris.length;
  const nx = new Float64Array(n), ny = new Float64Array(n), nz = new Float64Array(n), area = new Float64Array(n);
  // Coarse bins pick the candidate faces; each candidate is then scored exactly.
  const bins = new Map<number, { x: number; y: number; z: number; a: number }>();
  const BIN = 0.02;
  for (let k = 0; k < n; k++) {
    const t = tris[k] * 3;
    const a = triVerts[t] * 3, b = triVerts[t + 1] * 3, c = triVerts[t + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const len = Math.hypot(cx, cy, cz);
    if (!(len > 1e-30)) continue;
    nx[k] = cx / len; ny[k] = cy / len; nz[k] = cz / len; area[k] = len / 2;
    const key = (Math.round(nx[k] / BIN) + 64) * 16384 + (Math.round(ny[k] / BIN) + 64) * 128 + (Math.round(nz[k] / BIN) + 64);
    const e = bins.get(key);
    if (e) { e.x += nx[k] * area[k]; e.y += ny[k] * area[k]; e.z += nz[k] * area[k]; e.a += area[k]; }
    else bins.set(key, { x: nx[k] * area[k], y: ny[k] * area[k], z: nz[k] * area[k], a: area[k] });
  }
  if (bins.size === 0) return [0, 0, 0];

  const cosTol = Math.cos(toleranceDeg * Math.PI / 180);
  const candidates = [...bins.values()].sort((p, q) => q.a - p.a).slice(0, 8);
  let best: Vec3 | null = null, bestArea = -1;
  for (const cand of candidates) {
    const m = Math.hypot(cand.x, cand.y, cand.z);
    if (!(m > 0)) continue;
    const cxn = cand.x / m, cyn = cand.y / m, czn = cand.z / m;
    let sum = 0, sx = 0, sy = 0, sz = 0;
    for (let k = 0; k < n; k++) {
      if (area[k] > 0 && nx[k] * cxn + ny[k] * cyn + nz[k] * czn >= cosTol) {
        sum += area[k]; sx += nx[k] * area[k]; sy += ny[k] * area[k]; sz += nz[k] * area[k];
      }
    }
    if (sum > bestArea) {
      bestArea = sum;
      const sm = Math.hypot(sx, sy, sz) || 1;
      best = [sx / sm, sy / sm, sz / sm];
    }
  }
  if (!best) return [0, 0, 0];
  const [px, py, pz] = best;
  if (-pz > Math.cos(1e-6)) return [0, 0, 0];

  // Rx first brings the normal into the XZ plane pointing down (y' = 0, z' = -r),
  // then Ry swings it onto -Z; Rz stays 0 (a spin about z can't change "down").
  const r = Math.hypot(py, pz);
  const rx = r < 1e-12 ? 0 : Math.atan2(-py, -pz);
  let ry = Math.PI - Math.atan2(px, -r);
  if (ry > Math.PI) ry -= 2 * Math.PI;
  const deg = (v: number): number => (Math.abs(v) < 1e-9 ? 0 : v * 180 / Math.PI);
  return [deg(rx), deg(ry), 0];
}

/** `vertProperties` with stride `numProp` reduced to xyz (stride 3); the
 *  array itself when it already is. */
export function xyzPositions(vertProperties: Float32Array, numProp: number): Float32Array {
  if (numProp === 3) return vertProperties;
  const n = Math.floor(vertProperties.length / numProp);
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    out[i * 3] = vertProperties[i * numProp];
    out[i * 3 + 1] = vertProperties[i * numProp + 1];
    out[i * 3 + 2] = vertProperties[i * numProp + 2];
  }
  return out;
}

/** The lowest z of triangle set `tris` after turning it by Euler degrees `deg`
 *  (x first, matrix Rz·Ry·Rx) about its bounding-box centre — where a
 *  `rotatePart` leaves the part's bottom, so the caller can drop it back onto
 *  the plate. `positions` is xyz with stride 3. */
export function rotatedMinZ(positions: Float32Array, triVerts: Uint32Array, tris: Iterable<number>, deg: Vec3): number {
  const verts = new Set<number>();
  for (const t of tris) for (let k = 0; k < 3; k++) verts.add(triVerts[t * 3 + k]);
  if (verts.size === 0) return 0;
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const v of verts) {
    for (let a = 0; a < 3; a++) {
      const x = positions[v * 3 + a];
      if (x < min[a]) min[a] = x;
      if (x > max[a]) max[a] = x;
    }
  }
  const c = [0, 1, 2].map(a => (min[a] + max[a]) / 2);
  const [ax, ay] = [deg[0], deg[1]].map(d => d * Math.PI / 180);
  // Row z of Rz·Ry·Rx: [-sin y, cos y sin x, cos y cos x] (independent of the z turn).
  const r0 = -Math.sin(ay), r1 = Math.cos(ay) * Math.sin(ax), r2 = Math.cos(ay) * Math.cos(ax);
  let lo = Infinity;
  for (const v of verts) {
    const z = r0 * (positions[v * 3] - c[0]) + r1 * (positions[v * 3 + 1] - c[1]) + r2 * (positions[v * 3 + 2] - c[2]);
    if (z < lo) lo = z;
  }
  return lo + c[2];
}

/** Where a copy of `box` can go without touching any of `obstacles` (on X/Y):
 *  the first free slot stepping right in copy-widths (plus `gap`), then the
 *  rows behind it. Returns the offset from `box`. */
export function freeOffset(box: PartBox, obstacles: PartBox[], gap: number, maxTries = 64): Vec3 {
  const w = box.max[0] - box.min[0], d = box.max[1] - box.min[1];
  const hits = (dx: number, dy: number) => obstacles.some(o =>
    box.min[0] + dx < o.max[0] + gap - 1e-9 && o.min[0] < box.max[0] + dx + gap - 1e-9
    && box.min[1] + dy < o.max[1] + gap - 1e-9 && o.min[1] < box.max[1] + dy + gap - 1e-9);
  for (let row = 0; row < maxTries; row++) {
    for (let k = row === 0 ? 1 : 0; k < maxTries; k++) {
      const dx = k * (w + gap), dy = row * (d + gap);
      if (!hits(dx, dy)) return [dx, dy, 0];
    }
  }
  return [w + gap, 0, 0];
}
