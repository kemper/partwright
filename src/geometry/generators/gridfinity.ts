/**
 * Gridfinity — parametric bins + baseplates exposed to the manifold-js sandbox
 * as `api.Gridfinity`.
 *
 * Gridfinity (by Zack Freedman) is a modular storage standard built on a 42 mm
 * grid with 7 mm height units and a distinctive stacked-chamfer foot that drops
 * into a matching baseplate socket. AI agents are unreliable at reproducing the
 * magic-number foot profile from memory, so we ship a deterministic generator.
 *
 * Convention mirrors `src/geometry/curves.ts`: manifold objects are treated as
 * `any`, and the factory takes the initialized manifold-3d module.
 *
 * Coordinate system: Z-up. All geometry is centered on x=y=0 and sits on the
 * z=0 plane (bottom at z=0).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// --- Gridfinity standard constants (mm) ---
const GRID = 42.0;        // grid pitch
const ZU = 7.0;           // height unit
const CLEARANCE = 0.5;    // total XY clearance (0.25 per side) on the bin body
const OUTER_R = 3.75;     // outer corner radius

// Foot chamfer profile, bottom -> top.
const FOOT_BOTTOM_CHAMFER = 0.8;
const FOOT_STRAIGHT = 1.8;
const FOOT_TOP_CHAMFER = 2.15;
const FOOT_HEIGHT = FOOT_BOTTOM_CHAMFER + FOOT_STRAIGHT + FOOT_TOP_CHAMFER; // 4.75

// Magnet hole geometry.
const MAGNET_DIAMETER = 6.5;
const MAGNET_DEPTH = 2.4;
const MAGNET_OFFSET = 13.0; // from cell center, per axis

// Stacking lip.
const LIP_HEIGHT = 3.8;
const LIP_THICKNESS = 2.4;

// Baseplate.
const BASEPLATE_HEIGHT = 5.0;
const SOCKET_CLEARANCE = 0.25; // enlarge foot profile so feet seat with play

/** Options for {@link createGridfinityNamespace}'s `bin`. */
export interface BinOptions {
  /** Grid columns (X). Default 1. */
  cols?: number;
  /** Grid rows (Y). Default 1. */
  rows?: number;
  /** Height in 7 mm units. Default 3. */
  heightUnits?: number;
  /** Hollow out the body, leaving a wall + floor. Default true. */
  hollow?: boolean;
  /** Wall thickness for the hollow cavity. Default 1.2. */
  wallThickness?: number;
  /** Add the stacking lip on the top outer edge. Default true. */
  lip?: boolean;
  /** Subtract magnet holes under each cell foot corner. Default false. */
  magnetHoles?: boolean;
}

/** Options for {@link createGridfinityNamespace}'s `baseplate`. */
export interface BaseplateOptions {
  /** Grid columns (X). Default 1. */
  cols?: number;
  /** Grid rows (Y). Default 1. */
  rows?: number;
}

/** A manifold-3d Manifold (treated opaquely here). */
export type GridfinityResult = any;

type GridfinityAPI = {
  bin: (opts?: BinOptions) => GridfinityResult;
  baseplate: (opts?: BaseplateOptions) => GridfinityResult;
};

function isPositiveInt(v: any): boolean {
  return typeof v === 'number' && Number.isInteger(v) && v > 0;
}

export function createGridfinityNamespace(module: any): GridfinityAPI {
  const { Manifold, CrossSection } = module;

  /**
   * Rounded rectangular prism: w×d×h with vertical corner radius r, bottom at
   * z=0, centered in XY. Guards r so the inner square stays positive.
   */
  function roundedRectPrism(w: number, d: number, h: number, r: number): GridfinityResult {
    if (r > 0 && w - 2 * r > 0 && d - 2 * r > 0) {
      return CrossSection.square([w - 2 * r, d - 2 * r], true).offset(r, 'Round').extrude(h);
    }
    return CrossSection.square([w, d], true).extrude(h);
  }

  /**
   * A thin rounded-rect slab of footprint w×d, height `h`, sitting at z=`z0`.
   * Used as a hull endpoint to build chamfered frustum segments.
   */
  function slabAt(w: number, d: number, h: number, r: number, z0: number): GridfinityResult {
    return roundedRectPrism(w, d, h, r).translate([0, 0, z0]);
  }

  /**
   * Chamfered frustum segment spanning [z0, z0+h], widening from a wLow×dLow
   * footprint at the bottom to wHigh×dHigh at the top, via a hull of two thin
   * slabs. Corner radius `r` applies at both ends (3.75 at the wide end).
   */
  function chamferSegment(
    wLow: number, dLow: number, wHigh: number, dHigh: number,
    h: number, r: number, z0: number,
  ): GridfinityResult {
    const eps = 0.01;
    const lower = slabAt(wLow, dLow, eps, Math.max(0, r - (wHigh - wLow) / 2), z0);
    const upper = slabAt(wHigh, dHigh, eps, r, z0 + h - eps);
    return Manifold.hull([lower, upper]);
  }

  /**
   * Single Gridfinity foot centered on the origin, bottom at z=0. Stacked from
   * the bottom: 0.8 mm widening chamfer, 1.8 mm straight, 2.15 mm widening
   * chamfer, reaching the per-cell footprint (41.5 mm) at the 4.75 mm top.
   */
  function buildFoot(): GridfinityResult {
    const topW = GRID - CLEARANCE; // 41.5 — matches body footprint per cell
    // Working down from the top (45° chamfers shrink by their height per side).
    const straightW = topW - 2 * FOOT_TOP_CHAMFER;          // top of straight == bottom of top chamfer
    const bottomW = straightW - 2 * FOOT_BOTTOM_CHAMFER;    // bottom of foot

    let z = 0;
    const bottomChamfer = chamferSegment(
      bottomW, bottomW, straightW, straightW, FOOT_BOTTOM_CHAMFER, OUTER_R, z,
    );
    z += FOOT_BOTTOM_CHAMFER;
    const straight = roundedRectPrism(straightW, straightW, FOOT_STRAIGHT, OUTER_R).translate([0, 0, z]);
    z += FOOT_STRAIGHT;
    const topChamfer = chamferSegment(
      straightW, straightW, topW, topW, FOOT_TOP_CHAMFER, OUTER_R, z,
    );
    return bottomChamfer.add(straight).add(topChamfer);
  }

  /**
   * Replicate a per-cell part across a cols×rows grid, centering the whole
   * pattern on the origin. Each cell occupies a 42 mm pitch.
   */
  function tileGrid(cell: GridfinityResult, cols: number, rows: number): GridfinityResult {
    const x0 = -((cols - 1) * GRID) / 2;
    const y0 = -((rows - 1) * GRID) / 2;
    let acc: GridfinityResult | null = null;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const placed = cell.translate([x0 + i * GRID, y0 + j * GRID, 0]);
        acc = acc === null ? placed : acc.add(placed);
      }
    }
    return acc;
  }

  /** Centers of each grid cell in the cols×rows pattern. */
  function cellCenters(cols: number, rows: number): [number, number][] {
    const x0 = -((cols - 1) * GRID) / 2;
    const y0 = -((rows - 1) * GRID) / 2;
    const out: [number, number][] = [];
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) out.push([x0 + i * GRID, y0 + j * GRID]);
    }
    return out;
  }

  /**
   * Build a Gridfinity bin and return a Manifold.
   *
   * @example api.Gridfinity.bin({ cols: 2, rows: 1, heightUnits: 6 })
   */
  function bin(opts: BinOptions = {}): GridfinityResult {
    const cols = opts.cols ?? 1;
    const rows = opts.rows ?? 1;
    const heightUnits = opts.heightUnits ?? 3;
    const hollow = opts.hollow !== false;
    const wallThickness = opts.wallThickness ?? 1.2;
    const lip = opts.lip !== false;
    const magnetHoles = opts.magnetHoles === true;

    if (!isPositiveInt(cols)) throw new Error('Gridfinity.bin: cols must be a positive integer');
    if (!isPositiveInt(rows)) throw new Error('Gridfinity.bin: rows must be a positive integer');
    if (!isPositiveInt(heightUnits)) throw new Error('Gridfinity.bin: heightUnits must be a positive integer');
    if (typeof wallThickness !== 'number' || !(wallThickness > 0)) {
      throw new Error('Gridfinity.bin: wallThickness must be > 0');
    }

    const totalH = ZU * heightUnits;
    const footW = GRID * cols - CLEARANCE;
    const footD = GRID * rows - CLEARANCE;

    // Feet (one per cell) up to FOOT_HEIGHT, then a solid body to the full height.
    const feet = tileGrid(buildFoot(), cols, rows);
    const bodyH = totalH - FOOT_HEIGHT;
    let solid = feet;
    if (bodyH > 0) {
      const body = roundedRectPrism(footW, footD, bodyH, OUTER_R).translate([0, 0, FOOT_HEIGHT]);
      solid = solid.add(body);
    }

    let result = solid;

    if (hollow) {
      // Leave a floor of ~0.7 above the foot, then open the cavity to the top.
      const floor = FOOT_HEIGHT + 0.7;
      const cavityH = totalH - floor;
      if (cavityH > 0) {
        const innerW = footW - 2 * wallThickness;
        const innerD = footD - 2 * wallThickness;
        if (innerW > 0 && innerD > 0) {
          const innerR = Math.max(0, OUTER_R - wallThickness);
          // Extend the cut above the top so it stays open even with the lip on.
          const cavity = roundedRectPrism(innerW, innerD, cavityH + LIP_HEIGHT + 1, innerR)
            .translate([0, 0, floor]);
          result = result.subtract(cavity);
        }
      }
    }

    if (lip) {
      // Thin rounded-rect rim added at the top outer edge so bins stack.
      const rim = roundedRectPrism(footW, footD, LIP_HEIGHT, OUTER_R)
        .translate([0, 0, totalH - LIP_HEIGHT]);
      const rimInnerW = footW - 2 * LIP_THICKNESS;
      const rimInnerD = footD - 2 * LIP_THICKNESS;
      if (rimInnerW > 0 && rimInnerD > 0) {
        const rimInner = roundedRectPrism(rimInnerW, rimInnerD, LIP_HEIGHT + 1, Math.max(0, OUTER_R - LIP_THICKNESS))
          .translate([0, 0, totalH - LIP_HEIGHT]);
        result = result.add(rim.subtract(rimInner));
      } else {
        result = result.add(rim);
      }
    }

    if (magnetHoles) {
      const hole = Manifold.cylinder(MAGNET_DEPTH, MAGNET_DIAMETER / 2, MAGNET_DIAMETER / 2, 32);
      for (const [cx, cy] of cellCenters(cols, rows)) {
        for (const sx of [-1, 1]) {
          for (const sy of [-1, 1]) {
            const h = hole.translate([cx + sx * MAGNET_OFFSET, cy + sy * MAGNET_OFFSET, 0]);
            result = result.subtract(h);
          }
        }
      }
    }

    return result;
  }

  /**
   * Build a Gridfinity baseplate that bin feet drop into, returning a Manifold.
   *
   * @example api.Gridfinity.baseplate({ cols: 3, rows: 2 })
   */
  function baseplate(opts: BaseplateOptions = {}): GridfinityResult {
    const cols = opts.cols ?? 1;
    const rows = opts.rows ?? 1;

    if (!isPositiveInt(cols)) throw new Error('Gridfinity.baseplate: cols must be a positive integer');
    if (!isPositiveInt(rows)) throw new Error('Gridfinity.baseplate: rows must be a positive integer');

    const plateW = GRID * cols;
    const plateD = GRID * rows;

    // Slab with rounded corners.
    let plate = roundedRectPrism(plateW, plateD, BASEPLATE_HEIGHT, OUTER_R);

    // Socket = the foot profile, enlarged by SOCKET_CLEARANCE so feet seat,
    // positioned so its top is flush with the plate top (foot drops in from above).
    const socket = buildFoot()
      .scale([
        1 + (2 * SOCKET_CLEARANCE) / (GRID - CLEARANCE),
        1 + (2 * SOCKET_CLEARANCE) / (GRID - CLEARANCE),
        1,
      ])
      .translate([0, 0, BASEPLATE_HEIGHT - FOOT_HEIGHT]);

    plate = plate.subtract(tileGrid(socket, cols, rows));
    return plate;
  }

  return { bin, baseplate };
}
