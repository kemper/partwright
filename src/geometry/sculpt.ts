// `api.sculpt.*` — declarative, code-serializable sculpt nudges: Blender's
// grab / inflate / flatten brushes reduced to single warp expressions with a
// smooth radial falloff. Each op is one line of model code, so it rides the
// code-as-source-of-truth model (versioned, reproducible, AI-drivable via
// ray-cast coordinates) instead of an unserializable stroke recording.
//
// These are for *nudging* a mostly-finished model (raise a bump, dent a
// panel, flatten a stand); freeform sculpting from scratch remains out of
// scope by design. Ops auto-refine the affected region's tessellation via
// `refineToLength` so a low-poly input actually shows the deformation.
//
// Pure displacement builders exported for unit tests.

/* eslint-disable @typescript-eslint/no-explicit-any */

export type Vec3 = [number, number, number];

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

/** Wendland-style falloff: smooth (C²) 1 → 0 over t ∈ [0, 1]. */
export function falloff(t: number): number {
  if (t >= 1) return 0;
  if (t <= 0) return 1;
  const u = 1 - t * t;
  return u * u;
}

/** Grab: translate vertices within `radius` of `at` by `offset`, scaled by the
 *  falloff of their distance from `at`. */
export function makeGrabFn(at: Vec3, radius: number, offset: Vec3): (v: number[]) => void {
  const r2 = radius * radius;
  return (v) => {
    const dx = v[0] - at[0], dy = v[1] - at[1], dz = v[2] - at[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= r2) return;
    const w = falloff(Math.sqrt(d2) / radius);
    v[0] += offset[0] * w;
    v[1] += offset[1] * w;
    v[2] += offset[2] * w;
  };
}

/** Inflate: push vertices within `radius` of `at` radially away from `at` by up
 *  to `amount` (negative deflates/dents). Vertices at the exact center have no
 *  defined direction and stay put. */
export function makeInflateFn(at: Vec3, radius: number, amount: number): (v: number[]) => void {
  const r2 = radius * radius;
  return (v) => {
    const dx = v[0] - at[0], dy = v[1] - at[1], dz = v[2] - at[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= r2 || d2 < 1e-18) return;
    const d = Math.sqrt(d2);
    const w = falloff(d / radius) * amount / d;
    v[0] += dx * w;
    v[1] += dy * w;
    v[2] += dz * w;
  };
}

/** Flatten: pull vertices near `at` toward the plane through `at` with unit
 *  normal `n`, by `strength` ∈ (0, 1] of their plane distance. The falloff is
 *  measured on the IN-PLANE (tangential) distance — a vertex bulging far off
 *  the plane is exactly the one that needs the full press, so only lateral
 *  distance weakens the brush. Vertices further than `radius` from the plane
 *  itself are out of the brush's reach and untouched. */
export function makeFlattenFn(at: Vec3, radius: number, n: Vec3, strength: number): (v: number[]) => void {
  const r2 = radius * radius;
  return (v) => {
    const dx = v[0] - at[0], dy = v[1] - at[1], dz = v[2] - at[2];
    const dist = dx * n[0] + dy * n[1] + dz * n[2];
    if (dist * dist >= r2) return;
    const tang2 = dx * dx + dy * dy + dz * dz - dist * dist;
    if (tang2 >= r2) return;
    const w = falloff(Math.sqrt(tang2) / radius) * strength;
    v[0] -= n[0] * dist * w;
    v[1] -= n[1] * dist * w;
    v[2] -= n[2] * dist * w;
  };
}

// ---------------------------------------------------------------------------
// Factory (Manifold-touching)
// ---------------------------------------------------------------------------

export function createSculptOps(_module: any) {
  /** Refine so the falloff region has enough vertices to bend smoothly. The
   *  default target is ~radius/5 edges; `refine: false` skips (pre-refined
   *  input), a `segmentLength` overrides. */
  function refineFor(shape: any, radius: number, opts: { segmentLength?: number; refine?: boolean }, name: string): any {
    if (opts.refine === false) return shape;
    const seg = opts.segmentLength ?? radius / 5;
    need(isFiniteNum(seg) && seg > 0, `${name}.segmentLength must be > 0`);
    const refined = typeof shape.refineToLength === 'function' ? shape.refineToLength(seg) : shape;
    const tris = refined.numTri();
    if (tris > REFINE_TRI_BUDGET) {
      throw new Error(
        `meshOps: ${name}: refining to ${seg.toFixed(3)}-unit edges produced ${Math.round(tris / 1000)}k triangles ` +
        `(budget ${REFINE_TRI_BUDGET / 1000}k). Pass a larger segmentLength (or refine: false).`,
      );
    }
    return refined;
  }

  function common(shape: any, opts: any, name: string, extra: string[]): void {
    need(isManifold(shape), `${name}(shape, opts): shape must be a Manifold`);
    need(opts && typeof opts === 'object', `${name}: opts object is required`);
    rejectUnknown(opts, ['at', 'radius', 'segmentLength', 'refine', ...extra], name);
    need(isVec3(opts.at), `${name}.at must be a [x,y,z] point on (or near) the surface`);
    need(isFiniteNum(opts.radius) && opts.radius > 0, `${name}.radius must be a positive number`);
  }

  /** Grab-and-drag: move the surface near `at` by `offset` with smooth falloff. */
  function grab(shape: any, opts: { at: Vec3; radius: number; offset: Vec3; segmentLength?: number; refine?: boolean }): any {
    common(shape, opts, 'sculpt.grab', ['offset']);
    need(isVec3(opts.offset), 'sculpt.grab.offset must be a [dx,dy,dz] vector');
    const refined = refineFor(shape, opts.radius, opts, 'sculpt.grab');
    return refined.warp(makeGrabFn(opts.at, opts.radius, opts.offset));
  }

  /** Inflate (positive amount) or dent (negative) the surface around `at`. */
  function inflate(shape: any, opts: { at: Vec3; radius: number; amount: number; segmentLength?: number; refine?: boolean }): any {
    common(shape, opts, 'sculpt.inflate', ['amount']);
    need(isFiniteNum(opts.amount) && opts.amount !== 0, 'sculpt.inflate.amount must be a non-zero number (negative dents)');
    const refined = refineFor(shape, opts.radius, opts, 'sculpt.inflate');
    return refined.warp(makeInflateFn(opts.at, opts.radius, opts.amount));
  }

  /** Press the surface near `at` toward the plane (at, normal). */
  function flatten(shape: any, opts: { at: Vec3; radius: number; normal?: Vec3; strength?: number; segmentLength?: number; refine?: boolean }): any {
    common(shape, opts, 'sculpt.flatten', ['normal', 'strength']);
    let n: Vec3 = [0, 0, 1];
    if (opts.normal !== undefined) {
      need(isVec3(opts.normal), 'sculpt.flatten.normal must be a [x,y,z] vector');
      const l = Math.hypot(opts.normal[0], opts.normal[1], opts.normal[2]);
      need(l > 1e-9, 'sculpt.flatten.normal must have non-zero length');
      n = [opts.normal[0] / l, opts.normal[1] / l, opts.normal[2] / l];
    }
    const strength = opts.strength ?? 1;
    need(isFiniteNum(strength) && strength > 0 && strength <= 1, 'sculpt.flatten.strength must be in (0, 1]');
    const refined = refineFor(shape, opts.radius, opts, 'sculpt.flatten');
    return refined.warp(makeFlattenFn(opts.at, opts.radius, n, strength));
  }

  return { grab, inflate, flatten };
}
