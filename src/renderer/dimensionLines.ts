// Bounding box dimension annotations — shows X, Y, Z extent with lines and labels
import * as THREE from 'three';
import { formatDimension } from '../geometry/units';

let dimensionGroup: THREE.Group | null = null;
let visible = true;
let currentMaxDim = 1;

export function initDimensionLines(scene: THREE.Scene): void {
  dimensionGroup = new THREE.Group();
  dimensionGroup.name = 'dimension-lines';
  scene.add(dimensionGroup);
}

export function setDimensionsVisible(v: boolean): void {
  visible = v;
  if (dimensionGroup) dimensionGroup.visible = v;
}

export function isDimensionsVisible(): boolean {
  return visible;
}

export function updateDimensionLines(box: THREE.Box3): void {
  clearGroup();
  if (!dimensionGroup || !visible) return;

  const min = box.min;
  const max = box.max;
  const size = box.getSize(new THREE.Vector3());

  if (size.x === 0 && size.y === 0 && size.z === 0) return;

  currentMaxDim = Math.max(size.x, size.y, size.z);
  const off = currentMaxDim * 0.15; // offset from model to dimension line

  // Layout: three dimension lines meeting at corner (max.x + off, min.y - off, min.z - off)
  // X runs left, Y runs back, Z runs up — visible from default isometric view

  // X dimension — bottom front edge, offset in -Y and -Z
  if (size.x > 0.001) {
    const dy = min.y - off;
    const dz = min.z - off;
    // Extension lines from model corners to dimension line
    addExtLine(new THREE.Vector3(min.x, min.y, min.z), new THREE.Vector3(min.x, dy, dz));
    addExtLine(new THREE.Vector3(max.x, min.y, min.z), new THREE.Vector3(max.x, dy, dz));
    // Dimension line
    addDimLine(new THREE.Vector3(min.x, dy, dz), new THREE.Vector3(max.x, dy, dz));
    // Label
    addLabel(new THREE.Vector3((min.x + max.x) / 2, dy, dz), formatDimension(size.x));
  }

  // Y dimension — bottom right edge, offset in +X and -Z
  if (size.y > 0.001) {
    const dx = max.x + off;
    const dz = min.z - off;
    addExtLine(new THREE.Vector3(max.x, min.y, min.z), new THREE.Vector3(dx, min.y, dz));
    addExtLine(new THREE.Vector3(max.x, max.y, min.z), new THREE.Vector3(dx, max.y, dz));
    addDimLine(new THREE.Vector3(dx, min.y, dz), new THREE.Vector3(dx, max.y, dz));
    addLabel(new THREE.Vector3(dx, (min.y + max.y) / 2, dz), formatDimension(size.y));
  }

  // Z dimension — right front vertical, offset in +X and -Y
  if (size.z > 0.001) {
    const dx = max.x + off;
    const dy = min.y - off;
    addExtLine(new THREE.Vector3(max.x, min.y, min.z), new THREE.Vector3(dx, dy, min.z));
    addExtLine(new THREE.Vector3(max.x, min.y, max.z), new THREE.Vector3(dx, dy, max.z));
    addDimLine(new THREE.Vector3(dx, dy, min.z), new THREE.Vector3(dx, dy, max.z));
    addLabel(new THREE.Vector3(dx, dy, (min.z + max.z) / 2), formatDimension(size.z));
  }
}

function addExtLine(from: THREE.Vector3, to: THREE.Vector3): void {
  if (!dimensionGroup) return;
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const mat = new THREE.LineBasicMaterial({ color: 0x888888, transparent: true, opacity: 0.25, depthTest: false });
  const line = new THREE.Line(geo, mat);
  line.renderOrder = 100;
  dimensionGroup.add(line);
}

function addDimLine(from: THREE.Vector3, to: THREE.Vector3): void {
  if (!dimensionGroup) return;
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const mat = new THREE.LineBasicMaterial({ color: 0xaaaaaa, transparent: true, opacity: 0.5, depthTest: false });
  const line = new THREE.Line(geo, mat);
  line.renderOrder = 100;
  dimensionGroup.add(line);

  // Tick marks at each end — small perpendicular lines
  const dir = new THREE.Vector3().subVectors(to, from).normalize();
  const tick = currentMaxDim * 0.025;

  // Pick a perpendicular direction for the tick
  const up = new THREE.Vector3(0, 0, 1);
  let perp = new THREE.Vector3().crossVectors(dir, up);
  if (perp.lengthSq() < 0.001) {
    perp = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0));
  }
  perp.normalize().multiplyScalar(tick);

  for (const pt of [from, to]) {
    const tGeo = new THREE.BufferGeometry().setFromPoints([
      pt.clone().add(perp),
      pt.clone().sub(perp),
    ]);
    const tMat = new THREE.LineBasicMaterial({ color: 0xaaaaaa, transparent: true, opacity: 0.5, depthTest: false });
    const tLine = new THREE.Line(tGeo, tMat);
    tLine.renderOrder = 100;
    dimensionGroup.add(tLine);
  }
}

function addLabel(position: THREE.Vector3, text: string): void {
  if (!dimensionGroup) return;

  const canvas = document.createElement('canvas');
  const size = 128;
  canvas.width = size;
  canvas.height = size / 2;
  const ctx = canvas.getContext('2d')!;

  // Background pill
  ctx.fillStyle = 'rgba(30, 30, 50, 0.6)';
  const pad = 6;
  ctx.font = 'bold 22px system-ui, sans-serif';
  const tw = ctx.measureText(text).width;
  const rx = (size - tw) / 2 - pad;
  const ry = size / 4 - 14;
  const rw = tw + pad * 2;
  const rh = 28;
  ctx.beginPath();
  ctx.roundRect(rx, ry, rw, rh, 4);
  ctx.fill();

  // Text
  ctx.fillStyle = '#cccccc';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, size / 2, size / 4);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.position.copy(position);

  const scale = currentMaxDim * 0.07;
  sprite.scale.set(scale * 2, scale, 1);
  sprite.renderOrder = 101;
  dimensionGroup.add(sprite);
}

function clearGroup(): void {
  if (!dimensionGroup) return;
  while (dimensionGroup.children.length > 0) {
    const child = dimensionGroup.children[0];
    dimensionGroup.remove(child);
    if (child instanceof THREE.Line) {
      child.geometry.dispose();
      (child.material as THREE.Material).dispose();
    } else if (child instanceof THREE.Sprite) {
      child.material.map?.dispose();
      child.material.dispose();
    }
  }
}

