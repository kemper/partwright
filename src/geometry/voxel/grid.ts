// Sparse voxel grid — the core data structure for the `voxel` modeling
// engine. A grid is a set of occupied integer cells, each carrying a 24-bit
// RGB color. Empty cells are simply absent from the map (so black, 0x000000,
// is a legal color — presence in the map, not the value, encodes occupancy).
//
// This module is pure logic (no DOM, no WASM, no engine imports) so it can be
// unit-tested directly in the vitest tier and imported into the geometry
// Worker without pulling in browser globals.

import { assertNumber, assertNumberTuple, assertObject, assertEnum, assertNoUnknownKeys, ValidationError } from '../../validation/apiValidation';

export type Vec3 = [number, number, number];
/** A color the sandbox API accepts: `[r,g,b]` 0–255, `'#rgb'`/`'#rrggbb'`, or a
 *  packed `0xRRGGBB` number. Normalized to a 24-bit integer internally. */
export type ColorInput = Vec3 | string | number;

// Coordinates are packed into a single JS integer key for fast Map lookups.
// 11 bits per axis (offset by HALF) gives a usable range of [-1024, 1023] per
// axis; the largest key (~8.59e9) stays well under Number.MAX_SAFE_INTEGER.
const BITS = 11;
const DIM = 1 << BITS;          // 2048
const HALF = DIM >> 1;          // 1024
export const COORD_MIN = -HALF;     // -1024
export const COORD_MAX = HALF - 1;  //  1023

function assertCoord(v: number, name: string): number {
  const n = assertNumber(v, name, { integer: true, min: COORD_MIN, max: COORD_MAX })!;
  return n;
}

function packKey(x: number, y: number, z: number): number {
  // Each component is shifted into [0, 2047] before packing.
  return ((x + HALF) * DIM + (y + HALF)) * DIM + (z + HALF);
}

function inRange(x: number, y: number, z: number): boolean {
  return x >= COORD_MIN && x <= COORD_MAX
    && y >= COORD_MIN && y <= COORD_MAX
    && z >= COORD_MIN && z <= COORD_MAX;
}

/** Normalize any accepted color form to a 24-bit `0xRRGGBB` integer. */
export function normalizeColor(c: ColorInput, name = 'color'): number {
  if (typeof c === 'number') {
    if (!Number.isFinite(c) || c < 0 || c > 0xffffff || !Number.isInteger(c)) {
      throw new ValidationError(`${name}: numeric color must be an integer 0x000000–0xFFFFFF, got ${c}`);
    }
    return c;
  }
  if (typeof c === 'string') {
    const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(c.trim());
    if (!m) throw new ValidationError(`${name}: expected a hex color like "#ff8800" or "#f80", got ${JSON.stringify(c)}`);
    let hex = m[1];
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    return parseInt(hex, 16);
  }
  // Tuple [r,g,b], 0–255 each.
  const t = assertNumberTuple(c, 3, name);
  for (let i = 0; i < 3; i++) {
    if (t[i] < 0 || t[i] > 255) throw new ValidationError(`${name}: RGB components must be 0–255, got ${t[i]}`);
  }
  return ((t[0] & 0xff) << 16) | ((t[1] & 0xff) << 8) | (t[2] & 0xff);
}

/** Split a packed 24-bit color into 0–255 components. */
export function colorComponents(rgb: number): Vec3 {
  return [(rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff];
}

export interface GridBounds { min: Vec3; max: Vec3 }

/** How a grid is turned into a mesh. `blocks` = hard cube faces (default);
 *  `smooth` = Taubin-rounded edges (optionally over a `detail`× supersampled
 *  grid for finer rounding). Carried on the grid so the mesher/engine can read
 *  it off the returned value. */
export interface Surfacing { mode: 'blocks' | 'smooth'; iterations: number; detail: number }

/** A mutable sparse voxel grid. Builder methods chain (`return this`). */
export class VoxelGrid {
  /** @internal Brand so the engine can recognize a returned grid even across
   *  bundle boundaries where `instanceof` alone might be fragile. */
  readonly __isVoxelGrid = true as const;
  private cells = new Map<number, number>();
  private _surfacing: Surfacing = { mode: 'blocks', iterations: 2, detail: 1 };

  /** Number of occupied voxels. */
  get size(): number { return this.cells.size; }

  /** Set (occupy) a single voxel. */
  set(x: number, y: number, z: number, color: ColorInput): this {
    const cx = assertCoord(x, 'set(x)'), cy = assertCoord(y, 'set(y)'), cz = assertCoord(z, 'set(z)');
    this.cells.set(packKey(cx, cy, cz), normalizeColor(color, 'set(color)'));
    return this;
  }

  /** Remove (empty) a single voxel. No-op if already empty. */
  remove(x: number, y: number, z: number): this {
    this.cells.delete(packKey(assertCoord(x, 'remove(x)'), assertCoord(y, 'remove(y)'), assertCoord(z, 'remove(z)')));
    return this;
  }

  /** True if the voxel at (x,y,z) is occupied. */
  has(x: number, y: number, z: number): boolean {
    if (x < COORD_MIN || x > COORD_MAX || y < COORD_MIN || y > COORD_MAX || z < COORD_MIN || z > COORD_MAX) return false;
    return this.cells.has(packKey(x | 0, y | 0, z | 0));
  }

  /** Color of the voxel at (x,y,z), or null if empty. */
  get(x: number, y: number, z: number): number | null {
    const v = this.cells.get(packKey(x | 0, y | 0, z | 0));
    return v === undefined ? null : v;
  }

  /** Fill an inclusive axis-aligned box of voxels. Corners may be given in any
   *  order. */
  fillBox(a: Vec3, b: Vec3, color: ColorInput): this {
    const p = assertNumberTuple(a, 3, 'fillBox(min)');
    const q = assertNumberTuple(b, 3, 'fillBox(max)');
    const rgb = normalizeColor(color, 'fillBox(color)');
    const x0 = Math.min(p[0], q[0]) | 0, x1 = Math.max(p[0], q[0]) | 0;
    const y0 = Math.min(p[1], q[1]) | 0, y1 = Math.max(p[1], q[1]) | 0;
    const z0 = Math.min(p[2], q[2]) | 0, z1 = Math.max(p[2], q[2]) | 0;
    assertCoord(x0, 'fillBox.min.x'); assertCoord(x1, 'fillBox.max.x');
    assertCoord(y0, 'fillBox.min.y'); assertCoord(y1, 'fillBox.max.y');
    assertCoord(z0, 'fillBox.min.z'); assertCoord(z1, 'fillBox.max.z');
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++)
          this.cells.set(packKey(x, y, z), rgb);
    return this;
  }

  /** Fill a solid sphere of the given radius centered on `center` (rounded to
   *  the nearest voxel). */
  sphere(center: Vec3, radius: number, color: ColorInput): this {
    const c = assertNumberTuple(center, 3, 'sphere(center)');
    const r = assertNumber(radius, 'sphere(radius)', { min: 0 })!;
    const rgb = normalizeColor(color, 'sphere(color)');
    const cx = Math.round(c[0]), cy = Math.round(c[1]), cz = Math.round(c[2]);
    const ri = Math.ceil(r);
    const r2 = r * r;
    for (let dx = -ri; dx <= ri; dx++)
      for (let dy = -ri; dy <= ri; dy++)
        for (let dz = -ri; dz <= ri; dz++)
          if (dx * dx + dy * dy + dz * dz <= r2) {
            const x = cx + dx, y = cy + dy, z = cz + dz;
            if (x >= COORD_MIN && x <= COORD_MAX && y >= COORD_MIN && y <= COORD_MAX && z >= COORD_MIN && z <= COORD_MAX)
              this.cells.set(packKey(x, y, z), rgb);
          }
    return this;
  }

  /** Draw a 1-voxel-thick line between two points (3D Bresenham). */
  line(a: Vec3, b: Vec3, color: ColorInput): this {
    const p = assertNumberTuple(a, 3, 'line(a)').map(n => Math.round(n));
    const q = assertNumberTuple(b, 3, 'line(b)').map(n => Math.round(n));
    const rgb = normalizeColor(color, 'line(color)');
    let [x, y, z] = p;
    const [x1, y1, z1] = q;
    const dx = Math.abs(x1 - x), dy = Math.abs(y1 - y), dz = Math.abs(z1 - z);
    const sx = x < x1 ? 1 : -1, sy = y < y1 ? 1 : -1, sz = z < z1 ? 1 : -1;
    const dm = Math.max(dx, dy, dz);
    let ex = dm / 2, ey = dm / 2, ez = dm / 2;
    for (let i = 0; i <= dm; i++) {
      if (x >= COORD_MIN && x <= COORD_MAX && y >= COORD_MIN && y <= COORD_MAX && z >= COORD_MIN && z <= COORD_MAX)
        this.cells.set(packKey(x, y, z), rgb);
      ex -= dx; if (ex < 0) { ex += dm; x += sx; }
      ey -= dy; if (ey < 0) { ey += dm; y += sy; }
      ez -= dz; if (ez < 0) { ez += dm; z += sz; }
    }
    return this;
  }

  /** Iterate every occupied voxel. */
  forEach(cb: (x: number, y: number, z: number, color: number) => void): void {
    for (const [key, rgb] of this.cells) {
      const z = (key % DIM) - HALF;
      const y = (Math.floor(key / DIM) % DIM) - HALF;
      const x = Math.floor(key / (DIM * DIM)) - HALF;
      cb(x, y, z, rgb);
    }
  }

  /** Inclusive integer bounds of the occupied set, or null when empty. */
  bounds(): GridBounds | null {
    if (this.cells.size === 0) return null;
    const min: Vec3 = [Infinity, Infinity, Infinity];
    const max: Vec3 = [-Infinity, -Infinity, -Infinity];
    this.forEach((x, y, z) => {
      if (x < min[0]) min[0] = x; if (x > max[0]) max[0] = x;
      if (y < min[1]) min[1] = y; if (y > max[1]) max[1] = y;
      if (z < min[2]) min[2] = z; if (z > max[2]) max[2] = z;
    });
    return { min, max };
  }

  /** Fill a solid cylinder of `radius` and `height` (in voxels) whose base
   *  face is centered on `base`, extending in +`axis`. */
  cylinder(base: Vec3, radius: number, height: number, color: ColorInput, axis: 'x' | 'y' | 'z' = 'z'): this {
    const b = assertNumberTuple(base, 3, 'cylinder(base)');
    const r = assertNumber(radius, 'cylinder(radius)', { min: 0 })!;
    const h = assertNumber(height, 'cylinder(height)', { integer: true, min: 1 })!;
    const ax = assertEnum(axis, ['x', 'y', 'z'] as const, 'cylinder(axis)');
    const rgb = normalizeColor(color, 'cylinder(color)');
    const bx = Math.round(b[0]), by = Math.round(b[1]), bz = Math.round(b[2]);
    const ri = Math.ceil(r), r2 = r * r;
    for (let l = 0; l < h; l++) {
      for (let du = -ri; du <= ri; du++) {
        for (let dv = -ri; dv <= ri; dv++) {
          if (du * du + dv * dv > r2) continue;
          let x: number, y: number, z: number;
          if (ax === 'z') { x = bx + du; y = by + dv; z = bz + l; }
          else if (ax === 'y') { x = bx + du; y = by + l; z = bz + dv; }
          else { x = bx + l; y = by + du; z = bz + dv; }
          if (inRange(x, y, z)) this.cells.set(packKey(x, y, z), rgb);
        }
      }
    }
    return this;
  }

  /** Translate every voxel by an integer offset (rounded). */
  translate(delta: Vec3): this {
    const d = assertNumberTuple(delta, 3, 'translate(delta)');
    const dx = Math.round(d[0]), dy = Math.round(d[1]), dz = Math.round(d[2]);
    const moved = new Map<number, number>();
    this.forEach((x, y, z, c) => {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (inRange(nx, ny, nz)) moved.set(packKey(nx, ny, nz), c);
    });
    this.cells = moved;
    return this;
  }

  /** Add a mirrored copy of every voxel across the given axis's 0-plane (cell
   *  `n` maps to cell `-1-n`, so the geometry mirrors exactly about 0). */
  mirror(axis: 'x' | 'y' | 'z'): this {
    const ax = assertEnum(axis, ['x', 'y', 'z'] as const, 'mirror(axis)');
    const additions: [number, number, number, number][] = [];
    this.forEach((x, y, z, c) => {
      let nx = x, ny = y, nz = z;
      if (ax === 'x') nx = -1 - x; else if (ax === 'y') ny = -1 - y; else nz = -1 - z;
      if (inRange(nx, ny, nz)) additions.push([nx, ny, nz, c]);
    });
    for (const [x, y, z, c] of additions) this.cells.set(packKey(x, y, z), c);
    return this;
  }

  /** Hollow the solid into a shell of the given wall `thickness` (in voxels),
   *  removing voxels deeper than `thickness` from the surface. */
  hollow(thickness = 1): this {
    const t = assertNumber(thickness, 'hollow(thickness)', { integer: true, min: 1 })!;
    // BFS the depth of each occupied voxel from the surface (a voxel with any
    // empty face-neighbour is depth 1); remove anything deeper than `t`.
    const dist = new Map<number, number>();
    const queue: number[] = []; // flattened (x,y,z) triples
    this.forEach((x, y, z) => {
      if (!this.has(x + 1, y, z) || !this.has(x - 1, y, z)
        || !this.has(x, y + 1, z) || !this.has(x, y - 1, z)
        || !this.has(x, y, z + 1) || !this.has(x, y, z - 1)) {
        dist.set(packKey(x, y, z), 1);
        queue.push(x, y, z);
      }
    });
    for (let head = 0; head < queue.length; head += 3) {
      const x = queue[head], y = queue[head + 1], z = queue[head + 2];
      const d = dist.get(packKey(x, y, z))!;
      const nbrs: Vec3[] = [[x + 1, y, z], [x - 1, y, z], [x, y + 1, z], [x, y - 1, z], [x, y, z + 1], [x, y, z - 1]];
      for (const [nx, ny, nz] of nbrs) {
        if (!this.has(nx, ny, nz)) continue;
        const nk = packKey(nx, ny, nz);
        if (dist.has(nk)) continue;
        dist.set(nk, d + 1);
        queue.push(nx, ny, nz);
      }
    }
    const toRemove: number[] = [];
    this.forEach((x, y, z) => {
      const d = dist.get(packKey(x, y, z));
      if (d === undefined || d > t) toRemove.push(packKey(x, y, z));
    });
    for (const k of toRemove) this.cells.delete(k);
    return this;
  }

  // ---- Surfacing (how the grid is meshed) -------------------------------

  /** Select rounded-edge surfacing. Accepts an iteration count or
   *  `{ iterations, detail }`; more iterations = rounder, higher detail
   *  (supersample factor) = finer rounding on coarse models. Chainable. */
  smooth(opts: number | { iterations?: number; detail?: number } = {}): this {
    let iterations = 2, detail = 1;
    if (typeof opts === 'number') {
      iterations = assertNumber(opts, 'smooth(iterations)', { integer: true, min: 1, max: 8 })!;
    } else {
      const o = assertObject(opts, 'smooth(opts)')!;
      assertNoUnknownKeys(o, ['iterations', 'detail'], 'smooth(opts)');
      if (o.iterations !== undefined) iterations = assertNumber(o.iterations, 'smooth.iterations', { integer: true, min: 1, max: 8 })!;
      if (o.detail !== undefined) detail = assertNumber(o.detail, 'smooth.detail', { integer: true, min: 1, max: 4 })!;
    }
    this._surfacing = { mode: 'smooth', iterations, detail };
    return this;
  }

  /** Reset to hard-faced (blocky) surfacing — the default. Chainable. */
  blocky(): this {
    this._surfacing = { mode: 'blocks', iterations: 2, detail: 1 };
    return this;
  }

  /** The grid's current surfacing settings (a copy). */
  surfacing(): Surfacing { return { ...this._surfacing }; }

  /** Return a NEW grid with every voxel expanded into a `factor`³ block — used
   *  by smooth surfacing to give the smoother more vertices to work with. The
   *  result uses default (blocky) surfacing; the caller scales the mesh back
   *  down. Throws if the expansion would exceed the coordinate range. */
  supersample(factor: number): VoxelGrid {
    const f = assertNumber(factor, 'supersample(factor)', { integer: true, min: 1, max: 8 })!;
    const out = new VoxelGrid();
    const b = this.bounds();
    if (!b || f === 1) {
      this.forEach((x, y, z, c) => out.cells.set(packKey(x, y, z), c));
      return out;
    }
    const lo = Math.min(b.min[0], b.min[1], b.min[2]) * f;
    const hi = Math.max(b.max[0], b.max[1], b.max[2]) * f + (f - 1);
    if (lo < COORD_MIN || hi > COORD_MAX) {
      throw new ValidationError(`supersample(${f}): the model is too large to supersample by ${f}× (coordinates would exceed ±${HALF}). Use a smaller detail factor.`);
    }
    this.forEach((x, y, z, c) => {
      const bx = x * f, by = y * f, bz = z * f;
      for (let i = 0; i < f; i++)
        for (let j = 0; j < f; j++)
          for (let k = 0; k < f; k++)
            out.cells.set(packKey(bx + i, by + j, bz + k), c);
    });
    return out;
  }

  /** A deep copy of this grid (cells + surfacing). Used by Voxel Studio's
   *  undo/redo history, which snapshots the grid before each edit. */
  clone(): VoxelGrid {
    const out = new VoxelGrid();
    out.cells = new Map(this.cells);
    out._surfacing = { ...this._surfacing };
    return out;
  }

  /** @internal Raw cell map — for the mesher's fast neighbor queries. */
  rawCells(): Map<number, number> { return this.cells; }

  /** @internal Packed-key helper, exposed for the mesher. */
  static keyOf(x: number, y: number, z: number): number { return packKey(x, y, z); }
}

// ── Compact serialization (used by image import → editor code) ──────────────
//
// Encodes a grid as: a small header (offset + size) + a dense 1-bit occupancy
// bitmap over the bounding box + RGB triplets for occupied cells in iteration
// order. Base64-wrapped so it embeds cleanly in generated `voxels.decode("…")`
// code. This keeps imported pixel-art / logos fully runnable and round-trips
// through normal session save (the code is the source of truth — no separate
// schema field needed).

const MAGIC = 0x5631; // 'V1'

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  // Chunk to avoid blowing the argument limit of String.fromCharCode.apply.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Serialize a grid to a compact base64 string. */
export function encodeGrid(grid: VoxelGrid): string {
  const b = grid.bounds();
  if (!b) {
    // Empty grid: header with zero size.
    const head = new Uint8Array(2);
    new DataView(head.buffer).setUint16(0, MAGIC, true);
    return bytesToBase64(head);
  }
  const sx = b.max[0] - b.min[0] + 1;
  const sy = b.max[1] - b.min[1] + 1;
  const sz = b.max[2] - b.min[2] + 1;
  const cellCount = sx * sy * sz;
  const bitmapBytes = (cellCount + 7) >> 3;

  // Header: magic(2) + min x/y/z (int16 ×3) + size x/y/z (uint16 ×3) = 14 bytes.
  const header = new Uint8Array(14);
  const hv = new DataView(header.buffer);
  hv.setUint16(0, MAGIC, true);
  hv.setInt16(2, b.min[0], true); hv.setInt16(4, b.min[1], true); hv.setInt16(6, b.min[2], true);
  hv.setUint16(8, sx, true); hv.setUint16(10, sy, true); hv.setUint16(12, sz, true);

  const bitmap = new Uint8Array(bitmapBytes);
  const colors: number[] = [];
  // Iterate in canonical x→y→z order so decode reproduces colors in the same
  // sequence the bitmap is read.
  let idx = 0;
  for (let x = 0; x < sx; x++) {
    for (let y = 0; y < sy; y++) {
      for (let z = 0; z < sz; z++, idx++) {
        const rgb = grid.get(b.min[0] + x, b.min[1] + y, b.min[2] + z);
        if (rgb !== null) {
          bitmap[idx >> 3] |= 1 << (idx & 7);
          colors.push((rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff);
        }
      }
    }
  }
  const colorBytes = Uint8Array.from(colors);
  const out = new Uint8Array(header.length + bitmap.length + colorBytes.length);
  out.set(header, 0);
  out.set(bitmap, header.length);
  out.set(colorBytes, header.length + bitmap.length);
  return bytesToBase64(out);
}

/** Reconstruct a grid from {@link encodeGrid}'s output. */
export function decodeGrid(b64: string): VoxelGrid {
  const grid = new VoxelGrid();
  const bytes = base64ToBytes(b64);
  if (bytes.length < 2) return grid;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint16(0, true) !== MAGIC) {
    throw new ValidationError('voxels.decode(): unrecognized data (bad magic). Was this string produced by an image import?');
  }
  if (bytes.length < 14) return grid; // empty grid
  const minX = dv.getInt16(2, true), minY = dv.getInt16(4, true), minZ = dv.getInt16(6, true);
  const sx = dv.getUint16(8, true), sy = dv.getUint16(10, true), sz = dv.getUint16(12, true);
  const cellCount = sx * sy * sz;
  const bitmapBytes = (cellCount + 7) >> 3;
  const bitmapStart = 14;
  const colorStart = bitmapStart + bitmapBytes;
  let colorPtr = colorStart;
  let idx = 0;
  for (let x = 0; x < sx; x++) {
    for (let y = 0; y < sy; y++) {
      for (let z = 0; z < sz; z++, idx++) {
        const occupied = (bytes[bitmapStart + (idx >> 3)] >> (idx & 7)) & 1;
        if (occupied) {
          const r = bytes[colorPtr++], g = bytes[colorPtr++], b = bytes[colorPtr++];
          grid.set(minX + x, minY + y, minZ + z, [r, g, b]);
        }
      }
    }
  }
  return grid;
}
