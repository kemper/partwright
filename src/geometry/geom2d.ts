// 2D sketch / profile namespace — `api.geom`.
//
// Parametric profile primitives that lower into a Manifold `CrossSection`,
// ready for the existing `.extrude(h)` / `Manifold.revolve(cs, …)` / boolean
// paths. This fills the gap where a user would otherwise hand-build
// `CrossSection.ofPolygons` vertex-by-vertex (see examples/basic_shapes.js).
//
// Deliberately dependency-free: everything here is elementary computational
// geometry (a few trig loops and a corner-cutting subdivision). It does NOT
// re-cover ground the kernel already owns — polygon booleans, hull, offset,
// and simplify live on `CrossSection` itself; smooth paths / sweeps / fillets
// live on the `Curves` namespace; gear profiles live on the `gears`
// namespace. `api.geom` is just the primitive-profile layer.
//
// Convention: every helper RETURNS a `CrossSection` (in the XY plane,
// centered on the origin), so results compose with each other and with
// native CrossSection booleans.

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
  /** Rectangle centered on the origin with `radius` rounded corners
   *  (`segments` per quarter-arc). `radius: 0` is a plain rectangle. */
  roundedRect(
    width: number,
    height: number,
    radius: number,
    segments?: number,
  ): CrossSectionInstance;
  /** Rectangle centered on the origin with 45°-chamfered corners of leg `chamfer`. */
  chamferedRect(width: number, height: number, chamfer: number): CrossSectionInstance;
  /** Stadium / capsule: a `length`-long slot of width `2*radius` (hull of two
   *  end caps), centered on the origin and running along X. */
  slot(length: number, radius: number, segments?: number): CrossSectionInstance;
  /** Printable horizontal-hole profile: a circle of `radius` capped with a
   *  roof at `angle`° so it self-supports on FDM. Points +Y by default. */
  teardrop(radius: number, segments?: number, angle?: number): CrossSectionInstance;
  /** Ring / washer: disc of `outer` radius with a concentric `inner` hole. */
  annulus(outer: number, inner: number, segments?: number): CrossSectionInstance;
  /** Pie / arc sector from `startDeg` to `endDeg` (CCW) of radius `radius`. */
  sector(radius: number, startDeg: number, endDeg: number, segments?: number): CrossSectionInstance;
  /** Build a CrossSection from an explicit closed polyline of `[x, y]` points. */
  fromPoints(points: Vec2[]): CrossSectionInstance;
  /** Subdivision-curve smoothing of a coarse polyline into a smooth
   *  CrossSection. `kernel`: 'chaikin' (corner-cutting, default) or 'cubic'
   *  (B-spline-ish). `iterations` controls smoothness (1–6). */
  smooth(points: Vec2[], opts?: SmoothOpts): CrossSectionInstance;
}

interface SmoothOpts {
  iterations?: number;
  kernel?: 'chaikin' | 'cubic';
  closed?: boolean;
}

const SMOOTH_KEYS = ['iterations', 'kernel', 'closed'];
const TAU = Math.PI * 2;

function need(cond: boolean, message: string): void {
  if (!cond) throw new ValidationError(message);
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

/** Sample a circular arc from angle `a0` to `a1` (radians) into `n` points
 *  (inclusive of both ends), centered at `cx,cy` with radius `r`. */
function arcPoints(cx: number, cy: number, r: number, a0: number, a1: number, n: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

/** Signed area (shoelace); positive when the ring winds CCW. */
function signedArea(pts: Vec2[]): number {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Force CCW winding so CrossSection.ofPolygons' positive fill rule keeps it solid. */
function ensureCCW(pts: Vec2[]): Vec2[] {
  return signedArea(pts) < 0 ? pts.slice().reverse() : pts;
}

/** One pass of Chaikin corner-cutting over a polyline. */
function chaikinPass(pts: Vec2[], closed: boolean): Vec2[] {
  const out: Vec2[] = [];
  const n = pts.length;
  const last = closed ? n : n - 1;
  if (!closed) out.push(pts[0]);
  for (let i = 0; i < last; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
    out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
  }
  if (!closed) out.push(pts[n - 1]);
  return out;
}

/** One pass of cubic B-spline-style subdivision (uniform). */
function cubicPass(pts: Vec2[], closed: boolean): Vec2[] {
  const n = pts.length;
  const at = (i: number): Vec2 =>
    closed ? pts[((i % n) + n) % n] : pts[Math.max(0, Math.min(n - 1, i))];
  const out: Vec2[] = [];
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    // Edge midpoint (B-spline knot) then a 1/8·6/8·1/8 vertex point.
    out.push([(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2]);
    out.push([
      (p0[0] + 6 * p1[0] + p2[0]) / 8,
      (p0[1] + 6 * p1[1] + p2[1]) / 8,
    ]);
    void p3;
  }
  return out;
}

export function createGeom2dNamespace(module: { CrossSection: CrossSectionClass }): Geom2dNamespace {
  const { CrossSection } = module;

  const section = (contour: Vec2[]): CrossSectionInstance =>
    CrossSection.ofPolygons([ensureCCW(contour)]);

  return {
    ngon(radius, sides) {
      assertNumber(radius, 'ngon: radius', { min: 1e-3 });
      assertNumber(sides, 'ngon: sides', { integer: true, min: 3, max: 512 });
      const pts: Vec2[] = [];
      for (let i = 0; i < sides; i++) {
        const a = (TAU * i) / sides;
        pts.push([Math.cos(a) * radius, Math.sin(a) * radius]);
      }
      return section(pts);
    },

    star(radius, points, innerRatio = 0.5) {
      assertNumber(radius, 'star: radius', { min: 1e-3 });
      assertNumber(points, 'star: points', { integer: true, min: 2, max: 256 });
      assertNumber(innerRatio, 'star: innerRatio', { min: 1e-3, max: 1 });
      const pts: Vec2[] = [];
      for (let i = 0; i < 2 * points; i++) {
        const a = (Math.PI * i) / points;
        const r = i % 2 ? radius * innerRatio : radius;
        pts.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
      return section(pts);
    },

    ellipse(rx, ry, segments = 64) {
      assertNumber(rx, 'ellipse: rx', { min: 1e-3 });
      assertNumber(ry, 'ellipse: ry', { min: 1e-3 });
      assertNumber(segments, 'ellipse: segments', { integer: true, min: 8, max: 512 });
      const pts: Vec2[] = [];
      for (let i = 0; i < segments; i++) {
        const a = (TAU * i) / segments;
        pts.push([Math.cos(a) * rx, Math.sin(a) * ry]);
      }
      return section(pts);
    },

    roundedRect(width, height, radius, segments = 8) {
      assertNumber(width, 'roundedRect: width', { min: 1e-3 });
      assertNumber(height, 'roundedRect: height', { min: 1e-3 });
      assertNumber(radius, 'roundedRect: radius', { min: 0, max: Math.min(width, height) / 2 });
      assertNumber(segments, 'roundedRect: segments', { integer: true, min: 1, max: 64 });
      const hw = width / 2, hh = height / 2;
      if (radius < 1e-6) {
        return section([[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]);
      }
      const ix = hw - radius, iy = hh - radius;
      // Four corner arcs, CCW from the bottom-right corner.
      const pts: Vec2[] = [
        ...arcPoints(ix, -iy, radius, -Math.PI / 2, 0, segments),
        ...arcPoints(ix, iy, radius, 0, Math.PI / 2, segments),
        ...arcPoints(-ix, iy, radius, Math.PI / 2, Math.PI, segments),
        ...arcPoints(-ix, -iy, radius, Math.PI, 1.5 * Math.PI, segments),
      ];
      return section(pts);
    },

    chamferedRect(width, height, chamfer) {
      assertNumber(width, 'chamferedRect: width', { min: 1e-3 });
      assertNumber(height, 'chamferedRect: height', { min: 1e-3 });
      assertNumber(chamfer, 'chamferedRect: chamfer', { min: 1e-3, max: Math.min(width, height) / 2 });
      const hw = width / 2, hh = height / 2, c = chamfer;
      return section([
        [hw - c, -hh], [hw, -hh + c], [hw, hh - c], [hw - c, hh],
        [-hw + c, hh], [-hw, hh - c], [-hw, -hh + c], [-hw + c, -hh],
      ]);
    },

    slot(length, radius, segments = 32) {
      assertNumber(length, 'slot: length', { min: 1e-3 });
      assertNumber(radius, 'slot: radius', { min: 1e-3 });
      assertNumber(segments, 'slot: segments', { integer: true, min: 8, max: 256 });
      const hx = length / 2;
      const cap = Math.max(2, Math.round(segments / 2));
      // Right cap (-90°→90°) then left cap (90°→270°).
      const pts: Vec2[] = [
        ...arcPoints(hx, 0, radius, -Math.PI / 2, Math.PI / 2, cap),
        ...arcPoints(-hx, 0, radius, Math.PI / 2, 1.5 * Math.PI, cap),
      ];
      return section(pts);
    },

    teardrop(radius, segments = 48, angle = 45) {
      assertNumber(radius, 'teardrop: radius', { min: 1e-3 });
      assertNumber(segments, 'teardrop: segments', { integer: true, min: 12, max: 512 });
      assertNumber(angle, 'teardrop: angle', { min: 5, max: 80 });
      // A circle whose top is replaced by two roof lines, tangent to the circle
      // at ±`angle` from +X, meeting at an apex on +Y so the hole self-supports
      // when printed horizontally. A tangent at angle t meets the +Y axis at
      // height r/sin(t) (derived from the tangent-line / axis intersection).
      const t = angle * (Math.PI / 180);
      // Keep the major (bottom) arc: from the right tangent (t) clockwise around
      // the bottom to the left tangent (180° − t ≡ −(180° + t)).
      const arc = arcPoints(0, 0, radius, t, -(Math.PI + t), segments);
      const apex: Vec2 = [0, radius / Math.sin(t)];
      return section([...arc, apex]);
    },

    annulus(outer, inner, segments = 64) {
      assertNumber(outer, 'annulus: outer', { min: 1e-3 });
      assertNumber(inner, 'annulus: inner', { min: 1e-3, max: outer - 1e-3 });
      assertNumber(segments, 'annulus: segments', { integer: true, min: 8, max: 512 });
      return CrossSection.circle(outer, segments).subtract(CrossSection.circle(inner, segments));
    },

    sector(radius, startDeg, endDeg, segments = 48) {
      assertNumber(radius, 'sector: radius', { min: 1e-3 });
      assertNumber(startDeg, 'sector: startDeg');
      assertNumber(endDeg, 'sector: endDeg');
      assertNumber(segments, 'sector: segments', { integer: true, min: 2, max: 512 });
      need(Math.abs(endDeg - startDeg) > 1e-6, 'sector: startDeg and endDeg must differ');
      const a0 = startDeg * (Math.PI / 180), a1 = endDeg * (Math.PI / 180);
      const pts: Vec2[] = [[0, 0], ...arcPoints(0, 0, radius, a0, a1, segments)];
      return section(pts);
    },

    fromPoints(points) {
      assertPoints(points, 'fromPoints');
      return section(points.map((p) => [p[0], p[1]]));
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
      let pts = points.map((p) => [p[0], p[1]] as Vec2);
      const pass = kernel === 'cubic' ? cubicPass : chaikinPass;
      for (let i = 0; i < iterations; i++) pts = pass(pts, closed);
      return section(pts);
    },
  };
}
