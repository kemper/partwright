// STL parser + writer. Binary and ASCII in, binary out.
//
// A parsed mesh is `{ triangles: Float32Array }` where triangles hold
// 9 floats each (3 vertices × xyz), in the order the file listed them.
// No normals — they're recomputed on write from the vertex order (right-hand).

const ASCII_MAGIC = 'solid ';
const BIN_HEADER_LEN = 80;
const BIN_TRI_LEN = 50; // 12 normal + 36 verts + 2 attr

export function parseStl(buf) {
  if (!(buf instanceof Uint8Array)) {
    throw new TypeError('parseStl: expected Uint8Array, got ' + typeof buf);
  }
  if (looksAscii(buf)) return parseAscii(buf);
  return parseBinary(buf);
}

// A binary STL file *can* start with the bytes "solid " — some slicers write
// that as a marketing header. So we rely on the length invariant: a valid
// binary file is exactly 84 + 50 * triCount bytes. If the length matches for
// the triCount stored at offset 80, it's binary regardless of the prefix.
function looksAscii(buf) {
  if (buf.length < BIN_HEADER_LEN + 4) return true;
  const triCount = new DataView(buf.buffer, buf.byteOffset + BIN_HEADER_LEN, 4).getUint32(0, true);
  const expected = BIN_HEADER_LEN + 4 + triCount * BIN_TRI_LEN;
  if (buf.length === expected) return false;
  const head = new TextDecoder('ascii').decode(buf.subarray(0, 6));
  return head === ASCII_MAGIC;
}

function parseBinary(buf) {
  if (buf.length < BIN_HEADER_LEN + 4) {
    throw new Error('parseStl: binary file too short (' + buf.length + ' bytes)');
  }
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const triCount = dv.getUint32(BIN_HEADER_LEN, true);
  const expected = BIN_HEADER_LEN + 4 + triCount * BIN_TRI_LEN;
  if (buf.length < expected) {
    throw new Error(
      `parseStl: binary length ${buf.length} < expected ${expected} for ${triCount} triangles`,
    );
  }
  const triangles = new Float32Array(triCount * 9);
  let off = BIN_HEADER_LEN + 4 + 12; // skip normal
  for (let i = 0; i < triCount; i++) {
    for (let j = 0; j < 9; j++) triangles[i * 9 + j] = dv.getFloat32(off + j * 4, true);
    off += BIN_TRI_LEN;
  }
  return { triangles };
}

function parseAscii(buf) {
  const text = new TextDecoder('ascii').decode(buf);
  const verts = [];
  const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    verts.push(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
  }
  if (verts.length % 9 !== 0) {
    throw new Error('parseStl: ASCII vertex count ' + verts.length / 3 + ' not divisible by 3');
  }
  return { triangles: Float32Array.from(verts) };
}

export function writeBinaryStl(mesh, opts = {}) {
  const { triangles } = mesh;
  if (!(triangles instanceof Float32Array)) {
    throw new TypeError('writeBinaryStl: mesh.triangles must be Float32Array');
  }
  if (triangles.length % 9 !== 0) {
    throw new Error('writeBinaryStl: triangles.length not divisible by 9');
  }
  const triCount = triangles.length / 9;
  const out = new Uint8Array(BIN_HEADER_LEN + 4 + triCount * BIN_TRI_LEN);
  const header = opts.header ?? 'partwright inverse-cad';
  new TextEncoder().encodeInto(header.slice(0, BIN_HEADER_LEN), out);
  const dv = new DataView(out.buffer);
  dv.setUint32(BIN_HEADER_LEN, triCount, true);
  let off = BIN_HEADER_LEN + 4;
  for (let i = 0; i < triCount; i++) {
    const a = i * 9;
    const ax = triangles[a], ay = triangles[a + 1], az = triangles[a + 2];
    const bx = triangles[a + 3], by = triangles[a + 4], bz = triangles[a + 5];
    const cx = triangles[a + 6], cy = triangles[a + 7], cz = triangles[a + 8];
    // right-hand normal from vertex order
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    dv.setFloat32(off, nx, true);
    dv.setFloat32(off + 4, ny, true);
    dv.setFloat32(off + 8, nz, true);
    for (let j = 0; j < 9; j++) dv.setFloat32(off + 12 + j * 4, triangles[a + j], true);
    // 2 bytes attribute byte count stays zero
    off += BIN_TRI_LEN;
  }
  return out;
}

export function meshBBox(mesh) {
  const { triangles } = mesh;
  const n = triangles.length;
  if (n === 0) throw new Error('meshBBox: empty mesh');
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i += 3) {
    const x = triangles[i], y = triangles[i + 1], z = triangles[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    size: [maxX - minX, maxY - minY, maxZ - minZ],
    center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
  };
}
