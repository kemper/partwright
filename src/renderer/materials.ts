import * as THREE from 'three';

/** Built-in fallback color when no preference is supplied. Kept in sync
 *  with the `blue` entry in src/preferences.ts so the visual default
 *  remains consistent if a caller skips the override. */
const FALLBACK_COLOR = 0x4a9eff;

export function createDefaultMaterial(vertexColors = false, color = FALLBACK_COLOR): THREE.MeshPhongMaterial {
  return new THREE.MeshPhongMaterial({
    color: vertexColors ? 0xffffff : color,
    shininess: 40,
    side: THREE.DoubleSide,
    vertexColors,
  });
}

export function createWireframeMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: 0x000000,
    wireframe: true,
    transparent: true,
    opacity: 0.15,
  });
}

export function createWhiteMaterial(vertexColors = false): THREE.MeshPhongMaterial {
  return new THREE.MeshPhongMaterial({
    color: 0xffffff,
    shininess: 30,
    side: THREE.DoubleSide,
    vertexColors,
  });
}

export function createBlackWireframeMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: 0x000000,
    wireframe: true,
    transparent: true,
    opacity: 0.3,
  });
}
