// Shared MeshData → THREE.BufferGeometry conversion.
//
// A low-level renderer leaf so the viewport, the offscreen renders
// (thumbnails, renderViews), the phantom-overlay path (`phantomGeometry.ts`)
// and the insert-palette pick meshes (`ui/insertPalette.ts`) all build
// geometry the same way. Lives in the renderer layer so UI may import it
// without an upward dependency.
//
// Big meshes made this a main-thread hot spot: the viewport and the version
// thumbnail each rebuilt the same positions and ran Three's
// `computeVertexNormals` (Vector3-per-vertex, ~1 s at 3.7M triangles). Now the
// indexed positions + normals are computed once per MeshData object with
// typed-array loops and shared by every geometry built from it.
import * as THREE from 'three';
import type { MeshData } from '../geometry/types';

interface IndexedArrays { positions: Float32Array; normals: Float32Array }

/** Per-MeshData cache of indexed positions + vertex normals. Keyed on the
 *  object, so a new run / version (a new MeshData) recomputes and the old
 *  entry is collected with its mesh. Consumers must not write to these
 *  arrays (geometry that edits positions — the per-triangle-coloured path —
 *  builds its own). */
const indexedCache = new WeakMap<MeshData, IndexedArrays>();

function indexedArrays(mesh: MeshData): IndexedArrays {
  const hit = indexedCache.get(mesh);
  if (hit) return hit;
  const { vertProperties: vp, numProp: np, numVert, triVerts, numTri } = mesh;
  const positions = new Float32Array(numVert * 3);
  for (let i = 0; i < numVert; i++) {
    positions[i * 3] = vp[i * np];
    positions[i * 3 + 1] = vp[i * np + 1];
    positions[i * 3 + 2] = vp[i * np + 2];
  }
  // Area-weighted vertex normals — the same result as Three's
  // computeVertexNormals: sum each face's unnormalized normal into its
  // corners, then normalize.
  const normals = new Float32Array(numVert * 3);
  for (let t = 0; t < numTri; t++) {
    const a = triVerts[t * 3] * 3, b = triVerts[t * 3 + 1] * 3, c = triVerts[t * 3 + 2] * 3;
    const ex = positions[c] - positions[b], ey = positions[c + 1] - positions[b + 1], ez = positions[c + 2] - positions[b + 2];
    const fx = positions[a] - positions[b], fy = positions[a + 1] - positions[b + 1], fz = positions[a + 2] - positions[b + 2];
    const nx = ey * fz - ez * fy, ny = ez * fx - ex * fz, nz = ex * fy - ey * fx;
    normals[a] += nx; normals[a + 1] += ny; normals[a + 2] += nz;
    normals[b] += nx; normals[b + 1] += ny; normals[b + 2] += nz;
    normals[c] += nx; normals[c + 1] += ny; normals[c + 2] += nz;
  }
  normalizeInPlace(normals);
  const out = { positions, normals };
  indexedCache.set(mesh, out);
  return out;
}

function normalizeInPlace(n: Float32Array): void {
  for (let i = 0; i < n.length; i += 3) {
    const len = Math.hypot(n[i], n[i + 1], n[i + 2]);
    if (len > 0) { n[i] /= len; n[i + 1] /= len; n[i + 2] /= len; }
  }
}

/** Build a positions+index BufferGeometry from MeshData, with vertex normals
 *  (needed for shaded display; harmless for raycast-only pick meshes). The
 *  position/normal arrays are shared with other geometries of the same mesh
 *  (see `indexedCache`); the index is `mesh.triVerts` itself. */
export function meshDataToGeometry(mesh: MeshData): THREE.BufferGeometry {
  const { positions, normals } = indexedArrays(mesh);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(mesh.triVerts, 1));
  return geometry;
}

/** Build an un-indexed geometry carrying `mesh.triColors` as per-vertex
 *  colours (each triangle's three corners share its colour) and flat face
 *  normals. Triangles the colour layer marks unpainted get `unpainted`. */
export function triColoredGeometry(mesh: MeshData & { triColors: Uint8Array }, unpainted: readonly [number, number, number]): THREE.BufferGeometry {
  const { numTri, vertProperties, triVerts, numProp, triColors } = mesh;
  const positions = new Float32Array(numTri * 9);
  const colors = new Float32Array(numTri * 9);
  const normals = new Float32Array(numTri * 9);
  const painted = (triColors as Uint8Array & { _painted?: Uint8Array })._painted;
  for (let t = 0; t < numTri; t++) {
    const o = t * 9;
    for (let k = 0; k < 3; k++) {
      const v = triVerts[t * 3 + k] * numProp;
      positions[o + k * 3] = vertProperties[v];
      positions[o + k * 3 + 1] = vertProperties[v + 1];
      positions[o + k * 3 + 2] = vertProperties[v + 2];
    }
    // Flat face normal (Three's computeVertexNormals on un-indexed geometry).
    const ex = positions[o + 6] - positions[o + 3], ey = positions[o + 7] - positions[o + 4], ez = positions[o + 8] - positions[o + 5];
    const fx = positions[o] - positions[o + 3], fy = positions[o + 1] - positions[o + 4], fz = positions[o + 2] - positions[o + 5];
    let nx = ey * fz - ez * fy, ny = ez * fx - ex * fz, nz = ex * fy - ey * fx;
    const len = Math.hypot(nx, ny, nz);
    if (len > 0) { nx /= len; ny /= len; nz /= len; }

    const r = triColors[t * 3] / 255;
    const g = triColors[t * 3 + 1] / 255;
    const b = triColors[t * 3 + 2] / 255;
    // An explicit painted mask wins; without one, black means "unpainted".
    const isPainted = painted ? painted[t] === 1 : (r !== 0 || g !== 0 || b !== 0);
    const cr = isPainted ? r : unpainted[0];
    const cg = isPainted ? g : unpainted[1];
    const cb = isPainted ? b : unpainted[2];
    for (let k = 0; k < 3; k++) {
      colors[o + k * 3] = cr; colors[o + k * 3 + 1] = cg; colors[o + k * 3 + 2] = cb;
      normals[o + k * 3] = nx; normals[o + k * 3 + 1] = ny; normals[o + k * 3 + 2] = nz;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}
