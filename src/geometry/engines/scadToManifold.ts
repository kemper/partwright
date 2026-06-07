import type { MeshData } from '../types';

/**
 * Parse binary STL → deduplicated MeshGL-shaped mesh data suitable for `Manifold.ofMesh()`.
 *
 * Binary STL stores each triangle as 3 independent float32 vertex triples (no shared index),
 * so raw parsing would produce 3× vertex duplication. We weld vertices by quantized key.
 *
 * Tolerance: 1e-5 (OpenSCAD output is typically milli-unit precise). If Manifold.ofMesh
 * rejects welded output, consider switching to OFF export (already indexed) or loosening.
 *
 * Returns null on structurally invalid input.
 */
export function parseBinarySTLToMeshGL(bytes: Uint8Array): MeshData | null {
  if (bytes.byteLength < 84) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triCount = view.getUint32(80, true);
  const expectedSize = 84 + triCount * 50;
  if (bytes.byteLength < expectedSize) return null;

  const vertIndex = new Map<string, number>();
  const positions: number[] = [];
  const tris: number[] = [];

  // Weld tolerance: quantize coordinates to 5 decimal places before hashing.
  // `1e5` is the inverse of the tolerance, not a tolerance itself —
  // `round(v * 1e5) / 1e5` snaps to a 1e-5 grid, i.e. a 1e-5 weld tolerance.
  // That deliberately mirrors getConfig().import.stlWeldTolerance's default
  // (1e-5, see APP_CONFIG_DEFAULTS in src/config/appConfig.ts). We inline the
  // literal here because this runs in the engine Worker, where getConfig()
  // can't read the user's localStorage override anyway (it returns the static
  // defaults), so threading the config through would buy nothing.
  const quantize = (v: number) => Math.round(v * 1e5) / 1e5;

  let offset = 84;
  for (let t = 0; t < triCount; t++) {
    // skip 12-byte normal
    offset += 12;
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
    // skip 2-byte attribute
    offset += 2;
    // Drop degenerate triangles (would break manifold validation)
    if (
      triVerts[0] !== triVerts[1] &&
      triVerts[1] !== triVerts[2] &&
      triVerts[0] !== triVerts[2]
    ) {
      tris.push(triVerts[0], triVerts[1], triVerts[2]);
    }
  }

  return {
    vertProperties: new Float32Array(positions),
    triVerts: new Uint32Array(tris),
    numVert: positions.length / 3,
    numTri: tris.length / 3,
    numProp: 3,
  };
}
