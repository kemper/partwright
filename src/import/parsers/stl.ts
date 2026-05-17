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
// looser tolerances when ofMesh rejects the output.

export interface STLParseOptions {
  /** Coordinate quantization step before hashing. Vertices whose components
   *  round to the same grid cell are merged. Default 1e-5 (5 decimal places). */
  weldTolerance?: number;
}

const ASCII_DETECT_PREFIX = 'solid';

/** Parse any STL (binary or ASCII) into the MeshGL shape expected by Manifold.ofMesh. */
export function parseSTL(bytes: Uint8Array, options: STLParseOptions = {}): MeshData | null {
  const tolerance = options.weldTolerance ?? 1e-5;
  if (isBinarySTL(bytes)) {
    return parseBinarySTL(bytes, tolerance);
  }
  return parseAsciiSTL(bytes, tolerance);
}

/** Heuristic: ASCII STL must start with `solid`, but some binary STLs do too,
 *  so we additionally check whether the declared triangle count from the binary
 *  header matches the file size. If it matches, treat as binary. */
function isBinarySTL(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 84) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triCount = view.getUint32(80, true);
  const expectedSize = 84 + triCount * 50;
  if (bytes.byteLength === expectedSize) return true;
  // No size match — check the prefix; absence of `solid` is a strong binary signal.
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 5)).toLowerCase();
  return head !== ASCII_DETECT_PREFIX;
}

function parseBinarySTL(bytes: Uint8Array, weldTolerance: number): MeshData | null {
  if (bytes.byteLength < 84) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triCount = view.getUint32(80, true);
  const expectedSize = 84 + triCount * 50;
  if (bytes.byteLength < expectedSize) return null;

  const vertIndex = new Map<string, number>();
  const positions: number[] = [];
  const tris: number[] = [];
  const inv = 1 / weldTolerance;
  const quantize = (v: number) => Math.round(v * inv) / inv;

  let offset = 84;
  for (let t = 0; t < triCount; t++) {
    offset += 12; // skip 12-byte normal
    const triVerts: number[] = [];
    for (let v = 0; v < 3; v++) {
      const x = view.getFloat32(offset, true); offset += 4;
      const y = view.getFloat32(offset, true); offset += 4;
      const z = view.getFloat32(offset, true); offset += 4;
      const key = `${quantize(x)},${quantize(y)},${quantize(z)}`;
      let idx = vertIndex.get(key);
      if (idx === undefined) {
        idx = positions.length / 3;
        positions.push(x, y, z);
        vertIndex.set(key, idx);
      }
      triVerts.push(idx);
    }
    offset += 2; // skip attribute byte count
    if (
      triVerts[0] !== triVerts[1] &&
      triVerts[1] !== triVerts[2] &&
      triVerts[0] !== triVerts[2]
    ) {
      tris.push(triVerts[0], triVerts[1], triVerts[2]);
    }
  }

  if (tris.length === 0) return null;

  return {
    vertProperties: new Float32Array(positions),
    triVerts: new Uint32Array(tris),
    numVert: positions.length / 3,
    numTri: tris.length / 3,
    numProp: 3,
  };
}

function parseAsciiSTL(bytes: Uint8Array, weldTolerance: number): MeshData | null {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const vertIndex = new Map<string, number>();
  const positions: number[] = [];
  const tris: number[] = [];
  const inv = 1 / weldTolerance;
  const quantize = (v: number) => Math.round(v * inv) / inv;

  // Match "vertex x y z" lines, three per facet. We don't bother enforcing the
  // facet/outer-loop framing — malformed files just produce a partial mesh,
  // and Manifold.ofMesh will reject it loudly downstream if topology is bad.
  const vertexLines = text.match(/vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g);
  if (!vertexLines || vertexLines.length < 3) return null;

  const numTris = Math.floor(vertexLines.length / 3);
  for (let t = 0; t < numTris; t++) {
    const triVerts: number[] = [];
    for (let v = 0; v < 3; v++) {
      const m = /vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/.exec(vertexLines[t * 3 + v]);
      if (!m) return null;
      const x = parseFloat(m[1]);
      const y = parseFloat(m[2]);
      const z = parseFloat(m[3]);
      const key = `${quantize(x)},${quantize(y)},${quantize(z)}`;
      let idx = vertIndex.get(key);
      if (idx === undefined) {
        idx = positions.length / 3;
        positions.push(x, y, z);
        vertIndex.set(key, idx);
      }
      triVerts.push(idx);
    }
    if (
      triVerts[0] !== triVerts[1] &&
      triVerts[1] !== triVerts[2] &&
      triVerts[0] !== triVerts[2]
    ) {
      tris.push(triVerts[0], triVerts[1], triVerts[2]);
    }
  }

  if (tris.length === 0) return null;

  return {
    vertProperties: new Float32Array(positions),
    triVerts: new Uint32Array(tris),
    numVert: positions.length / 3,
    numTri: tris.length / 3,
    numProp: 3,
  };
}
