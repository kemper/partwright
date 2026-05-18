// Paint mode — coordinates face picking, hover preview, and color application.
// Supports three tools: bucket (coplanar flood fill), brush (single face), slab (axis/normal range).

import * as THREE from 'three';
import type { MeshData } from '../geometry/types';
import { pickFace } from './facePicker';
import { buildAdjacency, findCoplanarRegion, getTriangleNormal, type AdjacencyGraph } from './adjacency';
import { addRegion, getRegions } from './regions';
import { getScene, getMeshGroup, getRenderer, addPointerSuppressor, isPointerOverModel } from '../renderer/viewport';
import { activate as activateSlabDrag, deactivate as deactivateSlabDrag, onMeshChanged as onSlabDragMeshChanged } from './slabDrag';
import { activate as activateBoxDrag, deactivate as deactivateBoxDrag, onMeshChanged as onBoxDragMeshChanged } from './boxDrag';
export { setSlabAxis, getSlabAxis } from './slabDrag';

export type PaintTool = 'bucket' | 'brush' | 'slab' | 'box';
export type BrushShape = 'circle' | 'square' | 'diamond';

let active = false;
let currentColor: [number, number, number] = [1, 0.2, 0.2]; // default red
let currentTool: PaintTool = 'bucket';
let bucketTolerance = 0.9995;
/** Brush radius in mesh units. 0 = single-triangle (legacy behavior); >0 = paint
 *  every triangle whose centroid is within `brushRadius` of the picked surface
 *  point. */
let brushRadius = 0;
let brushShape: BrushShape = 'circle';
let adjacency: AdjacencyGraph | null = null;
let currentMesh: MeshData | null = null;

// Hover highlight state
let highlightMesh: THREE.Mesh | null = null;
let hoveredTriangles: Set<number> | null = null;

// Brush ring indicator — outline showing the brush footprint in world space
let brushRingMesh: THREE.LineLoop | null = null;
let brushRingBuiltRadius = -1;
let brushRingBuiltShape: BrushShape | '' = '';

// Brush drag state
let brushPainting = false;
let brushSession: Set<number> | null = null;

// True when the active mousedown missed the model. We let OrbitControls
// rotate in that case and skip the matching mouseup paint commit so a
// rotation that happens to release over the model doesn't paint by accident.
let mouseDownOffModel = false;

// Teardown for the capture-phase pointer suppressor registered on activate.
let removeSuppressor: (() => void) | null = null;

// Callbacks
let onRegionPainted: (() => void) | null = null;
let onToolChange: ((tool: PaintTool) => void) | null = null;

export function isActive(): boolean { return active; }

export function setColor(color: [number, number, number]): void {
  currentColor = color;
}

export function getColor(): [number, number, number] {
  return currentColor;
}

export function setTool(tool: PaintTool): void {
  if (currentTool === tool) return;
  const prev = currentTool;
  currentTool = tool;
  clearHighlight();

  if (active) {
    if (tool === 'slab') activateSlabDrag();
    else if (prev === 'slab') deactivateSlabDrag();
    if (tool === 'box') activateBoxDrag();
    else if (prev === 'box') deactivateBoxDrag();
  }

  if (onToolChange) onToolChange(tool);
}

export function getTool(): PaintTool {
  return currentTool;
}

export function setBucketTolerance(tol: number): void {
  bucketTolerance = Math.max(-1, Math.min(1, tol));
}

export function getBucketTolerance(): number {
  return bucketTolerance;
}

export function setBrushRadius(r: number): void {
  brushRadius = Math.max(0, r);
}

export function getBrushRadius(): number {
  return brushRadius;
}

export function setBrushShape(s: BrushShape): void {
  brushShape = s;
}

export function getBrushShape(): BrushShape {
  return brushShape;
}

export function setOnRegionPainted(fn: () => void): void {
  onRegionPainted = fn;
}

export function setOnToolChange(fn: (tool: PaintTool) => void): void {
  onToolChange = fn;
}

export function getCurrentMesh(): MeshData | null {
  return currentMesh;
}

export function getAdjacency(): AdjacencyGraph | null {
  return adjacency;
}

/** Rebuild adjacency graph for a new mesh. Call this whenever updateMesh fires. */
export function updatePaintMesh(mesh: MeshData): void {
  currentMesh = mesh;
  if (active) {
    adjacency = buildAdjacency(mesh);
    onSlabDragMeshChanged();
    onBoxDragMeshChanged();
  }
  clearHighlight();
}

export function activate(): void {
  if (active) return;
  active = true;

  if (currentMesh) {
    adjacency = buildAdjacency(currentMesh);
  }

  // Veto OrbitControls only for left-button pointerdowns that hit the model
  // and only when a tool wants the click. Off-model clicks fall through so
  // OrbitControls can rotate; the Box tool's gizmo owns its own drag.
  removeSuppressor = addPointerSuppressor((event) => {
    if (event.button !== 0) return false;
    if (currentTool === 'box') return false;
    return isPointerOverModel(event);
  });

  const canvas = getRenderer().domElement;
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('mouseleave', onMouseLeave);
  canvas.style.cursor = 'crosshair';

  if (currentTool === 'slab') activateSlabDrag();
  if (currentTool === 'box') activateBoxDrag();
}

export function deactivate(): void {
  if (!active) return;
  active = false;
  adjacency = null;

  if (removeSuppressor) { removeSuppressor(); removeSuppressor = null; }

  deactivateSlabDrag();
  deactivateBoxDrag();

  const canvas = getRenderer().domElement;
  canvas.removeEventListener('mousemove', onMouseMove);
  canvas.removeEventListener('mousedown', onMouseDown);
  canvas.removeEventListener('mouseup', onMouseUp);
  canvas.removeEventListener('mouseleave', onMouseLeave);
  canvas.style.cursor = '';
  clearHighlight();
  clearBrushRing();
  brushPainting = false;
  brushSession = null;
  mouseDownOffModel = false;
}

function onMouseMove(event: MouseEvent): void {
  if (!adjacency || !currentMesh) return;

  // Slab and box tools own their own gizmo / drag interactions; the
  // bucket-vs-brush hover preview gets out of the way.
  if (currentTool === 'slab' || currentTool === 'box') {
    clearHighlight();
    return;
  }

  // Mid-rotation (mousedown landed off the model) — skip hover preview so
  // the highlight doesn't flicker on top of the model as the camera spins.
  if (mouseDownOffModel) {
    clearHighlight();
    return;
  }

  // Brush drag: collect triangles into the active brush session.
  if (currentTool === 'brush' && brushPainting && brushSession) {
    const result = pickFace(event);
    if (result) {
      addBrushFootprint(result.triangleIndex, result.point, brushSession);
      showHighlight(brushSession);
      // Ring must come after showHighlight (which calls clearHighlight internally).
      if (brushRadius > 0) showBrushRing(result.point, result.normal);
      else clearBrushRing();
    } else {
      clearBrushRing();
    }
    return;
  }

  const result = pickFace(event);
  if (!result) {
    clearHighlight();
    clearBrushRing();
    return;
  }

  let region: Set<number>;
  if (currentTool === 'brush') {
    region = new Set<number>();
    addBrushFootprint(result.triangleIndex, result.point, region);
  } else {
    clearBrushRing();
    region = findCoplanarRegion(result.triangleIndex, adjacency, bucketTolerance);
  }

  if (hoveredTriangles && setsEqual(hoveredTriangles, region)) {
    // Triangles unchanged — just update ring position without rebuilding highlight.
    if (currentTool === 'brush' && brushRadius > 0) showBrushRing(result.point, result.normal);
    return;
  }

  hoveredTriangles = region;
  showHighlight(region);
  // Ring must come after showHighlight.
  if (currentTool === 'brush' && brushRadius > 0) showBrushRing(result.point, result.normal);
  else if (currentTool === 'brush') clearBrushRing();
}

function onMouseDown(event: MouseEvent): void {
  if (!adjacency || !currentMesh) return;
  if (event.button !== 0) return;
  if (currentTool === 'slab' || currentTool === 'box') return;

  // Off-model click → OrbitControls is rotating; remember so mouseup doesn't
  // paint if the user happens to release over the model after a rotation.
  const result = pickFace(event);
  if (!result) {
    mouseDownOffModel = true;
    return;
  }
  mouseDownOffModel = false;

  if (currentTool === 'brush') {
    brushPainting = true;
    brushSession = new Set<number>();
    addBrushFootprint(result.triangleIndex, result.point, brushSession);
    showHighlight(brushSession);
    event.preventDefault();
  }
}

/** Expand a single picked triangle into the brush's full footprint.
 *  At brushRadius=0 this just adds the picked triangle.
 *  At brushRadius>0 the footprint shape is controlled by brushShape:
 *    circle  — sphere test: distance ≤ radius
 *    square  — cube test:   |dx|, |dy|, |dz| all ≤ radius
 *    diamond — L1 test:     |dx|+|dy|+|dz| ≤ radius */
function addBrushFootprint(seedTri: number, seedPoint: [number, number, number], target: Set<number>): void {
  target.add(seedTri);
  if (brushRadius <= 0 || !adjacency) return;

  const { centroids } = adjacency;
  const numTri = centroids.length / 3;
  const r = brushRadius;
  const r2 = r * r;
  const sx = seedPoint[0], sy = seedPoint[1], sz = seedPoint[2];

  for (let t = 0; t < numTri; t++) {
    if (target.has(t)) continue;
    const dx = centroids[t * 3]     - sx;
    const dy = centroids[t * 3 + 1] - sy;
    const dz = centroids[t * 3 + 2] - sz;
    let inside: boolean;
    if (brushShape === 'square') {
      inside = Math.abs(dx) <= r && Math.abs(dy) <= r && Math.abs(dz) <= r;
    } else if (brushShape === 'diamond') {
      inside = Math.abs(dx) + Math.abs(dy) + Math.abs(dz) <= r;
    } else {
      inside = dx * dx + dy * dy + dz * dz <= r2;
    }
    if (inside) target.add(t);
  }
}

// ---------------------------------------------------------------------------
// Brush ring indicator
// ---------------------------------------------------------------------------

function buildRingPoints(shape: BrushShape, r: number): THREE.Vector3[] {
  if (shape === 'square') {
    return [
      new THREE.Vector3(-r, -r, 0),
      new THREE.Vector3( r, -r, 0),
      new THREE.Vector3( r,  r, 0),
      new THREE.Vector3(-r,  r, 0),
    ];
  }
  if (shape === 'diamond') {
    return [
      new THREE.Vector3( 0, -r, 0),
      new THREE.Vector3( r,  0, 0),
      new THREE.Vector3( 0,  r, 0),
      new THREE.Vector3(-r,  0, 0),
    ];
  }
  // circle — LineLoop auto-closes, so stop before 2π
  const pts: THREE.Vector3[] = [];
  const segments = 48;
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0));
  }
  return pts;
}

function showBrushRing(point: [number, number, number], normal: [number, number, number]): void {
  if (brushRadius <= 0) { clearBrushRing(); return; }

  // Rebuild when radius or shape changes.
  if (!brushRingMesh || brushRingBuiltRadius !== brushRadius || brushRingBuiltShape !== brushShape) {
    clearBrushRing();
    brushRingBuiltRadius = brushRadius;
    brushRingBuiltShape = brushShape;
    const geo = new THREE.BufferGeometry().setFromPoints(buildRingPoints(brushShape, brushRadius));
    const mat = new THREE.LineBasicMaterial({ color: 0xffffff, opacity: 0.75, transparent: true, depthTest: false });
    brushRingMesh = new THREE.LineLoop(geo, mat);
    brushRingMesh.name = 'brush-ring';
    brushRingMesh.renderOrder = 1001;
    getScene().add(brushRingMesh);
  }

  brushRingMesh.position.set(point[0], point[1], point[2]);
  const nrm = new THREE.Vector3(normal[0], normal[1], normal[2]).normalize();
  brushRingMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), nrm);
}

function clearBrushRing(): void {
  if (brushRingMesh) {
    brushRingMesh.parent?.remove(brushRingMesh);
    brushRingMesh.geometry.dispose();
    (brushRingMesh.material as THREE.Material).dispose();
    brushRingMesh = null;
    brushRingBuiltRadius = -1;
    brushRingBuiltShape = '';
  }
}

function onMouseUp(event: MouseEvent): void {
  if (!adjacency || !currentMesh) return;
  if (event.button !== 0) return;
  if (currentTool === 'slab' || currentTool === 'box') return;

  if (mouseDownOffModel) {
    mouseDownOffModel = false;
    return;
  }

  if (currentTool === 'brush') {
    if (!brushPainting || !brushSession || brushSession.size === 0) {
      brushPainting = false;
      brushSession = null;
      return;
    }
    const triangles = brushSession;
    const existingCount = getRegions().length;
    addRegion(
      `Region ${existingCount + 1}`,
      [...currentColor] as [number, number, number],
      'paintbrush',
      { kind: 'triangles', ids: [...triangles] },
      triangles,
    );
    brushPainting = false;
    brushSession = null;
    clearHighlight();
    if (onRegionPainted) onRegionPainted();
    return;
  }

  // Bucket: paint on click release (matches the previous click behavior)
  const result = pickFace(event);
  if (!result) return;

  const region = findCoplanarRegion(result.triangleIndex, adjacency, bucketTolerance);
  const normal = getTriangleNormal(result.triangleIndex, adjacency);

  const existingCount = getRegions().length;
  addRegion(
    `Region ${existingCount + 1}`,
    [...currentColor] as [number, number, number],
    'face-pick',
    {
      kind: 'coplanar',
      seedPoint: result.point,
      seedNormal: normal,
      normalTolerance: bucketTolerance,
    },
    region,
  );

  clearHighlight();
  if (onRegionPainted) onRegionPainted();
}

function onMouseLeave(): void {
  if (currentTool === 'brush' && brushPainting && brushSession && brushSession.size > 0) {
    const triangles = brushSession;
    const existingCount = getRegions().length;
    addRegion(
      `Region ${existingCount + 1}`,
      [...currentColor] as [number, number, number],
      'paintbrush',
      { kind: 'triangles', ids: [...triangles] },
      triangles,
    );
    if (onRegionPainted) onRegionPainted();
  }
  brushPainting = false;
  brushSession = null;
  clearHighlight();
  clearBrushRing();
}

/** Public helper: render a hover-style highlight over a triangle set.
 *  Used by the slab UI for live preview and by the region list for
 *  hover-to-locate. Optional `color` overrides the active paint color
 *  (defaults to whatever `setColor` last received). Returns a teardown
 *  function. */
export function previewTriangles(triangles: Set<number>, color?: [number, number, number]): () => void {
  showHighlight(triangles, color);
  return () => clearHighlight();
}

function showHighlight(triangles: Set<number>, colorOverride?: [number, number, number]): void {
  clearHighlight();
  if (!currentMesh) return;
  if (triangles.size === 0) return;

  const { triVerts, vertProperties, numProp } = currentMesh;

  const positions = new Float32Array(triangles.size * 9);
  let idx = 0;

  for (const t of triangles) {
    const v0 = triVerts[t * 3];
    const v1 = triVerts[t * 3 + 1];
    const v2 = triVerts[t * 3 + 2];

    for (const vi of [v0, v1, v2]) {
      positions[idx++] = vertProperties[vi * numProp];
      positions[idx++] = vertProperties[vi * numProp + 1];
      positions[idx++] = vertProperties[vi * numProp + 2];
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.computeVertexNormals();

  const c = colorOverride ?? currentColor;
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(c[0], c[1], c[2]),
    transparent: true,
    opacity: 0.4,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });

  highlightMesh = new THREE.Mesh(geo, mat);
  highlightMesh.name = 'paint-hover';
  highlightMesh.renderOrder = 999;
  getMeshGroup().add(highlightMesh);
}

function clearHighlight(): void {
  if (highlightMesh) {
    getMeshGroup().remove(highlightMesh);
    highlightMesh.geometry.dispose();
    (highlightMesh.material as THREE.Material).dispose();
    highlightMesh = null;
  }
  hoveredTriangles = null;
}

function setsEqual(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}
