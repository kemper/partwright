// Heightmap → closed, edge-manifold mesh for a HueForge-style print.
//
// The top surface has one vertex per heightmap cell (so the slicer sees smooth
// ramps between layer heights, like a HueForge STL). Skirt walls drop each
// border vertex to z = 0, and the bottom is a fan around one centre vertex, so
// the flat underside costs 2·(W+H) triangles instead of a second full grid.
// Centred on the XY origin; Z up; image top at +Y.

import type { HueforgeResult } from './solver';

export interface HeightfieldMesh {
  vertProperties: Float32Array;
  triVerts: Uint32Array;
  numVert: number;
  numTri: number;
  numProp: 3;
  /** Number of top-surface triangles (they come first, 2 per grid quad). */
  numTopTri: number;
}

export function buildHeightfieldMesh(heights: Float32Array, W: number, H: number, widthMm: number, depthMm: number): HeightfieldMesh {
  if (W < 2 || H < 2) throw new Error('heightfield: grid must be at least 2×2');
  // Border ring, counter-clockwise seen from +Z: bottom row L→R, right column
  // B→T, top row R→L, left column T→B.
  const ring: number[] = [];
  for (let x = 0; x < W - 1; x++) ring.push(x);
  for (let y = 0; y < H - 1; y++) ring.push(y * W + (W - 1));
  for (let x = W - 1; x > 0; x--) ring.push((H - 1) * W + x);
  for (let y = H - 1; y > 0; y--) ring.push(y * W);
  const R = ring.length;

  const numVert = W * H + R + 1;
  const vp = new Float32Array(numVert * 3);
  const dx = widthMm / (W - 1);
  const dy = depthMm / (H - 1);
  const x0 = -widthMm / 2, y0 = -depthMm / 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = y * W + x;
      vp[v * 3] = x0 + x * dx;
      vp[v * 3 + 1] = y0 + y * dy;
      vp[v * 3 + 2] = heights[v];
    }
  }
  // Bottom ring (z = 0) mirrors the top border, then the centre.
  const botBase = W * H;
  for (let k = 0; k < R; k++) {
    const t = ring[k];
    vp[(botBase + k) * 3] = vp[t * 3];
    vp[(botBase + k) * 3 + 1] = vp[t * 3 + 1];
    vp[(botBase + k) * 3 + 2] = 0;
  }
  const centre = botBase + R;
  vp[centre * 3] = 0; vp[centre * 3 + 1] = 0; vp[centre * 3 + 2] = 0;

  const numTopTri = 2 * (W - 1) * (H - 1);
  const numTri = numTopTri + 2 * R + R;
  const tv = new Uint32Array(numTri * 3);
  let o = 0;
  const tri = (a: number, b: number, c: number) => { tv[o++] = a; tv[o++] = b; tv[o++] = c; };
  // Top: CCW from +Z. Split each quad along the diagonal that better follows
  // the surface (shorter height jump) so ridges don't zig-zag.
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const a = y * W + x, b = a + 1, c = a + W + 1, d = a + W;
      if (Math.abs(heights[a] - heights[c]) <= Math.abs(heights[b] - heights[d])) {
        tri(a, b, c); tri(a, c, d);
      } else {
        tri(a, b, d); tri(b, c, d);
      }
    }
  }
  // Skirt: ring edge (t0→t1) is CCW from above, so the outward wall is
  // (t0, b0, b1) + (t0, b1, t1).
  for (let k = 0; k < R; k++) {
    const k1 = (k + 1) % R;
    const t0 = ring[k], t1 = ring[k1];
    const b0 = botBase + k, b1 = botBase + k1;
    tri(t0, b0, b1);
    tri(t0, b1, t1);
  }
  // Bottom fan: CW from +Z (normals down).
  for (let k = 0; k < R; k++) {
    const k1 = (k + 1) % R;
    tri(centre, botBase + k1, botBase + k);
  }
  return { vertProperties: vp, triVerts: tv, numVert, numTri, numProp: 3, numTopTri };
}

export function hueforgeMesh(r: HueforgeResult): HeightfieldMesh {
  return buildHeightfieldMesh(r.heightsMm, r.gridWidth, r.gridHeight, r.widthMm, r.depthMm);
}
