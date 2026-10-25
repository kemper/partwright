// Annotation store — module-level state for plane-anchored marks (freehand
// strokes and pinned text labels) drawn by the user to communicate intent
// to the AI. Each annotation captures the camera state at creation time so
// the user can later snap back to the original viewing angle.

import * as THREE from 'three';
import type { SessionCamera, SessionPlane } from './sessionPlane';

export interface StrokeAnnotation {
  type: 'stroke';
  id: string;
  points: THREE.Vector3[]; // 3D points on the session plane
  color: [number, number, number]; // 0..1
  width: number; // line width in screen-space pixels
  camera: SessionCamera; // camera at time of creation (for restore-view)
  plane: SessionPlane;   // plane data (for select-mode drag)
}

export interface TextAnnotation {
  type: 'text';
  id: string;
  anchor: THREE.Vector3; // 3D anchor on the session plane
  text: string;
  color: [number, number, number];
  fontSizePx: number;
  camera: SessionCamera;
  plane: SessionPlane;
}

export type Annotation = StrokeAnnotation | TextAnnotation;

/** JSON-serializable form of an annotation. THREE.Vector3 fields become
 *  plain `{x, y, z}` objects; everything else is already POJO-friendly. */
export type SerializedAnnotation =
  | {
      type: 'stroke';
      id: string;
      points: { x: number; y: number; z: number }[];
      color: [number, number, number];
      width: number;
      camera: SessionCamera;
      plane: SessionPlane;
    }
  | {
      type: 'text';
      id: string;
      anchor: { x: number; y: number; z: number };
      text: string;
      color: [number, number, number];
      fontSizePx: number;
      camera: SessionCamera;
      plane: SessionPlane;
    };

let annotations: Annotation[] = [];
const listeners: Array<() => void> = [];

// Redo stack — strokes that were removed via `removeLastStroke()`. Any other
// mutation (new add, clear, specific delete, session load) drops the stack so
// redo can never resurrect a stroke into a state where the user wouldn't
// expect it.
let strokeRedoStack: StrokeAnnotation[] = [];
const redoListeners: Array<() => void> = [];

export function getStrokes(): readonly StrokeAnnotation[] {
  return annotations.filter((a): a is StrokeAnnotation => a.type === 'stroke');
}

export function getTexts(): readonly TextAnnotation[] {
  return annotations.filter((a): a is TextAnnotation => a.type === 'text');
}

export function getAnnotationById(id: string): Annotation | null {
  return annotations.find(a => a.id === id) ?? null;
}

export function getCount(): number {
  return annotations.length;
}

export function addStroke(stroke: StrokeAnnotation): void {
  annotations.push(stroke);
  clearRedoStack();
  notify();
}

export function addText(text: TextAnnotation): void {
  annotations.push(text);
  clearRedoStack();
  notify();
}

export function updateStrokePoints(id: string, points: THREE.Vector3[]): boolean {
  const a = annotations.find(x => x.id === id);
  if (!a || a.type !== 'stroke') return false;
  a.points = points;
  notify();
  return true;
}

export function updateTextAnchor(id: string, anchor: THREE.Vector3): boolean {
  const a = annotations.find(x => x.id === id);
  if (!a || a.type !== 'text') return false;
  a.anchor = anchor;
  notify();
  return true;
}

export function removeLastStroke(): StrokeAnnotation | null {
  for (let i = annotations.length - 1; i >= 0; i--) {
    const a = annotations[i];
    if (a.type === 'stroke') {
      annotations.splice(i, 1);
      strokeRedoStack.push(a);
      notifyRedo();
      notify();
      return a;
    }
  }
  return null;
}

/** Re-add the most recently undone stroke. Returns null if nothing to redo. */
export function redoLastStroke(): StrokeAnnotation | null {
  const stroke = strokeRedoStack.pop() ?? null;
  if (!stroke) return null;
  annotations.push(stroke);
  notifyRedo();
  notify();
  return stroke;
}

export function canRedoStroke(): boolean {
  return strokeRedoStack.length > 0;
}

/** Remove the most recent annotation of either kind. A removed STROKE goes on
 *  the redo stack (like removeLastStroke) so redoLastStroke can bring it back;
 *  removing a text label is a different mutation, so it drops the stack. */
export function removeLastAnnotation(): Annotation | null {
  const popped = annotations.pop() ?? null;
  if (popped) {
    if (popped.type === 'stroke') {
      strokeRedoStack.push(popped);
      notifyRedo();
    } else {
      clearRedoStack();
    }
    notify();
  }
  return popped;
}

export function removeAnnotationById(id: string): Annotation | null {
  const i = annotations.findIndex(a => a.id === id);
  if (i < 0) return null;
  const [removed] = annotations.splice(i, 1);
  clearRedoStack();
  notify();
  return removed;
}

export function clearStrokes(): void {
  const before = annotations.length;
  annotations = annotations.filter(a => a.type !== 'stroke');
  if (annotations.length !== before) {
    clearRedoStack();
    notify();
  }
}

export function clearTexts(): void {
  const before = annotations.length;
  annotations = annotations.filter(a => a.type !== 'text');
  if (annotations.length !== before) {
    clearRedoStack();
    notify();
  }
}

export function clearAll(): void {
  if (annotations.length === 0) return;
  annotations = [];
  clearRedoStack();
  notify();
}

/** Snapshot all annotations as JSON-serializable plain objects. */
export function serializeAll(): SerializedAnnotation[] {
  return annotations.map((a): SerializedAnnotation => {
    if (a.type === 'stroke') {
      return {
        type: 'stroke',
        id: a.id,
        points: a.points.map(p => ({ x: p.x, y: p.y, z: p.z })),
        color: a.color,
        width: a.width,
        camera: a.camera,
        plane: a.plane,
      };
    }
    return {
      type: 'text',
      id: a.id,
      anchor: { x: a.anchor.x, y: a.anchor.y, z: a.anchor.z },
      text: a.text,
      color: a.color,
      fontSizePx: a.fontSizePx,
      camera: a.camera,
      plane: a.plane,
    };
  });
}

/** Replace all in-memory annotations with the given serialized snapshot. */
export function loadFromSerialized(serialized: SerializedAnnotation[]): void {
  clearRedoStack();
  annotations = serialized.map((s): Annotation => {
    if (s.type === 'stroke') {
      return {
        type: 'stroke',
        id: s.id,
        points: s.points.map(p => new THREE.Vector3(p.x, p.y, p.z)),
        color: s.color,
        width: s.width,
        camera: s.camera,
        plane: s.plane,
      };
    }
    return {
      type: 'text',
      id: s.id,
      anchor: new THREE.Vector3(s.anchor.x, s.anchor.y, s.anchor.z),
      text: s.text,
      color: s.color,
      fontSizePx: s.fontSizePx,
      camera: s.camera,
      plane: s.plane,
    };
  });
  notify();
}

export function onChange(fn: () => void): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

export function onRedoChange(fn: () => void): () => void {
  redoListeners.push(fn);
  return () => {
    const i = redoListeners.indexOf(fn);
    if (i >= 0) redoListeners.splice(i, 1);
  };
}

function notify(): void {
  for (const fn of listeners) fn();
}

function notifyRedo(): void {
  for (const fn of redoListeners) fn();
}

function clearRedoStack(): void {
  if (strokeRedoStack.length === 0) return;
  strokeRedoStack = [];
  notifyRedo();
}
