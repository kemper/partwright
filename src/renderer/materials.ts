import * as THREE from 'three';

export function createDefaultMaterial(vertexColors = false): THREE.MeshPhongMaterial {
  return new THREE.MeshPhongMaterial({
    color: vertexColors ? 0xffffff : 0x4a9eff,
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

// Crease/feature edges are far sparser than a full wireframe, so each line
// carries more meaning — render them more opaque than the 0.3 triangulation
// overlay so corners read crisply at small tile sizes. (linewidth is ignored
// by most WebGL drivers, so lines stay 1px; antialiasing softens them.)
export function createCreaseEdgeMaterial(): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.6,
  });
}
