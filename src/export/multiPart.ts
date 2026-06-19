// Shared helpers for the multi-part OBJ / STL / GLB exporters — bundling several
// Session Parts into one file. (3MF has its own richer `PartExport` + layout in
// threemfProject.ts; these formats use the lighter primitives below.)

import type { MeshData } from '../geometry/types';

/** One Session Part with its baked (optionally coloured) mesh — the shared input
 *  to the OBJ/STL/GLB multi-part builders. */
export interface ExportPart {
  /** Display name — becomes the object/node/file name in the export. */
  name: string;
  /** The part's mesh. `triColors` (if present) drives the per-triangle colour. */
  mesh: MeshData;
}

interface PartXYBounds { cx: number; cy: number; width: number; depth: number; }

function meshXYBounds(mesh: MeshData): PartXYBounds {
  const { vertProperties, numProp, numVert } = mesh;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < numVert; i++) {
    const x = vertProperties[i * numProp], y = vertProperties[i * numProp + 1];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX)) return { cx: 0, cy: 0, width: 0, depth: 0 };
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, width: maxX - minX, depth: maxY - minY };
}

/** Per-part XY translation to apply so parts don't overlap. */
export interface GridSlot { dx: number; dy: number; }

/**
 * Arrange parts in a centred ⌈√N⌉-column grid so they don't overlap — the same
 * layout the generic multi-object 3MF uses. Returns, for each part, the XY
 * translation to ADD to its geometry (move the part's XY bbox-centre onto its grid
 * cell centre); Z is left untouched. The cell pitch is the largest part footprint
 * plus `gapMm`, so no two parts touch.
 */
export function gridLayout(meshes: MeshData[], gapMm = 10): GridSlot[] {
  const bounds = meshes.map(meshXYBounds);
  const n = meshes.length;
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
  const rows = Math.max(1, Math.ceil(n / cols));
  const pitch = Math.max(1, ...bounds.map(b => Math.max(b.width, b.depth))) + gapMm;
  return bounds.map((b, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const cellX = col * pitch - (cols - 1) * pitch / 2;
    const cellY = row * pitch - (rows - 1) * pitch / 2;
    return { dx: cellX - b.cx, dy: cellY - b.cy };
  });
}

/**
 * Sanitise a part name into a safe object/node/file stem and dedupe it against
 * `used` (case-insensitive) by appending _2, _3, … An empty result falls back to
 * `fallback`. Keeps OBJ `o` names, GLB node names, and STL file names collision-free.
 */
export function uniquePartStem(name: string, used: Set<string>, fallback: string): string {
  let base = name
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .replace(/\s+/g, '_')
    .replace(/[-_]{2,}/g, '_')
    .replace(/^[-_]+|[-_]+$/g, '');
  if (!base) base = fallback;
  let stem = base;
  let n = 2;
  while (used.has(stem.toLowerCase())) stem = `${base}_${n++}`;
  used.add(stem.toLowerCase());
  return stem;
}
