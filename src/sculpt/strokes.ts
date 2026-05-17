// SculptStrokeStore — in-memory list of sculpt strokes for the current
// version, plus serialize/deserialize hooks. Mirrors `color/regions.ts`.

import type { SerializedStroke, BrushKind, StrokePoint } from './types';

type ChangeListener = () => void;

let strokes: SerializedStroke[] = [];
let subdivisionLevel = 0;
const listeners: ChangeListener[] = [];

// In-memory redo stack for pending strokes. Each entry is a stroke that was
// popped by undoLastPendingStroke. Cleared by any new addStroke, clearStrokes,
// or deserialize (i.e. version navigation).
let strokeRedoStack: SerializedStroke[] = [];

export function getStrokeRedoStack(): readonly SerializedStroke[] {
  return strokeRedoStack;
}

export function pushRedoStroke(s: SerializedStroke): void {
  strokeRedoStack.push({ ...s, points: s.points.map(p => ({ ...p })) });
}

export function popRedoStroke(): SerializedStroke | null {
  return strokeRedoStack.pop() ?? null;
}

export function clearStrokeRedo(): void {
  strokeRedoStack = [];
}

function notify(): void {
  for (const fn of listeners) fn();
}

export function onChange(fn: ChangeListener): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

export function getStrokes(): readonly SerializedStroke[] {
  return strokes;
}

export function hasStrokes(): boolean {
  return strokes.length > 0;
}

export function getSubdivisionLevel(): number {
  return subdivisionLevel;
}

export function setSubdivisionLevel(level: number): void {
  if (subdivisionLevel === level) return;
  subdivisionLevel = level;
  notify();
}

export function addStroke(
  brush: BrushKind,
  points: StrokePoint[],
  radius: number,
  strength: number,
): SerializedStroke {
  const id = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const stroke: SerializedStroke = {
    id,
    brush,
    points,
    radius,
    strength,
    subdivisionLevel,
  };
  strokes.push(stroke);
  clearStrokeRedo(); // new stroke invalidates redo branch
  notify();
  return stroke;
}

export function popLastStroke(): SerializedStroke | null {
  const s = strokes.pop() ?? null;
  if (s) notify();
  return s;
}

/** Re-add a stroke from the redo stack without clearing the redo stack.
 *  Only used by the redo flow; normal sculpt calls use addStroke. */
export function restoreStroke(s: SerializedStroke): void {
  strokes.push({ ...s, points: s.points.map(p => ({ ...p })) });
  notify();
}

export function clearStrokes(): void {
  if (strokes.length === 0 && subdivisionLevel === 0 && strokeRedoStack.length === 0) return;
  strokes = [];
  subdivisionLevel = 0;
  strokeRedoStack = [];
  notify();
}

export function serialize(): SerializedStroke[] {
  return strokes.map(s => ({
    id: s.id,
    brush: s.brush,
    points: s.points.map(p => ({ ...p })),
    radius: s.radius,
    strength: s.strength,
    subdivisionLevel: s.subdivisionLevel,
  }));
}

export function deserialize(data: SerializedStroke[] | undefined): void {
  strokeRedoStack = []; // version navigation clears redo
  if (!data || data.length === 0) {
    strokes = [];
    subdivisionLevel = 0;
    notify();
    return;
  }
  strokes = data.map(s => ({
    id: s.id,
    brush: s.brush,
    points: s.points.map(p => ({ ...p })),
    radius: s.radius,
    strength: s.strength,
    subdivisionLevel: s.subdivisionLevel,
  }));
  // The subdivision level on the version is the level recorded on the
  // first stroke — all strokes of one version share the same level.
  subdivisionLevel = strokes[0]?.subdivisionLevel ?? 0;
  notify();
}
