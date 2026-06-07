// Interactive measuring tool — drag between two points on model to measure distance
import * as THREE from 'three';
import { measureDistance } from '../geometry/rayCast';
import { startMeasurement, updateMeasurementTarget, clearMeasurement } from '../renderer/measureOverlay';

export interface MeasureState {
  active: boolean;
  point1: [number, number, number] | null;
  point2: [number, number, number] | null;
  distance: number | null;
}

type MeasureMode = 'inactive' | 'ready' | 'dragging' | 'displaying';

let mode: MeasureMode = 'inactive';
let point1: THREE.Vector3 | null = null;
let point2: THREE.Vector3 | null = null;
let currentDistance: number | null = null;

let meshGroup: THREE.Group;
let cam: THREE.PerspectiveCamera;
let viewportContainer: HTMLElement;
let canvas: HTMLCanvasElement;

let downHandler: ((e: PointerEvent) => void) | null = null;
let moveHandler: ((e: PointerEvent) => void) | null = null;
let upHandler: ((e: PointerEvent) => void) | null = null;
let clickHandler: ((e: MouseEvent) => void) | null = null;
let dragEndTime = 0; // suppress the click event that trails a drag's pointerup

export function initMeasureTool(
  canvasEl: HTMLCanvasElement,
  camera: THREE.PerspectiveCamera,
  group: THREE.Group,
  container: HTMLElement,
): void {
  canvas = canvasEl;
  cam = camera;
  meshGroup = group;
  viewportContainer = container;
}

export function activate(): void {
  if (mode !== 'inactive') return;
  mode = 'ready';
  canvas.style.cursor = 'crosshair';

  downHandler = handlePointerDown;
  clickHandler = handleClick;
  canvas.addEventListener('pointerdown', downHandler);
  canvas.addEventListener('click', clickHandler);
}

export function deactivate(): void {
  mode = 'inactive';
  point1 = null;
  point2 = null;
  currentDistance = null;
  canvas.style.cursor = '';
  clearMeasurement();
  removeListeners();
}

export function clear(): void {
  if (mode === 'displaying') {
    mode = 'ready';
    point1 = null;
    point2 = null;
    currentDistance = null;
    canvas.style.cursor = 'crosshair';
    clearMeasurement();
  }
}

export function getState(): MeasureState {
  return {
    active: mode !== 'inactive',
    point1: point1 ? [point1.x, point1.y, point1.z] : null,
    point2: point2 ? [point2.x, point2.y, point2.z] : null,
    distance: currentDistance,
  };
}

function raycastModel(e: PointerEvent | MouseEvent): THREE.Vector3 | null {
  const rect = canvas.getBoundingClientRect();
  const mouse = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1,
  );
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, cam);
  const intersections = raycaster.intersectObjects(meshGroup.children, true);
  return intersections.length > 0 ? intersections[0].point.clone() : null;
}

function handlePointerDown(e: PointerEvent): void {
  if (mode === 'displaying') return; // click handler will clear it
  if (mode !== 'ready') return;

  const hit = raycastModel(e);
  if (!hit) return;

  point1 = hit;
  point2 = null;
  currentDistance = null;
  mode = 'dragging';

  startMeasurement(point1, viewportContainer);

  // Add drag listeners
  moveHandler = handlePointerMove;
  upHandler = handlePointerUp;
  canvas.addEventListener('pointermove', moveHandler);
  canvas.addEventListener('pointerup', upHandler);

  e.preventDefault();
}

function handlePointerMove(e: PointerEvent): void {
  if (mode !== 'dragging' || !point1) return;

  const hit = raycastModel(e);
  if (hit) {
    point2 = hit;
    currentDistance = measureDistance(
      [point1.x, point1.y, point1.z],
      [point2.x, point2.y, point2.z],
    );
    updateMeasurementTarget(point2, currentDistance);
  }
}

function handlePointerUp(e: PointerEvent): void {
  if (mode !== 'dragging' || !point1) {
    endDrag(e);
    return;
  }

  // Try raycast at release point; fall back to last known point2 from drag
  const hit = raycastModel(e) || point2;
  if (hit && point1.distanceTo(hit) > 0.01) {
    // Finalize measurement
    point2 = hit;
    currentDistance = measureDistance(
      [point1.x, point1.y, point1.z],
      [point2.x, point2.y, point2.z],
    );
    updateMeasurementTarget(point2, currentDistance);
    mode = 'displaying';
    canvas.style.cursor = '';
    dragEndTime = Date.now();
  } else {
    // Drag was too short or missed model — cancel
    clearMeasurement();
    point1 = null;
    point2 = null;
    currentDistance = null;
    mode = 'ready';
    canvas.style.cursor = 'crosshair';
  }

  endDrag(e);
}

function handleClick(_e: MouseEvent): void {
  // Ignore the click event that immediately follows a drag's pointerup
  if (Date.now() - dragEndTime < 200) return;
  if (mode === 'displaying') {
    clear();
  }
}

function endDrag(_e: PointerEvent): void {
  if (moveHandler) canvas.removeEventListener('pointermove', moveHandler);
  if (upHandler) canvas.removeEventListener('pointerup', upHandler);
  moveHandler = null;
  upHandler = null;
}

function removeListeners(): void {
  if (downHandler) canvas.removeEventListener('pointerdown', downHandler);
  if (clickHandler) canvas.removeEventListener('click', clickHandler);
  if (moveHandler) canvas.removeEventListener('pointermove', moveHandler);
  if (upHandler) canvas.removeEventListener('pointerup', upHandler);
  downHandler = null;
  clickHandler = null;
  moveHandler = null;
  upHandler = null;
}
