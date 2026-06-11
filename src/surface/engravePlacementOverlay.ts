// A transient outline of the engrave stamp footprint, drawn in the viewport so
// the user can see where text/image will be carved — and drag it around the
// model in real time, the way the paint tool shows a brush cursor and the
// image-stamp tool shows its footprint square (src/color/imagePaintUI.ts).
//
// The outline is a closed quad (THREE.LineLoop) whose four world-space corners
// are computed by the caller from the engrave projection, so this module stays
// engrave-agnostic: it just renders and disposes the overlay.

import * as THREE from 'three';
import { getScene, requestRender } from '../renderer/viewport';

let outline: THREE.LineLoop | null = null;

function ensure(): THREE.LineLoop {
  if (outline) return outline;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(4 * 3), 3));
  // Vivid magenta with depthTest off so it reads on any surface color (the model
  // may itself be blue/grey) and is never occluded by the geometry.
  const mat = new THREE.LineBasicMaterial({
    color: 0xff2db4, opacity: 1, transparent: true, depthTest: false, depthWrite: false,
  });
  outline = new THREE.LineLoop(geo, mat);
  outline.renderOrder = 1002; // above the model and paint overlays
  outline.visible = false;
  getScene().add(outline);
  return outline;
}

/** Show the footprint outline at the four given world-space corners (in order). */
export function showEngraveOutline(corners: ReadonlyArray<readonly [number, number, number]>): void {
  if (corners.length !== 4) return;
  const loop = ensure();
  const pos = loop.geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < 4; i++) pos.setXYZ(i, corners[i][0], corners[i][1], corners[i][2]);
  pos.needsUpdate = true;
  loop.geometry.computeBoundingSphere();
  loop.visible = true;
  requestRender();
}

export function hideEngraveOutline(): void {
  if (outline?.visible) { outline.visible = false; requestRender(); }
}

/** Remove and free the overlay — call when the Surface panel closes. */
export function disposeEngraveOutline(): void {
  if (!outline) return;
  getScene().remove(outline);
  outline.geometry.dispose();
  (outline.material as THREE.Material).dispose();
  outline = null;
}
