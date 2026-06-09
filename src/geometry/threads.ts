/**
 * Threads — ISO-metric threaded rod / bolt / nut helpers exposed to the
 * manifold-js sandbox as `api.threads`.
 *
 * Real helical threads are a swept-along-a-helix surface that AI agents
 * routinely get wrong — until now the verb table in /ai.md said "(write a helix
 * manually)" and pointed people at OpenSCAD/BOSL2. This module builds the
 * thread ridge as a single hand-tessellated helical sweep (one closed profile
 * loop swept along the helix, capped at both ends), unions it with the core
 * cylinder, and trims the ends flat — producing a watertight, printable
 * Manifold. A metric coarse-pitch table means `threads.rod({ size: "M8" })`
 * just works.
 *
 * Conventions (match Curves / printFit / gears):
 *   • Z-up. A rod is built along +Z from z=0 to z=length; a bolt's head sits
 *     below z=0. The caller positions the result with `.translate()` etc.
 *   • Builders return a Manifold (or, for `bolt`, the assembled solid). They
 *     THROW `ValidationError` on bad input.
 *   • External threads are modelled at nominal size; the *nut* carries the fit
 *     clearance so a printed bolt threads into a printed nut.
 *
 * The profile is a truncated 60° ISO V-thread (crest/root flats), which prints
 * far more reliably on FDM than a sharp vee.
 */

import { ValidationError } from '../validation/apiValidation';

/* eslint-disable @typescript-eslint/no-explicit-any */

type Vec2 = [number, number];

const DEG = Math.PI / 180;
const LIP = 0.1;
/** ISO thread flank half-angle from the radial normal (60° included → 30°). */
const FLANK = 30 * DEG;

// ---------------------------------------------------------------------------
// Metric coarse-pitch table (nominal major diameter → coarse pitch, mm)
// ---------------------------------------------------------------------------

export const METRIC_COARSE: Readonly<Record<string, { nominal: number; pitch: number }>> = Object.freeze({
  M2:   { nominal: 2,  pitch: 0.4 },
  M2_5: { nominal: 2.5, pitch: 0.45 },
  M3:   { nominal: 3,  pitch: 0.5 },
  M4:   { nominal: 4,  pitch: 0.7 },
  M5:   { nominal: 5,  pitch: 0.8 },
  M6:   { nominal: 6,  pitch: 1.0 },
  M8:   { nominal: 8,  pitch: 1.25 },
  M10:  { nominal: 10, pitch: 1.5 },
  M12:  { nominal: 12, pitch: 1.75 },
  M16:  { nominal: 16, pitch: 2.0 },
  M20:  { nominal: 20, pitch: 2.5 },
});

function normalizeSize(size: unknown): string {
  if (typeof size !== 'string' || size.length === 0) {
    throw new ValidationError(`threads: size must be a string like "M8", got ${describe(size)}. Known: ${Object.keys(METRIC_COARSE).join(', ')}.`);
  }
  const key = size.trim().toUpperCase().replace('.', '_');
  if (!(key in METRIC_COARSE)) {
    throw new ValidationError(`threads: unknown size "${size}". Known: ${Object.keys(METRIC_COARSE).join(', ')}.`);
  }
  return key;
}

// ---------------------------------------------------------------------------
// Validation helpers
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
    throw new ValidationError(`threads: ${name} must be a finite number, got ${describe(val)}.`);
  }
  if (opts.min !== undefined && val < opts.min) throw new ValidationError(`threads: ${name} must be >= ${opts.min}, got ${val}.`);
  if (opts.max !== undefined && val > opts.max) throw new ValidationError(`threads: ${name} must be <= ${opts.max}, got ${val}.`);
  return val;
}

function int(val: unknown, name: string, opts: { min?: number; def?: number } = {}): number {
  const n = num(val, name, opts);
  if (!Number.isInteger(n)) throw new ValidationError(`threads: ${name} must be a whole number, got ${n}.`);
  return n;
}

function str(val: unknown, name: string, allowed: string[], def: string): string {
  if (val === undefined) return def;
  if (typeof val !== 'string' || !allowed.includes(val)) {
    throw new ValidationError(`threads: ${name} must be one of ${allowed.map(a => `"${a}"`).join(' | ')}, got ${describe(val)}.`);
  }
  return val;
}

function optsObj(val: unknown, name: string): Record<string, unknown> {
  if (val === undefined || val === null) return {};
  if (typeof val !== 'object' || Array.isArray(val)) {
    throw new ValidationError(`threads.${name}: options must be a plain object, got ${describe(val)}.`);
  }
  return val as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Pure geometry (unit-tested via __testables__ — no WASM)
// ---------------------------------------------------------------------------

/** Resolve (majorDiameter, pitch) from either { size } or { diameter, pitch }. */
export function resolveThread(o: { size?: unknown; diameter?: unknown; pitch?: unknown }): { major: number; pitch: number } {
  if (o.size !== undefined) {
    const spec = METRIC_COARSE[normalizeSize(o.size)];
    const pitch = o.pitch === undefined ? spec.pitch : num(o.pitch, 'pitch', { min: 0.1 });
    return { major: spec.nominal, pitch };
  }
  const major = num(o.diameter, 'diameter', { min: 0.5 });
  const pitch = num(o.pitch, 'pitch', { min: 0.1 });
  return { major, pitch };
}

/** Thread depth (radial) for the truncated ISO profile: 5/8 · H where H = √3/2·P. */
export function threadDepth(pitch: number): number {
  return (5 / 8) * (Math.sqrt(3) / 2) * pitch;
}

export interface ThreadProfilePoint { r: number; z: number }

/**
 * One closed profile loop of a single truncated ISO V-thread tooth, in
 * (radius, axial) coordinates centred on z=0. The loop is JUST the protruding
 * tooth (axial width < pitch), buried at its base in the body it unions with —
 * the root cylinder fills the gap between adjacent coils, so consecutive coils
 * never touch (that coincidence was what made a full-pitch profile non-manifold).
 *
 * `crestR`/`rootR` are the radii the flanks run between; `buriedR` is the base
 * edge buried inside the body (beyond the root). Works for both external
 * (crestR>rootR) and internal (crestR<rootR) threads.
 */
export function threadProfile(crestR: number, rootR: number, buriedR: number, pitch: number): ThreadProfilePoint[] {
  const depth = Math.abs(crestR - rootR);
  const flankRun = depth * Math.tan(FLANK);     // axial run of one flank
  const crestFlat = pitch / 8;                  // truncate the crest for printability
  const cf = crestFlat / 2;
  // Axial half-width at the root, clamped to leave a gap between coils.
  const toothHalf = Math.min(cf + flankRun, 0.47 * pitch);
  // Convex hexagon: buried base → root → crest flat → root → buried base.
  return [
    { r: buriedR, z: -toothHalf },
    { r: rootR, z: -toothHalf },
    { r: crestR, z: -cf },
    { r: crestR, z: cf },
    { r: rootR, z: toothHalf },
    { r: buriedR, z: toothHalf },
  ];
}

interface MeshData { numProp: number; vertProperties: Float32Array; triVerts: Uint32Array }

/**
 * Sweep a closed (r,z) profile loop along a helix and return mesh data for
 * `Manifold.ofMesh`. The helix advances `pitch` in z per turn; `handed` flips
 * the winding direction. Rings span φ from `phi0` to `phi1`; both ends are
 * fan-capped so the result is a closed solid.
 */
export function buildHelixMesh(
  profile: ThreadProfilePoint[],
  pitch: number,
  phi0: number,
  phi1: number,
  segmentsPerTurn: number,
  handed: 'right' | 'left',
): MeshData {
  const m = profile.length;
  const span = phi1 - phi0;
  const rings = Math.max(2, Math.ceil((span / (2 * Math.PI)) * segmentsPerTurn));
  const sign = handed === 'left' ? -1 : 1;

  const verts: number[] = [];
  for (let i = 0; i <= rings; i++) {
    const phi = phi0 + (span * i) / rings;
    const zHelix = (phi / (2 * Math.PI)) * pitch;
    const cos = Math.cos(sign * phi);
    const sin = Math.sin(sign * phi);
    for (let j = 0; j < m; j++) {
      const { r, z } = profile[j];
      verts.push(r * cos, r * sin, zHelix + z);
    }
  }

  const tris: number[] = [];
  const ringStart = (i: number) => i * m;
  // Side quads between consecutive rings (profile loop is closed in j).
  for (let i = 0; i < rings; i++) {
    const a = ringStart(i);
    const b = ringStart(i + 1);
    for (let j = 0; j < m; j++) {
      const j1 = (j + 1) % m;
      // Two triangles per quad, wound for outward-facing normals.
      tris.push(a + j, b + j, a + j1);
      tris.push(a + j1, b + j, b + j1);
    }
  }
  // Caps: fan-triangulate the start and end profile loops. Wound opposite to
  // each other (and to match the side faces) so the whole solid is orientable.
  const last = ringStart(rings);
  for (let j = 1; j < m - 1; j++) {
    tris.push(0, j, j + 1);                  // start cap
    tris.push(last, last + j + 1, last + j); // end cap
  }

  return { numProp: 3, vertProperties: new Float32Array(verts), triVerts: new Uint32Array(tris) };
}

// ---------------------------------------------------------------------------
// Namespace factory
// ---------------------------------------------------------------------------

export function createThreadsNamespace(module: any) {
  const { Manifold, CrossSection } = module;

  /** Across-flats `width` → regular-hexagon vertices (flats facing ±Y). */
  function hexPoints(width: number): Vec2[] {
    const R = width / Math.sqrt(3);
    const pts: Vec2[] = [];
    for (let i = 0; i < 6; i++) {
      const a = DEG * (60 * i);
      pts.push([R * Math.cos(a), R * Math.sin(a)]);
    }
    return pts;
  }

  /** Build the external thread ridge (a helical rib buried in a core cylinder
   *  of radius `minorR`) covering z roughly [0, length]; trimmed later. */
  function externalRidge(majorR: number, minorR: number, pitch: number, length: number, segPerTurn: number, handed: 'right' | 'left'): any {
    const overlap = Math.max(0.2, (majorR - minorR) * 0.5);
    const profile = threadProfile(majorR, minorR, minorR - overlap, pitch);
    // Sweep one turn below 0 and one turn past the top so the trim cuts clean.
    const turns = length / pitch + 2;
    const mesh = buildHelixMesh(profile, pitch, -2 * Math.PI, turns * 2 * Math.PI, segPerTurn, handed);
    return Manifold.ofMesh(mesh);
  }

  function segFor(o: Record<string, unknown>, def: number): number {
    return o.segments === undefined ? def : int(o.segments, 'segments', { min: 8 });
  }

  /** Assemble an external threaded rod, trimmed flat to z ∈ [0, length]. */
  function buildRod(o: Record<string, unknown>, where: string): any {
    const { major, pitch } = resolveThread(o as any);
    const length = num(o.length, `${where}.length`, { min: pitch });
    const depth = threadDepth(pitch);
    const majorR = major / 2;
    const minorR = Math.max(0.3, majorR - depth);
    const handed = str(o.handed, `${where}.handed`, ['right', 'left'], 'right') as 'right' | 'left';
    const segPerTurn = segFor(o, 24);
    const coreSeg = segFor(o, 48);

    const core = Manifold.cylinder(length, minorR, minorR, coreSeg);
    const rod = core.add(externalRidge(majorR, minorR, pitch, length, segPerTurn, handed));

    // Trim the helix overshoot flat at z=0/length. A lead-in chamfer at the top
    // (default on) lets the rod start a nut easily: the top `ch` of the trim
    // solid is a cone narrowing from majorR down to minorR.
    const wantChamfer = o.chamfer === undefined || o.chamfer === true || (typeof o.chamfer === 'number' && o.chamfer > 0);
    if (wantChamfer) {
      const ch = Math.min(typeof o.chamfer === 'number' ? o.chamfer : depth, length / 2);
      const trim = Manifold.cylinder(length - ch, majorR + 1, majorR + 1, coreSeg)
        .add(Manifold.cylinder(ch, majorR, minorR, coreSeg).translate([0, 0, length - ch]));
      return rod.intersect(trim);
    }
    return rod.intersect(Manifold.cylinder(length, majorR + 1, majorR + 1, coreSeg));
  }

  return {
    // Data passthroughs ------------------------------------------------------
    metric: METRIC_COARSE,
    depth(pitch: unknown): number {
      return threadDepth(num(pitch, 'depth.pitch', { min: 0.1 }));
    },

    /**
     * A threaded rod (external thread), built along +Z from z=0 to z=length.
     * Give either a metric size or an explicit diameter + pitch.
     *
     * opts: { size?:"M8" | diameter, pitch?, length, handed?='right',
     *         chamfer?=true, segments? }
     */
    rod(o0: unknown): any {
      return buildRod(optsObj(o0, 'rod'), 'rod');
    },

    /**
     * A hex-head bolt: threaded shank rising +Z from z=0, head below z=0.
     * `headType` 'hex' (default) or 'socket' (cylindrical cap). An optional
     * unthreaded `shank` length sits between the head and the threads.
     *
     * opts: { size?:"M8" | diameter, pitch?, length, headType?='hex',
     *         headWidth?, headHeight?, shank?=0, handed?, segments? }
     */
    bolt(o0: unknown): any {
      const o = optsObj(o0, 'bolt');
      const { major, pitch } = resolveThread(o as any);
      const majorR = major / 2;
      const coreSeg = segFor(o, 48);
      const headType = str(o.headType, 'bolt.headType', ['hex', 'socket'], 'hex');
      const headWidth = num(o.headWidth, 'bolt.headWidth', { def: major * 1.8, min: major });
      const headHeight = num(o.headHeight, 'bolt.headHeight', { def: major * 0.7, min: 0.5 });
      const shank = num(o.shank, 'bolt.shank', { def: 0, min: 0 });

      // Threaded portion + optional smooth shank, both rising from z=0.
      const threadLen = num(o.length, 'bolt.length', { min: pitch });
      let body = buildRod({ ...o, length: threadLen }, 'bolt');
      if (shank > 0) {
        body = body.translate([0, 0, shank]).add(Manifold.cylinder(shank + LIP, majorR, majorR, coreSeg));
      }
      // Head below z=0.
      let head: any;
      if (headType === 'socket') {
        const hr = num(o.headWidth, 'bolt.headWidth', { def: major * 1.5, min: major }) / 2;
        head = Manifold.cylinder(headHeight, hr, hr, coreSeg).translate([0, 0, -headHeight]);
      } else {
        head = Manifold.extrude(new CrossSection([hexPoints(headWidth)]), headHeight).translate([0, 0, -headHeight]);
      }
      return head.add(body);
    },

    /**
     * A hex nut with an internal thread sized to accept a same-size `bolt`/`rod`.
     * Built centred on z ∈ [0, thickness]. `fit` (radial clearance, mm) loosens
     * the internal thread so a printed nut runs onto a printed bolt.
     *
     * opts: { size?:"M8" | diameter, pitch?, thickness?, width?, fit?=0.2,
     *         handed?, segments? }
     */
    nut(o0: unknown): any {
      const o = optsObj(o0, 'nut');
      const { major, pitch } = resolveThread(o as any);
      const depth = threadDepth(pitch);
      const fit = num(o.fit, 'nut.fit', { def: 0.2, min: 0 });
      // Internal thread radii, opened up by the fit clearance.
      const majorR = major / 2 + fit;           // crest of the bolt clears here
      const minorR = Math.max(0.3, majorR - depth); // nut ridge protrudes to here
      const thickness = num(o.thickness, 'nut.thickness', { def: major * 0.8, min: pitch });
      const width = num(o.width, 'nut.width', { def: major * 1.8, min: major + 1 });
      const handed = str(o.handed, 'nut.handed', ['right', 'left'], 'right') as 'right' | 'left';
      const segPerTurn = segFor(o, 24);
      const coreSeg = segFor(o, 48);

      // Hex body with the clearance hole bored out.
      let nut = Manifold.extrude(new CrossSection([hexPoints(width)]), thickness);
      nut = nut.subtract(Manifold.cylinder(thickness + 2 * LIP, majorR, majorR, coreSeg).translate([0, 0, -LIP]));

      // Internal ridge: profile points inward (crest at minorR, root at majorR),
      // buried just outside the bored wall so it unions watertight.
      const overlap = Math.max(0.2, depth * 0.5);
      const profile = threadProfile(minorR, majorR, majorR + overlap, pitch);
      const turns = thickness / pitch + 2;
      const ridge = Manifold.ofMesh(buildHelixMesh(profile, pitch, -2 * Math.PI, turns * 2 * Math.PI, segPerTurn, handed));
      // Union the full ridge, then flatten the whole nut to z ∈ [0, thickness] in
      // a single intersect (radius `width` > hex circumradius, so the hex is kept).
      // Trimming the ridge first would leave a degenerate sliver component.
      return nut.add(ridge).intersect(Manifold.cylinder(thickness, width, width, coreSeg));
    },
  };
}

/** Pure helpers exposed for unit testing without the WASM module. */
export const __testables__ = {
  normalizeSize,
  resolveThread,
  threadDepth,
  threadProfile,
  buildHelixMesh,
  METRIC_COARSE,
};
