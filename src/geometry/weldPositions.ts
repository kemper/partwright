// Vertex welding by quantized position — shared by the STL / 3MF import
// welds and the renderer's preview decimation (vertex clustering). Pure and
// dependency-free.

/** Merge xyz positions (the first three of every `stride` values) that round
 *  to the same `tolerance` grid cell. Returns the unique positions (xyz only,
 *  first occurrence kept, first-seen order) and each input vertex's welded
 *  index.
 *
 *  An open-addressing hash over the quantized integer coordinates — a
 *  string-keyed Map here took ~6 s for a 2M-triangle STL, and the weld runs
 *  once per tolerance the import tries. */
export function weldPositions(
  pos: ArrayLike<number>,
  count: number,
  tolerance: number,
  stride = 3,
): { positions: Float32Array; remap: Uint32Array; numVert: number } {
  const inv = 1 / tolerance;
  let cap = 16;
  while (cap < count * 2) cap *= 2;
  const mask = cap - 1;
  const table = new Int32Array(cap).fill(-1);
  // Per unique vertex: its quantized cell (compared exactly on a hash hit) and
  // position. Sized for the unique count, not the input count — an STL soup
  // repeats each vertex ~6×, and at a few million triangles allocating these
  // per input vertex cost hundreds of MB — growing by doubling as needed.
  let room = Math.min(count, Math.max(1024, count >> 2));
  let qx = new Float64Array(room), qy = new Float64Array(room), qz = new Float64Array(room);
  let positions = new Float32Array(room * 3);
  const grow = () => {
    room = Math.min(count, room * 2);
    const nx = new Float64Array(room); nx.set(qx); qx = nx;
    const ny = new Float64Array(room); ny.set(qy); qy = ny;
    const nz = new Float64Array(room); nz.set(qz); qz = nz;
    const np = new Float32Array(room * 3); np.set(positions); positions = np;
  };
  const remap = new Uint32Array(count);
  let numVert = 0;
  for (let v = 0; v < count; v++) {
    const x = pos[v * stride], y = pos[v * stride + 1], z = pos[v * stride + 2];
    // `+ 0` folds -0 into 0 so both land in the same cell.
    const ix = Math.round(x * inv) + 0, iy = Math.round(y * inv) + 0, iz = Math.round(z * inv) + 0;
    let h = (Math.imul(ix | 0, 73856093) ^ Math.imul(iy | 0, 19349663) ^ Math.imul(iz | 0, 83492791)) & mask;
    let idx = table[h];
    while (idx !== -1 && (qx[idx] !== ix || qy[idx] !== iy || qz[idx] !== iz)) {
      h = (h + 1) & mask;
      idx = table[h];
    }
    if (idx === -1) {
      if (numVert === room) grow();
      idx = numVert++;
      table[h] = idx;
      qx[idx] = ix; qy[idx] = iy; qz[idx] = iz;
      positions[idx * 3] = x; positions[idx * 3 + 1] = y; positions[idx * 3 + 2] = z;
    }
    remap[v] = idx;
  }
  return { positions: numVert === room ? positions : positions.slice(0, numVert * 3), remap, numVert };
}
