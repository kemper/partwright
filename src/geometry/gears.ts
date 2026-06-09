/**
 * Gears — involute spur-gear & rack helpers exposed to the manifold-js sandbox
 * as `api.gears`.
 *
 * The base manifold-3d library gives you primitives + booleans, but a correct
 * involute tooth flank is fiddly trigonometry that AI agents (and humans)
 * routinely get wrong — until now the verb table in /ai.md said "(sample
 * involute manually)" and pointed people at OpenSCAD/BOSL2. This module ships a
 * deterministic, parametric involute generator so a real, meshing gear is one
 * call from a manifold-js session.
 *
 * Conventions (match Curves / printFit):
 *   • Z-up. A spur gear is built centred on the origin, lying in the XY plane,
 *     extruded along +Z from z=0 to z=thickness. The caller positions it with
 *     `.translate()` / `meshOps.placeOn()` / `meshOps.alignTo()`.
 *   • Builders return a Manifold ready to use (or, for `pair`, an object of
 *     Manifolds). They THROW `ValidationError` on bad input (like Curves /
 *     printFit), so the mistake surfaces as a clear run error.
 *
 * Terminology: `module` (mm of pitch diameter per tooth) is the metric tooth
 * size — pitch diameter = module · teeth. Two gears mesh iff they share a
 * module and pressure angle.
 */

import { ValidationError } from '../validation/apiValidation';

/* eslint-disable @typescript-eslint/no-explicit-any */

type Vec2 = [number, number];

const DEG = Math.PI / 180;
/** A tiny over-poke so a subtractive bore breaks both faces cleanly. */
const LIP = 0.1;

// ---------------------------------------------------------------------------
// Validation helpers (mirror printFit's local helpers)
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
    throw new ValidationError(`gears: ${name} must be a finite number, got ${describe(val)}.`);
  }
  if (opts.min !== undefined && val < opts.min) {
    throw new ValidationError(`gears: ${name} must be >= ${opts.min}, got ${val}.`);
  }
  if (opts.max !== undefined && val > opts.max) {
    throw new ValidationError(`gears: ${name} must be <= ${opts.max}, got ${val}.`);
  }
  return val;
}

function int(val: unknown, name: string, opts: { min?: number; def?: number } = {}): number {
  const n = num(val, name, opts);
  if (!Number.isInteger(n)) throw new ValidationError(`gears: ${name} must be a whole number, got ${n}.`);
  return n;
}

function optsObj(val: unknown, name: string): Record<string, unknown> {
  if (val === undefined || val === null) return {};
  if (typeof val !== 'object' || Array.isArray(val)) {
    throw new ValidationError(`gears.${name}: options must be a plain object, got ${describe(val)}.`);
  }
  return val as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Pure geometry (unit-tested via __testables__ — no WASM)
// ---------------------------------------------------------------------------

/** Involute function: inv(α) = tan(α) − α (α in radians). */
function involute(alpha: number): number {
  return Math.tan(alpha) - alpha;
}

export interface GearDims {
  /** Pitch radius — module · teeth / 2. The radius gears mesh tangent at. */
  pitchR: number;
  /** Base radius — the circle the involute unwinds from. */
  baseR: number;
  /** Tip (addendum) radius — outer radius of the teeth. */
  tipR: number;
  /** Root (dedendum) radius — bottom of the tooth valleys. */
  rootR: number;
  /** Circular pitch — arc length between adjacent teeth at the pitch circle. */
  circularPitch: number;
}

/** Standard involute spur-gear dimensions for a (module, teeth) pair.
 *  `clearance` is the dedendum clearance as a fraction of module (ISO 0.25). */
export function gearDimensions(module: number, teeth: number, pressureAngleDeg: number, clearance: number): GearDims {
  const pitchR = (module * teeth) / 2;
  const baseR = pitchR * Math.cos(pressureAngleDeg * DEG);
  const tipR = pitchR + module;                       // addendum = module
  const rootR = Math.max(0.05, pitchR - module * (1 + clearance)); // dedendum = module·(1+clearance)
  return { pitchR, baseR, tipR, rootR, circularPitch: Math.PI * module };
}

/** Centre distance for two meshing external gears sharing a module. */
export function centerDistance(teeth1: number, teeth2: number, module: number): number {
  return (module * (teeth1 + teeth2)) / 2;
}

/** Gear ratio (driven / driver). */
export function gearRatio(driverTeeth: number, drivenTeeth: number): number {
  return drivenTeeth / driverTeeth;
}

export interface SpurOutlineParams {
  module: number;
  teeth: number;
  pressureAngle?: number;
  clearance?: number;
  backlash?: number;
  steps?: number;
}

/** The closed 2-D outline (CCW, no centre point) of an involute spur gear,
 *  ready to hand to `new CrossSection([outline])`. Teeth are symmetric about
 *  radial lines; the flank below the base circle is a radial line into the
 *  root. Tip and root lands are short chords between the flank endpoints. */
export function spurOutline(p: SpurOutlineParams): Vec2[] {
  const pressureAngle = p.pressureAngle ?? 20;
  const clearance = p.clearance ?? 0.25;
  const backlash = p.backlash ?? 0;
  const steps = Math.max(2, p.steps ?? 8);
  const { pitchR, baseR, tipR, rootR } = gearDimensions(p.module, p.teeth, pressureAngle, clearance);

  const invAtPitch = involute(pressureAngle * DEG);
  // Half the angular tooth thickness measured at the pitch circle, reduced by
  // backlash (a tangential gap split evenly across both flanks).
  const halfToothPitch = Math.PI / (2 * p.teeth) - backlash / 2 / pitchR;
  if (halfToothPitch <= 0) {
    throw new ValidationError(`gears: backlash ${backlash} is too large for module ${p.module} / ${p.teeth} teeth (teeth would vanish).`);
  }
  // Extrapolated back to the base circle: the involute sweeps invAtPitch of
  // polar angle from base→pitch, so the tooth is wider at/below the base.
  const halfAngleBase = halfToothPitch + invAtPitch;

  // Angular half-width of the tooth at radius r. Constant (radial line) below
  // the base circle; narrows by the involute polar angle above it.
  const halfAngle = (r: number): number => {
    if (r <= baseR) return halfAngleBase;
    const a = Math.acos(Math.min(1, baseR / r));
    return halfAngleBase - involute(a);
  };

  // Guard against pointed/crossing teeth: if the flank narrows past the tip,
  // clamp the effective tip radius to where a thin land remains.
  const minTipHalf = 0.5 * DEG;
  let effTipR = tipR;
  if (halfAngle(tipR) < minTipHalf) {
    let lo = baseR, hi = tipR;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (halfAngle(mid) < minTipHalf) hi = mid; else lo = mid;
    }
    effTipR = lo;
  }

  const angStep = (2 * Math.PI) / p.teeth;
  const radii: number[] = [];
  for (let i = 0; i <= steps; i++) radii.push(rootR + ((effTipR - rootR) * i) / steps);

  const pts: Vec2[] = [];
  for (let k = 0; k < p.teeth; k++) {
    const c = k * angStep;
    // Left flank, root → tip (polar angle increases toward the tooth centre).
    for (let i = 0; i <= steps; i++) {
      const r = radii[i];
      const a = c - halfAngle(r);
      pts.push([r * Math.cos(a), r * Math.sin(a)]);
    }
    // Right flank, tip → root.
    for (let i = steps; i >= 0; i--) {
      const r = radii[i];
      const a = c + halfAngle(r);
      pts.push([r * Math.cos(a), r * Math.sin(a)]);
    }
  }
  return pts;
}

/** Closed 2-D profile of a straight (involute) rack — the linearised limit of a
 *  gear. Lies along +X, teeth pointing +Y, pitch line at y=0. Returns one
 *  closed CCW outline for `new CrossSection([outline])`. */
export function rackOutline(p: { module: number; teeth: number; pressureAngle?: number; clearance?: number; base?: number }): Vec2[] {
  const pressureAngle = p.pressureAngle ?? 20;
  const clearance = p.clearance ?? 0.25;
  const pitch = Math.PI * p.module;          // circular pitch
  const add = p.module;                      // addendum
  const ded = p.module * (1 + clearance);    // dedendum
  const base = Math.max(ded + 0.4, p.base ?? ded + p.module); // body depth below pitch line
  const flankRun = (add + ded) * Math.tan(pressureAngle * DEG); // X run of a flank
  const halfTop = pitch / 4 - add * Math.tan(pressureAngle * DEG);   // half tooth-tip land
  const halfBot = pitch / 4 + ded * Math.tan(pressureAngle * DEG);   // half valley land
  const length = pitch * p.teeth;

  const top: Vec2[] = [];
  for (let k = 0; k < p.teeth; k++) {
    const c = (k + 0.5) * pitch;             // tooth centre
    top.push([c - halfBot, -ded]);
    top.push([c - halfTop, add]);
    top.push([c + halfTop, add]);
    top.push([c + halfBot, -ded]);
  }
  // Assemble CCW (positive area): along the base left→right, up the right edge,
  // back across the toothed top row right→left, then down the left edge.
  void flankRun;
  return [
    [0, -base],
    [length, -base],
    [length, -ded],
    ...top.slice().reverse(),
    [0, -ded],
  ];
}

// ---------------------------------------------------------------------------
// Namespace factory
// ---------------------------------------------------------------------------

export function createGearsNamespace(module: any) {
  const { Manifold, CrossSection } = module;

  function segOf(o: Record<string, unknown>): number {
    return o.segments === undefined ? 0 : int(o.segments, 'segments', { min: 3 });
  }

  /** Resolve the shared (module, teeth, pressureAngle, clearance, backlash). */
  function resolveSpur(o: Record<string, unknown>, where: string) {
    const moduleVal = num(o.module ?? o.mod, `${where}.module`, { min: 0.05 });
    const teeth = int(o.teeth, `${where}.teeth`, { min: 4 });
    const pressureAngle = num(o.pressureAngle, `${where}.pressureAngle`, { def: 20, min: 10, max: 35 });
    const clearance = num(o.clearance, `${where}.clearance`, { def: 0.25, min: 0 });
    const backlash = num(o.backlash, `${where}.backlash`, { def: 0, min: 0 });
    return { moduleVal, teeth, pressureAngle, clearance, backlash };
  }

  /** Build a single spur gear Manifold from resolved params + thickness opts. */
  function buildSpur(o: Record<string, unknown>, where: string): any {
    const { moduleVal, teeth, pressureAngle, clearance, backlash } = resolveSpur(o, where);
    const thickness = num(o.thickness, `${where}.thickness`, { min: 0.2 });
    const seg = segOf(o);
    const outline = spurOutline({ module: moduleVal, teeth, pressureAngle, clearance, backlash, steps: o.steps === undefined ? undefined : int(o.steps, `${where}.steps`, { min: 2 }) });
    const cs = new CrossSection([outline]);

    let gear: any;
    const helixAngle = o.helix === undefined ? 0 : num(o.helix, `${where}.helix`, { min: -60, max: 60 });
    if (helixAngle !== 0) {
      const { pitchR } = gearDimensions(moduleVal, teeth, pressureAngle, clearance);
      const twistDeg = ((thickness * Math.tan(helixAngle * DEG)) / pitchR) * (180 / Math.PI);
      const divs = Math.max(4, Math.ceil(Math.abs(twistDeg) / 6));
      gear = Manifold.extrude(cs, thickness, divs, twistDeg);
    } else {
      gear = Manifold.extrude(cs, thickness);
    }

    // Optional centre bore.
    if (o.bore !== undefined) {
      const br = num(o.bore, `${where}.bore`, { min: 0.2 }) / 2;
      gear = gear.subtract(Manifold.cylinder(thickness + 2 * LIP, br, br, seg).translate([0, 0, -LIP]));
    }
    // Optional hub (solid boss on top, around the bore).
    if (o.hubDiameter !== undefined) {
      const hr = num(o.hubDiameter, `${where}.hubDiameter`, { min: 0.5 }) / 2;
      const hh = num(o.hubHeight, `${where}.hubHeight`, { def: thickness, min: 0.2 });
      let hub = Manifold.cylinder(hh, hr, hr, seg).translate([0, 0, thickness]);
      if (o.bore !== undefined) {
        const br = num(o.bore, `${where}.bore`, { min: 0.2 }) / 2;
        hub = hub.subtract(Manifold.cylinder(hh + 2 * LIP, br, br, seg).translate([0, 0, thickness - LIP]));
      }
      gear = gear.add(hub);
    }
    return gear;
  }

  return {
    // Data / math passthroughs ----------------------------------------------
    dimensions(o0: unknown): GearDims {
      const o = optsObj(o0, 'dimensions');
      const { moduleVal, teeth, pressureAngle, clearance } = resolveSpur(o, 'dimensions');
      return gearDimensions(moduleVal, teeth, pressureAngle, clearance);
    },
    centerDistance(teeth1: unknown, teeth2: unknown, moduleVal: unknown): number {
      return centerDistance(int(teeth1, 'centerDistance.teeth1', { min: 4 }), int(teeth2, 'centerDistance.teeth2', { min: 4 }), num(moduleVal, 'centerDistance.module', { min: 0.05 }));
    },
    ratio(driverTeeth: unknown, drivenTeeth: unknown): number {
      return gearRatio(int(driverTeeth, 'ratio.driverTeeth', { min: 4 }), int(drivenTeeth, 'ratio.drivenTeeth', { min: 4 }));
    },

    /**
     * An involute spur gear, centred on the origin in the XY plane, extruded
     * +Z from 0 to `thickness`. Two gears mesh iff they share `module` and
     * `pressureAngle`.
     *
     * opts: { module, teeth, thickness, pressureAngle?=20, clearance?=0.25,
     *         backlash?=0, helix?=0, bore?, hubDiameter?, hubHeight?, segments? }
     */
    spur(o0: unknown): any {
      return buildSpur(optsObj(o0, 'spur'), 'spur');
    },

    /**
     * A meshing pair of spur gears sharing a module. Returns
     * `{ pinion, gear, centerDistance, ratio }`. The `pinion` (teeth1) is at the
     * origin; the `gear` (teeth2) is positioned at +X by the centre distance and
     * phased so its tooth valleys line up with the pinion's teeth.
     *
     * opts: { module, teeth1, teeth2, thickness, pressureAngle?, clearance?,
     *         backlash?=0.05, bore1?, bore2?, segments? }
     */
    pair(o0: unknown): { pinion: any; gear: any; centerDistance: number; ratio: number } {
      const o = optsObj(o0, 'pair');
      const moduleVal = num(o.module ?? o.mod, 'pair.module', { min: 0.05 });
      const teeth1 = int(o.teeth1, 'pair.teeth1', { min: 4 });
      const teeth2 = int(o.teeth2, 'pair.teeth2', { min: 4 });
      const thickness = num(o.thickness, 'pair.thickness', { min: 0.2 });
      const pressureAngle = num(o.pressureAngle, 'pair.pressureAngle', { def: 20, min: 10, max: 35 });
      const clearance = num(o.clearance, 'pair.clearance', { def: 0.25, min: 0 });
      // A small default backlash keeps the two gears as separate components
      // (they don't fuse where teeth meet) and prints/assembles cleanly.
      const backlash = num(o.backlash, 'pair.backlash', { def: 0.05, min: 0 });
      const seg = segOf(o);

      const common = { module: moduleVal, thickness, pressureAngle, clearance, backlash, segments: seg || undefined };
      const pinion = buildSpur({ ...common, teeth: teeth1, bore: o.bore1 }, 'pair');
      let gear = buildSpur({ ...common, teeth: teeth2, bore: o.bore2 }, 'pair');

      const cd = centerDistance(teeth1, teeth2, moduleVal);
      // Phase the second gear so a tooth valley faces the pinion: orient a tooth
      // toward the line of centres (180° side), then add a half tooth-pitch.
      const pitchAngle = 360 / teeth2;
      const phaseDeg = ((180 % pitchAngle) + pitchAngle / 2);
      gear = gear.rotate([0, 0, phaseDeg]).translate([cd, 0, 0]);

      return { pinion, gear, centerDistance: cd, ratio: gearRatio(teeth1, teeth2) };
    },

    /**
     * A straight involute rack (the linear limit of a gear) — meshes with a
     * spur gear of the same module. Lies along +X with teeth pointing +Y, the
     * pitch line at y=0, extruded +Z from 0 to `thickness`.
     *
     * opts: { module, teeth, thickness, pressureAngle?=20, clearance?=0.25, base? }
     */
    rack(o0: unknown): any {
      const o = optsObj(o0, 'rack');
      const moduleVal = num(o.module ?? o.mod, 'rack.module', { min: 0.05 });
      const teeth = int(o.teeth, 'rack.teeth', { min: 1 });
      const thickness = num(o.thickness, 'rack.thickness', { min: 0.2 });
      const pressureAngle = num(o.pressureAngle, 'rack.pressureAngle', { def: 20, min: 10, max: 35 });
      const clearance = num(o.clearance, 'rack.clearance', { def: 0.25, min: 0 });
      const base = o.base === undefined ? undefined : num(o.base, 'rack.base', { min: 0.2 });
      const outline = rackOutline({ module: moduleVal, teeth, pressureAngle, clearance, base });
      return Manifold.extrude(new CrossSection([outline]), thickness);
    },
  };
}

/** Pure helpers exposed for unit testing without the WASM module. */
export const __testables__ = {
  involute,
  gearDimensions,
  centerDistance,
  gearRatio,
  spurOutline,
  rackOutline,
};
