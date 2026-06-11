// Pure spatial helpers for the "click in 3D view" operand mode: derive a
// part's axis-aligned bounding box from its spec, and resolve a clicked
// world-space point back to the best-matching part. Dependency-free and
// unit-tested in tests/insert-codegen.spec.ts.

import type { PrimitiveSpec, Vec3 } from './codegen';

export interface Box {
  min: Vec3;
  max: Vec3;
}

export interface RegistryEntry {
  center: Vec3;
  box: Box;
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function centerOf(min: Vec3, max: Vec3): Vec3 {
  return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
}

/** Axis-aligned bbox + center for a primitive at its emitted placement. Mirrors
 *  the centering/translate semantics in codegen's `emitPrimitive`. */
export function primitiveEntry(spec: PrimitiveSpec): RegistryEntry {
  const pos: Vec3 = spec.position ?? [0, 0, 0];
  let localMin: Vec3;
  let localMax: Vec3;

  switch (spec.kind) {
    case 'cube': {
      const [x, y, z] = spec.size;
      localMin = spec.center ? [-x / 2, -y / 2, -z / 2] : [0, 0, 0];
      localMax = spec.center ? [x / 2, y / 2, z / 2] : [x, y, z];
      break;
    }
    case 'sphere': {
      const r = spec.radius;
      localMin = [-r, -r, -r];
      localMax = [r, r, r];
      break;
    }
    case 'cylinder': {
      const r = spec.radius;
      localMin = [-r, -r, spec.center ? -spec.height / 2 : 0];
      localMax = [r, r, spec.center ? spec.height / 2 : spec.height];
      break;
    }
    case 'cone': {
      const r = Math.max(spec.radiusBottom, spec.radiusTop);
      localMin = [-r, -r, spec.center ? -spec.height / 2 : 0];
      localMax = [r, r, spec.center ? spec.height / 2 : spec.height];
      break;
    }
    case 'torus': {
      const outer = spec.majorRadius + spec.tubeRadius;
      localMin = [-outer, -outer, -spec.tubeRadius];
      localMax = [outer, outer, spec.tubeRadius];
      break;
    }
    case 'tube': {
      const r = spec.outerRadius;
      localMin = [-r, -r, spec.center ? -spec.height / 2 : 0];
      localMax = [r, r, spec.center ? spec.height / 2 : spec.height];
      break;
    }
    case 'wedge': {
      const [x, y, z] = spec.size;
      localMin = spec.center ? [-x / 2, -y / 2, -z / 2] : [0, 0, 0];
      localMax = spec.center ? [x / 2, y / 2, z / 2] : [x, y, z];
      break;
    }
    case 'pyramid': {
      const a = spec.baseSize / 2;
      localMin = [-a, -a, spec.center ? -spec.height / 2 : 0];
      localMax = [a, a, spec.center ? spec.height / 2 : spec.height];
      break;
    }
    case 'polygon': {
      const r = spec.radius;
      localMin = [-r, -r, spec.center ? -spec.height / 2 : 0];
      localMax = [r, r, spec.center ? spec.height / 2 : spec.height];
      break;
    }
    case 'hemisphere': {
      const R = spec.radius;
      // Dome occupies Z=0..R uncentered, Z=-R/2..R/2 when "center" shifts it
      // around the bbox midpoint.
      localMin = [-R, -R, spec.center ? -R / 2 : 0];
      localMax = [R, R, spec.center ? R / 2 : R];
      break;
    }
    case 'tetrahedron': {
      const s = spec.size / 2;
      localMin = [-s, -s, -s];
      localMax = [s, s, s];
      break;
    }
    case 'star': {
      const r = spec.outerRadius;
      localMin = [-r, -r, spec.center ? -spec.height / 2 : 0];
      localMax = [r, r, spec.center ? spec.height / 2 : spec.height];
      break;
    }
  }

  const min = add(localMin, pos);
  const max = add(localMax, pos);
  return { box: { min, max }, center: centerOf(min, max) };
}

/** Shift an entry's bbox + center by `delta` (used after a part is moved so
 *  subsequent picks/operations track the new position). */
export function translateEntry(entry: RegistryEntry, delta: Vec3): RegistryEntry {
  return {
    box: { min: add(entry.box.min, delta), max: add(entry.box.max, delta) },
    center: add(entry.center, delta),
  };
}

/** Union the bounding boxes of several entries (the result of an operation is
 *  pickable as the union of its operands). */
export function unionBoxes(entries: RegistryEntry[]): RegistryEntry | null {
  if (entries.length === 0) return null;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const e of entries) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], e.box.min[i]);
      max[i] = Math.max(max[i], e.box.max[i]);
    }
  }
  return { box: { min, max }, center: centerOf(min, max) };
}

function contains(box: Box, p: Vec3, eps: number): boolean {
  return (
    p[0] >= box.min[0] - eps && p[0] <= box.max[0] + eps &&
    p[1] >= box.min[1] - eps && p[1] <= box.max[1] + eps &&
    p[2] >= box.min[2] - eps && p[2] <= box.max[2] + eps
  );
}

function dist2(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

/** Resolve a world-space point to a part name. Prefers a part whose bbox
 *  contains the point; ties (and misses) break on nearest center. Only
 *  considers names in `valid` (still present in the live code). Returns null
 *  when nothing is registered. */
export function pickPart(
  point: Vec3,
  registry: Map<string, RegistryEntry>,
  valid: Set<string>,
  eps = 0.5,
): string | null {
  let best: string | null = null;
  let bestContains = false;
  let bestDist = Infinity;

  for (const [name, entry] of registry) {
    if (!valid.has(name)) continue;
    const inside = contains(entry.box, point, eps);
    const d = dist2(point, entry.center);
    if (inside && !bestContains) {
      best = name; bestContains = true; bestDist = d;
    } else if (inside === bestContains && d < bestDist) {
      best = name; bestDist = d;
    }
  }
  return best;
}
