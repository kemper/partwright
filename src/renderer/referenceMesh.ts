// The current reference ("ghost") geometry as plain data — the mesh plus how
// it is drawn. phantomGeometry.ts owns the live-viewport ghost and keeps this
// in step; the offscreen renderers (multiview.ts) read it to draw the same
// ghost into renderViews / renderView images. A leaf with no runtime imports,
// so the renderer layer can read it without importing the viewport feature
// modules (see viewportRegistry.ts for the layering rule).

import type { MeshData } from '../geometry/types';

export interface ReferenceStyle {
  color?: number;
  opacity?: number;
  wireframe?: boolean;
}

let current: { mesh: MeshData; style: ReferenceStyle } | null = null;

export function setReferenceMesh(mesh: MeshData | null, style: ReferenceStyle = {}): void {
  current = mesh ? { mesh, style } : null;
}

export function getReferenceMesh(): { mesh: MeshData; style: ReferenceStyle } | null {
  return current;
}
