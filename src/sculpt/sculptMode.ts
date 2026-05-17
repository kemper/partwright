// Sculpt mode — pointer/raycast wiring for the deformer prototype.
// Mirrors src/color/paintMode.ts closely but only supports a single
// "coplanar pick" region selector + two deformer kinds (Inflate, Smooth).

import * as THREE from 'three';
import type { MeshData } from '../geometry/types';
import type { DeformerKind } from './types';
import { pickFace } from '../color/facePicker';
import {
  buildAdjacency,
  findCoplanarRegion,
  getTriangleNormal,
  type AdjacencyGraph,
} from '../color/adjacency';
import {
  getMeshGroup,
  getRenderer,
  setUserOrbitLock,
  isUserOrbitLocked,
} from '../renderer/viewport';

let active = false;
let currentKind: DeformerKind = 'inflate';
// Params per kind — kept as separate scalars so the UI can edit them
// independently and they persist while the user toggles between tools.
let inflateDistance = 1.0;
let smoothIterations = 3;
let bucketTolerance = 0.9995;

let adjacency: AdjacencyGraph | null = null;
let currentMesh: MeshData | null = null;

// Current selection (a set of triangle ids in `currentMesh`) plus the spatial
// seed descriptor that produced it — the descriptor is what gets persisted
// when the user hits Apply.
interface CurrentSelection {
  triangles: Set<number>;
  seedPoint: [number, number, number];
  seedNormal: [number, number, number];
  tolerance: number;
}
let currentSelection: CurrentSelection | null = null;

// Hover highlight (cyan tint over candidate region)
let highlightMesh: THREE.Mesh | null = null;
let hoveredTriangles: Set<number> | null = null;

// Selection highlight (solid magenta — locked in until Apply or Cancel)
let selectionMesh: THREE.Mesh | null = null;

// Orbit lock state — same pattern as paintMode
let priorOrbitLock = false;

// Callbacks
let onSelectionChange: (() => void) | null = null;
let onKindChange: ((kind: DeformerKind) => void) | null = null;

export function isActive(): boolean {
  return active;
}

export function setKind(kind: DeformerKind): void {
  if (currentKind === kind) return;
  currentKind = kind;
  if (onKindChange) onKindChange(kind);
}

export function getKind(): DeformerKind {
  return currentKind;
}

export function setInflateDistance(d: number): void {
  inflateDistance = d;
}

export function getInflateDistance(): number {
  return inflateDistance;
}

export function setSmoothIterations(n: number): void {
  smoothIterations = Math.max(1, Math.floor(n));
}

export function getSmoothIterations(): number {
  return smoothIterations;
}

export function setBucketTolerance(tol: number): void {
  bucketTolerance = Math.max(-1, Math.min(1, tol));
}

export function getBucketTolerance(): number {
  return bucketTolerance;
}

export function getCurrentSelection(): CurrentSelection | null {
  return currentSelection;
}

export function setOnSelectionChange(fn: () => void): void {
  onSelectionChange = fn;
}

export function setOnKindChange(fn: (kind: DeformerKind) => void): void {
  onKindChange = fn;
}

/** The owner calls this after every successful runCode() so adjacency stays
 *  in sync with the live mesh. Also clears any in-flight selection — picks
 *  made against the previous mesh's triangle ids are meaningless. */
export function updateSculptMesh(mesh: MeshData): void {
  currentMesh = mesh;
  if (active) {
    adjacency = buildAdjacency(mesh);
  }
  clearSelection();
  clearHighlight();
}

export function activate(): void {
  if (active) return;
  active = true;

  if (currentMesh) {
    adjacency = buildAdjacency(currentMesh);
  }

  priorOrbitLock = isUserOrbitLocked();
  setUserOrbitLock(true);

  const canvas = getRenderer().domElement;
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mouseleave', onMouseLeave);
  canvas.style.cursor = 'crosshair';
}

export function deactivate(): void {
  if (!active) return;
  active = false;
  adjacency = null;

  if (!priorOrbitLock) setUserOrbitLock(false);

  const canvas = getRenderer().domElement;
  canvas.removeEventListener('mousemove', onMouseMove);
  canvas.removeEventListener('mousedown', onMouseDown);
  canvas.removeEventListener('mouseleave', onMouseLeave);
  canvas.style.cursor = '';

  clearHighlight();
  clearSelection();
}

function onMouseMove(event: MouseEvent): void {
  if (!adjacency || !currentMesh) return;

  // Don't hover-preview over the locked-in selection — would obscure it.
  if (currentSelection) return;

  const result = pickFace(event);
  if (!result) {
    clearHighlight();
    return;
  }

  const region = findCoplanarRegion(result.triangleIndex, adjacency, bucketTolerance);
  if (hoveredTriangles && setsEqual(hoveredTriangles, region)) return;
  hoveredTriangles = region;
  showHighlight(region, [0.0, 0.85, 1.0], 0.35);
}

function onMouseDown(event: MouseEvent): void {
  if (!adjacency || !currentMesh) return;
  if (event.button !== 0) return;

  const result = pickFace(event);
  if (!result) return;

  const region = findCoplanarRegion(result.triangleIndex, adjacency, bucketTolerance);
  const normal = getTriangleNormal(result.triangleIndex, adjacency);

  currentSelection = {
    triangles: region,
    seedPoint: result.point,
    seedNormal: normal,
    tolerance: bucketTolerance,
  };

  clearHighlight();
  showSelection(region);
  if (onSelectionChange) onSelectionChange();
  event.preventDefault();
}

function onMouseLeave(): void {
  clearHighlight();
}

export function clearSelection(): void {
  currentSelection = null;
  if (selectionMesh) {
    getMeshGroup().remove(selectionMesh);
    selectionMesh.geometry.dispose();
    (selectionMesh.material as THREE.Material).dispose();
    selectionMesh = null;
  }
  if (onSelectionChange) onSelectionChange();
}

function showSelection(triangles: Set<number>): void {
  if (selectionMesh) {
    getMeshGroup().remove(selectionMesh);
    selectionMesh.geometry.dispose();
    (selectionMesh.material as THREE.Material).dispose();
    selectionMesh = null;
  }
  selectionMesh = buildHighlightMesh(triangles, [1.0, 0.2, 0.9], 0.55);
  if (selectionMesh) {
    selectionMesh.name = 'sculpt-selection';
    selectionMesh.renderOrder = 998;
    getMeshGroup().add(selectionMesh);
  }
}

function showHighlight(
  triangles: Set<number>,
  color: [number, number, number],
  opacity: number,
): void {
  clearHighlight();
  const mesh = buildHighlightMesh(triangles, color, opacity);
  if (!mesh) return;
  mesh.name = 'sculpt-hover';
  mesh.renderOrder = 999;
  highlightMesh = mesh;
  getMeshGroup().add(mesh);
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

function buildHighlightMesh(
  triangles: Set<number>,
  color: [number, number, number],
  opacity: number,
): THREE.Mesh | null {
  if (!currentMesh) return null;
  if (triangles.size === 0) return null;

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

  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color[0], color[1], color[2]),
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });

  return new THREE.Mesh(geo, mat);
}

function setsEqual(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}
