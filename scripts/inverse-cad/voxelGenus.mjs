// Topology of a solid from its voxelization — for targets whose triangle
// mesh is not a clean 2-manifold (self-touching surfaces, T-vertices,
// duplicated sheets), where the Euler-characteristic-of-the-mesh route
// returns garbage (odd chi, fractional genus).
//
// Method: ray-parity voxelize (watertight by construction), then compute
// the Euler characteristic of the occupied cubical complex K by counting
// its distinct vertices/edges/faces/cells:
//
//   chi(K) = nV - nE + nF - nC
//
// For a compact 3-manifold-with-boundary, chi(boundary) = 2*chi(K), and
// chi(boundary) = 2*(#boundary surfaces) - 2*(total genus). A solid with
// `s` components and `h` internal cavities has s + h boundary surfaces, so
//
//   totalGenus = s + h - chi(K)
//
// Run at 2+ resolutions and trust agreement; a lone resolution can close a
// thin gap or open a thin wall.

import { voxelizeMesh } from './voxelDiff.mjs';

function computeBBox(mesh) {
  const t = mesh.triangles;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < t.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = t[i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  return { min, max };
}

/** chi(K) of the occupied cubical complex. occ is Uint8Array over nx*ny*nz. */
function eulerCharacteristic(occ, nx, ny, nz) {
  const idx = (x, y, z) => (z * ny + y) * nx + x;
  const at = (x, y, z) =>
    x >= 0 && y >= 0 && z >= 0 && x < nx && y < ny && z < nz && occ[idx(x, y, z)] !== 0;

  let nC = 0;
  for (let i = 0; i < occ.length; i++) if (occ[i]) nC++;

  // Distinct faces: a face perpendicular to axis A at grid plane i exists if
  // either adjacent cube is occupied. Iterate planes 0..n (inclusive).
  let nF = 0;
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x <= nx; x++)
        if (at(x - 1, y, z) || at(x, y, z)) nF++;
  for (let z = 0; z < nz; z++)
    for (let y = 0; y <= ny; y++)
      for (let x = 0; x < nx; x++)
        if (at(x, y - 1, z) || at(x, y, z)) nF++;
  for (let z = 0; z <= nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++)
        if (at(x, y, z - 1) || at(x, y, z)) nF++;

  // Distinct edges: an x-directed edge at (x..x+1, y, z) lattice position
  // exists if any of the 4 cubes sharing it is occupied (cube corners at
  // y-1..y, z-1..z). Analogous for y- and z-directed.
  let nE = 0;
  for (let z = 0; z <= nz; z++)
    for (let y = 0; y <= ny; y++)
      for (let x = 0; x < nx; x++)
        if (at(x, y - 1, z - 1) || at(x, y, z - 1) || at(x, y - 1, z) || at(x, y, z)) nE++;
  for (let z = 0; z <= nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x <= nx; x++)
        if (at(x - 1, y, z - 1) || at(x, y, z - 1) || at(x - 1, y, z) || at(x, y, z)) nE++;
  for (let z = 0; z < nz; z++)
    for (let y = 0; y <= ny; y++)
      for (let x = 0; x <= nx; x++)
        if (at(x - 1, y - 1, z) || at(x, y - 1, z) || at(x - 1, y, z) || at(x, y, z)) nE++;

  // Distinct vertices: lattice point belongs if any of its 8 cubes occupied.
  let nV = 0;
  for (let z = 0; z <= nz; z++)
    for (let y = 0; y <= ny; y++)
      for (let x = 0; x <= nx; x++)
        if (
          at(x - 1, y - 1, z - 1) || at(x, y - 1, z - 1) ||
          at(x - 1, y, z - 1) || at(x, y, z - 1) ||
          at(x - 1, y - 1, z) || at(x, y - 1, z) ||
          at(x - 1, y, z) || at(x, y, z)
        ) nV++;

  return nV - nE + nF - nC;
}

/** 6-connected BFS component count over a predicate. */
function countComponents(test, nx, ny, nz) {
  const idx = (x, y, z) => (z * ny + y) * nx + x;
  const seen = new Uint8Array(nx * ny * nz);
  let count = 0;
  const stack = [];
  for (let z0 = 0; z0 < nz; z0++)
    for (let y0 = 0; y0 < ny; y0++)
      for (let x0 = 0; x0 < nx; x0++) {
        const i0 = idx(x0, y0, z0);
        if (seen[i0] || !test(x0, y0, z0)) continue;
        count++;
        seen[i0] = 1;
        stack.push(x0, y0, z0);
        while (stack.length) {
          const z = stack.pop(), y = stack.pop(), x = stack.pop();
          const nbrs = [x - 1, y, z, x + 1, y, z, x, y - 1, z, x, y + 1, z, x, y, z - 1, x, y, z + 1];
          for (let n = 0; n < 18; n += 3) {
            const ax = nbrs[n], ay = nbrs[n + 1], az = nbrs[n + 2];
            if (ax < 0 || ay < 0 || az < 0 || ax >= nx || ay >= ny || az >= nz) continue;
            const ai = idx(ax, ay, az);
            if (!seen[ai] && test(ax, ay, az)) {
              seen[ai] = 1;
              stack.push(ax, ay, az);
            }
          }
        }
      }
  return count;
}

/**
 * @param {{triangles: Float32Array|number[]}} mesh  triangle soup (flat xyz*3 per tri)
 * @param {{res?: number}} opts
 * @returns {{res, gridSize, chi, solidComponents, airComponents, cavities, genus}}
 */
export function voxelGenus(mesh, opts = {}) {
  const bb = computeBBox(mesh);
  const dims = [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]];
  const maxDim = Math.max(...dims, 1e-9);
  const res = opts.res ?? Math.max(0.15, maxDim / 256);
  const PAD = 2;
  const min = [bb.min[0] - PAD * res, bb.min[1] - PAD * res, bb.min[2] - PAD * res];
  const size = [
    Math.ceil(dims[0] / res) + 2 * PAD,
    Math.ceil(dims[1] / res) + 2 * PAD,
    Math.ceil(dims[2] / res) + 2 * PAD,
  ];
  const occ = voxelizeMesh(mesh, { min, size, res });
  const [nx, ny, nz] = size;
  const idx = (x, y, z) => (z * ny + y) * nx + x;

  const chi = eulerCharacteristic(occ, nx, ny, nz);
  const solidComponents = countComponents((x, y, z) => occ[idx(x, y, z)] !== 0, nx, ny, nz);
  // Air components: the padded border guarantees the outside is one
  // component; every extra air component is an internal cavity.
  const airComponents = countComponents((x, y, z) => occ[idx(x, y, z)] === 0, nx, ny, nz);
  const cavities = airComponents - 1;
  const genus = solidComponents + cavities - chi;

  return { res, gridSize: size, chi, solidComponents, airComponents, cavities, genus };
}

// CLI: node scripts/inverse-cad/voxelGenus.mjs target.stl [--res 0.25[,0.15]]
if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import('fs');
  const { parseStl } = await import('./stl.mjs');
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node voxelGenus.mjs <mesh.stl> [--res 0.3,0.2]');
    process.exit(1);
  }
  const resArg = process.argv.indexOf('--res');
  const resList = resArg > -1 ? process.argv[resArg + 1].split(',').map(Number) : [undefined];
  const mesh = parseStl(readFileSync(file));
  for (const res of resList) {
    const t0 = Date.now();
    const out = voxelGenus(mesh, { res });
    console.log(JSON.stringify(out), `(${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  }
}
