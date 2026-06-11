// Pure-math helpers for Arrange mode — split out of arrangeMode.ts (which
// imports Three.js + the renderer) so unit tests can exercise them in Node
// without dragging the browser graph in.

import { fmt, type Vec3 } from './codegen';
import type { RegistryEntry } from './spatial';

/** Per-axis alignment modes for the Align row. */
export type AlignAxis = 'x' | 'y' | 'z';
export type AlignMode = 'min' | 'center' | 'max';

/** Compute the per-name translate delta needed to align each selected part to
 *  the chosen axis surface (min = leftmost/front/bottom, max = rightmost/back/top,
 *  center = midpoint). Reference point is the union of all selected bboxes,
 *  matching Tinkercad's "align to selection" behaviour. Parts whose reference
 *  is already at the target stay put (no zero-delta entry in the map). */
export function alignDeltas(
  selection: Iterable<string>,
  registry: Map<string, RegistryEntry>,
  axis: AlignAxis,
  mode: AlignMode,
): Map<string, Vec3> {
  const axisIdx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  const entries: { name: string; e: RegistryEntry }[] = [];
  for (const name of selection) {
    const e = registry.get(name);
    if (e) entries.push({ name, e });
  }
  if (entries.length === 0) return new Map();
  let target = 0;
  if (mode === 'min') target = Math.min(...entries.map(({ e }) => e.box.min[axisIdx]));
  else if (mode === 'max') target = Math.max(...entries.map(({ e }) => e.box.max[axisIdx]));
  else {
    const lo = Math.min(...entries.map(({ e }) => e.box.min[axisIdx]));
    const hi = Math.max(...entries.map(({ e }) => e.box.max[axisIdx]));
    target = (lo + hi) / 2;
  }
  const out = new Map<string, Vec3>();
  for (const { name, e } of entries) {
    const ref = mode === 'min' ? e.box.min[axisIdx] : mode === 'max' ? e.box.max[axisIdx] : e.center[axisIdx];
    const d = target - ref;
    if (Math.abs(d) < 1e-6) continue;
    const delta: Vec3 = [0, 0, 0];
    delta[axisIdx] = d;
    out.set(name, delta);
  }
  return out;
}

/** Build the `.scale([sx, sy, sz])` literal for a given per-axis factor. Each
 *  factor is clamped to a small positive minimum so a user accidentally typing
 *  `0` can't produce degenerate geometry the engine then chokes on. */
export function formatScaleCall(scale: Vec3): string {
  const s = scale.map(v => Math.max(0.001, v)) as Vec3;
  return `.scale([${fmt(s[0])}, ${fmt(s[1])}, ${fmt(s[2])}])`;
}
