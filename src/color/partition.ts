// Partition — divide a scoped triangle set into colored cells by an
// analytic field. The generalization of "striped limbs" that also covers
// radial shoulder wedges and concentric pupil rings:
//
//   bands  — N equal slices along an axis (paintOrientedStripes, scoped)
//   wedges — N angular sectors around an axis through a center
//   rings  — concentric annuli around an axis at given radial boundaries
//
// Cell assignment is by triangle centroid — on the densely-tessellated
// organic meshes this targets (character sculpts), centroid bucketing
// produces clean boundaries; analytic subdivision along cell boundaries is
// a possible future refinement (tracked in #881). Pure module: no DOM, no
// stores — unit-testable in the vitest node tier.

import type { MeshData } from '../geometry/types';

export type PartitionSpec =
  | { kind: 'bands'; axis: [number, number, number]; count: number }
  | { kind: 'wedges'; axis: [number, number, number]; center: [number, number, number]; count: number; phaseDeg?: number }
  | { kind: 'rings'; axis: [number, number, number]; center: [number, number, number]; radii: number[] };

export interface PartitionResult {
  /** One triangle set per cell, in cell order (low→high band, wedge 0 at
   *  phase, innermost ring first). Cells can be empty. */
  cells: Set<number>[];
  /** Human-readable cell descriptions (band ranges, wedge angles, ring
   *  radii) so callers can report what each cell is. */
  cellLabels: string[];
}

function centroidOf(mesh: MeshData, t: number): [number, number, number] {
  const { triVerts, vertProperties, numProp } = mesh;
  const v0 = triVerts[t * 3], v1 = triVerts[t * 3 + 1], v2 = triVerts[t * 3 + 2];
  return [
    (vertProperties[v0 * numProp] + vertProperties[v1 * numProp] + vertProperties[v2 * numProp]) / 3,
    (vertProperties[v0 * numProp + 1] + vertProperties[v1 * numProp + 1] + vertProperties[v2 * numProp + 1]) / 3,
    (vertProperties[v0 * numProp + 2] + vertProperties[v1 * numProp + 2] + vertProperties[v2 * numProp + 2]) / 3,
  ];
}

function normalize(v: [number, number, number]): [number, number, number] | null {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (!(len > 0)) return null;
  return [v[0] / len, v[1] / len, v[2] / len];
}

/** Any unit vector perpendicular to `axis` — the reference direction wedge
 *  angle 0 is measured from. Deterministic: prefers the world axis least
 *  aligned with `axis` so the result is stable and predictable. */
export function referencePerpendicular(axis: [number, number, number]): [number, number, number] {
  const ax = Math.abs(axis[0]), ay = Math.abs(axis[1]), az = Math.abs(axis[2]);
  const pick: [number, number, number] = ax <= ay && ax <= az ? [1, 0, 0] : ay <= az ? [0, 1, 0] : [0, 0, 1];
  // Gram-Schmidt: remove the axis component, normalize.
  const dot = pick[0] * axis[0] + pick[1] * axis[1] + pick[2] * axis[2];
  const perp: [number, number, number] = [pick[0] - dot * axis[0], pick[1] - dot * axis[1], pick[2] - dot * axis[2]];
  return normalize(perp)!;
}

/** Partition `scope` (triangle ids into `mesh`) into cells per `spec`.
 *  Returns `{ error }` on degenerate input (zero axis, bad counts). */
export function partitionTriangles(
  mesh: MeshData,
  scope: Iterable<number>,
  spec: PartitionSpec,
): PartitionResult | { error: string } {
  const axis = normalize(spec.axis);
  if (!axis) return { error: 'partition axis must be a non-zero vector.' };

  if (spec.kind === 'bands') {
    if (!Number.isInteger(spec.count) || spec.count < 1 || spec.count > 64) return { error: 'bands.count must be an integer in [1, 64].' };
    // count: 1 = "fill the whole scope with one colour" — no axis math
    // needed (and a zero-extent scope is fine for a single cell).
    if (spec.count === 1) {
      return { cells: [new Set(scope)], cellLabels: ['band 0: entire scope'] };
    }
    // Two passes: projection extents, then bucketing.
    let mn = Infinity, mx = -Infinity;
    const scopeArr = [...scope];
    const projs = new Float64Array(scopeArr.length);
    for (let i = 0; i < scopeArr.length; i++) {
      const c = centroidOf(mesh, scopeArr[i]);
      const p = c[0] * axis[0] + c[1] * axis[1] + c[2] * axis[2];
      projs[i] = p;
      if (p < mn) mn = p;
      if (p > mx) mx = p;
    }
    const span = mx - mn;
    if (!(span > 0)) return { error: 'partition scope has zero extent along the bands axis.' };
    const cells = Array.from({ length: spec.count }, () => new Set<number>());
    const bandLen = span / spec.count;
    for (let i = 0; i < scopeArr.length; i++) {
      let b = Math.floor((projs[i] - mn) / bandLen);
      if (b < 0) b = 0;
      if (b >= spec.count) b = spec.count - 1;
      cells[b].add(scopeArr[i]);
    }
    const cellLabels = cells.map((_, i) =>
      `band ${i}: axis-projection ${(mn + i * bandLen).toFixed(2)}..${(mn + (i + 1) * bandLen).toFixed(2)}`);
    return { cells, cellLabels };
  }

  if (spec.kind === 'wedges') {
    if (!Number.isInteger(spec.count) || spec.count < 2 || spec.count > 64) return { error: 'wedges.count must be an integer in [2, 64].' };
    const phase = ((spec.phaseDeg ?? 0) * Math.PI) / 180;
    const u = referencePerpendicular(axis);
    // v = axis × u completes the in-plane frame.
    const v: [number, number, number] = [
      axis[1] * u[2] - axis[2] * u[1],
      axis[2] * u[0] - axis[0] * u[2],
      axis[0] * u[1] - axis[1] * u[0],
    ];
    const cells = Array.from({ length: spec.count }, () => new Set<number>());
    const sector = (2 * Math.PI) / spec.count;
    for (const t of scope) {
      const c = centroidOf(mesh, t);
      const dx = c[0] - spec.center[0], dy = c[1] - spec.center[1], dz = c[2] - spec.center[2];
      const pu = dx * u[0] + dy * u[1] + dz * u[2];
      const pv = dx * v[0] + dy * v[1] + dz * v[2];
      let ang = Math.atan2(pv, pu) - phase;
      ang = ((ang % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      let w = Math.floor(ang / sector);
      if (w >= spec.count) w = spec.count - 1;
      cells[w].add(t);
    }
    const cellLabels = cells.map((_, i) =>
      `wedge ${i}: ${((spec.phaseDeg ?? 0) + (i * 360) / spec.count).toFixed(0)}°..${((spec.phaseDeg ?? 0) + ((i + 1) * 360) / spec.count).toFixed(0)}°`);
    return { cells, cellLabels };
  }

  // rings
  const radii = spec.radii;
  if (!Array.isArray(radii) || radii.length < 1 || radii.length > 63) return { error: 'rings.radii must have 1..63 boundary radii.' };
  for (let i = 0; i < radii.length; i++) {
    if (typeof radii[i] !== 'number' || !Number.isFinite(radii[i]) || radii[i] <= 0) return { error: `rings.radii[${i}] must be a positive finite number.` };
    if (i > 0 && radii[i] <= radii[i - 1]) return { error: 'rings.radii must be strictly increasing.' };
  }
  // Cells: [0, r0), [r0, r1), …, [rLast, ∞). Radial distance is measured
  // perpendicular to the axis (a true cylinder-radius, so rings on a domed
  // eye stay concentric when viewed along the axis).
  const nCells = radii.length + 1;
  const cells = Array.from({ length: nCells }, () => new Set<number>());
  for (const t of scope) {
    const c = centroidOf(mesh, t);
    const dx = c[0] - spec.center[0], dy = c[1] - spec.center[1], dz = c[2] - spec.center[2];
    const along = dx * axis[0] + dy * axis[1] + dz * axis[2];
    const rx = dx - along * axis[0], ry = dy - along * axis[1], rz = dz - along * axis[2];
    const r = Math.hypot(rx, ry, rz);
    let cell = radii.length; // outermost by default
    for (let i = 0; i < radii.length; i++) {
      if (r < radii[i]) { cell = i; break; }
    }
    cells[cell].add(t);
  }
  const cellLabels = cells.map((_, i) => {
    const lo = i === 0 ? 0 : radii[i - 1];
    const hi = i < radii.length ? radii[i] : Infinity;
    return `ring ${i}: radius ${lo.toFixed(2)}..${hi === Infinity ? '∞' : hi.toFixed(2)}`;
  });
  return { cells, cellLabels };
}
