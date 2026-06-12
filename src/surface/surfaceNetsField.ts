// Continuous-field Surface Nets — a smooth iso-surface from a scalar field.
//
// This generalizes voxel/surfaceNets.ts (binary occupancy, every crossing pinned
// to an edge midpoint) to an arbitrary continuous scalar field: each
// sign-changing cube edge contributes its LINEARLY INTERPOLATED zero-crossing,
// so the surface follows the true iso-contour sub-cell instead of snapping to
// voxel steps. That interpolation is exactly what removes the "corduroy"
// stair-stepping you get when a curved surface is meshed through binary
// occupancy — the same thing Manifold.levelSet does, but pure-JS on the main
// thread (where surface modifiers run, with no WASM).
//
// Convention: `field < iso` is INSIDE the solid. The field is sampled on a
// regular lattice of `dims` points spaced `spacing` apart; lattice point
// (i,j,k) sits at `origin + (i,j,k)·spacing`, stored at index (k·ny + j)·nx + i.
//
// Pure logic (no DOM/WASM) → unit-tested in the vitest tier.

import type { MeshData } from '../geometry/types';

// Standard Surface Nets tables (identical construction to voxel/surfaceNets.ts):
// `cubeEdges` lists the 12 cube edges as ordered corner-index pairs (entries
// 0/1/2 are the minimal +x/+y/+z edges from corner 0); `edgeTable[mask]` is the
// bitmask of which edges have a sign change for an 8-corner inside/outside mask.
const cubeEdges = new Int32Array(24);
const edgeTable = new Int32Array(256);
(function initTables() {
  let k = 0;
  for (let i = 0; i < 8; i++) {
    for (let j = 1; j <= 4; j <<= 1) {
      const p = i ^ j;
      if (i <= p) { cubeEdges[k++] = i; cubeEdges[k++] = p; }
    }
  }
  for (let i = 0; i < 256; i++) {
    let em = 0;
    for (let j = 0; j < 24; j += 2) {
      const a = !!(i & (1 << cubeEdges[j]));
      const b = !!(i & (1 << cubeEdges[j + 1]));
      em |= a !== b ? (1 << (j >> 1)) : 0;
    }
    edgeTable[i] = em;
  }
})();

export interface SurfaceNetsFieldOptions {
  /** Scalar field, length `dims[0]·dims[1]·dims[2]`, index (k·ny + j)·nx + i. */
  field: Float32Array;
  dims: [number, number, number];
  origin: [number, number, number];
  spacing: number;
  /** Iso level; `field < iso` is inside. Default 0. */
  iso?: number;
}

/** Mesh the `iso` level set of a continuous scalar field with interpolated
 *  Surface Nets, returning smooth, welded position-only `MeshData`. The lattice
 *  must carry a margin of outside (`field > iso`) samples around the geometry so
 *  the surface closes. */
export function surfaceNetsField(opts: SurfaceNetsFieldOptions): MeshData {
  const { field, dims, origin, spacing } = opts;
  const iso = opts.iso ?? 0;
  const [nx, ny, nz] = dims;
  const sidx = (i: number, j: number, k: number) => (k * ny + j) * nx + i;

  const positions: number[] = [];
  const tris: number[] = [];
  const vmap = new Int32Array(nx * ny * nz).fill(-1);
  const STEP = [1, nx, nx * ny];
  const f = new Float64Array(8);

  for (let k = 0; k < nz - 1; k++) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        // 8-corner inside mask + field values. Corner g offset (g&1,(g>>1)&1,(g>>2)&1).
        let mask = 0;
        for (let g = 0; g < 8; g++) {
          const fv = field[sidx(i + (g & 1), j + ((g >> 1) & 1), k + ((g >> 2) & 1))];
          f[g] = fv;
          if (fv < iso) mask |= 1 << g;
        }
        if (mask === 0 || mask === 0xff) continue; // no crossing in this cube

        // Vertex = mean of this cube's interpolated edge crossings.
        const em = edgeTable[mask];
        let vx = 0, vy = 0, vz = 0, ec = 0;
        for (let e = 0; e < 12; e++) {
          if (!(em & (1 << e))) continue;
          const e0 = cubeEdges[e << 1], e1 = cubeEdges[(e << 1) + 1];
          const f0 = f[e0], f1 = f[e1];
          const denom = f1 - f0;
          const t = denom === 0 ? 0.5 : (iso - f0) / denom; // crossing fraction along the edge
          vx += axisOffset(e0, e1, 1, t);
          vy += axisOffset(e0, e1, 2, t);
          vz += axisOffset(e0, e1, 4, t);
          ec++;
        }
        const inv = 1 / ec;
        const m = sidx(i, j, k);
        vmap[m] = positions.length / 3;
        positions.push(
          origin[0] + (i + vx * inv) * spacing,
          origin[1] + (j + vy * inv) * spacing,
          origin[2] + (k + vz * inv) * spacing,
        );

        // Emit a quad per minimal sign-changing edge (corner 0 → +axis), stitching
        // the four cubes around it (already-visited neighbours along the two
        // perpendicular axes).
        for (let axis = 0; axis < 3; axis++) {
          if (!(em & (1 << axis))) continue;
          const iu = (axis + 1) % 3, iv = (axis + 2) % 3;
          if (ijkAxis(i, j, k, iu) === 0 || ijkAxis(i, j, k, iv) === 0) continue;
          const du = STEP[iu], dv = STEP[iv];
          const v0 = vmap[m], vU = vmap[m - du], vV = vmap[m - dv], vUV = vmap[m - du - dv];
          if (v0 < 0 || vU < 0 || vV < 0 || vUV < 0) continue;
          const corner0Inside = mask & 1;
          if (corner0Inside) tris.push(v0, vU, vUV, v0, vUV, vV);
          else tris.push(v0, vV, vUV, v0, vUV, vU);
        }
      }
    }
  }

  return {
    vertProperties: Float32Array.from(positions),
    triVerts: Uint32Array.from(tris),
    numVert: positions.length / 3,
    numTri: tris.length / 3,
    numProp: 3,
  };
}

/** Per-axis offset (within the unit cube) of an edge's interpolated crossing.
 *  `axisBit` is 1/2/4 for x/y/z. On the edge's varying axis the offset is the
 *  interpolated fraction `t`; on the other two axes both corners share the bit,
 *  so it is that constant (0 or 1). */
function axisOffset(e0: number, e1: number, axisBit: number, t: number): number {
  if ((e0 ^ e1) === axisBit) {
    const b0 = (e0 & axisBit) ? 1 : 0, b1 = (e1 & axisBit) ? 1 : 0;
    return b0 + t * (b1 - b0);
  }
  return (e0 & axisBit) ? 1 : 0;
}

function ijkAxis(i: number, j: number, k: number, axis: number): number {
  return axis === 0 ? i : axis === 1 ? j : k;
}
