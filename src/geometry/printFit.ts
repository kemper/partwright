/**
 * Print-Fit — practical 3D-printing joinery & hardware helpers exposed to the
 * manifold-js sandbox as `api.printFit`.
 *
 * The base manifold-3d library gives you primitives + booleans, but the *fits*
 * that make a printed part actually assemble — clearance holes sized to a real
 * screw, heat-set insert bosses, captive-nut pockets, alignment pins, sliding
 * dovetails, cantilever snaps — are fiddly dimensional recipes that AI agents
 * (and humans) routinely get wrong. This module ships them as deterministic,
 * parametric builders backed by a real metric fastener table.
 *
 * Conventions (match Curves / sdf):
 *   • Z-up. Each builder documents its local frame; the caller positions the
 *     result with `.translate()` / `meshOps.placeOn()` / `meshOps.alignTo()`.
 *   • "Negative" builders (screwHole, socket, nutPocket, dovetail.socket,
 *     snapFit.catch) return a Manifold meant to be SUBTRACTED. They poke
 *     ~`LIP` above their entrance face so the boolean cuts cleanly through the
 *     surface instead of leaving a zero-thickness skin.
 *   • "Solid" builders (insertBoss, pin, dovetail.tail, snapFit.clip) return a
 *     Manifold meant to be UNIONED onto your part.
 *   • Builders THROW `ValidationError` on bad input (like api.label / Curves),
 *     so the mistake surfaces as a clear run error the agent can self-correct.
 *
 * Dimensions are typical references (ISO clearance holes, DIN 912 socket-cap /
 * DIN 7991 countersunk heads, DIN 934 nuts, common brass heat-set insert bores).
 * They are sensible defaults, not guarantees — every builder lets you override
 * the critical diameter directly, and the clearance presets are tunable.
 */

import { ValidationError } from '../validation/apiValidation';

/* eslint-disable @typescript-eslint/no-explicit-any */

type Vec2 = [number, number];

/** A tiny over-poke so subtractive tools break the surface cleanly. */
const LIP = 0.1;

// ---------------------------------------------------------------------------
// Fastener reference table
// ---------------------------------------------------------------------------

export interface HeadSpec { dia: number; height: number }
export interface FastenerSpec {
  /** Nominal major diameter (mm). */
  nominal: number;
  /** Clearance-hole diameters for the three standard fit classes. */
  clearance: { close: number; normal: number; loose: number };
  /** Tap / thread-forming pilot diameter (mm). */
  tap: number;
  /** Socket-cap (DIN 912) head — counterbore target. */
  socket: HeadSpec;
  /** Countersunk (DIN 7991) head diameter; cone is 90°. */
  countersunk: { dia: number; angleDeg: number };
  /** Pan head — shallow counterbore target. */
  pan: HeadSpec;
  /** Hex nut (DIN 934): across-flats width + height. */
  nut: { width: number; height: number };
  /** Brass heat-set insert: typical melt-in bore diameter + depth. */
  insert: { hole: number; depth: number };
}

/** Frozen metric fastener table, M2…M8. */
export const FASTENERS: Readonly<Record<string, FastenerSpec>> = Object.freeze({
  M2:   { nominal: 2,   clearance: { close: 2.2, normal: 2.4, loose: 2.6 },  tap: 1.6,  socket: { dia: 3.8,  height: 2.0 }, countersunk: { dia: 3.8,  angleDeg: 90 }, pan: { dia: 4.0,  height: 1.6 }, nut: { width: 4.0,  height: 1.6 }, insert: { hole: 3.2, depth: 4.0 } },
  M2_5: { nominal: 2.5, clearance: { close: 2.7, normal: 2.9, loose: 3.1 },  tap: 2.05, socket: { dia: 4.5,  height: 2.5 }, countersunk: { dia: 4.7,  angleDeg: 90 }, pan: { dia: 5.0,  height: 2.1 }, nut: { width: 5.0,  height: 2.0 }, insert: { hole: 3.6, depth: 4.5 } },
  M3:   { nominal: 3,   clearance: { close: 3.2, normal: 3.4, loose: 3.6 },  tap: 2.5,  socket: { dia: 5.5,  height: 3.0 }, countersunk: { dia: 5.6,  angleDeg: 90 }, pan: { dia: 5.6,  height: 2.4 }, nut: { width: 5.5,  height: 2.4 }, insert: { hole: 4.0, depth: 5.0 } },
  M4:   { nominal: 4,   clearance: { close: 4.3, normal: 4.5, loose: 4.8 },  tap: 3.3,  socket: { dia: 7.0,  height: 4.0 }, countersunk: { dia: 7.5,  angleDeg: 90 }, pan: { dia: 8.0,  height: 3.1 }, nut: { width: 7.0,  height: 3.2 }, insert: { hole: 5.6, depth: 6.5 } },
  M5:   { nominal: 5,   clearance: { close: 5.3, normal: 5.5, loose: 5.8 },  tap: 4.2,  socket: { dia: 8.5,  height: 5.0 }, countersunk: { dia: 9.2,  angleDeg: 90 }, pan: { dia: 9.5,  height: 3.7 }, nut: { width: 8.0,  height: 4.0 }, insert: { hole: 6.4, depth: 7.0 } },
  M6:   { nominal: 6,   clearance: { close: 6.4, normal: 6.6, loose: 7.0 },  tap: 5.0,  socket: { dia: 10.0, height: 6.0 }, countersunk: { dia: 11.0, angleDeg: 90 }, pan: { dia: 12.0, height: 4.6 }, nut: { width: 10.0, height: 5.0 }, insert: { hole: 8.0, depth: 8.0 } },
  M8:   { nominal: 8,   clearance: { close: 8.4, normal: 9.0, loose: 10.0 }, tap: 6.8,  socket: { dia: 13.0, height: 8.0 }, countersunk: { dia: 14.5, angleDeg: 90 }, pan: { dia: 16.0, height: 6.0 }, nut: { width: 13.0, height: 6.5 }, insert: { hole: 9.6, depth: 9.5 } },
});

/** Accept both "M2.5" and "M2_5" spellings for the size key. */
function normalizeSize(size: unknown): string {
  if (typeof size !== 'string' || size.length === 0) {
    throw new ValidationError(`printFit: size must be a string like "M3", got ${describe(size)}. Known: ${Object.keys(FASTENERS).join(', ')}.`);
  }
  const key = size.trim().toUpperCase().replace('.', '_');
  if (!(key in FASTENERS)) {
    throw new ValidationError(`printFit: unknown fastener size "${size}". Known: ${Object.keys(FASTENERS).join(', ')}.`);
  }
  return key;
}

/** Look up the full spec for a metric size (e.g. "M3", "M2.5"). */
export function fastener(size: unknown): FastenerSpec {
  return FASTENERS[normalizeSize(size)];
}

// ---------------------------------------------------------------------------
// Clearance-fit presets (radial gap, mm)
// ---------------------------------------------------------------------------

export type Fit = 'press' | 'snug' | 'normal' | 'loose' | 'free';

/** Radial clearance per fit class. Tuned for a typical 0.4mm-nozzle FDM
 *  printer; `printFit.clearance` lets callers read them and the builders apply
 *  them. A "press" fit is interference (0) — size for friction on your printer. */
export const CLEARANCE_PRESETS: Readonly<Record<Fit, number>> = Object.freeze({
  press: 0.0,
  snug: 0.1,
  normal: 0.2,
  loose: 0.35,
  free: 0.5,
});

export function clearance(fit: unknown = 'normal'): number {
  if (typeof fit === 'number' && Number.isFinite(fit)) return fit; // allow an explicit gap
  if (typeof fit !== 'string' || !(fit in CLEARANCE_PRESETS)) {
    throw new ValidationError(`printFit.clearance: fit must be one of ${Object.keys(CLEARANCE_PRESETS).join(' | ')} (or a number), got ${describe(fit)}.`);
  }
  return CLEARANCE_PRESETS[fit as Fit];
}

/** Clearance-hole diameter for a screw at a given fit class. */
export function clearanceHole(size: unknown, fit: 'close' | 'normal' | 'loose' = 'normal'): number {
  const spec = fastener(size);
  if (fit !== 'close' && fit !== 'normal' && fit !== 'loose') {
    throw new ValidationError(`printFit.clearanceHole: fit must be "close" | "normal" | "loose", got ${describe(fit)}.`);
  }
  return spec.clearance[fit];
}

// ---------------------------------------------------------------------------
// Pure geometry helpers (unit-tested via __testables__)
// ---------------------------------------------------------------------------

/** Across-flats `width` → regular-hexagon vertices, flats facing ±Y. */
export function hexPoints(width: number): Vec2[] {
  const R = width / Math.sqrt(3); // circumradius from across-flats
  const pts: Vec2[] = [];
  // Vertices at 0°,60°,…,300° put flat edges at the top/bottom (facing ±Y), so
  // the across-flats span is measured along Y and equals `width`.
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i);
    pts.push([R * Math.cos(a), R * Math.sin(a)]);
  }
  return pts;
}

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

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (typeof v === 'string') return `"${v}"`;
  return String(v);
}

function num(val: unknown, name: string, opts: { min?: number; def?: number } = {}): number {
  if (val === undefined && opts.def !== undefined) return opts.def;
  if (typeof val !== 'number' || !Number.isFinite(val)) {
    throw new ValidationError(`printFit: ${name} must be a finite number, got ${describe(val)}.`);
  }
  if (opts.min !== undefined && val < opts.min) {
    throw new ValidationError(`printFit: ${name} must be >= ${opts.min}, got ${val}.`);
  }
  return val;
}

function bool(val: unknown, def: boolean): boolean {
  if (val === undefined) return def;
  if (typeof val !== 'boolean') throw new ValidationError(`printFit: expected a boolean, got ${describe(val)}.`);
  return val;
}

function opts(val: unknown, name: string): Record<string, unknown> {
  if (val === undefined || val === null) return {};
  if (typeof val !== 'object' || Array.isArray(val)) {
    throw new ValidationError(`printFit.${name}: options must be a plain object, got ${describe(val)}.`);
  }
  return val as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Namespace factory
// ---------------------------------------------------------------------------

export interface PrintFitDeps {
  /** api.text — used by clearanceCoupon to emboss values. Optional; the coupon
   *  errors clearly if text isn't available (fonts not yet loaded). */
  text?: (str: string, opts?: any) => any;
}

export function createPrintFitNamespace(module: any, deps: PrintFitDeps = {}) {
  const { Manifold, CrossSection } = module;

  /** Cylinder from z0→z1 (mm) at radius r. */
  function cyl(z0: number, z1: number, r: number, segments?: number): any {
    return Manifold.cylinder(z1 - z0, r, r, segments ?? 0).translate([0, 0, z0]);
  }
  /** Cone (truncated) from z0→z1, radius rLow→rHigh. */
  function cone(z0: number, z1: number, rLow: number, rHigh: number, segments?: number): any {
    return Manifold.cylinder(z1 - z0, rLow, rHigh, segments ?? 0).translate([0, 0, z0]);
  }
  function seg(o: Record<string, unknown>): number | undefined {
    return o.segments === undefined ? undefined : num(o.segments, 'segments', { min: 3 });
  }

  return {
    // Data passthroughs ------------------------------------------------------
    fasteners: FASTENERS,
    fastener,
    clearance,
    clearanceHole,

    /**
     * Clearance hole for a screw, as a NEGATIVE tool to subtract.
     * Local frame: axis = Z, entrance (head) at z=0, shank descends to
     * z=-length. The head recess is carved at the top. The tool pokes `LIP`
     * above z=0 so it cuts the top face cleanly.
     *
     * opts: { size, fit?, length, head?, headClearance?, through?, segments? }
     *   head: 'socket' (counterbore) | 'countersunk' (90° cone) | 'pan' | 'none'
     */
    screwHole(o0: unknown): any {
      const o = opts(o0, 'screwHole');
      const spec = fastener(o.size);
      const fitClass = (o.fit as any) ?? 'normal';
      const shankR = clearanceHole(o.size, fitClass) / 2;
      const length = num(o.length, 'length', { min: 0.2 });
      const head = (o.head as string) ?? 'socket';
      const headClear = num(o.headClearance, 'headClearance', { def: 0.2, min: 0 });
      const s = seg(o);

      // Shank: from the top lip down to the bottom. `through` simply means we
      // also poke out the bottom so it cuts both faces.
      const through = bool(o.through, false);
      const bottom = through ? -length - LIP : -length;
      let tool = cyl(bottom, LIP, shankR, s);

      if (head === 'socket') {
        const hr = spec.socket.dia / 2 + headClear;
        const hh = spec.socket.height + headClear;
        tool = tool.add(cyl(-hh, LIP, hr, s));
      } else if (head === 'pan') {
        const hr = spec.pan.dia / 2 + headClear;
        const hh = spec.pan.height + headClear;
        tool = tool.add(cyl(-hh, LIP, hr, s));
      } else if (head === 'countersunk') {
        const hr = spec.countersunk.dia / 2 + headClear;
        // 90° cone: depth ≈ radius. Cone narrows from hr (at top) to shankR.
        const cdepth = hr - shankR;
        tool = tool.add(cone(-cdepth, LIP, shankR, hr, s).translate([0, 0, 0]));
      } else if (head !== 'none') {
        throw new ValidationError(`printFit.screwHole: head must be "socket" | "countersunk" | "pan" | "none", got ${describe(head)}.`);
      }
      return tool;
    },

    /**
     * Heat-set insert boss — a solid cylindrical post with a tapered insert
     * bore from the top. UNION it onto your part. Sits on z=0, rises to
     * z=height; bore opens at the top (z=height) and runs down `insert.depth`.
     * Local frame: axis = Z, base at z=0.
     *
     * opts: { size, height?, wall?, taper?, holeDiameter?, segments? }
     */
    insertBoss(o0: unknown): any {
      const o = opts(o0, 'insertBoss');
      const spec = fastener(o.size);
      const hole = num(o.holeDiameter, 'holeDiameter', { def: spec.insert.hole, min: 0.2 });
      const wall = num(o.wall, 'wall', { def: 2, min: 0.4 });
      const boreDepth = Math.min(num(o.depth, 'depth', { def: spec.insert.depth, min: 0.2 }));
      const height = num(o.height, 'height', { def: boreDepth + 2, min: boreDepth + 0.4 });
      const taper = bool(o.taper, true);
      const s = seg(o);
      const outerR = hole / 2 + wall;

      const boss = cyl(0, height, outerR, s);
      // Bore: optional slight lead-in flare at the mouth so the insert starts
      // square. Bore runs from the top down `boreDepth`.
      const r = hole / 2;
      const topZ = height + LIP;
      let bore;
      if (taper) {
        const flare = 0.4;
        bore = cone(height - boreDepth, topZ, r, r + flare, s);
      } else {
        bore = cyl(height - boreDepth, topZ, r, s);
      }
      return boss.subtract(bore);
    },

    /**
     * Captive / clearance nut pocket — a hex NEGATIVE to subtract. Local frame:
     * the hex prism axis = Z, pocket mouth at z=0 descending to z=-depth, flats
     * facing ±Y. With `captive: true` a horizontal entry slot is added so the
     * nut slides in from +Y.
     *
     * opts: { size, depth?, fit?, captive?, slotLength?, segments? }
     */
    nutPocket(o0: unknown): any {
      const o = opts(o0, 'nutPocket');
      const spec = fastener(o.size);
      const gap = clearance(o.fit ?? 'normal');
      const width = spec.nut.width + 2 * gap;
      const depth = num(o.depth, 'depth', { def: spec.nut.height + 0.2, min: 0.2 });

      const profile = hexPoints(width);
      // Extrude the hex along +Z then drop it so it spans [-depth, LIP].
      let pocket = Manifold.extrude(new CrossSection([profile]), depth + LIP).translate([0, 0, -depth]);

      if (bool(o.captive, false)) {
        const slotLen = num(o.slotLength, 'slotLength', { def: spec.nut.width, min: 0.2 });
        // A rectangular channel from the hex out toward +Y at nut thickness.
        const acrossFlats = width;
        const slot = Manifold.cube([acrossFlats, slotLen + acrossFlats, depth + LIP], false)
          .translate([-acrossFlats / 2, 0, -depth]);
        pocket = pocket.add(slot);
      }
      return pocket;
    },

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
     * Clearance-calibration coupon — a base bar of graduated through-holes for a
     * chosen screw/pin, each embossed with its clearance value. Print it once to
     * find the fit your printer actually produces. Returns a single Manifold.
     *
     * opts: { size, fits?, thickness?, segments? }
     *   fits: array of radial clearances to test (default a useful sweep).
     */
    clearanceCoupon(o0: unknown): any {
      const o = opts(o0, 'clearanceCoupon');
      const spec = fastener(o.size);
      const fits = Array.isArray(o.fits) && o.fits.length > 0
        ? (o.fits as unknown[]).map((f, i) => num(f, `fits[${i}]`, { min: 0 }))
        : [0.0, 0.1, 0.2, 0.3, 0.4];
      const thickness = num(o.thickness, 'thickness', { def: 3, min: 1 });
      const baseR = spec.nominal; // pad around each hole
      const pitch = (spec.nominal + 2 * baseR) + 4;
      const s = seg(o);

      const baseW = pitch * fits.length + 4;
      const baseD = spec.nominal * 2 + 10;
      let coupon = Manifold.cube([baseW, baseD, thickness], false).translate([-baseW / 2, -baseD / 2, 0]);

      fits.forEach((gap, i) => {
        const x = -baseW / 2 + 4 + pitch * i + pitch / 2 - 2;
        const r = spec.nominal / 2 + gap;
        const hole = cyl(-LIP, thickness + LIP, r, s).translate([x, baseD / 4, 0]);
        coupon = coupon.subtract(hole);

        if (deps.text) {
          // Engrave the clearance value (e.g. "0.20") below each hole. Engraving
          // (subtract) keeps the coupon a single watertight manifold and prints
          // more cleanly than raised text. The label spans from just under the
          // top face up through it, so the cut breaks the surface.
          const engrave = Math.min(0.6, thickness / 3);
          const label = deps.text(gap.toFixed(2), { size: 2.6, height: engrave + LIP, center: true });
          if (label) {
            coupon = coupon.subtract(label.translate([x, -baseD / 4, thickness - engrave]));
          }
        }
      });
      return coupon;
    },
  };
}

/** Pure helpers exposed for unit testing without the WASM module. */
export const __testables__ = {
  normalizeSize,
  hexPoints,
  dovetailProfile,
  clearance,
  clearanceHole,
  fastener,
};
