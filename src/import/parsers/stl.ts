import type { MeshData } from '../../geometry/types';

// STL files are either binary (the common case) or ASCII (older / hand-written).
// Both formats represent a flat triangle soup with no shared vertices, so the
// parsers weld duplicates by quantized position before producing MeshGL output.
//
// Weld tolerance matters for real-world STLs: CAD exporters often produce
// triangles with tiny gaps at their shared edges (float precision noise from
// the slicer's tessellation). A tight tolerance treats those as distinct
// vertices and the result fails Manifold.ofMesh()'s "every edge shared by
// exactly two triangles" check. Callers should retry with progressively
// looser tolerances when ofMesh rejects the output — parse the soup ONCE with
// `parseSTLSoup` and re-weld it with `weldSoup` per tolerance, rather than
// re-parsing the bytes each time.

export interface STLParseOptions {
  /** Coordinate quantization step before hashing. Vertices whose components
   *  round to the same grid cell are merged. Default 1e-5 (5 decimal places). */
  weldTolerance?: number;
}

/** The unwelded triangle soup of an STL: 9 coordinates (3 vertices × xyz) per
 *  triangle, in file order. Binary STLs store float32, ASCII parses to float64. */
export type STLSoup = Float32Array | Float64Array;

export const DEFAULT_STL_WELD_TOLERANCE = 1e-5;

const ASCII_DETECT_PREFIX = 'solid';

/** Parse any STL (binary or ASCII) into the MeshGL shape expected by Manifold.ofMesh. */
export function parseSTL(bytes: Uint8Array, options: STLParseOptions = {}): MeshData | null {
  const soup = parseSTLSoup(bytes);
  return soup ? weldSoup(soup, options.weldTolerance ?? DEFAULT_STL_WELD_TOLERANCE) : null;
}

/** Parse STL bytes into an unwelded triangle soup. Null when the bytes aren't
 *  an STL, are truncated, or hold a non-finite coordinate (rejected here rather
 *  than letting a NaN/Infinity vertex fail export later with a misleading
 *  "geometry" error). */
export function parseSTLSoup(bytes: Uint8Array): STLSoup | null {
  return isBinarySTL(bytes) ? parseBinarySoup(bytes) : parseAsciiSoup(bytes);
}

/** Heuristic: ASCII STL must start with `solid`, but some binary STLs do too,
 *  so we additionally check whether the declared triangle count from the binary
 *  header matches the file size. If it matches, treat as binary. */
function isBinarySTL(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 84) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triCount = view.getUint32(80, true);
  const expectedSize = 84 + triCount * 50;
  // Exact match, or a binary file with trailing padding some exporters append.
  // (An ASCII file's bytes 80..83 decode to a huge triCount, so its expectedSize
  // dwarfs any real file — this branch can only be true for genuine binary STLs,
  // even when the 80-byte header happens to start with "solid".)
  if (triCount > 0 && bytes.byteLength >= expectedSize) return true;
  // No size signal — check the prefix; absence of `solid` is a strong binary signal.
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 5)).toLowerCase();
  return head !== ASCII_DETECT_PREFIX;
}

function parseBinarySoup(bytes: Uint8Array): Float32Array | null {
  if (bytes.byteLength < 84) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triCount = view.getUint32(80, true);
  const expectedSize = 84 + triCount * 50;
  if (bytes.byteLength < expectedSize) return null;

  const soup = new Float32Array(triCount * 9);
  let offset = 84;
  let k = 0;
  for (let t = 0; t < triCount; t++) {
    offset += 12; // skip 12-byte normal
    for (let c = 0; c < 9; c++) {
      const v = view.getFloat32(offset, true); offset += 4;
      if (!Number.isFinite(v)) return null;
      soup[k++] = v;
    }
    offset += 2; // skip attribute byte count
  }
  return soup;
}

function parseAsciiSoup(bytes: Uint8Array): Float64Array | null {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  // Match "vertex x y z" lines, three per facet. We don't bother enforcing the
  // facet/outer-loop framing — malformed files just produce a partial mesh,
  // and Manifold.ofMesh will reject it loudly downstream if topology is bad.
  const re = /vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g;
  const coords: number[] = [];
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const x = parseFloat(m[1]);
    const y = parseFloat(m[2]);
    const z = parseFloat(m[3]);
    // Guard against overflow tokens like "1e999" (→ Infinity) producing a
    // non-finite mesh; fail the parse cleanly instead.
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    coords.push(x, y, z);
  }
  const numTri = Math.floor(coords.length / 9);
  if (numTri === 0) return null;
  return Float64Array.from(coords.length === numTri * 9 ? coords : coords.slice(0, numTri * 9));
}

/** Weld a triangle soup by quantized position into an indexed mesh. Vertices
 *  keep the position of their first occurrence, in first-seen order;
 *  triangles that collapse (two corners welded together) are dropped. Null
 *  when nothing survives. */
export function weldSoup(soup: STLSoup, weldTolerance: number): MeshData | null {
  const { positions, remap, numVert } = weldPositions(soup, soup.length / 3, weldTolerance);
  const numIn = soup.length / 9;
  const tris = new Uint32Array(numIn * 3);
  let n = 0;
  for (let t = 0; t < numIn; t++) {
    const a = remap[t * 3], b = remap[t * 3 + 1], c = remap[t * 3 + 2];
    if (a !== b && b !== c && a !== c) {
      tris[n++] = a; tris[n++] = b; tris[n++] = c;
    }
  }
  if (n === 0) return null;
  return {
    vertProperties: positions,
    triVerts: n === tris.length ? tris : tris.slice(0, n),
    numVert,
    numTri: n / 3,
    numProp: 3,
  };
}

/** Merge xyz positions (stride 3) that round to the same `tolerance` grid
 *  cell. Returns the unique positions (first occurrence kept, first-seen
 *  order) and each input vertex's welded index.
 *
 *  An open-addressing hash over the quantized integer coordinates — a
 *  string-keyed Map here took ~6 s for a 2M-triangle STL, and the weld runs
 *  once per tolerance the import tries. */
export function weldPositions(
  pos: ArrayLike<number>,
  count: number,
  tolerance: number,
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
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
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
