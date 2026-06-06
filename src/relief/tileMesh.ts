import type { ReliefMesh, TileHole } from './types';

export type TileShape =
  | { kind: 'rect' }
  | { kind: 'rounded'; cornerRadiusMm: number }
  | { kind: 'circle' }
  | { kind: 'mask'; mask: Uint8Array };

export interface TileOptions {
  widthMm: number;
  thickness: number;
  /** Zero or more circular cut-outs. */
  holes?: TileHole[];
  /** Top-edge bevel depth in mm. 0 = sharp corner; >0 lowers boundary vertices
   *  on the top surface to (thickness - chamferMm) for a soft beveled lip. */
  chamferMm?: number;
}

export interface TileMeshResult {
  mesh: ReliefMesh;
  /** Top-face triangle ids per cell (2 per cell, -1 for excluded). */
  cellTriIds: Int32Array;
  /** Bottom-face triangle ids per cell (2 per cell, -1 for excluded). */
  cellTriIdsBottom: Int32Array;
}

export function buildCellMask(W: number, H: number, opts: TileOptions, shape: TileShape): Uint8Array {
  const count = W * H;
  const mask = new Uint8Array(count);
  if (W < 2 || H < 2) return mask;

  const widthMm = opts.widthMm;
  const heightMm = widthMm * (H / W);
  const halfW = widthMm / 2;
  const halfH = heightMm / 2;
  const dx = widthMm / (W - 1);
  const dy = heightMm / (H - 1);

  if (shape.kind === 'mask') {
    if (shape.mask.length !== count) return mask;
    for (let i = 0; i < count; i++) mask[i] = shape.mask[i] ? 1 : 0;
  } else if (shape.kind === 'rect') {
    mask.fill(1);
  } else if (shape.kind === 'circle') {
    const r = Math.min(halfW, halfH);
    const r2 = r * r;
    for (let y = 0; y < H; y++) {
      const cy = -halfH + (y + 0.5) * dy;
      for (let x = 0; x < W; x++) {
        const cx = -halfW + (x + 0.5) * dx;
        if (cx * cx + cy * cy <= r2) mask[y * W + x] = 1;
      }
    }
  } else {
    // rounded rectangle: corner radius clamped to half-min-dim.
    const r = Math.min(Math.max(0, shape.cornerRadiusMm), Math.min(halfW, halfH));
    for (let y = 0; y < H; y++) {
      const cy = -halfH + (y + 0.5) * dy;
      for (let x = 0; x < W; x++) {
        const cx = -halfW + (x + 0.5) * dx;
        const ax = Math.abs(cx);
        const ay = Math.abs(cy);
        if (ax > halfW || ay > halfH) continue;
        // Distance from the inset rectangle's corner; inside if <= r in the corner zone.
        const ix = Math.max(0, ax - (halfW - r));
        const iy = Math.max(0, ay - (halfH - r));
        if (ix * ix + iy * iy <= r * r) mask[y * W + x] = 1;
      }
    }
  }

  const holes = opts.holes ?? [];
  for (const hole of holes) {
    const holeR2 = (hole.diameterMm / 2) * (hole.diameterMm / 2);
    if (holeR2 <= 0) continue;
    for (let y = 0; y < H; y++) {
      const cy = -halfH + (y + 0.5) * dy - hole.cyMm;
      for (let x = 0; x < W; x++) {
        const cx = -halfW + (x + 0.5) * dx - hole.cxMm;
        if (cx * cx + cy * cy <= holeR2) mask[y * W + x] = 0;
      }
    }
  }

  return mask;
}

// Undirected-edge manifold check: every edge must appear in exactly two triangles.
function isEdgeManifold(triVerts: Uint32Array, numTri: number): boolean {
  const counts = new Map<number, number>();
  const MUL = 1 << 26;
  const bump = (u: number, v: number) => {
    const a = u < v ? u : v;
    const b = u < v ? v : u;
    const key = a * MUL + b;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };
  for (let t = 0; t < numTri; t++) {
    const a = triVerts[t * 3];
    const b = triVerts[t * 3 + 1];
    const c = triVerts[t * 3 + 2];
    bump(a, b);
    bump(b, c);
    bump(c, a);
  }
  for (const count of counts.values()) {
    if (count !== 2) return false;
  }
  return true;
}

function emptyMesh(W: number, H: number): TileMeshResult {
  const cellTriIds = new Int32Array(2 * W * H);
  cellTriIds.fill(-1);
  const cellTriIdsBottom = new Int32Array(2 * W * H);
  cellTriIdsBottom.fill(-1);
  return {
    mesh: {
      vertProperties: new Float32Array(0),
      triVerts: new Uint32Array(0),
      numVert: 0,
      numTri: 0,
      numProp: 3,
      watertight: true,
    },
    cellTriIds,
    cellTriIdsBottom,
  };
}

export function buildTileMesh(
  W: number,
  H: number,
  opts: TileOptions,
  shape: TileShape,
): TileMeshResult {
  if (W < 2 || H < 2) return emptyMesh(W, H);

  const mask = buildCellMask(W, H, opts, shape);

  // Cell-quad mask: a quad (x,y) with x<W-1, y<H-1 is included iff the corresponding image cell is.
  let includedCells = 0;
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      if (mask[y * W + x]) includedCells++;
    }
  }
  if (includedCells === 0) return emptyMesh(W, H);

  const widthMm = opts.widthMm;
  const heightMm = widthMm * (H / W);
  const halfW = widthMm / 2;
  const halfH = heightMm / 2;
  const dx = widthMm / (W - 1);
  const dy = heightMm / (H - 1);
  const topZ = opts.thickness;
  const chamferMm = Math.max(0, Math.min(topZ * 0.5, opts.chamferMm ?? 0));
  const chamferZ = topZ - chamferMm;

  // A grid vertex (vx, vy) borders up to 4 cells (vx-1, vy-1), (vx, vy-1),
  // (vx-1, vy), (vx, vy). A vertex is "boundary" when at least one of those
  // cells is included AND at least one is excluded (or off-grid). Boundary
  // top-surface vertices drop to chamferZ so the perimeter cells slope inward,
  // giving a soft chamfered top lip without any extra geometry.
  const wantChamfer = chamferMm > 0;
  const isCellIncluded = (cx: number, cy: number): boolean => {
    if (cx < 0 || cy < 0 || cx >= W - 1 || cy >= H - 1) return false;
    return mask[cy * W + cx] === 1;
  };
  const isBoundaryVertex = (vx: number, vy: number): boolean => {
    const a = isCellIncluded(vx - 1, vy - 1);
    const b = isCellIncluded(vx, vy - 1);
    const c = isCellIncluded(vx - 1, vy);
    const d = isCellIncluded(vx, vy);
    const anyIn = a || b || c || d;
    const anyOut = !a || !b || !c || !d;
    return anyIn && anyOut;
  };

  const numVert = 2 * W * H;
  const vertProperties = new Float32Array(numVert * 3);
  const topBase = W * H * 3;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const cell = y * W + x;
      const px = -halfW + x * dx;
      const py = -halfH + y * dy;
      const t = cell * 3;
      const tz = wantChamfer && isBoundaryVertex(x, y) ? chamferZ : topZ;
      vertProperties[t] = px;
      vertProperties[t + 1] = py;
      vertProperties[t + 2] = tz;
      const b = topBase + cell * 3;
      vertProperties[b] = px;
      vertProperties[b + 1] = py;
      vertProperties[b + 2] = 0;
    }
  }

  const topIdx = (x: number, y: number) => y * W + x;
  const botIdx = (x: number, y: number) => W * H + y * W + x;

  // Count walls: for each included quad-cell, check 4 edges. An edge is a wall when
  // the neighbour is excluded or off-grid. 2 wall tris per wall edge.
  let wallEdges = 0;
  const isIncluded = isCellIncluded;
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      if (!isIncluded(x, y)) continue;
      if (!isIncluded(x, y - 1)) wallEdges++;
      if (!isIncluded(x + 1, y)) wallEdges++;
      if (!isIncluded(x, y + 1)) wallEdges++;
      if (!isIncluded(x - 1, y)) wallEdges++;
    }
  }

  const numTri = includedCells * 4 + wallEdges * 2;
  const triVerts = new Uint32Array(numTri * 3);
  const cellTriIds = new Int32Array(2 * W * H);
  cellTriIds.fill(-1);
  const cellTriIdsBottom = new Int32Array(2 * W * H);
  cellTriIdsBottom.fill(-1);

  let ti = 0;
  const tri = (a: number, b: number, c: number): number => {
    const id = ti / 3;
    triVerts[ti] = a;
    triVerts[ti + 1] = b;
    triVerts[ti + 2] = c;
    ti += 3;
    return id;
  };

  // 1. Top surface — CCW from +Z. Cell-major scan matching gridTriangleIndexForCell;
  //    excluded cells leave cellTriIds[..]=-1 so callers map only real top tris.
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      if (!isIncluded(x, y)) continue;
      const a = topIdx(x, y);
      const b = topIdx(x + 1, y);
      const c = topIdx(x + 1, y + 1);
      const d = topIdx(x, y + 1);
      const id0 = tri(a, b, c);
      const id1 = tri(a, c, d);
      const base = 2 * (y * W + x);
      cellTriIds[base] = id0;
      cellTriIds[base + 1] = id1;
    }
  }

  // 2. Bottom plane at z=0 — reverse winding (CCW from -Z).
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      if (!isIncluded(x, y)) continue;
      const a = botIdx(x, y);
      const b = botIdx(x + 1, y);
      const c = botIdx(x + 1, y + 1);
      const d = botIdx(x, y + 1);
      const id0 = tri(a, c, b);
      const id1 = tri(a, d, c);
      const base = 2 * (y * W + x);
      cellTriIdsBottom[base] = id0;
      cellTriIdsBottom[base + 1] = id1;
    }
  }

  // 3. Walls per boundary cell-edge, normals outward. Wind to match buildReliefMesh's
  //    skirt: on -Y/+X borders use (t0,b0,b1)+(t0,b1,t1); on +Y/-X use (t0,t1,b1)+(t0,b1,b0).
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      if (!isIncluded(x, y)) continue;

      // -Y edge: top corners (x,y)→(x+1,y); outward = -Y.
      if (!isIncluded(x, y - 1)) {
        const t0 = topIdx(x, y);
        const t1 = topIdx(x + 1, y);
        const b0 = botIdx(x, y);
        const b1 = botIdx(x + 1, y);
        tri(t0, b0, b1);
        tri(t0, b1, t1);
      }
      // +X edge: top corners (x+1,y)→(x+1,y+1); outward = +X.
      if (!isIncluded(x + 1, y)) {
        const t0 = topIdx(x + 1, y);
        const t1 = topIdx(x + 1, y + 1);
        const b0 = botIdx(x + 1, y);
        const b1 = botIdx(x + 1, y + 1);
        tri(t0, b0, b1);
        tri(t0, b1, t1);
      }
      // +Y edge: top corners (x,y+1)→(x+1,y+1); outward = +Y.
      if (!isIncluded(x, y + 1)) {
        const t0 = topIdx(x, y + 1);
        const t1 = topIdx(x + 1, y + 1);
        const b0 = botIdx(x, y + 1);
        const b1 = botIdx(x + 1, y + 1);
        tri(t0, t1, b1);
        tri(t0, b1, b0);
      }
      // -X edge: top corners (x,y)→(x,y+1); outward = -X.
      if (!isIncluded(x - 1, y)) {
        const t0 = topIdx(x, y);
        const t1 = topIdx(x, y + 1);
        const b0 = botIdx(x, y);
        const b1 = botIdx(x, y + 1);
        tri(t0, t1, b1);
        tri(t0, b1, b0);
      }
    }
  }

  const watertight = isEdgeManifold(triVerts, ti / 3);

  return {
    mesh: {
      vertProperties,
      triVerts,
      numVert,
      numTri,
      numProp: 3,
      watertight,
    },
    cellTriIds,
    cellTriIdsBottom,
  };
}
