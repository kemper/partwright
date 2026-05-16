import type { MeshData } from '../../geometry/types';
import { parseBinarySTLToMeshGL } from '../../geometry/engines/scadToManifold';

// STL files are either binary (the common case) or ASCII (older / hand-written).
// Both formats represent a flat triangle soup with no shared vertices, so the
// parsers weld duplicates by quantized position before producing MeshGL output.

const ASCII_DETECT_PREFIX = 'solid';

/** Parse any STL (binary or ASCII) into the MeshGL shape expected by Manifold.ofMesh. */
export function parseSTL(bytes: Uint8Array): MeshData | null {
  if (isBinarySTL(bytes)) {
    return parseBinarySTLToMeshGL(bytes);
  }
  return parseAsciiSTL(bytes);
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

function parseAsciiSTL(bytes: Uint8Array): MeshData | null {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const vertIndex = new Map<string, number>();
  const positions: number[] = [];
  const tris: number[] = [];
  const quantize = (v: number) => Math.round(v * 1e5) / 1e5;

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
