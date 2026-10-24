// Algorithmic colour patterns — the colour twin of the `src/surface/` procedural
// *texture* system. Instead of displacing geometry, a pattern assigns each
// triangle in a scope ONE colour from a small palette, computed from a field
// evaluated at the triangle's centroid. Because every triangle stays a single
// flat colour, the result is multi-material printable (each colour maps to a
// filament slot) and rides the existing per-triangle colour path
// (`ColorRegion.perTriColors`, the same one `imagePaint` uses).
//
// Pure + dependency-free (mesh + noise only), so it resolves identically in the
// browser underlay (`resolveDescriptorTriangles`) and the HEADLESS preview
// (`paintOpsResolve` → `model:preview`).

//
// SMOOTH patterns (`soccer`, `stripes`, `checker` — see SMOOTH_PATTERN_KINDS)
// also expose an analytic signed FIELD (≤0 = mark, 0 on the colour boundary).
// With `smooth: true` the paint layer turns it into a `RefineRegion`
// (`patternRefineRegion`) so boundary triangles are subdivided and then CLIPPED
// exactly along the field's zero set — the painted edge follows the analytic
// outline instead of stair-stepping at mesh resolution. Every triangle still
// stays one flat colour (the clip just puts triangle edges on the boundary).

import type { MeshData } from '../geometry/types';
import { getTriangleCentroid } from './adjacency';
import { meshBounds } from './slabPaint';
import { makeNoise, mulberry32 } from '../geometry/noise';
import type { Aabb, RefineRegion, TriClass } from './subdivide';

export type RGB = [number, number, number];
export type ColorPatternKind = 'stripes' | 'spots' | 'patches' | 'gradient' | 'checker' | 'soccer';

export interface ColorPatternSpec {
  /** Which field to evaluate. */
  pattern: ColorPatternKind;
  /** Palette: colors[0] = base coat, colors[1] = primary marking, colors[2] =
   *  optional third (calico third tone / leopard rosette centre). */
  colors: RGB[];
  /** Feature size in world units — stripe period / spot spacing / blotch size.
   *  Omitted ⇒ ~1/8 of the model's bounding-box diagonal. */
  scale?: number;
  /** Stripe band direction (the axis the bands run *across*). Default 'z'. */
  axis?: 'x' | 'y' | 'z';
  /** Domain-warp amount 0..1 — how much fBm noise wiggles the stripe lines /
   *  blotch and gradient edges so they read organic, not ruler-straight. */
  warp?: number;
  /** Pattern-specific fraction 0..1: stripe duty cycle, spot radius (× spacing),
   *  base-coat fraction for patches, or the distance threshold for gradient.
   *  `soccer`: the panel SIZE factor instead — 1 = the standard truncated
   *  icosahedron (default), smaller shrinks the pentagons, up to 1.45. */
  coverage?: number;
  /** Seed for reproducible noise / feature scatter. Default 1. */
  seed?: number;
  /** `gradient`: extremity anchor points (ears/paws/tail/face). Triangles
   *  within `scale` of the nearest anchor get the mark colour — the seam-free way
   *  to darken a colourpoint's actual extremities (incl. the face mask).
   *  `soccer`: orientation. One pentagon is centred on the direction from the
   *  fitted ball centre to `anchors[0]`; `anchors[1]` (optional) turns the ball
   *  about that axis so a neighbouring pentagon leans toward it. Default: a
   *  pentagon faces +X with a neighbour toward +Z (up). */
  anchors?: [number, number, number][];
}

export const COLOR_PATTERN_KINDS: ReadonlyArray<ColorPatternKind> = ['stripes', 'spots', 'patches', 'gradient', 'checker', 'soccer'];

/** Pattern kinds with an analytic boundary field, i.e. the ones `smooth: true`
 *  can clip sub-triangle. The rest (spots / patches / gradient) stay
 *  whole-triangle. */
export const SMOOTH_PATTERN_KINDS: ReadonlyArray<ColorPatternKind> = ['soccer', 'stripes', 'checker'];

export function patternSupportsSmooth(kind: ColorPatternKind): boolean {
  return SMOOTH_PATTERN_KINDS.includes(kind);
}

/** Where a pattern applies. A `label` restricts it to an `api.label` region; the
 *  geometric predicates (`above`/`below` a plane, inside a `box`, inside a
 *  `sphere`) further narrow it by triangle centroid. All provided predicates AND
 *  together, so `{ label:'body', above:{axis:'z',at:14} }` = the upper body, and
 *  `{ sphere:{center, radius} }` = a head/paw blob — no relabeling, no SDF seams. */
export interface PatternScope {
  label?: string;
  above?: { axis: 'x' | 'y' | 'z'; at: number };
  below?: { axis: 'x' | 'y' | 'z'; at: number };
  box?: { min: [number, number, number]; max: [number, number, number] };
  sphere?: { center: [number, number, number]; radius: number };
}

const AXIS_IDX: Record<'x' | 'y' | 'z', number> = { x: 0, y: 1, z: 2 };
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Narrow a base triangle set by the scope's geometric predicates (centroid
 *  test). Returns `base` unchanged when no geometric predicate is set. */
export function filterScopeTriangles(mesh: MeshData, base: Set<number>, scope?: PatternScope): Set<number> {
  if (!scope || (!scope.above && !scope.below && !scope.box && !scope.sphere)) return base;
  const out = new Set<number>();
  for (const t of base) {
    const c = getTriangleCentroid(t, mesh);
    if (scope.above && c[AXIS_IDX[scope.above.axis]] < scope.above.at) continue;
    if (scope.below && c[AXIS_IDX[scope.below.axis]] > scope.below.at) continue;
    if (scope.box) {
      const { min, max } = scope.box;
      if (c[0] < min[0] || c[0] > max[0] || c[1] < min[1] || c[1] > max[1] || c[2] < min[2] || c[2] > max[2]) continue;
    }
    if (scope.sphere) {
      const { center, radius } = scope.sphere;
      const dx = c[0] - center[0], dy = c[1] - center[1], dz = c[2] - center[2];
      if (dx * dx + dy * dy + dz * dz > radius * radius) continue;
    }
    out.add(t);
  }
  return out;
}

// --- Sphere fit + soccer-ball geometry --------------------------------------

/** A fitted sphere (the ball a `soccer` pattern wraps). */
export interface PatternSphere {
  center: [number, number, number];
  radius: number;
}

/** Fit a sphere to a triangle set: area-weighted algebraic least squares (Kåsa)
 *  over the triangle centroids, so a PARTIAL sphere (a ball squashed by a foot,
 *  or cut flat where it meets a base) still recovers its true centre/radius.
 *  Falls back to the area-weighted centroid + mean radius when the system is
 *  degenerate (a flat or tiny scope). Returns null for an empty scope.
 *
 *  Deterministic for a given (mesh, set): iterates triangle ids ascending. */
export function fitSphere(mesh: MeshData, tris: Iterable<number>): PatternSphere | null {
  const ids = [...tris].sort((a, b) => a - b);
  if (ids.length === 0) return null;
  const { triVerts, vertProperties: vp, numProp: P } = mesh;
  const pts: number[] = [];
  const ws: number[] = [];
  let W = 0, mx = 0, my = 0, mz = 0;
  for (const t of ids) {
    const a = triVerts[t * 3] * P, b = triVerts[t * 3 + 1] * P, c = triVerts[t * 3 + 2] * P;
    const ax = vp[a], ay = vp[a + 1], az = vp[a + 2];
    const bx = vp[b], by = vp[b + 1], bz = vp[b + 2];
    const cx = vp[c], cy = vp[c + 1], cz = vp[c + 2];
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const w = 0.5 * Math.hypot(nx, ny, nz);
    if (!(w > 0)) continue;
    const px = (ax + bx + cx) / 3, py = (ay + by + cy) / 3, pz = (az + bz + cz) / 3;
    pts.push(px, py, pz);
    ws.push(w);
    W += w; mx += w * px; my += w * py; mz += w * pz;
  }
  if (!(W > 0)) return null;
  mx /= W; my /= W; mz /= W;
  // Normal equations for  x²+y²+z² + D x + E y + F z + G = 0  (points centred
  // on their weighted mean for conditioning).
  const A = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  const rhs = [0, 0, 0, 0];
  let meanDist = 0;
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];
    const x = pts[i * 3] - mx, y = pts[i * 3 + 1] - my, z = pts[i * 3 + 2] - mz;
    const row = [x, y, z, 1];
    const r2 = x * x + y * y + z * z;
    meanDist += w * Math.sqrt(r2);
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) A[r][c] += w * row[r] * row[c];
      rhs[r] -= w * r2 * row[r];
    }
  }
  meanDist /= W;
  const fallback: PatternSphere = { center: [mx, my, mz], radius: meanDist };
  const sol = solve4(A, rhs);
  if (!sol) return fallback;
  const cx = -sol[0] / 2, cy = -sol[1] / 2, cz = -sol[2] / 2;
  const r2 = cx * cx + cy * cy + cz * cz - sol[3];
  if (!(r2 > 0)) return fallback;
  const radius = Math.sqrt(r2);
  // A near-flat scope fits a huge sphere far away — useless for a ball; the
  // centroid/mean-radius fallback at least keeps the panels on the surface.
  const spread = Math.max(meanDist, 1e-9);
  if (radius > spread * 50 || Math.hypot(cx, cy, cz) > spread * 50) return fallback;
  return { center: [cx + mx, cy + my, cz + mz], radius };
}

/** Gaussian elimination with partial pivoting on a 4×4 system. Null when
 *  (near-)singular. */
function solve4(A: number[][], b: number[]): number[] | null {
  const M = A.map((row, i) => [...row, b[i]]);
  let scale = 0;
  for (const row of A) for (const v of row) scale = Math.max(scale, Math.abs(v));
  if (!(scale > 0)) return null;
  for (let col = 0; col < 4; col++) {
    let piv = col;
    for (let r = col + 1; r < 4; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < scale * 1e-12) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < 4; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c < 5; c++) M[r][c] -= f * M[col][c];
    }
  }
  return [M[0][4] / M[0][0], M[1][4] / M[1][1], M[2][4] / M[2][2], M[3][4] / M[3][3]];
}

const PHI = (1 + Math.sqrt(5)) / 2;
/** cos of the angle between adjacent icosahedron vertices (1/√5). */
const ICO_ADJ_COS = 1 / Math.sqrt(5);

/** The 12 unit icosahedron vertex directions (a fixed, documented order). */
function icosahedronDirs(): V3[] {
  const raw: V3[] = [];
  for (const s1 of [1, -1]) for (const s2 of [1, -1]) {
    raw.push([0, s1, s2 * PHI]);
    raw.push([s1, s2 * PHI, 0]);
    raw.push([s2 * PHI, 0, s1]);
  }
  const n = Math.hypot(1, PHI);
  return raw.map(([x, y, z]) => [x / n, y / n, z / n]);
}

type V3 = [number, number, number];
const dot3 = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
/** Unit component of `v` orthogonal to unit `a`, or null when (anti)parallel. */
const orthoTo = (v: V3, a: V3): V3 | null => {
  const d = dot3(v, a);
  const o: V3 = [v[0] - d * a[0], v[1] - d * a[1], v[2] - d * a[2]];
  const l = Math.hypot(o[0], o[1], o[2]);
  return l > 1e-6 ? [o[0] / l, o[1] / l, o[2] / l] : null;
};

/** Standard truncated-icosahedron truncation: each pentagon vertex sits 1/3 of
 *  the way along an icosahedron edge. */
const SOCCER_TRUNCATION = 1 / 3;
/** `coverage` (panel size factor) upper bound — at 1.5 the pentagons touch. */
export const SOCCER_MAX_COVERAGE = 1.45;

/** Soccer-ball panel geometry around a fitted sphere: the 12 pentagon centre
 *  directions plus, per pentagon, its 5 inward edge-plane normals. Every edge
 *  plane passes through the ball centre, so a panel is the intersection of 5
 *  half-spaces — a convex cone — and its boundary on ANY surface is the planar
 *  cut through the centre (the great-circle arc on a true sphere). */
export interface SoccerGeometry {
  sphere: PatternSphere;
  /** 12 × unit pentagon-centre directions. */
  centers: V3[];
  /** 12 × 5 × 3 inward unit edge-plane normals (flattened). */
  normals: Float64Array;
}

/** Build the soccer panels for a sphere. Orientation: one pentagon centred on
 *  `anchors[0] − centre` (default +X); `anchors[1] − centre` (default +Z) sets
 *  the roll by leaning a neighbouring pentagon toward it. `coverage` scales the
 *  panels (1 = the standard ball). */
export function soccerGeometry(sphere: PatternSphere, anchors?: [number, number, number][], coverage?: number): SoccerGeometry {
  const ico = icosahedronDirs();
  const v0 = ico[0];
  const nb0 = ico.find((v, i) => i > 0 && Math.abs(dot3(v, v0) - ICO_ADJ_COS) < 1e-6)!;
  const c = sphere.center;
  const dirOf = (p: [number, number, number] | undefined): V3 | null => {
    if (!p) return null;
    const d: V3 = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
    return Math.hypot(d[0], d[1], d[2]) > 1e-9 ? norm3(d) : null;
  };
  const a = dirOf(anchors?.[0]) ?? [1, 0, 0];
  const hint = dirOf(anchors?.[1]);
  const b = (hint && orthoTo(hint, a)) ?? orthoTo([0, 0, 1], a) ?? orthoTo([0, 1, 0], a)!;
  // Rotation R = F·Eᵀ mapping the source frame (v0, u0, v0×u0) onto (a, b, a×b).
  const u0 = orthoTo(nb0, v0)!;
  const E: V3[] = [v0, u0, cross3(v0, u0)];
  const F: V3[] = [a, b, cross3(a, b)];
  const rot = (v: V3): V3 => {
    const e0 = dot3(v, E[0]), e1 = dot3(v, E[1]), e2 = dot3(v, E[2]);
    return [
      F[0][0] * e0 + F[1][0] * e1 + F[2][0] * e2,
      F[0][1] * e0 + F[1][1] * e1 + F[2][1] * e2,
      F[0][2] * e0 + F[1][2] * e1 + F[2][2] * e2,
    ];
  };
  const dirs = ico.map(rot);
  const size = coverage !== undefined && Number.isFinite(coverage)
    ? Math.min(Math.max(coverage, 0.05), SOCCER_MAX_COVERAGE)
    : 1;
  const t = SOCCER_TRUNCATION * size;
  const normals = new Float64Array(12 * 5 * 3);
  dirs.forEach((v, k) => {
    const nbrs = dirs.filter((u, j) => j !== k && Math.abs(dot3(u, v) - ICO_ADJ_COS) < 1e-6);
    // Order the 5 neighbours around v so consecutive corners share an edge.
    const tu = orthoTo(nbrs[0], v)!;
    const tw = cross3(v, tu);
    nbrs.sort((p, q) => Math.atan2(dot3(p, tw), dot3(p, tu)) - Math.atan2(dot3(q, tw), dot3(q, tu)));
    const corners: V3[] = nbrs.map((u) => [v[0] + t * (u[0] - v[0]), v[1] + t * (u[1] - v[1]), v[2] + t * (u[2] - v[2])]);
    for (let j = 0; j < 5; j++) {
      let n = norm3(cross3(corners[j], corners[(j + 1) % 5]));
      if (dot3(n, v) < 0) n = [-n[0], -n[1], -n[2]];
      normals.set(n, (k * 5 + j) * 3);
    }
  });
  return { sphere, centers: dirs, normals };
}

/** Signed field of the soccer panels at a world point: ≤0 inside a pentagon
 *  (the mark colour), 0 on its edge, >0 on the white hexagons. Magnitude is the
 *  distance to the nearest panel's nearest edge plane (≈ the surface distance
 *  to the seam near the boundary); 1-Lipschitz and piecewise LINEAR, so a seam
 *  crossing a flat triangle is clipped exactly without any refinement — only
 *  the 60 pentagon corners need a finer rim. */
export function soccerField(g: SoccerGeometry): (x: number, y: number, z: number) => number {
  const [cx, cy, cz] = g.sphere.center;
  const N = g.normals;
  return (x, y, z) => {
    const px = x - cx, py = y - cy, pz = z - cz;
    let best = Infinity;
    for (let k = 0; k < 12; k++) {
      let m = -Infinity;
      for (let j = 0; j < 5; j++) {
        const o = (k * 5 + j) * 3;
        const d = -(px * N[o] + py * N[o + 1] + pz * N[o + 2]);
        if (d > m) m = d;
      }
      if (m < best) best = m;
    }
    return best;
  };
}

// --- Shared per-pattern context ---------------------------------------------

/** Everything a pattern needs beyond the spec, resolved ONCE against the
 *  pristine base mesh so the refine (clip) step and the colour step evaluate
 *  the IDENTICAL field — even in the subdivision Worker, which can't see labels
 *  or parts. Plain data, so it structured-clones to the Worker. */
export interface PatternContext {
  /** Whole-mesh bounds (drive the default `scale` and the noise domain). */
  bounds: { min: [number, number, number]; max: [number, number, number] };
  /** `soccer` only: the ball the panels wrap (fit to the scope). */
  sphere: PatternSphere | null;
  /** Scope mask over the base mesh's triangle ids (1 = in scope) — confines
   *  the smooth refinement/clip to the scoped part. Null = not built. */
  allow: Uint8Array | null;
  /** Bounding box of the scoped triangles — cheap spatial reject. */
  aabb: Aabb | null;
}

/** Resolve a pattern's context against `mesh` for an already-resolved scope
 *  set. `withAllow` builds the scope mask + AABB (only the smooth refine needs
 *  them). */
export function buildPatternContext(
  mesh: MeshData,
  scope: Iterable<number>,
  spec: ColorPatternSpec,
  withAllow = false,
): PatternContext {
  const bounds = meshBounds(mesh);
  const ids = [...scope];
  const sphere = spec.pattern === 'soccer' ? fitSphere(mesh, ids) : null;
  let allow: Uint8Array | null = null;
  let aabb: Aabb | null = null;
  if (withAllow) {
    allow = new Uint8Array(mesh.numTri);
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    const { triVerts, vertProperties: vp, numProp: P } = mesh;
    for (const t of ids) {
      if (t < 0 || t >= mesh.numTri) continue;
      allow[t] = 1;
      for (let k = 0; k < 3; k++) {
        const v = triVerts[t * 3 + k] * P;
        for (let ax = 0; ax < 3; ax++) {
          const c = vp[v + ax];
          if (c < min[ax]) min[ax] = c;
          if (c > max[ax]) max[ax] = c;
        }
      }
    }
    if (min[0] <= max[0]) {
      const pad = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) * 1e-3 + 1e-6;
      aabb = { min: [min[0] - pad, min[1] - pad, min[2] - pad], max: [max[0] + pad, max[1] + pad, max[2] + pad] };
    }
  }
  return { bounds, sphere, allow, aabb };
}

interface PatternEval {
  pick: (c: RGB) => RGB;
  /** Signed boundary field (≤0 = mark side) for SMOOTH_PATTERN_KINDS. */
  field?: (x: number, y: number, z: number) => number;
  /** Upper bound on |∇field| — sizes the "could a boundary cross this
   *  triangle?" margin in the refine classifier. */
  lipschitz?: number;
}

/** Build the colour picker (and, for smooth-capable kinds, the signed field)
 *  for a spec. Pure — the same inputs give the same functions on the main
 *  thread, in the Worker, and headlessly. */
function buildPatternEval(spec: ColorPatternSpec, ctx: PatternContext): PatternEval {
  const colors = spec.colors;
  const base = colors[0];
  const mark = colors[1] ?? colors[0];
  const b = ctx.bounds;
  const size: RGB = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
  const center: RGB = [(b.max[0] + b.min[0]) / 2, (b.max[1] + b.min[1]) / 2, (b.max[2] + b.min[2]) / 2];
  const diag = Math.hypot(size[0], size[1], size[2]) || 1;
  const seed = spec.seed ?? 1;
  const scale = spec.scale && spec.scale > 0 ? spec.scale : diag / 8;

  switch (spec.pattern) {
    case 'stripes': {
      const axis = AXIS_IDX[spec.axis ?? 'z'];
      const warp = spec.warp ?? 0.35;
      const duty = clamp01(spec.coverage ?? 0.5);     // fraction of each cycle in the mark colour
      const period = Math.max(scale, 1e-3);
      const warpNoise = makeNoise({ seed, frequency: 1.3 / period, octaves: 2 });
      const phaseAt = (x: number, y: number, z: number): number => {
        const w = warp * period * warpNoise(x, y, z);
        const phase = ((axis === 0 ? x : axis === 1 ? y : z) + w) / period;
        return phase - Math.floor(phase);              // 0..1 sawtooth along the axis
      };
      return {
        pick: (c) => (phaseAt(c[0], c[1], c[2]) < duty ? mark : base),
        // Signed distance (world units along the band axis) to the nearer band
        // edge: the mark band is s ∈ [0, duty), its edges at s = 0 and s = duty.
        field: (x, y, z) => {
          const s = phaseAt(x, y, z);
          const d = s < duty ? -Math.min(s, duty - s) : Math.min(s - duty, 1 - s);
          return d * period;
        },
        lipschitz: 1 + 3 * Math.abs(warp),
      };
    }
    case 'spots': {
      // Worley/cellular: scatter feature points, colour a triangle if it's within
      // `spotR` of the nearest one. A third colour (if present) tints the spot core.
      const spacing = Math.max(scale, 1e-3);
      const vol = Math.max(size[0], 1e-3) * Math.max(size[1], 1e-3) * Math.max(size[2], 1e-3);
      const n = Math.max(4, Math.min(500, Math.round((vol / (spacing * spacing * spacing)) * 0.5)));
      const rng = mulberry32(seed || 1);
      const pts: RGB[] = [];
      for (let i = 0; i < n; i++) {
        pts.push([b.min[0] + rng() * size[0], b.min[1] + rng() * size[1], b.min[2] + rng() * size[2]]);
      }
      const spotR = spacing * clamp01(spec.coverage ?? 0.38);
      const core = colors[2];
      return {
        pick: (c) => {
          let dmin = Infinity;
          for (let i = 0; i < pts.length; i++) {
            const dx = c[0] - pts[i][0], dy = c[1] - pts[i][1], dz = c[2] - pts[i][2];
            const dd = dx * dx + dy * dy + dz * dz;
            if (dd < dmin) dmin = dd;
          }
          const dist = Math.sqrt(dmin);
          if (dist >= spotR) return base;
          if (core && dist < spotR * 0.55) return core;
          return mark;
        },
      };
    }
    case 'patches': {
      // Irregular blotches (calico / cow / tortoiseshell): a low-frequency fBm
      // split into 2 zones, or 3 via a second decorrelated field inside the marks.
      const warp = spec.warp ?? 0;
      const f1 = makeNoise({ seed, frequency: 1 / Math.max(scale, 1e-3), octaves: 2, gain: 0.6 });
      const f2 = makeNoise({ seed: seed * 2 + 17, frequency: 1.0 / Math.max(scale, 1e-3), octaves: 2, gain: 0.6 });
      const baseFrac = clamp01(spec.coverage ?? 0.5);
      const third = colors[2];
      return {
        pick: (c) => {
          const wj = warp ? warp * (f2(c[0], c[1], c[2])) * scale * 0.3 : 0;
          const v = (f1(c[0] + wj, c[1], c[2]) + 1) / 2;   // 0..1
          if (v < baseFrac) return base;
          if (third) return f2(c[0], c[1], c[2]) > 0 ? mark : third;
          return mark;
        },
      };
    }
    case 'gradient': {
      // Points/colourpoint (siamese): darken the extremities. With `anchors`
      // (ear/paw/tail/face points the model supplies) it marks triangles within
      // `scale` of the nearest anchor — so the face mask darkens too, not just the
      // top/bottom. Without anchors it falls back to distance-from-centre. Both
      // use a noise-jittered threshold so the edge reads soft, not a hard ring.
      const warp = spec.warp ?? 0.12;
      const jitter = makeNoise({ seed, frequency: 4 / diag, octaves: 2 });
      const anchors = spec.anchors;
      if (anchors && anchors.length > 0) {
        const pointR = spec.scale && spec.scale > 0 ? spec.scale : diag / 6;
        return {
          pick: (c) => {
            let dmin = Infinity;
            for (let i = 0; i < anchors.length; i++) {
              const dx = c[0] - anchors[i][0], dy = c[1] - anchors[i][1], dz = c[2] - anchors[i][2];
              const dd = dx * dx + dy * dy + dz * dz;
              if (dd < dmin) dmin = dd;
            }
            const d = Math.sqrt(dmin) + warp * pointR * jitter(c[0], c[1], c[2]);
            return d < pointR ? mark : base;
          },
        };
      }
      const lo = clamp01(spec.coverage ?? 0.58);
      const maxR = diag / 2;
      return {
        pick: (c) => {
          const dx = c[0] - center[0], dy = c[1] - center[1], dz = c[2] - center[2];
          const d = Math.hypot(dx, dy, dz) / maxR + warp * jitter(c[0], c[1], c[2]);
          return d > lo ? mark : base;
        },
      };
    }
    case 'checker': {
      // 3D checkerboard: alternate by the parity of the cell index sum. `warp`
      // wobbles the cell boundaries for a hand-painted look; a third colour
      // turns the pattern into a 3-cycle (candy-cane / plaid-ish rotation).
      const cell = Math.max(scale, 1e-3);
      const warp = spec.warp ?? 0;
      const warpNoise = warp ? makeNoise({ seed, frequency: 1.1 / cell, octaves: 2 }) : null;
      const third = colors[2];
      const n = third ? 3 : 2;
      const warpAt = (x: number, y: number, z: number): number => (warpNoise ? warp * cell * 0.4 * warpNoise(x, y, z) : 0);
      return {
        pick: (c) => {
          const w = warpAt(c[0], c[1], c[2]);
          const idx = Math.floor((c[0] + w) / cell) + Math.floor((c[1] + w) / cell) + Math.floor((c[2] + w) / cell);
          const m = ((idx % n) + n) % n;
          return m === 0 ? base : m === 1 ? mark : third!;
        },
        // Every cell plane separates two different colours (crossing one plane
        // steps the index sum by ±1), so the boundary is ALL the cell planes:
        // distance to the nearest one, signed by the index-sum parity — which
        // flips on every plane crossing, for the 3-colour cycle too.
        field: (x, y, z) => {
          const w = warpAt(x, y, z);
          const qx = (x + w) / cell, qy = (y + w) / cell, qz = (z + w) / cell;
          const fx = Math.floor(qx), fy = Math.floor(qy), fz = Math.floor(qz);
          const d = Math.min(qx - fx, fx + 1 - qx, qy - fy, fy + 1 - qy, qz - fz, fz + 1 - qz) * cell;
          return ((fx + fy + fz) & 1) === 0 ? d : -d;
        },
        lipschitz: 1 + 2 * Math.abs(warp),
      };
    }
    case 'soccer': {
      if (!ctx.sphere) return { pick: () => base };
      const field = soccerField(soccerGeometry(ctx.sphere, spec.anchors, spec.coverage));
      return {
        pick: (c) => (field(c[0], c[1], c[2]) <= 0 ? mark : base),
        field,
        lipschitz: 1,
      };
    }
    default:
      return { pick: () => base };
  }
}

/** Assign every triangle in `scope` a palette colour from the chosen field.
 *  Returns a `triId → rgb` map (the `perTriColors` substrate). Pass the `ctx`
 *  the smooth refine used (built on the base mesh) so the colours land on the
 *  same side of the clipped boundary; omitted ⇒ resolved from `mesh` + `scope`
 *  (a `soccer` ball is fit to the scope itself). */
export function computePatternColors(
  mesh: MeshData,
  scope: Iterable<number>,
  spec: ColorPatternSpec,
  ctx?: PatternContext,
): Map<number, RGB> {
  const out = new Map<number, RGB>();
  const ids = [...scope];
  if (ids.length === 0 || spec.colors.length === 0) return out;
  const { pick } = buildPatternEval(spec, ctx ?? buildPatternContext(mesh, ids, spec));
  for (const t of ids) out.set(t, pick(getTriangleCentroid(t, mesh)));
  return out;
}

/** The signed boundary field (≤0 = mark side) of a smooth-capable pattern, or
 *  null for kinds without one (or a soccer ball with no fitted sphere). */
export function patternField(spec: ColorPatternSpec, ctx: PatternContext): ((x: number, y: number, z: number) => number) | null {
  return buildPatternEval(spec, ctx).field ?? null;
}

/** Build the refine region that makes a pattern's colour boundary smooth: the
 *  rim triangles the boundary crosses are subdivided toward `maxEdge` where the
 *  boundary curves, then clipped exactly along the field's zero set. Confined
 *  to the scope (`ctx.allow`, over the BASE mesh's triangle ids, and
 *  `ctx.aabb`). Null when the pattern has no analytic field. */
export function patternRefineRegion(spec: ColorPatternSpec, ctx: PatternContext, maxEdge: number): RefineRegion | null {
  const ev = buildPatternEval(spec, ctx);
  const field = ev.field;
  if (!field || !(maxEdge > 0)) return null;
  const L = ev.lipschitz ?? 1;
  // A boundary can only cross a triangle where the field changes sign. The
  // corner values bound the field inside the triangle to within L × (longest
  // edge), so same-sign corners further than that from zero are provably clear;
  // anything closer is (conservatively) a straddle — e.g. a pentagon corner
  // poking into a triangle whose three vertices are all white.
  const classify = (a: number[], b: number[], c: number[]): TriClass => {
    const fa = field(a[0], a[1], a[2]), fb = field(b[0], b[1], b[2]), fc = field(c[0], c[1], c[2]);
    if (!(fa > 0 && fb > 0 && fc > 0) && !(fa <= 0 && fb <= 0 && fc <= 0)) return 'straddle';
    const e = Math.sqrt(Math.max(
      (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2,
      (b[0] - c[0]) ** 2 + (b[1] - c[1]) ** 2 + (b[2] - c[2]) ** 2,
      (c[0] - a[0]) ** 2 + (c[1] - a[1]) ** 2 + (c[2] - a[2]) ** 2,
    ));
    if (Math.min(Math.abs(fa), Math.abs(fb), Math.abs(fc)) <= L * e) return 'straddle';
    return fa <= 0 ? 'inside' : 'outside';
  };
  return {
    aabb: ctx.aabb,
    maxEdge,
    classify,
    field,
    ...(ctx.allow ? { allow: ctx.allow } : {}),
  };
}

/** Default smooth target edge for a pattern. A soccer ball's seams are planar
 *  cuts (clipped exactly at any resolution), so only its 60 pentagon corners
 *  need a fine rim — radius/100 keeps them sharp for a few hundred extra
 *  triangles. Other kinds use the model's bbox-relative default (`fallback`). */
export function defaultPatternMaxEdge(spec: ColorPatternSpec, ctx: PatternContext, fallback: number): number {
  if (spec.pattern === 'soccer' && ctx.sphere) return ctx.sphere.radius / 100;
  return fallback;
}
