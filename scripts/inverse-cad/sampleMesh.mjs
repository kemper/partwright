// Area-weighted uniform surface sampling + a static k-d tree for
// nearest-neighbor queries. All Float32Array-oriented; no allocations
// inside the hot loops beyond the initial buffers.

// Mulberry32 — seeded PRNG so runs are reproducible.
export function makeRng(seed = 1) {
  let s = seed >>> 0;
  return function rng() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function triAreas(triangles) {
  const n = triangles.length / 9;
  const areas = new Float64Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 9;
    const ax = triangles[o], ay = triangles[o + 1], az = triangles[o + 2];
    const bx = triangles[o + 3], by = triangles[o + 4], bz = triangles[o + 5];
    const cx = triangles[o + 6], cy = triangles[o + 7], cz = triangles[o + 8];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const a = 0.5 * Math.hypot(nx, ny, nz);
    areas[i] = a;
    total += a;
  }
  return { areas, total };
}

// Draw n uniform surface points from a triangle-soup mesh. Returns a
// flat Float32Array of length 3n.
export function samplePoints(mesh, n, opts = {}) {
  const { triangles } = mesh;
  const rng = opts.rng ?? makeRng(opts.seed ?? 1);
  const { areas, total } = triAreas(triangles);
  const triCount = areas.length;
  const cdf = new Float64Array(triCount);
  let acc = 0;
  for (let i = 0; i < triCount; i++) {
    acc += areas[i];
    cdf[i] = acc / total;
  }
  const out = new Float32Array(n * 3);
  for (let s = 0; s < n; s++) {
    const r = rng();
    // binary search
    let lo = 0, hi = triCount - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    const t = lo;
    const o = t * 9;
    let u = rng(), v = rng();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const w = 1 - u - v;
    const ax = triangles[o], ay = triangles[o + 1], az = triangles[o + 2];
    const bx = triangles[o + 3], by = triangles[o + 4], bz = triangles[o + 5];
    const cx = triangles[o + 6], cy = triangles[o + 7], cz = triangles[o + 8];
    out[s * 3] = w * ax + u * bx + v * cx;
    out[s * 3 + 1] = w * ay + u * by + v * cy;
    out[s * 3 + 2] = w * az + u * bz + v * cz;
  }
  return out;
}

// Static k-d tree over a flat xyz point array. `build` returns an object
// with a `nearest(qx, qy, qz)` method returning `{ index, distSq }` where
// `index` is the sample index in the original array.
export function buildKdTree(points) {
  const n = points.length / 3;
  const idx = new Int32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  const nodes = []; // flat: [axis, splitVal, leftEnd, rightStart, leafFrom, leafTo]
  const LEAF_SIZE = 16;

  function build(from, to) {
    const count = to - from;
    if (count <= LEAF_SIZE) {
      const id = nodes.length / 6;
      nodes.push(-1, 0, 0, 0, from, to);
      return id;
    }
    // pick axis with largest extent
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = from; i < to; i++) {
      const p = idx[i] * 3;
      const x = points[p], y = points[p + 1], z = points[p + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
    const axis = dx >= dy && dx >= dz ? 0 : dy >= dz ? 1 : 2;
    // nth-element (partial sort) by axis
    const mid = (from + to) >> 1;
    quickselect(idx, from, to - 1, mid, points, axis);
    const splitVal = points[idx[mid] * 3 + axis];
    const id = nodes.length / 6;
    nodes.push(axis, splitVal, 0, 0, 0, 0);
    const leftId = build(from, mid);
    const rightId = build(mid, to);
    nodes[id * 6 + 2] = leftId;
    nodes[id * 6 + 3] = rightId;
    return id;
  }
  build(0, n);
  const nodesArr = Float64Array.from(nodes);

  function nearest(qx, qy, qz) {
    let bestI = -1;
    let bestD = Infinity;
    function recurse(nodeId) {
      const b = nodeId * 6;
      const axis = nodesArr[b];
      if (axis < 0) {
        for (let i = nodesArr[b + 4]; i < nodesArr[b + 5]; i++) {
          const p = idx[i] * 3;
          const dx = points[p] - qx;
          const dy = points[p + 1] - qy;
          const dz = points[p + 2] - qz;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < bestD) { bestD = d2; bestI = idx[i]; }
        }
        return;
      }
      const split = nodesArr[b + 1];
      const q = axis === 0 ? qx : axis === 1 ? qy : qz;
      const diff = q - split;
      const near = diff <= 0 ? nodesArr[b + 2] : nodesArr[b + 3];
      const far = diff <= 0 ? nodesArr[b + 3] : nodesArr[b + 2];
      recurse(near);
      if (diff * diff < bestD) recurse(far);
    }
    recurse(0);
    return { index: bestI, distSq: bestD };
  }
  return { nearest };
}

function quickselect(idx, from, to, k, points, axis) {
  while (from < to) {
    const pivot = points[idx[(from + to) >> 1] * 3 + axis];
    let i = from, j = to;
    while (i <= j) {
      while (points[idx[i] * 3 + axis] < pivot) i++;
      while (points[idx[j] * 3 + axis] > pivot) j--;
      if (i <= j) {
        const tmp = idx[i]; idx[i] = idx[j]; idx[j] = tmp;
        i++; j--;
      }
    }
    if (k <= j) to = j;
    else if (k >= i) from = i;
    else break;
  }
}
