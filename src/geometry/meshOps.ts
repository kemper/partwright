/**
 * meshOps — predicate + alignment + pattern helpers exposed to the manifold-js
 * sandbox under `api.meshOps` (and re-exported flat as `api.intersects`,
 * `api.placeOn`, etc. for shorter agent code).
 *
 * The verbs here are the ones AI agents repeatedly trip over when modeling with
 * raw `Manifold`: deciding whether two shapes intersect (without rendering),
 * placing shape A on top of shape B without doing trig in their head, pattern-
 * arraying without writing the loop themselves, and validating a boolean
 * actually produced the expected number of components.
 *
 * Convention:
 *  - Helpers that return data return plain JS values (booleans, numbers, plain
 *    objects). They never mutate or .delete() the inputs the caller passed.
 *  - Helpers that build geometry return a fresh Manifold. Intermediate Manifolds
 *    they allocate are auto-tracked by the engine's run-scoped wrapper (see
 *    manifoldJs.ts) so they're freed at the end of the run.
 *  - Argument validation matches the rest of the sandbox: clear messages,
 *    no silent type coercion, unknown keys rejected.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export type Vec3 = [number, number, number];
type Vec3Or1 = Vec3 | [number, number] | number;
type AlignMode = 'min' | 'max' | 'center' | 'left' | 'right' | 'front' | 'back' | 'top' | 'bottom';

const ALIGN_MIN = new Set<AlignMode>(['min', 'left', 'front', 'bottom']);
const ALIGN_MAX = new Set<AlignMode>(['max', 'right', 'back', 'top']);
// 'center' falls through both checks.

export interface BBoxInfo {
  min: Vec3;
  max: Vec3;
  size: Vec3;
  center: Vec3;
}

export interface ComponentInfo {
  index: number;
  volume: number;
  triangleCount: number;
  vertexCount: number;
  bbox: BBoxInfo;
}

function need(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`meshOps: ${msg}`);
}

function isFiniteNum(v: any): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isVec3(v: any): v is Vec3 {
  return Array.isArray(v) && v.length === 3 && isFiniteNum(v[0]) && isFiniteNum(v[1]) && isFiniteNum(v[2]);
}

function isManifold(v: any): boolean {
  return !!v && typeof v.boundingBox === 'function' && typeof v.translate === 'function' && typeof v.getMesh === 'function';
}

function bboxInfo(m: any): BBoxInfo {
  const bb = m.boundingBox();
  const min: Vec3 = [bb.min[0], bb.min[1], bb.min[2]];
  const max: Vec3 = [bb.max[0], bb.max[1], bb.max[2]];
  return {
    min,
    max,
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
  };
}

function alignOffset(smin: number, smax: number, tmin: number, tmax: number, mode: AlignMode | undefined): number {
  if (mode === undefined) return 0;
  if (ALIGN_MIN.has(mode)) return tmin - smin;
  if (ALIGN_MAX.has(mode)) return tmax - smax;
  if (mode === 'center') return (tmin + tmax) / 2 - (smin + smax) / 2;
  throw new Error(`meshOps: alignTo: unknown mode "${mode}" (use min/max/center or directional aliases like top/bottom/left/right)`);
}

/** Parse a "plane" argument that may be 'x'|'y'|'z' (the plane normal to that
 *  axis, through the origin) or an explicit normal vector. */
function parsePlaneNormal(plane: unknown, name: string): Vec3 {
  if (plane === 'x' || plane === 'X') return [1, 0, 0];
  if (plane === 'y' || plane === 'Y') return [0, 1, 0];
  if (plane === 'z' || plane === 'Z') return [0, 0, 1];
  if (isVec3(plane)) return plane;
  throw new Error(`meshOps: ${name}: plane must be "x"/"y"/"z" or a [nx,ny,nz] vector`);
}

function parseAxis(axis: unknown, name: string): Vec3 {
  if (axis === 'x' || axis === 'X') return [1, 0, 0];
  if (axis === 'y' || axis === 'Y') return [0, 1, 0];
  if (axis === 'z' || axis === 'Z' || axis === undefined) return [0, 0, 1];
  if (isVec3(axis)) {
    const m = Math.hypot(axis[0], axis[1], axis[2]);
    need(m > 1e-9, `${name}: axis vector must have non-zero length`);
    return [axis[0] / m, axis[1] / m, axis[2] / m];
  }
  throw new Error(`meshOps: ${name}: axis must be "x"/"y"/"z" or a [x,y,z] vector`);
}

function rotateAroundAxis(shape: any, axis: Vec3, angleDeg: number, center: Vec3 | undefined): any {
  if (Math.abs(angleDeg) < 1e-12) return shape;
  const [ax, ay, az] = axis;
  // Axis-aligned fast paths — avoid a full transform matrix when we can.
  if (Math.abs(ax) > 0.9999 && Math.abs(ay) < 1e-6 && Math.abs(az) < 1e-6) {
    let s = shape;
    if (center) s = s.translate([-center[0], -center[1], -center[2]]);
    s = s.rotate([angleDeg * Math.sign(ax), 0, 0]);
    if (center) s = s.translate(center);
    return s;
  }
  if (Math.abs(ay) > 0.9999 && Math.abs(ax) < 1e-6 && Math.abs(az) < 1e-6) {
    let s = shape;
    if (center) s = s.translate([-center[0], -center[1], -center[2]]);
    s = s.rotate([0, angleDeg * Math.sign(ay), 0]);
    if (center) s = s.translate(center);
    return s;
  }
  if (Math.abs(az) > 0.9999 && Math.abs(ax) < 1e-6 && Math.abs(ay) < 1e-6) {
    let s = shape;
    if (center) s = s.translate([-center[0], -center[1], -center[2]]);
    s = s.rotate([0, 0, angleDeg * Math.sign(az)]);
    if (center) s = s.translate(center);
    return s;
  }
  // General axis: build a Rodrigues rotation matrix and feed it to .transform().
  // manifold-3d's transform takes a column-major 4x3 matrix laid out as
  // [r00,r10,r20, r01,r11,r21, r02,r12,r22, tx,ty,tz].
  const c = Math.cos(angleDeg * Math.PI / 180);
  const s = Math.sin(angleDeg * Math.PI / 180);
  const t = 1 - c;
  const r00 = t * ax * ax + c;
  const r01 = t * ax * ay - s * az;
  const r02 = t * ax * az + s * ay;
  const r10 = t * ax * ay + s * az;
  const r11 = t * ay * ay + c;
  const r12 = t * ay * az - s * ax;
  const r20 = t * ax * az - s * ay;
  const r21 = t * ay * az + s * ax;
  const r22 = t * az * az + c;
  // If a rotation center is given, fold "translate to origin, rotate, translate back" into the matrix.
  let tx = 0, ty = 0, tz = 0;
  if (center) {
    tx = center[0] - (r00 * center[0] + r01 * center[1] + r02 * center[2]);
    ty = center[1] - (r10 * center[0] + r11 * center[1] + r12 * center[2]);
    tz = center[2] - (r20 * center[0] + r21 * center[1] + r22 * center[2]);
  }
  // Column-major: column 0 first, then column 1, ...
  const mat = [
    r00, r10, r20,
    r01, r11, r21,
    r02, r12, r22,
    tx, ty, tz,
  ];
  return shape.transform(mat);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createMeshOpsNamespace(module: any) {
  const { Manifold } = module;

  // ---- Predicates / introspection ----------------------------------------

  function intersects(a: any, b: any): boolean {
    need(isManifold(a), 'intersects(a, b): a must be a Manifold');
    need(isManifold(b), 'intersects(a, b): b must be a Manifold');
    if (a.isEmpty() || b.isEmpty()) return false;
    // Fast bbox reject — cheap and avoids a boolean for the common
    // "obviously disjoint" case.
    const ba = a.boundingBox();
    const bb = b.boundingBox();
    if (ba.max[0] < bb.min[0] || ba.min[0] > bb.max[0]) return false;
    if (ba.max[1] < bb.min[1] || ba.min[1] > bb.max[1]) return false;
    if (ba.max[2] < bb.min[2] || ba.min[2] > bb.max[2]) return false;
    // Need the real boolean — bbox overlap doesn't imply geometric overlap.
    const inter = a.intersect(b);
    const empty = inter.isEmpty();
    // The engine tracks this intermediate, so we don't .delete() here.
    return !empty;
  }

  function contains(outer: any, inner: any): boolean {
    need(isManifold(outer), 'contains(outer, inner): outer must be a Manifold');
    need(isManifold(inner), 'contains(outer, inner): inner must be a Manifold');
    if (inner.isEmpty()) return true;
    if (outer.isEmpty()) return false;
    // inner ⊂ outer iff (inner − outer) is empty.
    const diff = inner.subtract(outer);
    return diff.isEmpty();
  }

  function pointInside(m: any, point: unknown): boolean {
    need(isManifold(m), 'pointInside(m, point): m must be a Manifold');
    need(isVec3(point), 'pointInside(m, point): point must be a [x,y,z] vector');
    const p = point as Vec3;
    if (m.isEmpty()) return false;
    // Quick reject against the bbox.
    const bb = m.boundingBox();
    if (p[0] < bb.min[0] || p[0] > bb.max[0]) return false;
    if (p[1] < bb.min[1] || p[1] > bb.max[1]) return false;
    if (p[2] < bb.min[2] || p[2] > bb.max[2]) return false;
    // Tiny cube intersection — robust enough for "is this point inside the solid"
    // without writing ray-casting against the mesh. Epsilon scales with the
    // bbox so it works for both 1mm parts and 1km terrain.
    const sx = Math.max(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2], 1);
    const eps = sx * 1e-5;
    const probe = Manifold.cube([eps, eps, eps], true).translate(p);
    const inter = probe.intersect(m);
    return !inter.isEmpty();
  }

  function bbox(m: any): BBoxInfo {
    need(isManifold(m), 'bbox(m): m must be a Manifold');
    return bboxInfo(m);
  }

  function componentBounds(m: any): ComponentInfo[] {
    need(isManifold(m), 'componentBounds(m): m must be a Manifold');
    if (m.isEmpty()) return [];
    const pieces = m.decompose();
    const out: ComponentInfo[] = [];
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      out.push({
        index: i,
        volume: p.volume(),
        triangleCount: p.numTri(),
        vertexCount: p.numVert(),
        bbox: bboxInfo(p),
      });
    }
    // Sort largest-volume first — the agent almost always wants the "main" body
    // at index 0 and the leak/satellite at index 1+.
    out.sort((a, b) => b.volume - a.volume);
    for (let i = 0; i < out.length; i++) out[i].index = i;
    return out;
  }

  function volumeDelta(a: any, b: any): number {
    need(isManifold(a), 'volumeDelta(a, b): a must be a Manifold');
    need(isManifold(b), 'volumeDelta(a, b): b must be a Manifold');
    return b.volume() - a.volume();
  }

  // ---- Alignment ---------------------------------------------------------

  interface AlignOpts {
    x?: AlignMode;
    y?: AlignMode;
    z?: AlignMode;
  }

  /** Resolve the target argument into a bbox-shaped object. Accepts a Manifold,
   *  the string 'origin' (a zero-extent bbox at world (0,0,0)), or a plain
   *  bbox literal `{ min:[…], max:[…] }`. This lets users say
   *  `alignTo(shape, 'origin', {x:'center'})` to drop a shape onto the world
   *  axis without inventing a target Manifold. */
  function resolveAlignTarget(target: unknown, name: string): BBoxInfo {
    if (target === 'origin') {
      return { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0], center: [0, 0, 0] };
    }
    if (target && typeof target === 'object'
        && Array.isArray((target as { min?: unknown }).min)
        && Array.isArray((target as { max?: unknown }).max)) {
      const t = target as { min: number[]; max: number[] };
      need(t.min.length === 3 && t.max.length === 3, `${name}: bbox target must have 3-element min/max arrays`);
      for (let i = 0; i < 3; i++) {
        need(isFiniteNum(t.min[i]) && isFiniteNum(t.max[i]), `${name}: bbox target min/max must be finite numbers`);
      }
      const min: Vec3 = [t.min[0], t.min[1], t.min[2]];
      const max: Vec3 = [t.max[0], t.max[1], t.max[2]];
      return {
        min, max,
        size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
        center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
      };
    }
    if (isManifold(target)) return bboxInfo(target);
    throw new Error(`meshOps: ${name}: target must be a Manifold, the string 'origin', or { min:[x,y,z], max:[x,y,z] }`);
  }

  function alignTo(shape: any, target: any, opts: AlignOpts): any {
    need(isManifold(shape), 'alignTo(shape, target, opts): shape must be a Manifold');
    need(opts && typeof opts === 'object', 'alignTo requires an options object {x?, y?, z?}');
    const allowed = ['x', 'y', 'z'];
    for (const k of Object.keys(opts)) {
      if (!allowed.includes(k)) throw new Error(`meshOps: alignTo: unknown option "${k}" (allowed: x, y, z)`);
    }
    const sb = bboxInfo(shape);
    const tb = resolveAlignTarget(target, 'alignTo');
    const dx = alignOffset(sb.min[0], sb.max[0], tb.min[0], tb.max[0], opts.x);
    const dy = alignOffset(sb.min[1], sb.max[1], tb.min[1], tb.max[1], opts.y);
    const dz = alignOffset(sb.min[2], sb.max[2], tb.min[2], tb.max[2], opts.z);
    return shape.translate([dx, dy, dz]);
  }

  interface PlaceOnOpts {
    at?: 'center' | 'preserve' | [number, number];
    /** Vertical gap between target's top and shape's bottom; default 0.
     *  Use a small negative value (e.g. -0.5) to overlap volumetrically so
     *  the boolean union actually fuses the parts instead of leaving a seam. */
    gap?: number;
  }

  function placeOn(shape: any, target: any, opts: PlaceOnOpts = {}): any {
    need(isManifold(shape), 'placeOn(shape, target): shape must be a Manifold');
    need(isManifold(target), 'placeOn(shape, target): target must be a Manifold');
    const allowed = ['at', 'gap'];
    for (const k of Object.keys(opts)) {
      if (!allowed.includes(k)) throw new Error(`meshOps: placeOn: unknown option "${k}" (allowed: at, gap)`);
    }
    const gap = opts.gap ?? 0;
    need(isFiniteNum(gap), 'placeOn.gap must be a number');
    const sb = bboxInfo(shape);
    const tb = bboxInfo(target);
    // Z: shape bottom sits on target top (+ gap).
    const dz = tb.max[2] - sb.min[2] + gap;
    let cx: number, cy: number;
    if (opts.at === 'preserve') {
      // Keep the shape's own XY — only the Z lift happens. Useful when the
      // shape was already positioned correctly horizontally (e.g. placing a
      // platform on an off-axis target whose bbox center isn't what you want
      // to align to).
      cx = sb.center[0];
      cy = sb.center[1];
    } else if (opts.at === undefined || opts.at === 'center') {
      cx = tb.center[0];
      cy = tb.center[1];
    } else {
      need(Array.isArray(opts.at) && opts.at.length === 2 && isFiniteNum(opts.at[0]) && isFiniteNum(opts.at[1]),
        'placeOn.at must be "center", "preserve", or a [x, y] vector');
      cx = opts.at[0];
      cy = opts.at[1];
    }
    const dx = cx - sb.center[0];
    const dy = cy - sb.center[1];
    return shape.translate([dx, dy, dz]);
  }

  function mirror(shape: any, plane: unknown): any {
    need(isManifold(shape), 'mirror(shape, plane): shape must be a Manifold');
    const normal = parsePlaneNormal(plane, 'mirror');
    return shape.mirror(normal);
  }

  function mirrorCopy(shape: any, plane: unknown): any {
    need(isManifold(shape), 'mirrorCopy(shape, plane): shape must be a Manifold');
    const normal = parsePlaneNormal(plane, 'mirrorCopy');
    return Manifold.union([shape, shape.mirror(normal)]);
  }

  // ---- Patterns ----------------------------------------------------------

  function linearPattern(shape: any, count: number, step: Vec3Or1): any {
    need(isManifold(shape), 'linearPattern(shape, count, step): shape must be a Manifold');
    need(Number.isInteger(count) && count >= 1, 'linearPattern.count must be a positive integer');
    let stepVec: Vec3;
    if (isFiniteNum(step)) stepVec = [step as number, 0, 0];
    else if (Array.isArray(step) && step.length === 2 && isFiniteNum(step[0]) && isFiniteNum(step[1])) stepVec = [step[0] as number, step[1] as number, 0];
    else if (isVec3(step)) stepVec = step;
    else throw new Error('meshOps: linearPattern.step must be a number (X) or a [x,y] / [x,y,z] vector');
    if (count === 1) return shape;
    const parts: any[] = [];
    for (let i = 0; i < count; i++) {
      parts.push(shape.translate([stepVec[0] * i, stepVec[1] * i, stepVec[2] * i]));
    }
    return Manifold.union(parts);
  }

  interface CircularPatternOpts {
    axis?: 'x' | 'y' | 'z' | Vec3;
    /** Total spread in degrees.
     *  Endpoint convention:
     *  - `angle === ±360` (full ring) → N copies at 360/N spacing, NO duplicate
     *    at the seam (step = total/count).
     *  - any other angle (partial arc) → endpoints INCLUSIVE; first copy at 0°,
     *    last copy at `angle°` (step = total/(count-1)).
     *  Default: 360 (full ring). */
    angle?: number;
    /** Rotation center; default [0,0,0]. */
    center?: Vec3;
    /** Shortcut: translate the shape by `[radius, 0, 0]` (then any axis-specific
     *  permutation) BEFORE rotating it into the ring. Lets you write
     *  `circularPattern(stud, 8, { radius: 25 })` instead of pre-translating
     *  the stud yourself. */
    radius?: number;
  }

  function circularPattern(shape: any, count: number, opts: CircularPatternOpts = {}): any {
    need(isManifold(shape), 'circularPattern(shape, count, opts?): shape must be a Manifold');
    need(Number.isInteger(count) && count >= 1, 'circularPattern.count must be a positive integer');
    const allowed = ['axis', 'angle', 'center', 'radius'];
    for (const k of Object.keys(opts)) {
      if (!allowed.includes(k)) throw new Error(`meshOps: circularPattern: unknown option "${k}" (allowed: axis, angle, center, radius)`);
    }
    const axis = parseAxis(opts.axis, 'circularPattern');
    const totalAngle = opts.angle ?? 360;
    need(isFiniteNum(totalAngle), 'circularPattern.angle must be a number');
    const center = opts.center;
    if (center !== undefined) need(isVec3(center), 'circularPattern.center must be a [x,y,z] vector');
    if (opts.radius !== undefined) need(isFiniteNum(opts.radius), 'circularPattern.radius must be a number');

    // Apply the radius shortcut. The default orientation pushes "outward" from
    // the rotation center along the in-plane axis that's NOT the rotation axis:
    //   axis=z → push along +X (the canonical "12 o'clock" position pre-rotation)
    //   axis=y → push along +X (so blades fan in the XZ plane, like a turbine)
    //   axis=x → push along +Y
    //   general → push along the canonical "out" direction
    //              (whichever world axis has the smallest |dot| with the rotation axis)
    let positioned = shape;
    if (opts.radius !== undefined && opts.radius !== 0) {
      const r = opts.radius;
      let push: Vec3;
      const ax = Math.abs(axis[0]), ay = Math.abs(axis[1]), az = Math.abs(axis[2]);
      // Pick the world axis least aligned with the rotation axis, so the radial
      // direction is genuinely orthogonal to the axis of rotation.
      if (ax <= ay && ax <= az) push = [r, 0, 0];
      else if (ay <= az) push = [0, r, 0];
      else push = [0, 0, r];
      positioned = positioned.translate(push);
    }

    if (count === 1) return positioned;

    // Endpoint convention (see opts.angle docs above): full ring divides by N,
    // partial arc divides by N-1. Matches Curves.ringCopy.
    const denom = Math.abs(Math.abs(totalAngle) - 360) < 1e-9 ? count : Math.max(1, count - 1);
    const parts: any[] = [];
    for (let i = 0; i < count; i++) {
      const a = (i / denom) * totalAngle;
      parts.push(rotateAroundAxis(positioned, axis, a, center));
    }
    return Manifold.union(parts);
  }

  // ---- Spiral pattern (rotate + axial rise per copy) --------------------

  interface SpiralPatternOpts {
    axis?: 'x' | 'y' | 'z' | Vec3;
    /** Rotation per copy in degrees. */
    anglePerCopy: number;
    /** Translation per copy along the rotation axis. */
    risePerCopy: number;
    /** Rotation center; default [0,0,0]. The rise translates along the axis,
     *  not from the center, so center only affects the rotation. */
    center?: Vec3;
  }

  /** N copies arranged in a helix: each copy rotated by `anglePerCopy` AND
   *  translated by `risePerCopy` along the rotation axis. The "staircase"
   *  pattern that no single helper could express before — pairing with
   *  `expectUnion` validates the steps actually all merged. */
  function spiralPattern(shape: any, count: number, opts: SpiralPatternOpts): any {
    need(isManifold(shape), 'spiralPattern(shape, count, opts): shape must be a Manifold');
    need(Number.isInteger(count) && count >= 1, 'spiralPattern.count must be a positive integer');
    need(opts && typeof opts === 'object', 'spiralPattern: opts is required (anglePerCopy, risePerCopy)');
    const allowed = ['axis', 'anglePerCopy', 'risePerCopy', 'center'];
    for (const k of Object.keys(opts)) {
      if (!allowed.includes(k)) throw new Error(`meshOps: spiralPattern: unknown option "${k}" (allowed: axis, anglePerCopy, risePerCopy, center)`);
    }
    need(isFiniteNum(opts.anglePerCopy), 'spiralPattern.anglePerCopy must be a number');
    need(isFiniteNum(opts.risePerCopy), 'spiralPattern.risePerCopy must be a number');
    if (opts.center !== undefined) need(isVec3(opts.center), 'spiralPattern.center must be a [x,y,z] vector');
    const axis = parseAxis(opts.axis, 'spiralPattern');
    if (count === 1) return shape;
    const parts: any[] = [];
    for (let i = 0; i < count; i++) {
      const rot = rotateAroundAxis(shape, axis, i * opts.anglePerCopy, opts.center);
      const rise = i * opts.risePerCopy;
      const lift: Vec3 = [axis[0] * rise, axis[1] * rise, axis[2] * rise];
      parts.push(rot.translate(lift));
    }
    return Manifold.union(parts);
  }

  // ---- Robust booleans / heal -------------------------------------------

  interface UnionOpts {
    /** Expected number of connected components in the result. If the actual
     *  count differs, throws with a diagnostic message. */
    expectComponents?: number;
  }

  function expectUnion(parts: any[], opts: UnionOpts = {}): any {
    need(Array.isArray(parts) && parts.length > 0, 'expectUnion(parts, opts?): parts must be a non-empty array of Manifolds');
    for (let i = 0; i < parts.length; i++) {
      need(isManifold(parts[i]), `expectUnion: parts[${i}] must be a Manifold`);
    }
    const result = Manifold.union(parts);
    const expected = opts.expectComponents;
    if (expected !== undefined) {
      need(Number.isInteger(expected) && expected >= 0, 'expectUnion.expectComponents must be a non-negative integer');
      const pieces = result.decompose();
      const actual = pieces.length;
      if (actual !== expected) {
        // Include per-piece bbox/volume in the error so the agent can see at a
        // glance which component is the orphan. Sorted largest-first.
        const summary = pieces
          .map((p: any) => ({ vol: p.volume(), bb: p.boundingBox() }))
          .sort((a: { vol: number }, b: { vol: number }) => b.vol - a.vol)
          .slice(0, 6) // cap output so a 50-piece blast doesn't flood the log
          .map(({ vol, bb }: { vol: number; bb: { min: number[]; max: number[] } }, i: number) =>
            `[${i}] vol=${vol.toFixed(2)} bbox=([${bb.min[0].toFixed(1)},${bb.min[1].toFixed(1)},${bb.min[2].toFixed(1)}] → [${bb.max[0].toFixed(1)},${bb.max[1].toFixed(1)},${bb.max[2].toFixed(1)}])`)
          .join('; ');
        const tail = actual > 6 ? `; …${actual - 6} more` : '';
        throw new Error(
          `meshOps: expectUnion: expected ${expected} component(s) but got ${actual}. ` +
          (actual > expected
            ? 'Inputs likely don\'t overlap enough — translate them so they share ~0.5+ units of volume.'
            : 'Inputs overlap more than expected — re-check positions.') +
          `\nComponents (largest first): ${summary}${tail}`,
        );
      }
    }
    return result;
  }

  /** Standalone "is this manifold the expected number of components?" predicate.
   *  Useful as a runtime invariant check after any boolean op without having
   *  to re-shape the union into expectUnion. Returns the actual count when ok,
   *  throws with bbox-per-piece detail when mismatched. */
  function expectComponents(m: any, expected: number): number {
    need(isManifold(m), 'expectComponents(m, expected): m must be a Manifold');
    need(Number.isInteger(expected) && expected >= 0, 'expectComponents.expected must be a non-negative integer');
    const pieces = m.decompose();
    const actual = pieces.length;
    if (actual === expected) return actual;
    const summary = pieces
      .map((p: any) => ({ vol: p.volume(), bb: p.boundingBox() }))
      .sort((a: { vol: number }, b: { vol: number }) => b.vol - a.vol)
      .slice(0, 6)
      .map(({ vol, bb }: { vol: number; bb: { min: number[]; max: number[] } }, i: number) =>
        `[${i}] vol=${vol.toFixed(2)} bbox=([${bb.min[0].toFixed(1)},${bb.min[1].toFixed(1)},${bb.min[2].toFixed(1)}] → [${bb.max[0].toFixed(1)},${bb.max[1].toFixed(1)},${bb.max[2].toFixed(1)}])`)
      .join('; ');
    const tail = actual > 6 ? `; …${actual - 6} more` : '';
    throw new Error(
      `meshOps: expectComponents: expected ${expected} component(s) but got ${actual}.\nComponents (largest first): ${summary}${tail}`,
    );
  }

  function expectDifference(a: any, b: any, opts: { expectNonEmpty?: boolean } = {}): any {
    need(isManifold(a), 'expectDifference(a, b, opts?): a must be a Manifold');
    need(isManifold(b), 'expectDifference(a, b, opts?): b must be a Manifold');
    const result = a.subtract(b);
    if (opts.expectNonEmpty && result.isEmpty()) {
      throw new Error('meshOps: expectDifference: result is empty — b fully contained a, or a was empty to start with.');
    }
    return result;
  }

  interface HealOpts {
    /** Tolerance for simplify (default: 0 → manifold-3d picks its own epsilon). */
    tolerance?: number;
  }

  function heal(m: any, opts: HealOpts = {}): any {
    need(isManifold(m), 'heal(m, opts?): m must be a Manifold');
    if (opts.tolerance !== undefined) need(isFiniteNum(opts.tolerance) && opts.tolerance >= 0, 'heal.tolerance must be >= 0');
    // .simplify(tol) in manifold-3d collapses edges shorter than `tol` and re-runs
    // the boolean-cleanup pass. Passing 0 means "don't collapse anything based on
    // length, just re-run the cleanup" — the lightest-touch heal, which is what
    // we want for fixing STL imports / failed-boolean residue without destroying
    // detail. Callers can pass an explicit tolerance for an aggressive pass.
    const tol = opts.tolerance ?? 0;
    const cleaned = m.simplify(tol);
    const status = typeof cleaned.status === 'function' ? cleaned.status() : 0;
    if (status && status !== 0 && status !== 'NoError') {
      throw new Error(`meshOps: heal: manifold-3d still reports status=${status} after simplify. Try Manifold.ofMesh(m.getMesh()) to rebuild from scratch.`);
    }
    return cleaned;
  }

  return {
    // predicates
    intersects,
    contains,
    pointInside,
    bbox,
    componentBounds,
    volumeDelta,
    // alignment
    alignTo,
    placeOn,
    mirror,
    mirrorCopy,
    // patterns
    linearPattern,
    circularPattern,
    spiralPattern,
    // robust booleans / heal
    expectUnion,
    expectDifference,
    expectComponents,
    heal,
  };
}

export type MeshOpsNamespace = ReturnType<typeof createMeshOpsNamespace>;

// ---------------------------------------------------------------------------
// Pure-logic helpers exported for unit testing (no manifold-3d dependency).
// ---------------------------------------------------------------------------

/** Resolve an alignTo target — exported pure so unit tests can exercise the
 *  'origin' / bbox-literal / Manifold dispatch without spinning up WASM.
 *  Module-level so callers outside `createMeshOpsNamespace` can reuse it. */
function resolveAlignTargetPure(target: unknown, name: string): BBoxInfo {
  if (target === 'origin') {
    return { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0], center: [0, 0, 0] };
  }
  if (target && typeof target === 'object'
      && Array.isArray((target as { min?: unknown }).min)
      && Array.isArray((target as { max?: unknown }).max)) {
    const t = target as { min: number[]; max: number[] };
    if (t.min.length !== 3 || t.max.length !== 3) {
      throw new Error(`meshOps: ${name}: bbox target must have 3-element min/max arrays`);
    }
    for (let i = 0; i < 3; i++) {
      if (!isFiniteNum(t.min[i]) || !isFiniteNum(t.max[i])) {
        throw new Error(`meshOps: ${name}: bbox target min/max must be finite numbers`);
      }
    }
    const min: Vec3 = [t.min[0], t.min[1], t.min[2]];
    const max: Vec3 = [t.max[0], t.max[1], t.max[2]];
    return {
      min, max,
      size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
      center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    };
  }
  throw new Error(`meshOps: ${name}: target must be a Manifold, the string 'origin', or { min:[x,y,z], max:[x,y,z] }`);
}

export const __testables__ = {
  alignOffset,
  parsePlaneNormal,
  parseAxis,
  isVec3,
  resolveAlignTargetPure,
};
