/**
 * Knurling & functional grips — exposed to the manifold-js sandbox as
 * `api.knurl`.
 *
 * Knurls are *functional* surface geometry — the diamond cross-hatch on a
 * thumbscrew, the straight splines on a knob, the finger ridges on a grip —
 * distinct from the decorative `surface` modifier textures. They are awkward to
 * model by hand: a diamond knurl is the intersection of two opposite-handed
 * helical tooth families, which is easy to get wrong with raw booleans. This
 * module builds them robustly and cheaply (two twisted extrudes + one
 * intersection for the diamond; a single extrude/revolve for the others).
 *
 * Siblings: `gears.ts`, `threads.ts`, `fasteners.ts`, `joints.ts`,
 * `enclosure.ts`.
 *
 * Conventions (match gears / fasteners):
 *   • Z-up, millimetres. Every builder returns a knurled CYLINDER centred on
 *     the origin, extruded +Z from z=0 to z=height. UNION it onto a knob/handle
 *     core, or add a `bore` to use it as a grip sleeve directly.
 *   • Ridges peak at `diameter/2`; troughs sit `depth` below. So the knurl's
 *     OUTER diameter is `diameter` — size the core you union it onto to match.
 *   • Builders THROW `ValidationError` on bad input so the mistake surfaces as
 *     a clear run error the agent can self-correct.
 */

import { ValidationError } from '../validation/apiValidation';

/* eslint-disable @typescript-eslint/no-explicit-any */

type Vec2 = [number, number];

const LIP = 0.1;

// ---------------------------------------------------------------------------
// Validation helpers (mirror gears' / fasteners' local helpers)
// ---------------------------------------------------------------------------

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (typeof v === 'string') return `"${v}"`;
  return String(v);
}

function num(val: unknown, name: string, opts: { min?: number; max?: number; def?: number } = {}): number {
  if (val === undefined && opts.def !== undefined) return opts.def;
  if (typeof val !== 'number' || !Number.isFinite(val)) {
    throw new ValidationError(`knurl: ${name} must be a finite number, got ${describe(val)}.`);
  }
  if (opts.min !== undefined && val < opts.min) {
    throw new ValidationError(`knurl: ${name} must be >= ${opts.min}, got ${val}.`);
  }
  if (opts.max !== undefined && val > opts.max) {
    throw new ValidationError(`knurl: ${name} must be <= ${opts.max}, got ${val}.`);
  }
  return val;
}

function optsObj(val: unknown, name: string): Record<string, unknown> {
  if (val === undefined || val === null) return {};
  if (typeof val !== 'object' || Array.isArray(val)) {
    throw new ValidationError(`knurl.${name}: options must be a plain object, got ${describe(val)}.`);
  }
  return val as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Pure geometry helpers (unit-tested via __testables__)
// ---------------------------------------------------------------------------

/** Number of ridges (teeth) around the circumference for a given circumferential
 *  pitch, snapped to a sensible minimum. */
export function colsFor(diameter: number, pitch: number): number {
  return Math.max(6, Math.round((Math.PI * diameter) / pitch));
}

/** Twist (degrees over the full `height`) that yields ~square diamonds for a
 *  given diameter, scaled by an `aspect` knob (1 = square). */
export function knurlTwist(diameter: number, height: number, aspect = 1): number {
  return (360 * height) / (Math.PI * diameter) / aspect;
}

/** Sinusoidal cog cross-section: `cols` ridges, radius sweeping between
 *  `rootR` (troughs) and `outerR` (peaks). CCW, closed. */
export function cogProfile(rootR: number, outerR: number, cols: number, samplesPerTooth = 6): Vec2[] {
  const n = Math.max(3, Math.round(cols * samplesPerTooth));
  const amp = (outerR - rootR) / 2;
  const mid = rootR + amp;
  const pts: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n;
    const r = mid + amp * Math.cos(cols * t);
    pts.push([r * Math.cos(t), r * Math.sin(t)]);
  }
  return pts;
}

/** Half profile (in X=radius, Y=height) of a horizontal-rib grip, for revolve.
 *  `count` rounded ribs stacked along the height. Closed back to the axis. */
export function ribProfile(rootR: number, outerR: number, height: number, count: number, samplesPerRib = 6): Vec2[] {
  const m = Math.max(8, Math.round(count * samplesPerRib));
  const amp = (outerR - rootR) / 2;
  const mid = rootR + amp;
  const pts: Vec2[] = [[0, 0]];
  for (let j = 0; j <= m; j++) {
    const y = (height * j) / m;
    const r = mid + amp * Math.cos((2 * Math.PI * count * j) / m);
    pts.push([r, y]);
  }
  pts.push([0, height]);
  return pts;
}

// ---------------------------------------------------------------------------
// Namespace factory
// ---------------------------------------------------------------------------

export function createKnurlNamespace(module: any) {
  const { Manifold, CrossSection } = module;

  function seg(o: Record<string, unknown>): number {
    return o.segments === undefined ? 64 : num(o.segments, 'segments', { min: 8, max: 512 });
  }

  /** Resolve the shared cylinder + ridge params. */
  function base(o: Record<string, unknown>, where: string) {
    const diameter = num(o.diameter ?? o.d, `${where}.diameter`, { min: 1 });
    const height = num(o.height ?? o.h, `${where}.height`, { min: 0.5 });
    const depth = num(o.depth, `${where}.depth`, { def: Math.min(Math.max(diameter * 0.04, 0.4), 1.5), min: 0.1, max: diameter / 2 - 0.2 });
    const outerR = diameter / 2;
    const rootR = outerR - depth;
    return { diameter, height, depth, outerR, rootR };
  }

  /** Bore a central through-hole if `bore` (diameter) was given. */
  function applyBore(solid: any, o: Record<string, unknown>, height: number, where: string): any {
    if (o.bore === undefined) return solid;
    const br = num(o.bore, `${where}.bore`, { min: 0.2 }) / 2;
    return solid.subtract(Manifold.cylinder(height + 2 * LIP, br, br, 0).translate([0, 0, -LIP]));
  }

  return {
    /**
     * Diamond (cross-hatch) knurl on a cylinder — the classic thumbscrew /
     * tool-handle grip. Built as the intersection of two opposite-handed
     * helical ridge families, so the diamonds are exact and the result is a
     * clean single manifold.
     *
     * opts: { diameter, height, pitch?=2, depth?, aspect?=1, bore?, segments? }
     *   pitch:  circumferential ridge spacing (mm) → ridge count
     *   aspect: diamond aspect (1 = square; >1 taller, <1 wider)
     */
    diamond(o0: unknown): any {
      const o = optsObj(o0, 'diamond');
      const { diameter, height, outerR, rootR } = base(o, 'diamond');
      const pitch = num(o.pitch, 'diamond.pitch', { def: 2, min: 0.3 });
      const aspect = num(o.aspect, 'diamond.aspect', { def: 1, min: 0.2, max: 5 });
      const cols = colsFor(diameter, pitch);
      const twist = knurlTwist(diameter, height, aspect);
      const cs = new CrossSection([cogProfile(rootR, outerR, cols)]);
      // Resolve the helix: enough divisions for both the twist and the axial
      // diamond rows, capped so a tall fine knurl can't explode the tri count.
      const rows = (cols * height) / (Math.PI * diameter);
      const divs = Math.min(400, Math.max(12, Math.ceil(Math.max(twist / 6, rows * 4))));
      const right = Manifold.extrude(cs, height, divs, twist);
      const left = Manifold.extrude(cs, height, divs, -twist);
      return applyBore(right.intersect(left), o, height, 'diamond');
    },

    /**
     * Straight (axial) knurl — vertical splines/ridges running the height of
     * the cylinder. A single un-twisted extrude.
     *
     * opts: { diameter, height, pitch?=2, depth?, bore?, segments? }
     */
    straight(o0: unknown): any {
      const o = optsObj(o0, 'straight');
      const { diameter, height, outerR, rootR } = base(o, 'straight');
      const pitch = num(o.pitch, 'straight.pitch', { def: 2, min: 0.3 });
      const cols = colsFor(diameter, pitch);
      const cs = new CrossSection([cogProfile(rootR, outerR, cols)]);
      return applyBore(Manifold.extrude(cs, height), o, height, 'straight');
    },

    /**
     * Horizontal grip ribs — rounded rings stacked up the height (finger
     * grips). A revolve of a scalloped profile.
     *
     * opts: { diameter, height, pitch?=2.5, count?, depth?, bore?, segments? }
     *   count overrides the pitch-derived rib count if given.
     */
    ribs(o0: unknown): any {
      const o = optsObj(o0, 'ribs');
      const { height, outerR, rootR } = base(o, 'ribs');
      const pitch = num(o.pitch, 'ribs.pitch', { def: 2.5, min: 0.5 });
      const count = o.count === undefined
        ? Math.max(2, Math.round(height / pitch))
        : num(o.count, 'ribs.count', { min: 1, max: 200 });
      const profile = new CrossSection([ribProfile(rootR, outerR, height, count)]);
      return applyBore(Manifold.revolve(profile, seg(o), 360), o, height, 'ribs');
    },
  };
}

/** Pure helpers exposed for unit testing without the WASM module. */
export const __testables__ = { colsFor, knurlTwist, cogProfile, ribProfile };
