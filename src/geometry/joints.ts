/**
 * Joints — part-to-part 3D-printing joinery helpers exposed to the manifold-js
 * sandbox as `api.joints`.
 *
 * Sibling of `src/geometry/fasteners.ts` (hardware fits: screw/tap holes,
 * insert bosses, nut pockets). This module covers the joints that connect
 * printed parts to each other: alignment pins + sockets, sliding dovetails,
 * cantilever snap-fits, print-in-place hinges, snap-together ball joints, and
 * annular snap rims for press-on lids. The deprecated `api.printFit` alias
 * spreads both namespaces for old saved sessions.
 *
 * Conventions (match Curves / fasteners / gears):
 *   • Z-up. Each builder documents its local frame; the caller positions the
 *     result with `.translate()` / `meshOps.placeOn()` / `meshOps.alignTo()`.
 *   • "Negative" builders (socket, dovetail.socket, snapFit.catch,
 *     snapRim.groove) return a Manifold meant to be SUBTRACTED. They poke
 *     ~`LIP` past the faces they cut so the boolean breaks the surface cleanly
 *     instead of leaving a zero-thickness skin.
 *   • "Solid" builders (pin, dovetail.tail, snapFit.clip, snapRim.bead, hinge,
 *     ballSocket.*) return a Manifold meant to be UNIONED onto your part (or
 *     to stand alone).
 *   • Builders THROW `ValidationError` on bad input (like api.label / Curves),
 *     so the mistake surfaces as a clear run error the agent can self-correct.
 *
 * Clearances follow the `fasteners.CLEARANCE_PRESETS` spirit — tuned for a
 * typical 0.4mm-nozzle FDM printer, always overridable.
 */

import { ValidationError } from '../validation/apiValidation';
import { clearance, LIP } from './fasteners';

/* eslint-disable @typescript-eslint/no-explicit-any */

type Vec2 = [number, number];

// ---------------------------------------------------------------------------
// Validation helpers (mirror fasteners' / gears' local helpers)
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
    throw new ValidationError(`joints: ${name} must be a finite number, got ${describe(val)}.`);
  }
  if (opts.min !== undefined && val < opts.min) {
    throw new ValidationError(`joints: ${name} must be >= ${opts.min}, got ${val}.`);
  }
  if (opts.max !== undefined && val > opts.max) {
    throw new ValidationError(`joints: ${name} must be <= ${opts.max}, got ${val}.`);
  }
  return val;
}

function int(val: unknown, name: string, opts: { min?: number; def?: number } = {}): number {
  const n = num(val, name, opts);
  if (!Number.isInteger(n)) throw new ValidationError(`joints: ${name} must be a whole number, got ${n}.`);
  return n;
}

function bool(val: unknown, def: boolean): boolean {
  if (val === undefined) return def;
  if (typeof val !== 'boolean') throw new ValidationError(`joints: expected a boolean, got ${describe(val)}.`);
  return val;
}

function opts(val: unknown, name: string): Record<string, unknown> {
  if (val === undefined || val === null) return {};
  if (typeof val !== 'object' || Array.isArray(val)) {
    throw new ValidationError(`joints.${name}: options must be a plain object, got ${describe(val)}.`);
  }
  return val as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Pure geometry helpers (unit-tested via __testables__ — no WASM)
// ---------------------------------------------------------------------------

/** Dovetail cross-section: narrow at the mouth (y=0), flaring wider into the
 *  material (+y) by `angle`. `width` is the mouth width, `depth` the dovetail
 *  depth. Returns a closed CCW quad. */
export function dovetailProfile(width: number, depth: number, angleDeg: number): Vec2[] {
  const flare = depth * Math.tan((Math.PI / 180) * angleDeg);
  const w = width / 2;
  const W = w + flare;
  // CCW from mouth-left.
  return [
    [-w, 0],
    [w, 0],
    [W, depth],
    [-W, depth],
  ];
}

export interface KnuckleInterval {
  /** Interval along the barrel axis (mm from the hinge's x=0 end). */
  start: number;
  end: number;
  /** 0 = pin leaf (owns the integral pin), 1 = wrap leaf (bored knuckles). */
  owner: 0 | 1;
}

/** Knuckle layout for a print-in-place barrel hinge: `knuckles` equal-length
 *  intervals tiling `[0, width]` exactly, separated by axial gaps of `gap`,
 *  alternating ownership starting (and therefore ending — the count is odd)
 *  with the pin leaf, so the integral pin is captive at both ends. */
export function hingeKnuckleIntervals(width: number, knuckles: number, gap: number): KnuckleInterval[] {
  const len = (width - (knuckles - 1) * gap) / knuckles;
  const out: KnuckleInterval[] = [];
  for (let i = 0; i < knuckles; i++) {
    const start = i * (len + gap);
    out.push({ start, end: start + len, owner: (i % 2) as 0 | 1 });
  }
  return out;
}

export interface BallSocketDims {
  /** Ball radius (mm). */
  ballR: number;
  /** Socket cavity radius = ballR + radial clearance. */
  cavityR: number;
  /** Radius of the circular opening the ball snaps through. */
  openingR: number;
  /** Height of the retention lip — distance from cavity centre up to the top
   *  face, where the sphere's chord equals the opening. sqrt(cavityR² − openingR²). */
  lipH: number;
}

/** Core ball-and-socket dimensions. The opening is `openingRatio · ballD`
 *  (always < ballD, so the snapped-in ball is captive); the cavity carries the
 *  radial clearance so the ball articulates. */
export function ballSocketDims(ballD: number, clearanceGap: number, openingRatio: number): BallSocketDims {
  const ballR = ballD / 2;
  const cavityR = ballR + clearanceGap;
  const openingR = (openingRatio * ballD) / 2;
  return { ballR, cavityR, openingR, lipH: Math.sqrt(cavityR * cavityR - openingR * openingR) };
}

/** Circular bead/groove profile for `snapRim`: a closed CCW circle of radius
 *  `r` centred at `(R, 0)` in the revolve plane (x = radial distance, y → z).
 *  Requires `R > r` so every vertex stays at positive radius. */
export function snapRimProfile(R: number, r: number, n = 32): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    pts.push([R + r * Math.cos(a), r * Math.sin(a)]);
  }
  return pts;
}

// ---------------------------------------------------------------------------
// Namespace factory
// ---------------------------------------------------------------------------

export function createJointsNamespace(module: any) {
  const { Manifold, CrossSection } = module;

  /** Cylinder from z0→z1 (mm) at radius r. */
  function cyl(z0: number, z1: number, r: number, segments?: number): any {
    return Manifold.cylinder(z1 - z0, r, r, segments ?? 0).translate([0, 0, z0]);
  }
  /** Cone (truncated) from z0→z1, radius rLow→rHigh. */
  function cone(z0: number, z1: number, rLow: number, rHigh: number, segments?: number): any {
    return Manifold.cylinder(z1 - z0, rLow, rHigh, segments ?? 0).translate([0, 0, z0]);
  }
  /** Cylinder along +X from x0→x1, axis at (y=0, z=zc). */
  function cylX(x0: number, x1: number, r: number, zc: number, segments?: number): any {
    return Manifold.cylinder(x1 - x0, r, r, segments ?? 0)
      .rotate([0, 90, 0])
      .translate([x0, 0, zc]);
  }
  function seg(o: Record<string, unknown>): number | undefined {
    return o.segments === undefined ? undefined : num(o.segments, 'segments', { min: 3 });
  }

  return {
    /**
     * Alignment pin (solid) — a cylinder along +Z from z=0 to z=length, with a
     * lead-in chamfer at the top. UNION onto part A. Mate with `socket` of the
     * same nominal `diameter`. The pin stays nominal; the socket carries the
     * clearance.
     *
     * opts: { diameter, length, chamfer?, segments? }
     */
    pin(o0: unknown): any {
      const o = opts(o0, 'pin');
      const d = num(o.diameter, 'diameter', { min: 0.2 });
      const length = num(o.length, 'length', { min: 0.2 });
      const r = d / 2;
      const cham = num(o.chamfer, 'chamfer', { def: Math.min(0.6, r * 0.6), min: 0 });
      const s = seg(o);
      let pin = cyl(0, length, r, s);
      if (cham > 0) {
        // Chamfer the top: intersect the tip with a cone so the lead-in tapers.
        const tip = cone(length - cham, length, r, Math.max(r - cham, 0.05), s);
        const body = cyl(0, length - cham, r, s);
        pin = body.add(tip);
      }
      return pin;
    },

    /**
     * Socket (negative) for an alignment `pin` — a bored hole along +Z, mouth
     * at z=0 descending to z=-depth, sized `diameter + 2·clearance(fit)` with a
     * chamfered mouth for lead-in. SUBTRACT from part B.
     *
     * opts: { diameter, depth, fit?, chamfer?, segments? }
     */
    socket(o0: unknown): any {
      const o = opts(o0, 'socket');
      const d = num(o.diameter, 'diameter', { min: 0.2 });
      const depth = num(o.depth, 'depth', { min: 0.2 });
      const gap = clearance(o.fit ?? 'normal');
      const r = d / 2 + gap;
      const cham = num(o.chamfer, 'chamfer', { def: 0.6, min: 0 });
      const s = seg(o);
      let tool = cyl(-depth, LIP, r, s);
      if (cham > 0) {
        // Funnel mouth: a short cone wider at the surface.
        tool = tool.add(cone(-cham, LIP, r, r + cham, s));
      }
      return tool;
    },

    /**
     * Sliding dovetail. Returns { tail, socket }. The joint slides along +X.
     * The dovetail cross-section is narrow at the mouth (y=0) and flares wider
     * into the material (+y). `tail` is the male solid (UNION onto one part);
     * `socket` is the female negative (SUBTRACT from the other), widened by the
     * fit clearance so it slides.
     *
     * opts: { length, width, depth?, angle?, fit?, segments? }
     */
    dovetail(o0: unknown): { tail: any; socket: any } {
      const o = opts(o0, 'dovetail');
      const length = num(o.length, 'length', { min: 0.2 });
      const width = num(o.width, 'width', { min: 0.5 });
      const depth = num(o.depth, 'depth', { def: width * 0.6, min: 0.2 });
      const angle = num(o.angle, 'angle', { def: 15, min: 1 });
      const gap = clearance(o.fit ?? 'normal');

      // Build the male profile in XY (mouth on y=0), extrude along +Z by length,
      // then rotate so the slide axis becomes +X.
      const make = (extraWidth: number, extraDepth: number) => {
        const profile = dovetailProfile(width + 2 * extraWidth, depth + extraDepth, angle);
        return Manifold.extrude(new CrossSection([profile]), length)
          .rotate([0, 90, 0]); // Z(length) -> X
      };
      const tail = make(0, 0);
      // Socket is the negative: widen on the flared faces by `gap`, deepen by LIP
      // so it cuts through, and over-run the length so it slides clear.
      const socket = make(gap, LIP).translate([-LIP, 0, 0]);
      return { tail, socket };
    },

    /**
     * Cantilever snap fit. Returns { clip, catch }. The clip is a flexible beam
     * standing in +Z (rooted at z=0, tip at z=length) with a retention hook
     * jutting +Y at the tip; its top face is a `leadAngle` ramp for insertion.
     * UNION `clip` onto the moving part. The `catch` is a window negative
     * (SUBTRACT from the mating wall) the hook clicks through.
     * Local frame: beam back face on y=0, hook protrudes +Y.
     *
     * opts: { width, length, thickness?, hookDepth?, leadAngle?, fit?, rounded? }
     *   rounded: round the retention edge of the hook for smoother snap-in/out.
     */
    snapFit(o0: unknown): { clip: any; catch: any } {
      const o = opts(o0, 'snapFit');
      const width = num(o.width, 'width', { min: 0.5 });
      const length = num(o.length, 'length', { min: 1 });
      const thickness = num(o.thickness, 'thickness', { def: Math.max(1.2, width * 0.2), min: 0.4 });
      const hookDepth = num(o.hookDepth, 'hookDepth', { def: thickness * 0.8, min: 0.2 });
      const leadAngle = num(o.leadAngle, 'leadAngle', { def: 45, min: 10 });
      const gap = clearance(o.fit ?? 'normal');
      const rounded = bool(o.rounded, false);

      // Beam: a box width×thickness rising in Z. Back face on y=0.
      const beam = Manifold.cube([width, thickness, length], false).translate([-width / 2, 0, 0]);

      // Hook: a wedge at the tip that juts +Y by hookDepth. Build a triangular
      // prism in the Y-Z plane: flat retention face (bottom), ramped top.
      const ramp = hookDepth / Math.tan((Math.PI / 180) * leadAngle);
      const hookH = Math.min(ramp + hookDepth, length * 0.6);
      const hookBlock = Manifold.cube([width, hookDepth + thickness, hookH], false)
        .translate([-width / 2, 0, length - hookH]);
      // Slice the outer-top corner off to make the lead-in ramp.
      const cutter = Manifold.cube([width + 2, hookDepth * 2 + 2, hookH * 2], false)
        .translate([-width / 2 - 1, thickness, length])
        .rotate([leadAngle, 0, 0])
        .translate([0, 0, 0]);
      const hook = hookBlock.subtract(cutter);
      let clipResult = beam.add(hook);

      if (rounded) {
        // Chamfer the retention edge — the convex corner where the outer face
        // (y = thickness+hookDepth) meets the retention face (z = length-hookH) —
        // with a 45°-rotated cube cut. Produces a clean diagonal bevel that
        // reduces snap-in/out force without adding separate geometry.
        const r = Math.max(0.5, Math.min(hookDepth * 0.5, 1.5));
        const c = r * Math.SQRT2;
        const chamferCutter = Manifold.cube([width + 2, c, c], false)
          .translate([-width / 2 - 1, -c / 2, -c / 2])
          .rotate([45, 0, 0])
          .translate([0, thickness + hookDepth, length - hookH]);
        clipResult = clipResult.subtract(chamferCutter);
      }

      // Catch: a rectangular window the hook passes through, sized with
      // clearance. Centered on the hook protrusion, as a negative slab in Y.
      const winW = width + 2 * gap;
      const winH = hookDepth + 2 * gap;
      const catchTool = Manifold.cube([winW, thickness + 2 * LIP, winH], false)
        .translate([-winW / 2, -LIP, length - hookH - gap]);
      return { clip: clipResult, catch: catchTool };
    },

    /**
     * Print-in-place barrel hinge, lying open flat (180°) on the build plate.
     * Returns ONE Manifold made of exactly TWO free components: the *pin leaf*
     * (its knuckles carry an integral pin spanning the full width) and the
     * *wrap leaf* (its knuckles are bored `pinD + 2·clearance` and wrap the
     * pin). Knuckles alternate along the barrel with axial gaps of `clearance`;
     * the pin leaf owns both ends so the pin is captive. Local frame: barrel
     * axis along +X at x∈[0, width], leaves flat on z=0 extending ±Y; the
     * barrel rests tangent to z=0 so the whole hinge prints as-is.
     *
     * opts: { width?, leaf?, thickness?, knuckles?, pinD?, clearance?, segments? }
     *   width:     extent along the barrel axis (default 30)
     *   leaf:      depth of each leaf plate, from its setback edge outward (default 12)
     *   thickness: leaf plate thickness (default 3)
     *   knuckles:  odd count >= 3 (default 5)
     *   pinD:      pin diameter (default 4)
     *   clearance: radial + axial moving gap (default 0.3 — print-in-place
     *              needs more than an assembly fit)
     */
    hinge(o0: unknown): any {
      const o = opts(o0, 'hinge');
      const width = num(o.width, 'width', { def: 30, min: 5 });
      const leaf = num(o.leaf, 'leaf', { def: 12, min: 2 });
      const t = num(o.thickness, 'thickness', { def: 3, min: 0.8 });
      const knuckles = int(o.knuckles, 'knuckles', { def: 5, min: 3 });
      if (knuckles % 2 === 0) {
        throw new ValidationError(`joints.hinge: knuckles must be an odd count (so the pin leaf owns both ends), got ${knuckles}.`);
      }
      const pinD = num(o.pinD, 'pinD', { def: 4, min: 1 });
      const gap = clearance(o.clearance ?? 0.3);
      if (gap < 0.05) {
        throw new ValidationError(`joints.hinge: clearance must be >= 0.05 (parts fuse below that), got ${gap}.`);
      }
      const s = seg(o);

      const layout = hingeKnuckleIntervals(width, knuckles, gap);
      const kLen = layout[0].end - layout[0].start;
      if (kLen < 0.8) {
        throw new ValidationError(`joints.hinge: width ${width} is too small for ${knuckles} knuckles at clearance ${gap} (each knuckle would be ${kLen.toFixed(2)} long; need >= 0.8).`);
      }

      const pinR = pinD / 2;
      // Knuckle wall around the bored (wrap-leaf) knuckles — printable on a
      // 0.4mm nozzle, scaling up with the pin.
      const wall = Math.max(1.6, pinD * 0.4);
      const outerR = pinR + gap + wall; // knuckle outer radius
      const zc = outerR;                // barrel axis height → barrel rests on z=0
      // Leaf plates stand off the barrel by `gap` beyond the knuckle radius so
      // their edges never graze the other leaf's knuckles while rotating.
      const setback = outerR + gap;

      let pinLeaf = Manifold.cube([width, leaf, t], false).translate([0, -setback - leaf, 0]);
      let wrapLeaf = Manifold.cube([width, leaf, t], false).translate([0, setback, 0]);

      for (const k of layout) {
        const len = k.end - k.start;
        const knuckle = cylX(k.start, k.end, outerR, zc, s);
        // Web: a buttress (only over this knuckle's interval, so it can't touch
        // the other leaf's knuckles) joining the plate to the barrel. Overlaps
        // the plate by 0.5 so the union is volumetric.
        const web = Manifold.cube([len, setback + 0.5, zc], false)
          .translate([k.start, k.owner === 0 ? -(setback + 0.5) : 0, 0]);
        if (k.owner === 0) pinLeaf = pinLeaf.add(knuckle).add(web);
        else wrapLeaf = wrapLeaf.add(knuckle).add(web);
      }

      // Integral pin: part of the pin leaf, spanning the full width. It is
      // buried in the pin leaf's knuckles, bare in the axial gaps, and passes
      // through the wrap leaf's bores with radial clearance.
      pinLeaf = pinLeaf.add(cylX(0, width, pinR, zc, s));
      // Bore the wrap leaf's knuckles (and trim its webs near the axis) so the
      // pin spins free.
      wrapLeaf = wrapLeaf.subtract(cylX(-LIP, width + LIP, pinR + gap, zc, s));

      return pinLeaf.add(wrapLeaf); // disjoint union → componentCount === 2
    },

    /**
     * Snap-together ball-and-socket joint. Returns { ball, socket } — TWO
     * separate Manifolds, printed apart and snapped together afterwards.
     * `ball` is a sphere on a cylindrical stem rising from a mounting disc
     * (base on z=0, ball on top). `socket` is a cylindrical housing (base on
     * z=0) whose spherical cavity (`ballD + 2·clearance`) opens upward through
     * a circular mouth of `openingRatio · ballD` — smaller than the ball, so it
     * snaps in past the lip and stays captive while articulating — with a
     * conical entry chamfer to guide the snap. Union each piece onto your
     * parts (or use the discs as-is).
     *
     * opts: { ballD?, clearance?, openingRatio?, stemD?, stemL?, baseD?, baseT?, segments? }
     *   ballD:        ball diameter (default 10)
     *   clearance:    radial articulation gap (default 0.15)
     *   openingRatio: opening diameter as a fraction of ballD, 0.7..0.95
     *                 (default 0.85 — smaller is tighter to snap, harder to pop out)
     */
    ballSocket(o0: unknown): { ball: any; socket: any } {
      const o = opts(o0, 'ballSocket');
      const ballD = num(o.ballD, 'ballD', { def: 10, min: 2 });
      const gap = num(o.clearance, 'clearance', { def: 0.15, min: 0 });
      const ratio = num(o.openingRatio, 'openingRatio', { def: 0.85, min: 0.7, max: 0.95 });
      const dims = ballSocketDims(ballD, gap, ratio);
      const stemD = num(o.stemD, 'stemD', { def: ballD * 0.4, min: 0.8 });
      if (stemD / 2 >= dims.openingR) {
        throw new ValidationError(`joints.ballSocket: stemD (${stemD}) must be smaller than the socket opening (${(dims.openingR * 2).toFixed(2)}) or the ball can't articulate.`);
      }
      const stemL = num(o.stemL, 'stemL', { def: ballD * 0.6, min: 1 });
      const baseD = num(o.baseD, 'baseD', { def: ballD * 1.6, min: 1 });
      const baseT = num(o.baseT, 'baseT', { def: 3, min: 0.8 });
      const s = seg(o);

      // Ball half: disc base → stem → sphere (tip buried in the sphere).
      const stemTop = baseT + stemL;
      const ballC = stemTop + dims.ballR - Math.min(1.5, dims.ballR * 0.3);
      const ball = cyl(0, baseT, baseD / 2, s)
        .add(cyl(0, stemTop, stemD / 2, s))
        .add(Manifold.sphere(dims.ballR, s ?? 0).translate([0, 0, ballC]));

      // Socket half: housing cylinder minus the cavity sphere. The housing's
      // top face sits exactly where the cavity's chord equals the opening
      // radius, so cutting the sphere leaves a circular mouth of openingR.
      const wall = Math.max(1.6, ballD * 0.16);
      const floor = Math.max(1.2, wall);
      const cavC = floor + dims.cavityR;
      const topZ = cavC + dims.lipH;
      let socket = cyl(0, topZ, dims.cavityR + wall, s)
        .subtract(Manifold.sphere(dims.cavityR, s ?? 0).translate([0, 0, cavC]));
      // Conical entry chamfer around the mouth — eases the snap without eating
      // the retention lip (capped well below cavityR − openingR).
      const cham = Math.min(1.2, Math.max(0.3, (dims.cavityR - dims.openingR) * 0.6));
      socket = socket.subtract(
        cone(topZ - cham, topZ + LIP, dims.openingR, dims.openingR + cham + LIP, s),
      );
      return { ball, socket };
    },

    /**
     * Annular snap rim for press-on lids. Returns { bead, groove } (same pair
     * convention as `dovetail`):
     *   • `bead` — a POSITIVE torus ring; UNION it onto the MALE wall (e.g. the
     *     outside of a lid's skirt) so half the bead protrudes from the wall
     *     surface at `diameter`.
     *   • `groove` — a NEGATIVE torus ring at bead radius + `clearance`;
     *     SUBTRACT it from the FEMALE wall (e.g. the inside of the box mouth)
     *     at the same `diameter`, at the height where the lid seats.
     * Local frame: ring centred on the Z axis, bead/groove centreline circle of
     * diameter `diameter` lying in the z=0 plane — translate to the seating
     * height. `sweepDeg < 360` makes a partial arc (e.g. two opposing snaps).
     *
     * opts: { diameter, beadD?, clearance?, sweepDeg?, segments? }
     *   diameter: wall interface diameter the bead/groove centreline sits on (required)
     *   beadD:    bead cross-section diameter (default 1.2)
     *   clearance: radial growth of the groove over the bead (default 0.15)
     */
    snapRim(o0: unknown): { bead: any; groove: any } {
      const o = opts(o0, 'snapRim');
      const dia = num(o.diameter, 'diameter', { min: 1 });
      const beadD = num(o.beadD, 'beadD', { def: 1.2, min: 0.4 });
      const gap = num(o.clearance, 'clearance', { def: 0.15, min: 0 });
      const sweepDeg = num(o.sweepDeg, 'sweepDeg', { def: 360, min: 5, max: 360 });
      const s = seg(o);
      const R = dia / 2;
      const grooveR = beadD / 2 + gap;
      if (grooveR >= R) {
        throw new ValidationError(`joints.snapRim: diameter (${dia}) must exceed beadD + 2·clearance (${2 * grooveR}) — the ring profile must stay clear of the axis.`);
      }
      const ring = (r: number) =>
        Manifold.revolve(new CrossSection([snapRimProfile(R, r)]), s ?? 0, sweepDeg);
      return { bead: ring(beadD / 2), groove: ring(grooveR) };
    },
  };
}

/** Pure helpers exposed for unit testing without the WASM module. */
export const __testables__ = {
  dovetailProfile,
  hingeKnuckleIntervals,
  ballSocketDims,
  snapRimProfile,
};
