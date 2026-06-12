/**
 * Enclosures — two-part project boxes and the shells/standoffs that make them,
 * exposed to the manifold-js sandbox as `api.enclosure`.
 *
 * A two-part box is the single most-printed functional object, and getting the
 * lid-to-base fit right (a nesting lip with the correct clearance, or corner
 * screw bosses that line up with clearance holes in the lid) is exactly the
 * fiddly dimensional work that humans and AI agents get subtly wrong by hand.
 * This module ships it as deterministic parametric builders that **compose the
 * fasteners library** (`src/geometry/fasteners.ts`): the screw-lid variant
 * bores its bosses and lid holes with the real metric-fastener table and the
 * shared clearance presets, so a box and the hardware that closes it stay in
 * sync. Its siblings are `gears.ts`, `threads.ts`, `joints.ts`.
 *
 * Conventions (match Curves / fasteners / gears / joints):
 *   • Z-up, millimetres. A box is built with its base floor on `z=0`; the
 *     returned `lid` is already positioned ON the base (assembled) so the fit
 *     previews directly — translate it up / lay it flat to print.
 *   • A correctly-fitting two-part box reports `componentCount === 2` (the
 *     clearance gap keeps base and lid as separate solids). A fused `1` means
 *     the gap is too small — loosen `fit`.
 *   • Builders THROW `ValidationError` on bad input (like fasteners / gears) so
 *     the mistake surfaces as a clear run error the agent can self-correct.
 *
 * v1 scope: rounded `shell`, two-part `box` (lip-nesting OR corner-screw lid),
 * and PCB `standoff` posts. Vents/grilles are intentionally deferred — compose
 * them by subtracting your own pattern from a `shell` for now.
 */

import { ValidationError } from '../validation/apiValidation';
import { LIP, clearance, fastener } from './fasteners';

/* eslint-disable @typescript-eslint/no-explicit-any */

type Vec2 = [number, number];

// ---------------------------------------------------------------------------
// Validation helpers (mirror fasteners' / gears' local helpers)
// ---------------------------------------------------------------------------

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (typeof v === 'string') return `"${v}"`;
  if (Array.isArray(v)) return `[${v.map(describe).join(', ')}]`;
  return String(v);
}

function num(val: unknown, name: string, opts: { min?: number; max?: number; def?: number } = {}): number {
  if (val === undefined && opts.def !== undefined) return opts.def;
  if (typeof val !== 'number' || !Number.isFinite(val)) {
    throw new ValidationError(`enclosure: ${name} must be a finite number, got ${describe(val)}.`);
  }
  if (opts.min !== undefined && val < opts.min) {
    throw new ValidationError(`enclosure: ${name} must be >= ${opts.min}, got ${val}.`);
  }
  if (opts.max !== undefined && val > opts.max) {
    throw new ValidationError(`enclosure: ${name} must be <= ${opts.max}, got ${val}.`);
  }
  return val;
}

function opts(val: unknown, name: string): Record<string, unknown> {
  if (val === undefined || val === null) return {};
  if (typeof val !== 'object' || Array.isArray(val)) {
    throw new ValidationError(`enclosure.${name}: options must be a plain object, got ${describe(val)}.`);
  }
  return val as Record<string, unknown>;
}

/** Parse a `size: [x, y, z]` triple of positive numbers. */
function size3(val: unknown, where: string): [number, number, number] {
  if (!Array.isArray(val) || val.length !== 3) {
    throw new ValidationError(`enclosure.${where}: size must be [x, y, z], got ${describe(val)}.`);
  }
  const x = num(val[0], `${where}.size[0]`, { min: 1 });
  const y = num(val[1], `${where}.size[1]`, { min: 1 });
  const z = num(val[2], `${where}.size[2]`, { min: 1 });
  return [x, y, z];
}

// ---------------------------------------------------------------------------
// Pure geometry helpers (unit-tested via __testables__)
// ---------------------------------------------------------------------------

/** Centred rounded-rectangle outline (CCW). `r === 0` → a plain rectangle. */
export function roundedRectPts(w: number, h: number, r: number, seg = 8): Vec2[] {
  const hw = w / 2, hh = h / 2;
  const rad = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  if (rad < 1e-6) return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
  const ix = hw - rad, iy = hh - rad;
  const arc = (cx: number, cy: number, a0: number, a1: number): Vec2[] => {
    const out: Vec2[] = [];
    for (let i = 0; i <= seg; i++) {
      const a = a0 + ((a1 - a0) * i) / seg;
      out.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a)]);
    }
    return out;
  };
  const P = Math.PI;
  return [
    ...arc(ix, -iy, -P / 2, 0),
    ...arc(ix, iy, 0, P / 2),
    ...arc(-ix, iy, P / 2, P),
    ...arc(-ix, -iy, P, 1.5 * P),
  ];
}

// ---------------------------------------------------------------------------
// Namespace factory
// ---------------------------------------------------------------------------

export interface EnclosureDeps {
  /** api.fasteners — the screw-lid + standoff builders reuse its tapHole /
   *  screwHole so bores stay sized to the real metric table. */
  fasteners: {
    tapHole: (o: any) => any;
    screwHole: (o: any) => any;
  };
}

export function createEnclosureNamespace(module: any, deps: EnclosureDeps) {
  const { Manifold, CrossSection } = module;
  const { fasteners } = deps;

  /** A solid rounded box of [w,h,depth] sitting on z=0, footprint centred on XY. */
  function roundedBox(w: number, h: number, depth: number, r: number, seg: number): any {
    return Manifold.extrude(new CrossSection([roundedRectPts(w, h, r, seg)]), depth);
  }

  function cornerSeg(o: Record<string, unknown>): number {
    return o.segments === undefined ? 8 : num(o.segments, 'segments', { min: 1, max: 64 });
  }

  /**
   * A single open-top (or fully closed) rounded shell — the primitive every
   * box is built from. Floor on z=0, walls rising to z=size[2], hollowed to the
   * given `wall`/`floor` thickness. Local frame: footprint centred on XY.
   *
   * opts: { size:[x,y,z], wall?=2, floor?=wall, radius?=2, open?='top' }
   *   open: 'top' (default — open box) | 'none' (fully enclosed box)
   */
  function shell(o0: unknown): any {
    const o = opts(o0, 'shell');
    const [x, y, z] = size3(o.size, 'shell');
    const wall = num(o.wall, 'wall', { def: 2, min: 0.4, max: Math.min(x, y) / 2 - 0.1 });
    const floor = num(o.floor, 'floor', { def: wall, min: 0.4, max: z - 0.1 });
    const radius = num(o.radius, 'radius', { def: 2, min: 0, max: Math.min(x, y) / 2 });
    const open = o.open ?? 'top';
    if (open !== 'top' && open !== 'none') {
      throw new ValidationError(`enclosure.shell: open must be "top" | "none", got ${describe(open)}.`);
    }
    const seg = cornerSeg(o);

    const outer = roundedBox(x, y, z, radius, seg);
    const innerR = Math.max(0, radius - wall);
    // Cavity rises from the top of the floor. Open-top: poke past the rim so it
    // cuts the top face cleanly. Closed: stop `wall` below the rim for a lid.
    const cavityTop = open === 'top' ? z - floor + LIP : z - floor - wall;
    if (cavityTop <= 0) {
      throw new ValidationError(`enclosure.shell: walls/floor leave no interior (size z=${z}, floor=${floor}, wall=${wall}).`);
    }
    const cavity = roundedBox(x - 2 * wall, y - 2 * wall, cavityTop, innerR, seg).translate([0, 0, floor]);
    return outer.subtract(cavity);
  }

  /**
   * A two-part project box. Returns `{ base, lid }`, both Manifolds, with the
   * lid already seated on the base (assembled) so the fit previews directly.
   * `size` is the assembled OUTER size [x,y,z]; the seam sits at z = size[2] −
   * lidHeight. A correct fit reports `componentCount === 2`.
   *
   * opts: { size:[x,y,z], wall?=2, floor?=wall, radius?=2,
   *         lidHeight?, type?='lip', fit?='snug', lip?, screw? }
   *   type: 'lip'   — the lid's lower section narrows into a plug that nests
   *                   inside the base opening with `fit` clearance.
   *         'screw' — corner bosses in the base (tapped for `screw.size`) and
   *                   matching countersunk clearance holes in the lid.
   *   fit:  clearance preset ('press'|'snug'|'normal'|'loose'|'free') or a
   *         number (mm radial gap) for the lid↔base mate. Default 'snug'.
   *   lip:  { depth? } — plug depth for the 'lip' type.
   *   screw:{ size?='M3', count?=4, inset?, head?='countersunk' } — for 'screw'.
   */
  function box(o0: unknown): { base: any; lid: any } {
    const o = opts(o0, 'box');
    const [x, y, z] = size3(o.size, 'box');
    const wall = num(o.wall, 'wall', { def: 2, min: 0.4, max: Math.min(x, y) / 4 });
    const floor = num(o.floor, 'floor', { def: wall, min: 0.4 });
    const radius = num(o.radius, 'radius', { def: 2, min: 0, max: Math.min(x, y) / 2 });
    const lidHeight = num(o.lidHeight, 'lidHeight', { def: Math.min(Math.max(z * 0.18, 4), z - floor - 2), min: 1, max: z - floor - 1 });
    const seg = cornerSeg(o);
    const gap = clearance(o.fit ?? 'snug');
    const type = o.type ?? 'lip';
    if (type !== 'lip' && type !== 'screw') {
      throw new ValidationError(`enclosure.box: type must be "lip" | "screw", got ${describe(type)}.`);
    }
    const seam = z - lidHeight; // global z of the base rim
    if (seam <= floor + 0.5) {
      throw new ValidationError(`enclosure.box: lidHeight ${lidHeight} leaves the base too short (seam at z=${seam.toFixed(2)} vs floor ${floor}). Reduce lidHeight or increase size z.`);
    }

    // Base: an open-top shell up to the seam.
    let base = shell({ size: [x, y, seam], wall, floor, radius, open: 'top', segments: seg });

    if (type === 'lip') {
      const lipCfg = opts(o.lip, 'box.lip');
      const lipDepth = num(lipCfg.depth, 'lip.depth', { def: Math.min(Math.max(z * 0.1, 2.5), seam - floor - 0.5), min: 1, max: seam - floor - 0.5 });
      const innerW = x - 2 * wall, innerH = y - 2 * wall;
      // Plug footprint = base opening minus the mating gap on each side.
      const plugW = innerW - 2 * gap, plugH = innerH - 2 * gap;
      if (plugW <= 2 * wall || plugH <= 2 * wall) {
        throw new ValidationError(`enclosure.box: walls too thick for a lip plug (plug ${plugW.toFixed(1)}×${plugH.toFixed(1)} vs wall ${wall}). Reduce wall or fit.`);
      }
      const plugR = Math.max(0, radius - wall - gap);
      const Ht = lidHeight + lipDepth; // full lid solid: exposed cap + plug skirt

      // Full cap, then carve the outer band off the bottom `lipDepth` so only
      // the plug footprint descends.
      let lid = roundedBox(x, y, Ht, radius, seg);
      const bottomSlab = roundedBox(x + 2 * LIP, y + 2 * LIP, lipDepth, radius, seg);
      const plugKeep = roundedBox(plugW, plugH, lipDepth + 2 * LIP, plugR, seg).translate([0, 0, -LIP]);
      const band = bottomSlab.subtract(plugKeep);
      lid = lid.subtract(band);
      // Hollow the lid, leaving `wall` of top + plug-skirt walls.
      const cav = roundedBox(plugW - 2 * wall, plugH - 2 * wall, Ht - wall + LIP, Math.max(0, plugR - wall), seg).translate([0, 0, -LIP]);
      lid = lid.subtract(cav);
      // Seat it: plug bottom at seam − lipDepth so the plug nests into the base.
      lid = lid.translate([0, 0, seam - lipDepth]);
      return { base, lid };
    }

    // type === 'screw'
    const screwCfg = opts(o.screw, 'box.screw');
    const sizeKey = (screwCfg.size as string) ?? 'M3';
    const spec = fastener(sizeKey); // validates the key
    const count = num(screwCfg.count, 'screw.count', { def: 4, min: 1, max: 12 });
    if (count !== 4) {
      throw new ValidationError(`enclosure.box: screw.count is fixed at 4 (one boss per corner) in v1, got ${count}.`);
    }
    const head = (screwCfg.head as string) ?? 'countersunk';
    const bossWall = 2.2;
    const bossOD = spec.tap + 2 * bossWall;
    const inset = num(screwCfg.inset, 'screw.inset', { def: Math.max(wall + bossOD / 2 + 0.6, radius + bossOD / 2), min: bossOD / 2 });
    const corners: Vec2[] = [
      [x / 2 - inset, y / 2 - inset],
      [-(x / 2 - inset), y / 2 - inset],
      [x / 2 - inset, -(y / 2 - inset)],
      [-(x / 2 - inset), -(y / 2 - inset)],
    ];
    const bossH = seam - floor;
    if (bossH < spec.tap) {
      throw new ValidationError(`enclosure.box: base too short for screw bosses (boss height ${bossH.toFixed(1)} < tap depth). Increase size z.`);
    }
    for (const [cx, cy] of corners) {
      // Solid post on the floor, then tapped from its top so the screw bites.
      let boss = Manifold.cylinder(bossH, bossOD / 2, bossOD / 2, seg * 4).translate([0, 0, floor]);
      const tap = fasteners.tapHole({ size: sizeKey, length: Math.min(bossH, spec.tap * 2.5) }).translate([0, 0, floor + bossH]);
      boss = boss.subtract(tap);
      base = base.add(boss.translate([cx, cy, 0]));
    }

    // Lid: a closed shell sitting on the rim, holes for the screws.
    let lid = shell({ size: [x, y, lidHeight], wall, floor: wall, radius, open: 'none', segments: seg });
    // Flip so the closed face is up and the open lip mates onto the base rim.
    lid = lid.rotate([180, 0, 0]).translate([0, 0, lidHeight]);
    for (const [cx, cy] of corners) {
      const hole = fasteners.screwHole({ size: sizeKey, length: lidHeight + 2 * LIP, head, through: true })
        .translate([cx, cy, lidHeight]);
      lid = lid.subtract(hole);
    }
    lid = lid.translate([0, 0, seam]);
    return { base, lid };
  }

  /**
   * A PCB / board standoff post: a cylinder on z=0 with a self-tapping pilot
   * bore (`bore:'tap'`) or a through clearance hole (`bore:'through'`) from the
   * top. UNION it onto a floor (pattern the positions yourself with
   * `api.linearPattern` / `circularPattern`). Local frame: base on z=0.
   *
   * opts: { size?='M3', height?=6, od?, bore?='tap', segments? }
   */
  function standoff(o0: unknown): any {
    const o = opts(o0, 'standoff');
    const sizeKey = (o.size as string) ?? 'M3';
    const spec = fastener(sizeKey);
    const height = num(o.height, 'height', { def: 6, min: 1 });
    const od = num(o.od, 'od', { def: spec.tap + 2 * 2.2, min: spec.tap + 0.8 });
    const bore = o.bore ?? 'tap';
    if (bore !== 'tap' && bore !== 'through') {
      throw new ValidationError(`enclosure.standoff: bore must be "tap" | "through", got ${describe(bore)}.`);
    }
    const seg = cornerSeg(o) * 4;
    let post = Manifold.cylinder(height, od / 2, od / 2, seg);
    if (bore === 'tap') {
      post = post.subtract(fasteners.tapHole({ size: sizeKey, length: Math.min(height, spec.tap * 3) }).translate([0, 0, height]));
    } else {
      post = post.subtract(fasteners.screwHole({ size: sizeKey, length: height, head: 'none', through: true }).translate([0, 0, height]));
    }
    return post;
  }

  return { shell, box, standoff };
}

/** Pure helpers exposed for unit testing without the WASM module. */
export const __testables__ = { roundedRectPts };
