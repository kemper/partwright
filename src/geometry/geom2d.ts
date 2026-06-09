// 2D sketch / profile namespace backed by @thi.ng/geom.
//
// SPIKE: parallel exploration to the SDF spike. Where `api.sdf` explores
// thi.ng-style signed-distance fields in 3D, `api.geom` explores thi.ng's
// 2D vector-geometry library as a *sketch layer*: parametric profile
// primitives (star, ngon, ellipse, rounded rect) and subdivision-curve
// smoothing that lower directly into a Manifold `CrossSection`, ready for
// the existing `.extrude(h)` / `Manifold.revolve(cs, …)` paths.
//
// Why this fills a gap: today a user hand-builds `CrossSection.ofPolygons`
// vertex-by-vertex (see examples/basic_shapes.js). This namespace gives the
// same expressive 2D toolkit a CAD sketcher expects, while staying entirely
// inside the engine-agnostic mesh pipeline below the CrossSection boundary —
// booleans, extrude, revolve, paint, export all keep working unchanged.
//
// Convention: every helper RETURNS a `CrossSection` (in the XY plane,
// centered on the origin), so results compose with each other and with
// native CrossSection booleans. Nothing here touches the WASM-free voxel
// path; it is a pure manifold-js sketch helper.

import { circle, ellipse, roundedRect, star, vertices } from '@thi.ng/geom';
import { subdivide, SUBDIV_CHAIKIN, SUBDIV_CUBIC } from '@thi.ng/geom-subdiv-curve';

import {
  assertNumber,
  assertObject,
  assertEnum,
  assertNoUnknownKeys,
  ValidationError,
} from '../validation/apiValidation';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CrossSectionClass = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CrossSectionInstance = any;

type Vec2 = [number, number];

export interface Geom2dNamespace {
  /** Regular n-gon of circumradius `radius` with `sides` sides. */
  ngon(radius: number, sides: number): CrossSectionInstance;
  /** `points`-pointed star; spokes alternate between `radius` and
   *  `radius * innerRatio`. */
  star(radius: number, points: number, innerRatio?: number): CrossSectionInstance;
  /** Axis-aligned ellipse, sampled with `segments` vertices. */
  ellipse(rx: number, ry: number, segments?: number): CrossSectionInstance;
  /** Rounded rectangle centered on the origin. */
  roundedRect(
    width: number,
    height: number,
    radius: number,
    segments?: number,
  ): CrossSectionInstance;
  /** Build a CrossSection from an explicit closed polyline of `[x, y]` points. */
  fromPoints(points: Vec2[]): CrossSectionInstance;
  /** Subdivision-curve smoothing of a coarse closed polyline into a smooth
   *  CrossSection. `kernel`: 'chaikin' (corner-cutting, default) or 'cubic'
   *  (B-spline). `iterations` controls smoothness (1–6). */
  smooth(points: Vec2[], opts?: SmoothOpts): CrossSectionInstance;
}

interface SmoothOpts {
  iterations?: number;
  kernel?: 'chaikin' | 'cubic';
  closed?: boolean;
}

const SMOOTH_KEYS = ['iterations', 'kernel', 'closed'];

function need(cond: boolean, message: string): void {
  if (!cond) throw new ValidationError(message);
}

/** Coerce thi.ng's Vec2-ish output (plain arrays or typed arrays) into the
 *  plain `[x, y]` number tuples CrossSection.ofPolygons expects. */
function toContour(verts: ArrayLike<ArrayLike<number>>): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < verts.length; i++) {
    const v = verts[i];
    out.push([v[0], v[1]]);
  }
  return out;
}

function assertPoints(points: unknown, label: string): asserts points is Vec2[] {
  need(Array.isArray(points), `${label}: points must be an array of [x, y] pairs`);
  const arr = points as unknown[];
  need(arr.length >= 3, `${label}: need at least 3 points, got ${arr.length}`);
  for (let i = 0; i < arr.length; i++) {
    const p = arr[i] as unknown;
    need(
      Array.isArray(p) && p.length === 2 &&
        Number.isFinite(p[0]) && Number.isFinite(p[1]),
      `${label}: point ${i} must be a finite [x, y] pair`,
    );
  }
}

export function createGeom2dNamespace(module: { CrossSection: CrossSectionClass }): Geom2dNamespace {
  const { CrossSection } = module;

  const section = (contour: Vec2[]): CrossSectionInstance =>
    CrossSection.ofPolygons([contour]);

  return {
    ngon(radius, sides) {
      assertNumber(radius, 'ngon: radius', { min: 1e-3 });
      assertNumber(sides, 'ngon: sides', { integer: true, min: 3, max: 512 });
      return section(toContour(vertices(circle(radius), { num: sides })));
    },

    star(radius, points, innerRatio = 0.5) {
      assertNumber(radius, 'star: radius', { min: 1e-3 });
      assertNumber(points, 'star: points', { integer: true, min: 2, max: 256 });
      assertNumber(innerRatio, 'star: innerRatio', { min: 1e-3, max: 1 });
      // thi.ng star profile is a per-spoke radial scale list; [1, innerRatio]
      // alternates outer/inner spokes.
      return section(toContour(vertices(star(radius, points, [1, innerRatio]))));
    },

    ellipse(rx, ry, segments = 64) {
      assertNumber(rx, 'ellipse: rx', { min: 1e-3 });
      assertNumber(ry, 'ellipse: ry', { min: 1e-3 });
      assertNumber(segments, 'ellipse: segments', { integer: true, min: 8, max: 512 });
      return section(toContour(vertices(ellipse([0, 0], [rx, ry]), { num: segments })));
    },

    roundedRect(width, height, radius, segments = 8) {
      assertNumber(width, 'roundedRect: width', { min: 1e-3 });
      assertNumber(height, 'roundedRect: height', { min: 1e-3 });
      assertNumber(radius, 'roundedRect: radius', { min: 0, max: Math.min(width, height) / 2 });
      assertNumber(segments, 'roundedRect: segments', { integer: true, min: 1, max: 64 });
      // thi.ng roundedRect takes a corner position + size; center on origin.
      const shape = roundedRect([-width / 2, -height / 2], [width, height], radius);
      return section(toContour(vertices(shape, { num: segments })));
    },

    fromPoints(points) {
      assertPoints(points, 'fromPoints');
      return section(toContour(points));
    },

    smooth(points, opts = {}) {
      assertPoints(points, 'smooth');
      assertObject(opts, 'smooth: opts');
      assertNoUnknownKeys(opts as Record<string, unknown>, SMOOTH_KEYS, 'smooth: opts');
      const iterations = opts.iterations ?? 3;
      const kernel = opts.kernel ?? 'chaikin';
      const closed = opts.closed ?? true;
      assertNumber(iterations, 'smooth: iterations', { integer: true, min: 1, max: 6 });
      assertEnum(kernel, ['chaikin', 'cubic'], 'smooth: kernel');
      const k = kernel === 'cubic' ? SUBDIV_CUBIC : SUBDIV_CHAIKIN;
      // subdivide(points, kernels, closed): one kernel entry per smoothing pass.
      const passes = new Array(iterations).fill(k);
      const smoothed = subdivide(points as number[][], passes, closed);
      return section(toContour(smoothed));
    },
  };
}
