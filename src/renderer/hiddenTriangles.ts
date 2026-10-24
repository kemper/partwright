// Hide a set of the displayed mesh's triangles — the object list's eye toggle on
// a part or piece (and `partwright.setObjectPartHidden`). View-only: the code,
// the saved versions, exports and offscreen renders are untouched (they build
// their own geometry from the mesh data). Each hidden triangle is collapsed to
// a single point in the live geometry, which keeps the triangle numbering — so
// paint/measure picks on the visible triangles still map to the right ids — and
// a zero-area triangle can never be drawn or hit by a ray-cast. `updateMesh`
// builds fresh geometry on every run, so the caller re-applies after each one.

import * as THREE from 'three';
import { getMeshGroup, getDisplayedMesh, requestRender } from './viewport';

// Meshes in the group that draw the model's own geometry (the solid is unnamed;
// overlays such as the part highlight have their own names and are skipped).
const MODEL_MESH_NAMES = new Set(['', 'wireframe', 'clip-cap']);

/** Hide exactly `hidden` (triangle ids of the displayed mesh); null or empty
 *  shows everything again. Returns how many triangles are now hidden. */
export function applyHiddenTriangles(hidden: ReadonlySet<number> | null): number {
  const mesh = getDisplayedMesh();
  if (!mesh) return 0;
  const { triVerts, vertProperties, numProp, numTri } = mesh;
  const geometries = new Set<THREE.BufferGeometry>();
  for (const child of getMeshGroup().children) {
    if (child instanceof THREE.Mesh && MODEL_MESH_NAMES.has(child.name)) geometries.add(child.geometry as THREE.BufferGeometry);
  }
  const want = hidden && hidden.size > 0 ? hidden : null;
  let count = 0;
  for (const geo of geometries) {
    // Untouched geometry with nothing to hide — leave it (and its shared
    // index buffer) alone.
    if (!want && !geo.userData.hiddenTriangles) continue;
    const index = geo.getIndex();
    if (index) {
      if (index.count !== numTri * 3) continue;
      // The indexed path shares `mesh.triVerts` as its index buffer, so edit a
      // copy rather than the mesh data itself.
      const idx = new Uint32Array(triVerts);
      if (want) {
        for (const t of want) {
          if (t < 0 || t >= numTri) continue;
          idx[t * 3 + 1] = idx[t * 3 + 2] = idx[t * 3];
        }
      }
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
    } else {
      const pos = geo.getAttribute('position') as THREE.BufferAttribute | undefined;
      if (!pos || pos.count !== numTri * 3) continue;
      const arr = pos.array as Float32Array;
      for (let t = 0; t < numTri; t++) {
        const hide = want?.has(t) ?? false;
        for (let k = 0; k < 3; k++) {
          const v = triVerts[t * 3 + (hide ? 0 : k)];
          const o = t * 9 + k * 3;
          arr[o] = vertProperties[v * numProp];
          arr[o + 1] = vertProperties[v * numProp + 1];
          arr[o + 2] = vertProperties[v * numProp + 2];
        }
      }
      pos.needsUpdate = true;
    }
    geo.userData.hiddenTriangles = !!want;
    if (want) count = want.size;
  }
  requestRender();
  return count;
}
