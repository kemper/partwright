// Measurement visualization — line + label overlay in viewport
import * as THREE from 'three';
import { formatDimension } from '../geometry/units';

let measureGroup: THREE.Group | null = null;
let labelEl: HTMLElement | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let renderer: THREE.WebGLRenderer | null = null;
// Retained references for efficient updates during drag
let lineObj: THREE.Line | null = null;
let sphere1: THREE.Mesh | null = null;
let sphere2: THREE.Mesh | null = null;
let storedP1: THREE.Vector3 | null = null;

export function initMeasureOverlay(
  scene: THREE.Scene,
  cam: THREE.PerspectiveCamera,
  ren: THREE.WebGLRenderer,
): void {
  camera = cam;
  renderer = ren;

  measureGroup = new THREE.Group();
  measureGroup.name = 'measure-overlay';
  scene.add(measureGroup);
}

/** Create the measurement visual for point 1 (start of drag). */
export function startMeasurement(p1: THREE.Vector3, container: HTMLElement): void {
  clearMeasurement();
  if (!measureGroup || !camera || !renderer) return;
  storedP1 = p1.clone();

  const sphereGeo = new THREE.SphereGeometry(0.15, 8, 8);
  const sphereMat = new THREE.MeshBasicMaterial({ color: 0xffdd00, depthTest: false });

  sphere1 = new THREE.Mesh(sphereGeo, sphereMat);
  sphere1.position.copy(p1);
  sphere1.renderOrder = 999;
  measureGroup.add(sphere1);

  sphere2 = new THREE.Mesh(sphereGeo.clone(), sphereMat.clone());
  sphere2.position.copy(p1);
  sphere2.renderOrder = 999;
  measureGroup.add(sphere2);

  // Dashed line (initially zero-length)
  const geometry = new THREE.BufferGeometry().setFromPoints([p1, p1]);
  const material = new THREE.LineDashedMaterial({
    color: 0xffdd00,
    dashSize: 0.5,
    gapSize: 0.25,
    depthTest: false,
    linewidth: 2,
  });
  lineObj = new THREE.Line(geometry, material);
  lineObj.computeLineDistances();
  lineObj.renderOrder = 999;
  measureGroup.add(lineObj);

  // Label (initially hidden)
  labelEl = document.createElement('div');
  labelEl.className = 'absolute pointer-events-none px-2 py-1 rounded text-xs font-mono font-bold z-50';
  labelEl.style.cssText = 'background: rgba(255,221,0,0.9); color: #1a1a2e; transform: translate(-50%, -100%); white-space: nowrap; display: none;';
  container.style.position = 'relative';
  container.appendChild(labelEl);
}

/** Update the measurement target (point 2) during drag. Fast — no allocation. */
export function updateMeasurementTarget(p2: THREE.Vector3, distance: number): void {
  if (!lineObj || !sphere2 || !storedP1 || !camera || !renderer || !labelEl) return;

  // Update sphere position
  sphere2.position.copy(p2);

  // Update line geometry
  const positions = lineObj.geometry.attributes.position as THREE.BufferAttribute;
  positions.setXYZ(1, p2.x, p2.y, p2.z);
  positions.needsUpdate = true;
  lineObj.geometry.computeBoundingSphere();
  lineObj.computeLineDistances();

  // Update label
  labelEl.textContent = formatDimension(distance);
  labelEl.style.display = '';

  // Position label in screen space at midpoint
  const mid = new THREE.Vector3().addVectors(storedP1, p2).multiplyScalar(0.5);
  const projected = mid.clone().project(camera);
  const canvas = renderer.domElement;
  const x = (projected.x * 0.5 + 0.5) * canvas.clientWidth;
  const y = (-projected.y * 0.5 + 0.5) * canvas.clientHeight;
  labelEl.style.left = `${x}px`;
  labelEl.style.top = `${y}px`;
}

/** Show a complete measurement (legacy — used for finalized state). */

export function clearMeasurement(): void {
  if (measureGroup) {
    while (measureGroup.children.length > 0) {
      const child = measureGroup.children[0];
      measureGroup.remove(child);
      if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    }
  }
  if (labelEl) {
    labelEl.remove();
    labelEl = null;
  }
  lineObj = null;
  sphere1 = null;
  sphere2 = null;
  storedP1 = null;
}
