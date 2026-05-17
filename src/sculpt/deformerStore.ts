// Deformer store — runtime list of applied deformers for the current version.
// Mirrors the shape of color/regions.ts (much smaller surface area).

import type { SerializedDeformer } from './types';

type ChangeListener = () => void;

let deformers: SerializedDeformer[] = [];
let nextOrder = 1;
const listeners: ChangeListener[] = [];

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

export function getDeformers(): readonly SerializedDeformer[] {
  return deformers;
}

export function hasDeformers(): boolean {
  return deformers.length > 0;
}

export function addDeformer(d: Omit<SerializedDeformer, 'id' | 'order'>): SerializedDeformer {
  const full: SerializedDeformer = {
    ...d,
    id: Date.now() + Math.floor(Math.random() * 1000),
    order: nextOrder++,
  };
  deformers.push(full);
  notify();
  return full;
}

export function removeDeformer(id: number): boolean {
  const idx = deformers.findIndex(d => d.id === id);
  if (idx < 0) return false;
  deformers.splice(idx, 1);
  notify();
  return true;
}

export function clearDeformers(): void {
  if (deformers.length === 0) return;
  deformers = [];
  nextOrder = 1;
  notify();
}

export function serialize(): SerializedDeformer[] {
  // Defensive deep copy so external code can't mutate our state.
  return deformers.map(d => ({
    id: d.id,
    kind: d.kind,
    regionDescriptor: { ...d.regionDescriptor },
    params: { ...d.params },
    order: d.order,
  }));
}

export function deserialize(data: SerializedDeformer[]): void {
  deformers = data.map(d => ({
    id: d.id,
    kind: d.kind,
    regionDescriptor: { ...d.regionDescriptor },
    params: { ...d.params },
    order: d.order,
  }));
  nextOrder = deformers.reduce((max, d) => Math.max(max, d.order + 1), 1);
  notify();
}
