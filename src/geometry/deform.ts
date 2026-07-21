// Friendly named deforms over `Manifold.warp` — the meshOps analogue of
// Blender's Simple Deform + Curve modifiers. Raw `.warp(fn)` is powerful but
// makes agents (and users) do the trig; these wrap the four deforms everyone
// actually wants — wrap-around-a-cylinder (text on mugs), bend, twist, taper —
// plus `alongCurve` for sweeping a modeled strip along a 3D polyline.
//
// All of them auto-refine the mesh first (`refineToLength`) because warping a
// coarse tessellation just shears its few triangles: a cube bent 90° without
// refinement is still 12 triangles and shows no curve at all. The default
// segment length targets ~2° of arc per edge; `segmentLength` overrides it and
// `refine: false` disables (for pre-refined input).
//
// Pure warp-function builders are exported for unit tests (no WASM needed).

/* eslint-disable @typescript-eslint/no-explicit-any */

export type Vec3 = [number, number, number];

const DEG = Math.PI / 180;
/** Target arc per refined edge (radians) — ~2° reads smooth at any radius. */
const ARC_PER_EDGE = 2 * DEG;
/** Post-refine triangle budget — a too-fine segmentLength fails by name
 *  instead of hanging the worker. */
const REFINE_TRI_BUDGET = 3_000_000;

function need(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`meshOps: ${msg}`);
}

function isManifold(v: any): boolean {
  return !!v && typeof v.boundingBox === 'function' && typeof v.translate === 'function' && typeof v.getMesh === 'function';
}

function isFiniteNum(v: any): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isVec3(v: any): v is Vec3 {
  return Array.isArray(v) && v.length === 3 && isFiniteNum(v[0]) && isFiniteNum(v[1]) && isFiniteNum(v[2]);
}

function rejectUnknown(opts: Record<string, unknown>, allowed: string[], name: string): void {
  for (const k of Object.keys(opts)) {
    if (!allowed.includes(k)) throw new Error(`meshOps: ${name}: unknown option "${k}" (allowed: ${allowed.join(', ')})`);
  }
}

/** Refine so warped edges read smooth, then verify the budget. */
function refineFor(shape: any, segmentLength: number, refine: boolean | undefined, name: string): any {
  if (refine === false) return shape;
  need(isFiniteNum(segmentLength) && segmentLength > 0, `${name}.segmentLength must be > 0`);
  const refined = typeof shape.refineToLength === 'function' ? shape.refineToLength(segmentLength) : shape;
  const tris = refined.numTri();
  if (tris > REFINE_TRI_BUDGET) {
    throw new Error(
      `meshOps: ${name}: refining to ${segmentLength.toFixed(3)}-unit edges produced ${Math.round(tris / 1000)}k triangles ` +
      `(budget ${REFINE_TRI_BUDGET / 1000}k). Pass a larger segmentLength (or refine: false).`,
    );
  }
  return refined;
}

// ---------------------------------------------------------------------------
// Pure warp-function builders (unit-testable)
// ---------------------------------------------------------------------------

/** Cylindrical wrap about the Z axis: input X becomes azimuth (arc length is
 *  preserved at radius), input Y becomes radial offset (outward), input Z runs
 *  along the cylinder axis. x=0 lands at the front of the cylinder (−Y), so a
 *  shape centered on x=0 wraps symmetrically about the front. */
export function makeWrapFn(radius: number, angleOffsetRad: number): (v: number[]) => void {
  return (v) => {
    const theta = v[0] / radius + angleOffsetRad;
    const r = radius + v[1];
    v[0] = r * Math.sin(theta);
    v[1] = -r * Math.cos(theta);
    // v[2] unchanged
  };
}

/** Bend the X extent [x0, x1] into an arc of `angleRad` in the XY plane
 *  (positive bends the ends toward +Y). Vertices at y=yRef keep their arc
 *  length; the bend pivots about the segment's X center. */
export function makeBendFn(x0: number, x1: number, yRef: number, angleRad: number): (v: number[]) => void {
  const span = Math.max(x1 - x0, 1e-9);
  const cx = (x0 + x1) / 2;
  const R = span / angleRad; // signed
  return (v) => {
    const theta = ((v[0] - cx) / span) * angleRad;
    const r = R - (v[1] - yRef);
    v[0] = cx + r * Math.sin(theta);
    v[1] = yRef + R - r * Math.cos(theta);
  };
}

/** Twist about an axis: rotate each vertex about `axis` (through the shape's
 *  axis-extent) by `degrees · t`, t = normalized position along the axis. */
export function makeTwistFn(axisIdx: 0 | 1 | 2, h0: number, h1: number, totalRad: number): (v: number[]) => void {
  const span = Math.max(h1 - h0, 1e-9);
  const [i, j] = axisIdx === 2 ? [0, 1] : axisIdx === 0 ? [1, 2] : [2, 0];
  return (v) => {
    const t = (v[axisIdx] - h0) / span;
    const a = totalRad * t;
    const c = Math.cos(a), s = Math.sin(a);
    const p = v[i], q = v[j];
    v[i] = p * c - q * s;
    v[j] = p * s + q * c;
  };
}

/** Taper along an axis: scale the two perpendicular coordinates by
 *  lerp(scaleBottom, scaleTop, t) about the axis line through (cI, cJ). */
export function makeTaperFn(
  axisIdx: 0 | 1 | 2, h0: number, h1: number,
  scaleBottom: [number, number], scaleTop: [number, number],
  cI: number, cJ: number,
): (v: number[]) => void {
  const span = Math.max(h1 - h0, 1e-9);
  const [i, j] = axisIdx === 2 ? [0, 1] : axisIdx === 0 ? [1, 2] : [2, 0];
  return (v) => {
    const t = Math.min(Math.max((v[axisIdx] - h0) / span, 0), 1);
    const si = scaleBottom[0] + (scaleTop[0] - scaleBottom[0]) * t;
    const sj = scaleBottom[1] + (scaleTop[1] - scaleBottom[1]) * t;
    v[i] = cI + (v[i] - cI) * si;
    v[j] = cJ + (v[j] - cJ) * sj;
  };
}

export interface CurveFrame {
  /** Cumulative arc length at this polyline vertex. */
  s: number;
  p: Vec3;
  t: Vec3;
  n: Vec3;
  b: Vec3;
}

/** Parallel-transport frames along a polyline. The initial normal is `up` with
 *  the tangential component removed; each subsequent frame rotates the previous
 *  normal by the minimal rotation between segment tangents (so the strip never
 *  spontaneously flips). */
export function buildCurveFrames(points: Vec3[], up: Vec3): CurveFrame[] {
  const frames: CurveFrame[] = [];
  const segT: Vec3[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1][0] - points[i][0];
    const dy = points[i + 1][1] - points[i][1];
    const dz = points[i + 1][2] - points[i][2];
    const len = Math.hypot(dx, dy, dz) || 1;
    segT.push([dx / len, dy / len, dz / len]);
  }
  // Vertex tangent = normalized average of adjacent segment tangents.
  const vertT: Vec3[] = points.map((_, i) => {
    const a = segT[Math.max(0, i - 1)];
    const b = segT[Math.min(segT.length - 1, i)];
    const tx = a[0] + b[0], ty = a[1] + b[1], tz = a[2] + b[2];
    const len = Math.hypot(tx, ty, tz) || 1;
    return [tx / len, ty / len, tz / len];
  });
  // Initial normal: up minus its tangential component.
  const t0 = vertT[0];
  let ndot = up[0] * t0[0] + up[1] * t0[1] + up[2] * t0[2];
  let n: Vec3 = [up[0] - ndot * t0[0], up[1] - ndot * t0[1], up[2] - ndot * t0[2]];
  let nlen = Math.hypot(n[0], n[1], n[2]);
  if (nlen < 1e-9) {
    // up parallel to the tangent — pick any perpendicular.
    n = Math.abs(t0[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    ndot = n[0] * t0[0] + n[1] * t0[1] + n[2] * t0[2];
    n = [n[0] - ndot * t0[0], n[1] - ndot * t0[1], n[2] - ndot * t0[2]];
    nlen = Math.hypot(n[0], n[1], n[2]);
  }
  n = [n[0] / nlen, n[1] / nlen, n[2] / nlen];

  let s = 0;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) {
      const dx = points[i][0] - points[i - 1][0];
      const dy = points[i][1] - points[i - 1][1];
      const dz = points[i][2] - points[i - 1][2];
      s += Math.hypot(dx, dy, dz);
      // Parallel-transport n from the previous tangent to this one: rotate by
      // the minimal rotation taking tPrev to tCur (Rodrigues about their cross).
      const tp = vertT[i - 1], tc = vertT[i];
      const cx = tp[1] * tc[2] - tp[2] * tc[1];
      const cy = tp[2] * tc[0] - tp[0] * tc[2];
      const cz = tp[0] * tc[1] - tp[1] * tc[0];
      const sinA = Math.hypot(cx, cy, cz);
      const cosA = tp[0] * tc[0] + tp[1] * tc[1] + tp[2] * tc[2];
      if (sinA > 1e-9) {
        const ax = cx / sinA, ay = cy / sinA, az = cz / sinA;
        const t1 = 1 - cosA;
        const rn: Vec3 = [
          (t1 * ax * ax + cosA) * n[0] + (t1 * ax * ay - sinA * az) * n[1] + (t1 * ax * az + sinA * ay) * n[2],
          (t1 * ax * ay + sinA * az) * n[0] + (t1 * ay * ay + cosA) * n[1] + (t1 * ay * az - sinA * ax) * n[2],
          (t1 * ax * az - sinA * ay) * n[0] + (t1 * ay * az + sinA * ax) * n[1] + (t1 * az * az + cosA) * n[2],
        ];
        const rl = Math.hypot(rn[0], rn[1], rn[2]) || 1;
        n = [rn[0] / rl, rn[1] / rl, rn[2] / rl];
      }
    }
    const t = vertT[i];
    // Re-orthogonalize n against t (drift guard), then b = t × n.
    const d = n[0] * t[0] + n[1] * t[1] + n[2] * t[2];
    let nn: Vec3 = [n[0] - d * t[0], n[1] - d * t[1], n[2] - d * t[2]];
    const nl = Math.hypot(nn[0], nn[1], nn[2]) || 1;
    nn = [nn[0] / nl, nn[1] / nl, nn[2] / nl];
    const b: Vec3 = [
      t[1] * nn[2] - t[2] * nn[1],
      t[2] * nn[0] - t[0] * nn[2],
      t[0] * nn[1] - t[1] * nn[0],
    ];
    frames.push({ s, p: points[i], t, n: nn, b });
    n = nn;
  }
  return frames;
}

/** Warp mapping the shape's X extent [x0, x1] onto the polyline arclength:
 *  position = P(s) + n̂(s)·y + b̂(s)·z. X beyond the curve extends straight
 *  along the end tangents. */
export function makeAlongCurveFn(frames: CurveFrame[], x0: number): (v: number[]) => void {
  const total = frames[frames.length - 1].s;
  return (v) => {
    const s = v[0] - x0;
    // Find the frame segment (linear scan is fine — frames are few; vertices
    // dominate). Binary search for longer polylines.
    let i = 0;
    let hi = frames.length - 1;
    if (s >= frames[hi].s) {
      i = hi - 1;
    } else if (s > 0) {
      let lo = 0;
      while (lo + 1 < hi) {
        const mid = (lo + hi) >> 1;
        if (frames[mid].s <= s) lo = mid;
        else hi = mid;
      }
      i = lo;
    }
    const f0 = frames[i], f1 = frames[i + 1];
    const segLen = Math.max(f1.s - f0.s, 1e-9);
    const u = (s - f0.s) / segLen; // may be <0 or >1 at the overhanging ends
    const uc = Math.min(Math.max(u, 0), 1);
    const overhang = s < 0 ? s : s > total ? s - total : 0;
    // nlerp the frame across the segment.
    const mix = (a: Vec3, b: Vec3): Vec3 => {
      const m: Vec3 = [a[0] + (b[0] - a[0]) * uc, a[1] + (b[1] - a[1]) * uc, a[2] + (b[2] - a[2]) * uc];
      const l = Math.hypot(m[0], m[1], m[2]) || 1;
      return [m[0] / l, m[1] / l, m[2] / l];
    };
    const t = mix(f0.t, f1.t);
    const n = mix(f0.n, f1.n);
    const b = mix(f0.b, f1.b);
    const px = f0.p[0] + (f1.p[0] - f0.p[0]) * uc + t[0] * overhang;
    const py = f0.p[1] + (f1.p[1] - f0.p[1]) * uc + t[1] * overhang;
    const pz = f0.p[2] + (f1.p[2] - f0.p[2]) * uc + t[2] * overhang;
    const y = v[1], z = v[2];
    v[0] = px + n[0] * y + b[0] * z;
    v[1] = py + n[1] * y + b[1] * z;
    v[2] = pz + n[2] * y + b[2] * z;
  };
}

// ---------------------------------------------------------------------------
// Factory (Manifold-touching)
// ---------------------------------------------------------------------------

export function createDeformOps(_module: any) {
  interface WrapOpts {
    /** Cylinder radius the shape's y=0 plane wraps onto. */
    radius: number;
    /** Cylinder axis in world space (default 'z'). The input mapping is always
     *  X→circumference, Y→radial (outward), Z→along the axis; for 'x'/'y' the
     *  wrapped result is rotated so the cylinder axis lands on that world axis. */
    axis?: 'x' | 'y' | 'z';
    /** Extra rotation around the cylinder (degrees); 0 centers x=0 at the front (−Y). */
    angleOffset?: number;
    segmentLength?: number;
    refine?: boolean;
  }

  /** Wrap a flat shape around a cylinder — engraved/embossed text on a mug,
   *  a relief band around a vase. Author the shape flat: content along X,
   *  thickness along Y (outward = +Y), height along Z. Arc length along the
   *  y=0 plane is preserved, so an X span of 2πr wraps a full turn. */
  function wrapAround(shape: any, opts: WrapOpts): any {
    need(isManifold(shape), 'wrapAround(shape, opts): shape must be a Manifold');
    need(opts && typeof opts === 'object', 'wrapAround: opts object with { radius } is required');
    rejectUnknown(opts as any, ['radius', 'axis', 'angleOffset', 'segmentLength', 'refine'], 'wrapAround');
    need(isFiniteNum(opts.radius) && opts.radius > 0, 'wrapAround.radius must be a positive number');
    const axis = opts.axis ?? 'z';
    need(axis === 'x' || axis === 'y' || axis === 'z', "wrapAround.axis must be 'x', 'y' or 'z'");
    const angleOffset = opts.angleOffset ?? 0;
    need(isFiniteNum(angleOffset), 'wrapAround.angleOffset must be a number');
    const bb = shape.boundingBox();
    const spanX = bb.max[0] - bb.min[0];
    const wrapped = spanX / opts.radius;
    if (wrapped > Math.PI * 2 + 1e-6) {
      throw new Error(
        `meshOps: wrapAround: the shape spans ${spanX.toFixed(1)} units along X but a radius of ${opts.radius} ` +
        `wraps a full turn in ${(Math.PI * 2 * opts.radius).toFixed(1)} units — the ends would overlap themselves. ` +
        `Use a larger radius or a narrower shape.`,
      );
    }
    if (bb.min[1] <= -opts.radius) {
      throw new Error(
        `meshOps: wrapAround: the shape reaches y=${bb.min[1].toFixed(2)}, at or beyond the cylinder axis ` +
        `(radius ${opts.radius}) — inner geometry would invert. Keep y > −radius (thin shapes near y=0 are ideal).`,
      );
    }
    const segDefault = opts.radius * ARC_PER_EDGE;
    const refined = refineFor(shape, opts.segmentLength ?? segDefault, opts.refine, 'wrapAround');
    let out = refined.warp(makeWrapFn(opts.radius, angleOffset * DEG));
    if (axis === 'x') out = out.rotate([0, -90, 0]);
    else if (axis === 'y') out = out.rotate([90, 0, 0]).rotate([0, 0, 180]);
    return out;
  }

  interface BendOpts {
    /** Total bend angle in degrees; positive bends the ends toward +Y. */
    angle: number;
    segmentLength?: number;
    refine?: boolean;
  }

  /** Bend a shape's X extent into a circular arc in the XY plane (Z is
   *  untouched) — Blender Simple Deform's Bend. Rotate the input/result to
   *  bend in another plane. */
  function bend(shape: any, opts: BendOpts): any {
    need(isManifold(shape), 'bend(shape, opts): shape must be a Manifold');
    need(opts && typeof opts === 'object', 'bend: opts object with { angle } is required');
    rejectUnknown(opts as any, ['angle', 'segmentLength', 'refine'], 'bend');
    need(isFiniteNum(opts.angle) && opts.angle !== 0, 'bend.angle must be a non-zero number (degrees)');
    need(Math.abs(opts.angle) <= 360, 'bend.angle must be within ±360 degrees');
    const bb = shape.boundingBox();
    const spanX = Math.max(bb.max[0] - bb.min[0], 1e-9);
    const segDefault = spanX / Math.max(4, Math.abs(opts.angle) / 2); // ~2° per edge
    const refined = refineFor(shape, opts.segmentLength ?? segDefault, opts.refine, 'bend');
    const yRef = (bb.min[1] + bb.max[1]) / 2;
    return refined.warp(makeBendFn(bb.min[0], bb.max[0], yRef, opts.angle * DEG));
  }

  interface TwistOpts {
    /** Total twist in degrees across the shape's axis extent. */
    degrees: number;
    axis?: 'x' | 'y' | 'z';
    segmentLength?: number;
    refine?: boolean;
  }

  /** Twist a shape about an axis, rotation growing linearly along the extent —
   *  Blender Simple Deform's Twist, for meshes (the SDF twin is api.sdf's
   *  `.twist`). The rotation axis passes through the world origin, matching
   *  `CrossSection.extrude(h, n, twist)`. */
  function twist(shape: any, opts: TwistOpts): any {
    need(isManifold(shape), 'twist(shape, opts): shape must be a Manifold');
    need(opts && typeof opts === 'object', 'twist: opts object with { degrees } is required');
    rejectUnknown(opts as any, ['degrees', 'axis', 'segmentLength', 'refine'], 'twist');
    need(isFiniteNum(opts.degrees) && opts.degrees !== 0, 'twist.degrees must be a non-zero number');
    const axis = opts.axis ?? 'z';
    need(axis === 'x' || axis === 'y' || axis === 'z', "twist.axis must be 'x', 'y' or 'z'");
    const axisIdx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
    const bb = shape.boundingBox();
    const h0 = bb.min[axisIdx], h1 = bb.max[axisIdx];
    const span = Math.max(h1 - h0, 1e-9);
    const segDefault = span / Math.max(4, Math.abs(opts.degrees) / 2);
    const refined = refineFor(shape, opts.segmentLength ?? segDefault, opts.refine, 'twist');
    return refined.warp(makeTwistFn(axisIdx as 0 | 1 | 2, h0, h1, opts.degrees * DEG));
  }

  interface TaperOpts {
    /** Scale at the axis-max end: a number (uniform) or [sI, sJ] for the two
     *  perpendicular axes (in world order, e.g. [sx, sy] for axis 'z'). 0 is
     *  allowed but collapses to a point — print-unsafe; prefer ≥ 0.05. */
    scaleTop: number | [number, number];
    /** Scale at the axis-min end (default 1). */
    scaleBottom?: number | [number, number];
    axis?: 'x' | 'y' | 'z';
    /** Center line of the taper in the perpendicular plane; defaults to the
     *  shape's bbox center. */
    center?: [number, number];
    segmentLength?: number;
    refine?: boolean;
  }

  /** Taper a shape along an axis — Blender Simple Deform's Taper. Scales the
   *  perpendicular section linearly from `scaleBottom` (axis min) to `scaleTop`
   *  (axis max) about the shape's center line. */
  function taper(shape: any, opts: TaperOpts): any {
    need(isManifold(shape), 'taper(shape, opts): shape must be a Manifold');
    need(opts && typeof opts === 'object', 'taper: opts object with { scaleTop } is required');
    rejectUnknown(opts as any, ['scaleTop', 'scaleBottom', 'axis', 'center', 'segmentLength', 'refine'], 'taper');
    const parseScale = (v: unknown, name: string, dflt?: [number, number]): [number, number] => {
      if (v === undefined && dflt) return dflt;
      if (isFiniteNum(v)) { need(v >= 0, `${name} must be >= 0`); return [v, v]; }
      if (Array.isArray(v) && v.length === 2 && isFiniteNum(v[0]) && isFiniteNum(v[1])) {
        need(v[0] >= 0 && v[1] >= 0, `${name} components must be >= 0`);
        return [v[0], v[1]];
      }
      throw new Error(`meshOps: ${name} must be a number or a [sI, sJ] pair`);
    };
    const scaleTop = parseScale(opts.scaleTop, 'taper.scaleTop');
    const scaleBottom = parseScale(opts.scaleBottom, 'taper.scaleBottom', [1, 1]);
    const axis = opts.axis ?? 'z';
    need(axis === 'x' || axis === 'y' || axis === 'z', "taper.axis must be 'x', 'y' or 'z'");
    const axisIdx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
    const bb = shape.boundingBox();
    const [i, j] = axisIdx === 2 ? [0, 1] : axisIdx === 0 ? [1, 2] : [2, 0];
    let cI = (bb.min[i] + bb.max[i]) / 2;
    let cJ = (bb.min[j] + bb.max[j]) / 2;
    if (opts.center !== undefined) {
      need(Array.isArray(opts.center) && opts.center.length === 2 && isFiniteNum(opts.center[0]) && isFiniteNum(opts.center[1]),
        'taper.center must be a [cI, cJ] pair');
      cI = opts.center[0];
      cJ = opts.center[1];
    }
    const span = Math.max(bb.max[axisIdx] - bb.min[axisIdx], 1e-9);
    // Taper is linear, so curvature is mild — refine at ~1/12 of the extent.
    const refined = refineFor(shape, opts.segmentLength ?? span / 12, opts.refine, 'taper');
    return refined.warp(makeTaperFn(axisIdx as 0 | 1 | 2, bb.min[axisIdx], bb.max[axisIdx], scaleBottom, scaleTop, cI, cJ));
  }

  interface AlongCurveOpts {
    /** Reference "up" for the transported frame (default [0,0,1]): the shape's
     *  +Y offset follows this direction at the curve start. */
    up?: Vec3;
    segmentLength?: number;
    refine?: boolean;
  }

  /** Deform a shape so its X extent follows a 3D polyline — Blender's Curve
   *  modifier. Author the shape as a strip along X; Y and Z offsets ride the
   *  parallel-transported frame (Y ≈ `up`, Z completes the frame). The polyline
   *  needs ≥ 2 points; corners are rounded only as far as the refinement, so
   *  supply a subdivided curve for smooth sweeps. */
  function alongCurve(shape: any, points: unknown, opts: AlongCurveOpts = {}): any {
    need(isManifold(shape), 'alongCurve(shape, points, opts?): shape must be a Manifold');
    need(Array.isArray(points) && points.length >= 2, 'alongCurve.points must be an array of at least 2 [x,y,z] points');
    const pts: Vec3[] = (points as unknown[]).map((p, idx) => {
      need(isVec3(p), `alongCurve.points[${idx}] must be a [x,y,z] vector`);
      return p as Vec3;
    });
    rejectUnknown(opts as any, ['up', 'segmentLength', 'refine'], 'alongCurve');
    let up: Vec3 = [0, 0, 1];
    if (opts.up !== undefined) {
      need(isVec3(opts.up), 'alongCurve.up must be a [x,y,z] vector');
      const l = Math.hypot(opts.up[0], opts.up[1], opts.up[2]);
      need(l > 1e-9, 'alongCurve.up must have non-zero length');
      up = [opts.up[0] / l, opts.up[1] / l, opts.up[2] / l];
    }
    const frames = buildCurveFrames(pts, up);
    const total = frames[frames.length - 1].s;
    need(total > 1e-9, 'alongCurve.points describe a zero-length curve');
    const bb = shape.boundingBox();
    const segDefault = total / 100;
    const refined = refineFor(shape, opts.segmentLength ?? segDefault, opts.refine, 'alongCurve');
    return refined.warp(makeAlongCurveFn(frames, bb.min[0]));
  }

  return { wrapAround, bend, twist, taper, alongCurve };
}
