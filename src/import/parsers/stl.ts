import type { MeshData } from '../../geometry/types';
import { weldPositions } from '../../geometry/weldPositions';

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
