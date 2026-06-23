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

/** Centre of the union of every selected part's bbox — the pivot for a
 *  group-centroid scale or rotate, matching Tinkercad's "scale 2+ parts as
 *  one". Returns null when nothing in `names` resolves to a registry entry. */
export function groupCentroid(
  names: Iterable<string>,
  registry: Map<string, RegistryEntry>,
): Vec3 | null {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let any = false;
  for (const name of names) {
    const e = registry.get(name);
    if (!e) continue;
    any = true;
    if (e.box.min[0] < minX) minX = e.box.min[0];
    if (e.box.min[1] < minY) minY = e.box.min[1];
    if (e.box.min[2] < minZ) minZ = e.box.min[2];
    if (e.box.max[0] > maxX) maxX = e.box.max[0];
    if (e.box.max[1] > maxY) maxY = e.box.max[1];
    if (e.box.max[2] > maxZ) maxZ = e.box.max[2];
  }
  if (!any) return null;
  return [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
}

/** For a group-centroid scale, the per-part translate delta needed so the
 *  part's centre lies the right distance from the pivot AFTER each part is
 *  scaled around its own centre by the same factor. Caller still applies the
 *  scale to each part individually — this helper only produces the
 *  "spread / pull-in" component that turns N scale-in-place ops into a
 *  scale-around-the-group-centre.
 *
 *  Math: newCentre[i] = pivot[i] + (centre[i] − pivot[i]) × scale[i]
 *       delta[i]      = newCentre[i] − centre[i]
 *                     = (centre[i] − pivot[i]) × (scale[i] − 1) */
export function groupCentroidScaleDelta(center: Vec3, pivot: Vec3, scale: Vec3): Vec3 {
  return [
    (center[0] - pivot[0]) * (scale[0] - 1),
    (center[1] - pivot[1]) * (scale[1] - 1),
    (center[2] - pivot[2]) * (scale[2] - 1),
  ];
}

/** For a group-centroid Z-axis rotation (degrees), the per-part translate
 *  delta needed so each part's centre lies on the rotated radius around
 *  pivot. Caller still applies the rotation to each part individually —
 *  this helper produces the swing-around-the-group-centre component. We
 *  expose Z separately because (a) it's the only single-axis rotation
 *  with a clean planar pivot — XY rotation around an arbitrary 3D pivot
 *  is well-defined too but rarely what a CAD user wants in a flat-on-the-
 *  build-plate workflow, and (b) only Z makes physical sense for voxel
 *  snap-to-90° rotations.
 *
 *  Math for Z rotation by θ around `pivot`:
 *    [x'] = pivot + R(θ) · (center − pivot)
 *    delta = [x' − x]
 *  where R(θ) is the 2D rotation matrix in the XY plane (Z component stays). */
export function groupCentroidRotateZDelta(center: Vec3, pivot: Vec3, deg: number): Vec3 {
  if (deg === 0) return [0, 0, 0];
  const rad = deg * Math.PI / 180;
  const c = Math.cos(rad), s = Math.sin(rad);
  const dx = center[0] - pivot[0];
  const dy = center[1] - pivot[1];
  const nx = pivot[0] + c * dx - s * dy;
  const ny = pivot[1] + s * dx + c * dy;
  return [nx - center[0], ny - center[1], 0];
}
