// Paint mode — coordinates face picking, hover preview, and color application.
// Supports three tools: bucket (coplanar flood fill), brush (single face), slab (axis/normal range).

import * as THREE from 'three';
import type { MeshData } from '../geometry/types';
import { pickFace } from './facePicker';
import { buildAdjacency, findCoplanarRegion, getTriangleNormal, type AdjacencyGraph } from './adjacency';
import { addRegion, getRegions } from './regions';
import { getScene, getMeshGroup, getRenderer, addPointerSuppressor, isPointerOverModel, setWireframeVisible, isWireframeVisible } from '../renderer/viewport';
import { activate as activateSlabDrag, deactivate as deactivateSlabDrag, onMeshChanged as onSlabDragMeshChanged } from './slabDrag';
import { activate as activateBoxDrag, deactivate as deactivateBoxDrag, onMeshChanged as onBoxDragMeshChanged } from './boxDrag';
import type { BrushShape } from './subdivide';
export { setSlabAxis, getSlabAxis } from './slabDrag';

export type PaintTool = 'bucket' | 'brush' | 'slab' | 'box';
export type { BrushShape };

let active = false;
let currentColor: [number, number, number] = [1, 0.2, 0.2]; // default red
let currentTool: PaintTool = 'bucket';
let bucketTolerance = 0.9995;
/** Brush radius in mesh units. 0 = single-triangle (legacy behavior); >0 = paint
 *  every triangle whose centroid is within `brushRadius` of the picked surface
 *  point. */
let brushRadius = 0;
let brushShape: BrushShape = 'circle';
/** When on (and radius > 0), a brush stroke subdivides the triangles its edge
 *  crosses so the painted region's outline is smooth/rounded instead of
 *  following the existing tessellation. */
let brushSmooth = false;
/** Smooth-edge quality preset (1..4 = Coarse/Medium/Fine/Very fine). Maps to a
 *  target triangle edge of `brushRadius / SMOOTH_QUALITY_DIVISOR[level]`, so the
 *  refinement adapts to brush size and base-mesh coarseness rather than running
 *  a fixed number of passes. Higher = smoother edge + more triangles. */
let brushSmoothQuality = 3;
/** Divisor of the brush radius per quality level (index 1..4). */
const SMOOTH_QUALITY_DIVISOR: Record<number, number> = { 1: 4, 2: 8, 3: 16, 4: 32 };

/** Target edge length (mesh units) for the active brush settings. */
export function brushTargetEdge(): number {
  return brushRadius / (SMOOTH_QUALITY_DIVISOR[brushSmoothQuality] ?? 16);
}
/** Surface points sampled along the in-progress smooth stroke. */
let strokeSamples: [number, number, number][] = [];
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

// Wireframe edges are important for aiming paint, so paint mode forces them on
// and restores whatever the user had when it deactivates.
let wireframeBeforePaint = false;

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
  if (tool !== 'brush') clearBrushRing(); // ring is brush-only; don't leave it in the scene

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

export function setBrushSmooth(on: boolean): void {
  brushSmooth = on;
}

export function isBrushSmooth(): boolean {
  return brushSmooth;
}

export function setBrushSmoothQuality(level: number): void {
  brushSmoothQuality = Math.max(1, Math.min(4, Math.round(level)));
}

export function getBrushSmoothQuality(): number {
  return brushSmoothQuality;
}

/** True when the active brush settings will subdivide the mesh on commit. */
export function brushWillSubdivide(): boolean {
  return brushSmooth && brushRadius > 0;
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
  adjacency = null; // invalidate — mesh changed
  if (active) {
    adjacency = buildAdjacency(mesh);
    onSlabDragMeshChanged();
    onBoxDragMeshChanged();
  } else {
    // Pre-warm in the background so activate() finds it ready.
    // Uses requestIdleCallback when available (Chrome/Firefox/Edge); falls back
    // to setTimeout so Safari still benefits from the deferral.
    const prewarm = () => {
      if (currentMesh === mesh && adjacency === null) adjacency = buildAdjacency(mesh);
    };
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(prewarm);
    } else {
      setTimeout(prewarm, 0);
    }
  }
  clearHighlight();
}

export function activate(): void {
  if (active) return;
  active = true;

  wireframeBeforePaint = isWireframeVisible();
  setWireframeVisible(true);

  if (currentMesh && !adjacency) {
    // Fallback: pre-warm callback hasn't fired yet (e.g. user opened paint
    // immediately after execution). Build synchronously now.
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

  setWireframeVisible(wireframeBeforePaint);

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
      recordStrokeSample(result.point);
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
    strokeSamples = [];
    recordStrokeSample(result.point);
    addBrushFootprint(result.triangleIndex, result.point, brushSession);
    showHighlight(brushSession);
    event.preventDefault();
  }
}

/** Append a surface point to the in-progress smooth stroke, decimated so a
 *  slow drag doesn't accumulate thousands of near-duplicate samples. Spacing
 *  scales with the brush so the footprint stays continuous along the path. */
function recordStrokeSample(p: [number, number, number]): void {
  const minSpacing = Math.max(brushRadius * 0.4, 0.01);
  const last = strokeSamples[strokeSamples.length - 1];
  if (last) {
    const dx = p[0] - last[0], dy = p[1] - last[1], dz = p[2] - last[2];
    if (dx * dx + dy * dy + dz * dz < minSpacing * minSpacing) return;
  }
  strokeSamples.push([p[0], p[1], p[2]]);
}

/** Commit the active brush drag as a colour region. Smooth strokes (radius > 0
 *  with smooth on) store a `brushStroke` descriptor and trigger a mesh rebuild
 *  that subdivides under the stroke; otherwise the legacy whole-triangle set is
 *  stored directly. */
function commitBrushStroke(): void {
  if (!brushSession || brushSession.size === 0) return;
  const name = `Region ${getRegions().length + 1}`;
  const color = [...currentColor] as [number, number, number];

  if (brushSmooth && brushRadius > 0 && strokeSamples.length > 0) {
    // Triangles are left empty here: adding a brushStroke region fires the
    // regions-change listener, which rebuilds the refined working mesh and
    // resolves every region (including this one) against it.
    addRegion(
      name,
      color,
      'paintbrush',
      {
        kind: 'brushStroke',
        samples: strokeSamples.map(s => [s[0], s[1], s[2]] as [number, number, number]),
        radius: brushRadius,
        shape: brushShape,
        maxEdge: brushTargetEdge(),
      },
      new Set<number>(),
    );
  } else {
    addRegion(name, color, 'paintbrush', { kind: 'triangles', ids: [...brushSession] }, brushSession);
    if (onRegionPainted) onRegionPainted();
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
      strokeSamples = [];
      return;
    }
    commitBrushStroke();
    brushPainting = false;
    brushSession = null;
    strokeSamples = [];
    clearHighlight();
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
    commitBrushStroke();
  }
  brushPainting = false;
  brushSession = null;
  strokeSamples = [];
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
