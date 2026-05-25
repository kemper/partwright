// Slab drag — interactive slab painting. The user picks an axis (X/Y/Z),
// hovers the model to see a translucent cuboid showing where the slab will be,
// then click-drags along the model surface to extend the slab from a start
// coordinate to an end coordinate. Releasing the mouse commits the slab as a
// paint region.

import * as THREE from 'three';
import type { MeshData } from '../geometry/types';
import { getMeshGroup, getRenderer, getCamera } from '../renderer/viewport';
import { addRegion, getRegions } from './regions';
import { findSlabTriangles, projectionRange, AXIS_NORMALS } from './slabPaint';
import { getColor, getCurrentMesh, shapeSmoothDescriptorFields } from './paintMode';

export type SlabAxis = 'x' | 'y' | 'z';

let active = false;
let axis: SlabAxis = 'z';
let cuboid: THREE.Mesh | null = null;
let edges: THREE.LineSegments | null = null;

// Drag state
let dragging = false;
let dragStart: number | null = null;
let dragEnd: number | null = null;
let hoverCoord: number | null = null;

// Cached mesh range for the active axis (recomputed when mesh or axis changes)
let cachedRange: { min: number; max: number } | null = null;

const raycaster = new THREE.Raycaster();
const mouseVec = new THREE.Vector2();

export function setSlabAxis(a: SlabAxis): void {
  axis = a;
  cachedRange = null;
  rebuildCuboid();
  refreshVisual();
}

export function getSlabAxis(): SlabAxis {
  return axis;
}

export function activate(): void {
  if (active) return;
  active = true;

  cachedRange = null;
  rebuildCuboid();

  const canvas = getRenderer().domElement;
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('mouseleave', onMouseLeave);
}

export function deactivate(): void {
  if (!active) return;
  active = false;
  dragging = false;
  dragStart = null;
  dragEnd = null;
  hoverCoord = null;

  const canvas = getRenderer().domElement;
  canvas.removeEventListener('mousemove', onMouseMove);
  canvas.removeEventListener('mousedown', onMouseDown);
  canvas.removeEventListener('mouseup', onMouseUp);
  canvas.removeEventListener('mouseleave', onMouseLeave);

  disposeCuboid();
}

function ensureRange(mesh: MeshData): { min: number; max: number } {
  if (cachedRange) return cachedRange;
  cachedRange = projectionRange(mesh, AXIS_NORMALS[axis]);
  return cachedRange;
}

function rebuildCuboid(): void {
  disposeCuboid();
  const mesh = getCurrentMesh();
  if (!mesh) return;

  const range = ensureRange(mesh);
  const lateral = lateralAxes(axis);
  const a = projectionRange(mesh, AXIS_NORMALS[lateral[0]]);
  const b = projectionRange(mesh, AXIS_NORMALS[lateral[1]]);

  // Pad lateral dimensions so the cuboid extends slightly past the model.
  const padA = Math.max((a.max - a.min) * 0.02, 0.01);
  const padB = Math.max((b.max - b.min) * 0.02, 0.01);

  // Box geometry sized in world units. Default thickness = 1; we'll scale
  // along the slab normal each frame.
  const sizes = { x: 1, y: 1, z: 1 };
  sizes[lateral[0]] = (a.max - a.min) + padA * 2;
  sizes[lateral[1]] = (b.max - b.min) + padB * 2;

  const color = colorToHex(getColor());

  const geo = new THREE.BoxGeometry(sizes.x, sizes.y, sizes.z);
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.18,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  cuboid = new THREE.Mesh(geo, mat);
  cuboid.name = 'slab-cuboid';
  cuboid.renderOrder = 998;
  cuboid.visible = false;
  getMeshGroup().add(cuboid);

  // Wireframe edges for clearer slab boundary
  const edgeGeo = new THREE.EdgesGeometry(geo);
  const edgeMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.7, depthTest: false });
  edges = new THREE.LineSegments(edgeGeo, edgeMat);
  edges.name = 'slab-cuboid-edges';
  edges.renderOrder = 999;
  edges.visible = false;
  getMeshGroup().add(edges);

  // Center the box in the lateral axes; slab axis position is updated each frame
  const centerLateral = (k: 'x' | 'y' | 'z'): number => {
    const r = projectionRange(mesh, AXIS_NORMALS[k]);
    return (r.min + r.max) / 2;
  };
  const cx = axis === 'x' ? 0 : centerLateral('x');
  const cy = axis === 'y' ? 0 : centerLateral('y');
  const cz = axis === 'z' ? 0 : centerLateral('z');
  cuboid.position.set(cx, cy, cz);
  edges.position.set(cx, cy, cz);
  // Initial scale on slab axis is 0 (invisible until hover/drag sets it)
  setSlabAxisScale(0, range.min);
}

function disposeCuboid(): void {
  if (cuboid) {
    getMeshGroup().remove(cuboid);
    cuboid.geometry.dispose();
    (cuboid.material as THREE.Material).dispose();
    cuboid = null;
  }
  if (edges) {
    getMeshGroup().remove(edges);
    edges.geometry.dispose();
    (edges.material as THREE.Material).dispose();
    edges = null;
  }
}

function lateralAxes(a: SlabAxis): [SlabAxis, SlabAxis] {
  if (a === 'x') return ['y', 'z'];
  if (a === 'y') return ['x', 'z'];
  return ['x', 'y'];
}

function setSlabAxisScale(thickness: number, center: number): void {
  if (!cuboid || !edges) return;
  const scaleProp = axis;
  cuboid.scale[scaleProp] = Math.max(thickness, 0.0001);
  edges.scale[scaleProp] = Math.max(thickness, 0.0001);
  cuboid.position[scaleProp] = center;
  edges.position[scaleProp] = center;
  const visible = thickness > 0;
  cuboid.visible = visible;
  edges.visible = visible;
}

function refreshVisual(): void {
  // Re-add the cuboid if a viewport refresh detached it.
  if (cuboid && !cuboid.parent) getMeshGroup().add(cuboid);
  if (edges && !edges.parent) getMeshGroup().add(edges);
  if (!cuboid) return;
  let lo: number;
  let hi: number;

  if (dragging && dragStart !== null && dragEnd !== null) {
    lo = Math.min(dragStart, dragEnd);
    hi = Math.max(dragStart, dragEnd);
  } else if (hoverCoord !== null) {
    // No drag in progress — show a thin preview slab at the cursor coord.
    const mesh = getCurrentMesh();
    const span = mesh ? Math.max(0.01, ensureRange(mesh).max - ensureRange(mesh).min) : 1;
    const halfThickness = span * 0.005;
    lo = hoverCoord - halfThickness;
    hi = hoverCoord + halfThickness;
  } else {
    setSlabAxisScale(0, 0);
    return;
  }

  setSlabAxisScale(hi - lo, (lo + hi) / 2);

  // Update colors in case the active paint color changed
  const color = colorToHex(getColor());
  if (cuboid) (cuboid.material as THREE.MeshBasicMaterial).color.setHex(color);
  if (edges) (edges.material as THREE.LineBasicMaterial).color.setHex(color);
}

function pickAxisCoord(event: MouseEvent): number | null {
  const canvas = getRenderer().domElement;
  const rect = canvas.getBoundingClientRect();
  mouseVec.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouseVec.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  const camera = getCamera();
  raycaster.setFromCamera(mouseVec, camera);

  const meshGroup = getMeshGroup();
  const solidMesh = meshGroup.children[0];
  if (!(solidMesh instanceof THREE.Mesh)) return null;

  const intersections = raycaster.intersectObject(solidMesh);
  if (intersections.length === 0) return null;

  const hit = intersections[0].point;
  return axis === 'x' ? hit.x : axis === 'y' ? hit.y : hit.z;
}

function onMouseMove(event: MouseEvent): void {
  if (!active) return;

  const coord = pickAxisCoord(event);

  if (dragging) {
    if (coord !== null) {
      dragEnd = coord;
      refreshVisual();
    }
    // If no hit during drag, hold the previous dragEnd value.
    return;
  }

  hoverCoord = coord;
  refreshVisual();
}

function onMouseDown(event: MouseEvent): void {
  if (!active) return;
  if (event.button !== 0) return;

  const coord = pickAxisCoord(event);
  if (coord === null) return;

  dragging = true;
  dragStart = coord;
  dragEnd = coord;
  refreshVisual();
  event.preventDefault();
}

function onMouseUp(event: MouseEvent): void {
  if (!active) return;
  if (event.button !== 0) return;
  if (!dragging) return;

  dragging = false;

  if (dragStart !== null && dragEnd !== null) {
    const offset = Math.min(dragStart, dragEnd);
    const thickness = Math.max(dragStart, dragEnd) - offset;
    if (thickness > 0) {
      commitSlab(offset, thickness);
    }
  }

  dragStart = null;
  dragEnd = null;
  refreshVisual();
}

function onMouseLeave(): void {
  if (!active) return;
  // If the user releases their mouse outside the canvas, commit what we have.
  if (dragging && dragStart !== null && dragEnd !== null) {
    const offset = Math.min(dragStart, dragEnd);
    const thickness = Math.max(dragStart, dragEnd) - offset;
    if (thickness > 0) commitSlab(offset, thickness);
  }
  dragging = false;
  dragStart = null;
  dragEnd = null;
  hoverCoord = null;
  refreshVisual();
}

function commitSlab(offset: number, thickness: number): void {
  const mesh = getCurrentMesh();
  if (!mesh) return;

  const normal = AXIS_NORMALS[axis];
  const triangles = findSlabTriangles(mesh, normal, offset, thickness);
  if (triangles.size === 0) return;

  const existingCount = getRegions().length;
  const name = `Slab ${axis.toUpperCase()} ${existingCount + 1}`;
  const { smooth, maxEdge } = shapeSmoothDescriptorFields(mesh);
  addRegion(
    name,
    [...getColor()] as [number, number, number],
    'slab',
    { kind: 'slab', normal: [...normal] as [number, number, number], offset, thickness, smooth, maxEdge },
    triangles,
  );
}

function colorToHex(color: [number, number, number]): number {
  const r = Math.round(Math.max(0, Math.min(1, color[0])) * 255);
  const g = Math.round(Math.max(0, Math.min(1, color[1])) * 255);
  const b = Math.round(Math.max(0, Math.min(1, color[2])) * 255);
  return (r << 16) | (g << 8) | b;
}

/** Notify the drag controller that the underlying mesh changed so it can
 *  rebuild its cuboid against the new bounds. */
export function onMeshChanged(): void {
  if (!active) return;
  cachedRange = null;
  rebuildCuboid();
}
