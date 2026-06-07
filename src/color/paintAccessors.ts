// Leaf indirection for the few paint-state reads the drag tools (boxDrag,
// slabDrag) need from paintMode.
//
// paintMode drives boxDrag/slabDrag (it imports their activate/deactivate), and
// they in turn need the active color, the current mesh, and the shape-smoothing
// descriptor — all owned by paintMode. Importing those back from paintMode
// created a cycle. paintMode now publishes the accessors here once at load, and
// the drag tools read them from this leaf, so the dependency flows one way.

import type { MeshData } from '../geometry/types';

export interface PaintAccessors {
  getColor(): [number, number, number];
  getSlotId(): string | null;
  getCurrentMesh(): MeshData | null;
  shapeSmoothDescriptorFields(mesh: MeshData): { smooth: boolean; maxEdge: number };
}

let accessors: PaintAccessors | null = null;

/** Called once by paintMode at module load to publish its state accessors. */
export function setPaintAccessors(a: PaintAccessors): void {
  accessors = a;
}

function require(): PaintAccessors {
  if (!accessors) throw new Error('paint accessors used before paintMode initialised');
  return accessors;
}

export function getColor(): [number, number, number] {
  return require().getColor();
}

export function getSlotId(): string | null {
  return require().getSlotId();
}

export function getCurrentMesh(): MeshData | null {
  return require().getCurrentMesh();
}

export function shapeSmoothDescriptorFields(mesh: MeshData): { smooth: boolean; maxEdge: number } {
  return require().shapeSmoothDescriptorFields(mesh);
}
