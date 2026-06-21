// Shared MeshData → THREE.BufferGeometry conversion.
//
// A low-level renderer leaf so both the phantom-overlay path
// (`phantomGeometry.ts`) and the insert-palette pick meshes (`ui/insertPalette.ts`)
// build geometry the same way — they had diverged (one computed vertex normals,
// the other didn't). Lives in the renderer layer so UI may import it without an
// upward dependency.
import * as THREE from 'three';
import type { MeshData } from '../geometry/types';

/** Build a positions+index BufferGeometry from MeshData, with computed vertex
 *  normals (needed for shaded display; harmless for raycast-only pick meshes). */
export function meshDataToGeometry(mesh: MeshData): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(mesh.numVert * 3);
  for (let i = 0; i < mesh.numVert; i++) {
    positions[i * 3] = mesh.vertProperties[i * mesh.numProp];
    positions[i * 3 + 1] = mesh.vertProperties[i * mesh.numProp + 1];
    positions[i * 3 + 2] = mesh.vertProperties[i * mesh.numProp + 2];
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(mesh.triVerts, 1));
  geometry.computeVertexNormals();
  return geometry;
}
