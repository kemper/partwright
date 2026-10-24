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
// Every op takes an optional `select` (a selector — see selector.ts: a part
// label, a region ball, a facing/bounds filter) that confines it to part of the
// shape, plus `blend` to feather the edge; `sculpt.transform` moves / scales /
// rotates a selection as a soft-selection edit ("make the head 20% bigger").
//
// Pure displacement builders exported for unit tests.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { parseSelectOpts, selectionWeights, weightedWarp } from './selector';

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

/** Soft-selection transform: scale (uniform or per-axis) and rotate (degrees,
 *  X then Y then Z — Manifold.rotate's order) about `pivot`, then translate. */
export function makeTransformFn(pivot: Vec3, scale: Vec3, rotateDeg: Vec3, translate: Vec3): (v: number[]) => void {
  const [ax, ay, az] = rotateDeg.map(d => (d * Math.PI) / 180);
  const cx = Math.cos(ax), sx = Math.sin(ax), cy = Math.cos(ay), sy = Math.sin(ay), cz = Math.cos(az), sz = Math.sin(az);
  return (v) => {
    let x = (v[0] - pivot[0]) * scale[0], y = (v[1] - pivot[1]) * scale[1], z = (v[2] - pivot[2]) * scale[2];
    let t = y * cx - z * sx; z = y * sx + z * cx; y = t; // about X
    t = x * cy + z * sy; z = -x * sy + z * cy; x = t;    // about Y
    t = x * cz - y * sz; y = x * sz + y * cz; x = t;     // about Z
    v[0] = x + pivot[0] + translate[0];
    v[1] = y + pivot[1] + translate[1];
    v[2] = z + pivot[2] + translate[2];
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
    rejectUnknown(opts, ['at', 'radius', 'segmentLength', 'refine', 'select', 'blend', ...extra], name);
    need(isVec3(opts.at), `${name}.at must be a [x,y,z] point on (or near) the surface`);
    need(isFiniteNum(opts.radius) && opts.radius > 0, `${name}.radius must be a positive number`);
  }

  /** Apply a brush warp, confined to `opts.select` (feathered by `blend`) when
   *  given. The selection is resolved on the REFINED shape, so it covers the
   *  new vertices too. */
  function scopedWarp(refined: any, fn: (v: number[]) => void, opts: any, name: string): any {
    const { select, blend } = parseSelectOpts(opts, name);
    if (!select) return refined.warp(fn);
    const sel = selectionWeights(refined, select, blend, name);
    return refined.warp(weightedWarp(fn, sel.weightOf));
  }

  /** Grab-and-drag: move the surface near `at` by `offset` with smooth falloff. */
  function grab(shape: any, opts: { at: Vec3; radius: number; offset: Vec3; segmentLength?: number; refine?: boolean; select?: unknown; blend?: number }): any {
    common(shape, opts, 'sculpt.grab', ['offset']);
    need(isVec3(opts.offset), 'sculpt.grab.offset must be a [dx,dy,dz] vector');
    parseSelectOpts(opts, 'sculpt.grab'); // validate select/blend before refining
    const refined = refineFor(shape, opts.radius, opts, 'sculpt.grab');
    return scopedWarp(refined, makeGrabFn(opts.at, opts.radius, opts.offset), opts, 'sculpt.grab');
  }

  /** Inflate (positive amount) or dent (negative) the surface around `at`. */
  function inflate(shape: any, opts: { at: Vec3; radius: number; amount: number; segmentLength?: number; refine?: boolean; select?: unknown; blend?: number }): any {
    common(shape, opts, 'sculpt.inflate', ['amount']);
    need(isFiniteNum(opts.amount) && opts.amount !== 0, 'sculpt.inflate.amount must be a non-zero number (negative dents)');
    parseSelectOpts(opts, 'sculpt.inflate'); // validate select/blend before refining
    const refined = refineFor(shape, opts.radius, opts, 'sculpt.inflate');
    return scopedWarp(refined, makeInflateFn(opts.at, opts.radius, opts.amount), opts, 'sculpt.inflate');
  }

  /** Press the surface near `at` toward the plane (at, normal). */
  function flatten(shape: any, opts: { at: Vec3; radius: number; normal?: Vec3; strength?: number; segmentLength?: number; refine?: boolean; select?: unknown; blend?: number }): any {
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
    parseSelectOpts(opts, 'sculpt.flatten'); // validate select/blend before refining
    const refined = refineFor(shape, opts.radius, opts, 'sculpt.flatten');
    return scopedWarp(refined, makeFlattenFn(opts.at, opts.radius, n, strength), opts, 'sculpt.flatten');
  }

  interface TransformOpts {
    select: unknown;
    blend?: number;
    translate?: Vec3;
    rotate?: Vec3;
    scale?: number | Vec3;
    pivot?: Vec3;
    segmentLength?: number;
    refine?: boolean;
  }

  /** Move / scale / rotate the SELECTED part of a shape in place — Blender's
   *  proportional editing. The selection moves rigidly; with `blend` the
   *  surface within `blend` units of it follows partway, so the edit fades in
   *  instead of tearing at the seam. Pivot defaults to the selection's centroid. */
  function transform(shape: any, opts: TransformOpts): any {
    const name = 'sculpt.transform';
    need(isManifold(shape), `${name}(shape, opts): shape must be a Manifold`);
    need(opts && typeof opts === 'object', `${name}: opts object with { select, scale | rotate | translate } is required`);
    rejectUnknown(opts as any, ['select', 'blend', 'translate', 'rotate', 'scale', 'pivot', 'segmentLength', 'refine'], name);
    const { select, blend } = parseSelectOpts(opts, name);
    need(select, `${name}.select is required — e.g. { label: 'head' } or { region: { center: [x, y, z], radius } }`);
    need(opts.translate !== undefined || opts.rotate !== undefined || opts.scale !== undefined, `${name}: pass at least one of scale, rotate, translate`);
    const translate: Vec3 = opts.translate ?? [0, 0, 0];
    need(isVec3(translate), `${name}.translate must be [dx, dy, dz]`);
    const rotate: Vec3 = opts.rotate ?? [0, 0, 0];
    need(isVec3(rotate), `${name}.rotate must be [rx, ry, rz] in degrees`);
    let scale: Vec3 = [1, 1, 1];
    if (opts.scale !== undefined) {
      if (isFiniteNum(opts.scale)) scale = [opts.scale, opts.scale, opts.scale];
      else if (isVec3(opts.scale)) scale = opts.scale;
      else need(false, `${name}.scale must be a number or [sx, sy, sz]`);
      need(scale.every(s => s > 0), `${name}.scale must be > 0 (mirror with mirrorAcross instead)`);
    }
    if (opts.pivot !== undefined) need(isVec3(opts.pivot), `${name}.pivot must be [x, y, z]`);
    // Only the fade zone needs extra vertices; a hard selection moves whole
    // triangles as they are. An explicit segmentLength always refines.
    const seg = opts.segmentLength ?? (blend > 0 ? blend / 3 : undefined);
    const refined = seg !== undefined ? refineFor(shape, seg * 5, { ...opts, segmentLength: seg }, name) : shape;
    const sel = selectionWeights(refined, select!, blend, name);
    const pivot = (opts.pivot as Vec3 | undefined) ?? sel.bounds.centroid;
    return refined.warp(weightedWarp(makeTransformFn(pivot, scale, rotate, translate), sel.weightOf));
  }

  return { grab, inflate, flatten, transform };
}
