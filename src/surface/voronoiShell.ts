// Voronoi-shell surface texture.
//
// Produces an organic cell-wall relief — a network of raised ridges that trace
// the boundaries between Voronoi cells, with flat cell interiors. This is the
// "voronoi" / "cracked-mud" / "dragonfly-wing" look popular for printable
// lampshades, planters, and decorative shells.
//
// Algorithm (cellular / Worley distance field — no full Voronoi diagram needed
// for a displacement texture):
//   1. Map world position onto a cell grid (grainAngleDeg rotates in XY; the Z
//      axis is the second grid axis, matching the other fabric textures).
//   2. Scatter one seed point per grid cell, jittered within the cell by a
//      deterministic hash. jitter=1 → full irregular Voronoi; jitter=0 → a
//      regular square grid.
//   3. For the query point, find the nearest (F1) and second-nearest (F2) seed
//      over the 3×3 neighbouring cells. The half-difference (F2−F1)/2 is the
//      approximate distance to the cell boundary (the perpendicular bisector
//      between the two closest sites).
//   4. Walls form where that boundary distance is small:
//        wall = 1 − smoothstep(0, wallWidth, edgeDist)   ∈ [0,1]
//      Displacement = ±amplitude × wall, pushed along the vertex normal.
//      raised=true raises the wall network; raised=false engraves it as channels.
//
// Like the sibling fabric textures this is computed per-projection via triplanar
// blending so the pattern follows the surface, and it is pure logic (no
// DOM/WASM) → unit-tested in the vitest tier.

import type { MeshData } from '../geometry/types';
import {
  subdivideToMaxEdge,
  extractPositions,
  computeVertexNormals,
  bboxOf,
  triplanarCoords,
} from './meshSubdivide';

export interface VoronoiShellOptions {
  /** Peak displacement (wall height) in world units. */
  amplitude: number;
  /** Approximate spacing between cells in world units (cell grid pitch). */
  cellSize: number;
  /** Raised-wall band width as a fraction of cellSize [0.02, 0.95]. Default 0.25.
   *  Smaller = thinner, crisper struts; larger = chunky walls / smaller openings. */
  wallWidth?: number;
  /** true (default) = raised wall network; false = engraved channels (recessed). */
  raised?: boolean;
  /** Seed jitter within each grid cell [0, 1]. 1 = full irregular Voronoi
   *  (default); 0 = a regular square grid. */
  jitter?: number;
  /** Rotate the cell grid in the XY plane (degrees). Default 0. */
  grainAngleDeg?: number;
  /** Deterministic seed. Default 1. */
  seed?: number;
  /** Densify mesh before displacing. Default true. */
  subdivide?: boolean;
  /** Subdivision quality 1 (draft) – 5 (ultra). Default 3. */
  quality?: number;
}

/** Deterministic integer hash → two independent floats in [0, 1). */
function hash2(ix: number, iz: number, seed: number): [number, number] {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h ^= h >>> 13;
  const a = (h >>> 0) / 4294967296;
  h = Math.imul(h ^ (h >>> 16), 3266489917);
  h ^= h >>> 13;
  const b = (h >>> 0) / 4294967296;
  return [a, b];
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0 || 1e-9)));
  return t * t * (3 - 2 * t);
}

/** Cellular wall intensity at grid coords (gx, gz): 1 on a cell boundary,
 *  falling to 0 in the cell interior over a band of `wallWidth` cell-units. */
function cellWall(gx: number, gz: number, jitter: number, wallWidth: number, seed: number): number {
  const cx = Math.floor(gx), cz = Math.floor(gz);
  let f1 = Infinity, f2 = Infinity;
  for (let oz = -1; oz <= 1; oz++) {
    for (let ox = -1; ox <= 1; ox++) {
      const ncx = cx + ox, ncz = cz + oz;
      const [hx, hz] = hash2(ncx, ncz, seed);
      const sx = ncx + 0.5 + jitter * (hx - 0.5);
      const sz = ncz + 0.5 + jitter * (hz - 0.5);
      const dx = sx - gx, dz = sz - gz;
      const dist = Math.hypot(dx, dz);
      if (dist < f1) { f2 = f1; f1 = dist; }
      else if (dist < f2) { f2 = dist; }
    }
  }
  const edge = (f2 - f1) * 0.5; // approx distance to the cell boundary (cell units)
  return 1 - smoothstep(0, wallWidth, edge);
}

export function voronoiShell(mesh: MeshData, opts: VoronoiShellOptions): MeshData {
  const amplitude = Math.max(0, opts.amplitude);
  const cellSize = Math.max(1e-4, opts.cellSize);
  const wallWidth = Math.min(0.95, Math.max(0.02, opts.wallWidth ?? 0.25));
  const raised = opts.raised !== false;
  const jitter = Math.min(1, Math.max(0, opts.jitter ?? 1));
  const seed = Math.floor(opts.seed ?? 1);
  const angleRad = ((opts.grainAngleDeg ?? 0) * Math.PI) / 180;
  const cosA = Math.cos(angleRad), sinA = Math.sin(angleRad);

  let base: MeshData = mesh;
  if (opts.subdivide !== false && amplitude > 0) {
    const quality = Math.max(1, Math.min(5, Math.round(opts.quality ?? 3)));
    const qScale = 2 ** ((quality - 3) / 2);
    const diag = Math.hypot(...bboxOf(extractPositions(mesh)).size);
    // Walls are thin features — target an edge length a fraction of the wall band
    // so the ridge resolves cleanly, with a diagonal-based floor as a safety net.
    const targetEdge = Math.max((cellSize * wallWidth) / (3 * qScale), diag / (400 * qScale));
    base = subdivideToMaxEdge(mesh, { maxEdge: targetEdge, maxRounds: 6 });
  }

  const positions = base.numProp === 3
    ? Float32Array.from(base.vertProperties)
    : extractPositions(base);
  const normals = computeVertexNormals(positions, base.triVerts);
  const sign = raised ? 1 : -1;

  for (let v = 0; v < base.numVert; v++) {
    const px = positions[v * 3], py = positions[v * 3 + 1], pz = positions[v * 3 + 2];
    const nx = normals[v * 3], ny = normals[v * 3 + 1], nz = normals[v * 3 + 2];

    const { pairs, weights } = triplanarCoords(px, py, pz, nx, ny, nz);
    let wall = 0;
    for (let i = 0; i < 3; i++) {
      const [s, t] = pairs[i];
      const gx = (cosA * s + sinA * t) / cellSize;
      const gz = (-sinA * s + cosA * t) / cellSize;
      // Offset the seed per projection so the three planes carry independent
      // cell patterns (avoids a mirrored pattern across the triplanar seams).
      wall += weights[i] * cellWall(gx, gz, jitter, wallWidth, seed + i * 1013);
    }
    const d = sign * amplitude * wall;

    positions[v * 3]     = px + nx * d;
    positions[v * 3 + 1] = py + ny * d;
    positions[v * 3 + 2] = pz + nz * d;
  }

  return {
    vertProperties: positions,
    triVerts: base.triVerts,
    numVert: base.numVert,
    numTri: base.numTri,
    numProp: 3,
    triColors: base.triColors,
  };
}
