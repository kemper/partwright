// Phantom/Reference Geometry — translucent overlay for fitment checking
// Lives in a separate THREE.Group in the viewport scene, excluded from exports
import * as THREE from 'three';
import type { MeshData } from '../geometry/types';
import { requestRender } from './viewport';
import { meshDataToGeometry } from './meshGeometry';

let phantomGroup: THREE.Group | null = null;

export interface PhantomOptions {
  color?: number;
  opacity?: number;
  wireframe?: boolean;
}

export function initPhantomGroup(scene: THREE.Scene): THREE.Group {
  phantomGroup = new THREE.Group();
  phantomGroup.name = 'phantom-reference';
  scene.add(phantomGroup);
  return phantomGroup;
}

export function setPhantom(meshData: MeshData, options?: PhantomOptions): void {
  if (!phantomGroup) return;

  clearPhantom();

  const geometry = meshDataToGeometry(meshData);

  const material = new THREE.MeshPhongMaterial({
    color: options?.color ?? 0x00ff88,
    transparent: true,
    opacity: options?.opacity ?? 0.25,
    side: THREE.DoubleSide,
    depthWrite: false,
    wireframe: options?.wireframe ?? false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  phantomGroup.add(mesh);

  if (options?.wireframe === undefined || !options.wireframe) {
    // Add wireframe overlay for better visibility
    const wireMat = new THREE.MeshBasicMaterial({
      color: options?.color ?? 0x00ff88,
      transparent: true,
      opacity: Math.min((options?.opacity ?? 0.25) * 1.5, 0.6),
      wireframe: true,
    });
    const wireMesh = new THREE.Mesh(geometry, wireMat);
    phantomGroup.add(wireMesh);
  }

  // With on-demand rendering, a programmatic (console/AI) setReferenceGeometry
  // call has no pointer event or mesh re-render to repaint it — request one.
  requestRender();
}

export function clearPhantom(): void {
  if (!phantomGroup) return;

  while (phantomGroup.children.length > 0) {
    const child = phantomGroup.children[0];
    phantomGroup.remove(child);
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach(m => m.dispose());
      } else {
        child.material.dispose();
      }
    }
  }
  requestRender();
}

export function hasPhantom(): boolean {
  return (phantomGroup?.children.length ?? 0) > 0;
}
