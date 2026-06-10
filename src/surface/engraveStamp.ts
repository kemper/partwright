// Engrave / cut-through stamp — the field math for cutting a projected 2D mask
// (text or an image) into a solid as recessed channels or all-the-way-through
// holes. Unlike the relief textures (which only displace the existing skin),
// this *removes* material, so it rides the shared SDF scaffolding: it supplies a
// `combine(sample)` to `sdfModifierMesh`, sampling a 2D ink mask at the world
// point projected onto a chosen face (planar) or wrapped around Z (cylindrical).
//
// The pipeline splits cleanly into a pure data mask + pure projection math:
//
//   • A `StampMask` is just { width, height, data } — a row-major coverage grid
//     in [0,255], row 0 = top (v=0). It is produced two ways, both pure here:
//       - `rasterizeContours` scan-fills opentype glyph outlines (the app's own
//         text path, Liberation Sans) with the even-odd rule → matches api.text.
//       - `maskFromRGBA` reduces decoded image pixels (alpha · darkness) → ink.
//     The DOM-only steps (font fetch, image decode) live in the host (main.ts);
//     everything here is unit-testable in the node tier.
//
//   • `engraveCombine` maps a world point → (u,v) → mask coverage m, then:
//       stampSDF(p) = (0.5 - m) · scale          (< 0 where ink, m > 0.5)
//       cut-through:  combine = max( d, -stampSDF )                  (subtract a
//                     full prism wherever ink projects through the wall)
//       engrave:      combine = max( d, -max(stampSDF, depthInto - depth) )
//                     (subtract only within `depth` of the chosen face — the
//                     face-relative depth, NOT |d|, so the back face is untouched)
//     where `< 0` is inside the result solid (the SDF convention of sdfModifier).

import type { SdfCombine, SdfSample } from './sdfModifier';

type Vec2 = [number, number];

/** A 2D ink-coverage mask. Row-major `data` in [0,255]; row 0 is the *top* of
 *  the image (v = 0), so it lines up with the projection's v axis. */
export interface StampMask {
  width: number;
  height: number;
  data: Uint8Array;
}

/** Width / height aspect of a mask (>1 = wider than tall, e.g. a word). */
export function maskAspect(mask: StampMask): number {
  return mask.height > 0 ? mask.width / mask.height : 1;
}

/** Bilinear-sample a mask. `u`,`v` in [0,1] (v=0 top). Outside the unit square
 *  returns 0 (no ink). Returns coverage in [0,1]. */
export function sampleMask(mask: StampMask, u: number, v: number): number {
  const { width: w, height: h, data } = mask;
  if (w === 0 || h === 0) return 0;
  if (u < 0 || u > 1 || v < 0 || v > 1) return 0;
  // Map to pixel-center grid: pixel c spans u∈[c/w,(c+1)/w], center at (c+0.5)/w.
  const fx = u * w - 0.5;
  const fy = v * h - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const clampX = (x: number) => (x < 0 ? 0 : x >= w ? w - 1 : x);
  const clampY = (y: number) => (y < 0 ? 0 : y >= h ? h - 1 : y);
  const x0c = clampX(x0), x1c = clampX(x0 + 1), y0c = clampY(y0), y1c = clampY(y0 + 1);
  const s00 = data[y0c * w + x0c], s10 = data[y0c * w + x1c];
  const s01 = data[y1c * w + x0c], s11 = data[y1c * w + x1c];
  const top = s00 + (s10 - s00) * tx;
  const bot = s01 + (s11 - s01) * tx;
  return (top + (bot - top) * ty) / 255;
}

export interface RasterizeOptions {
  /** Pixels along the longer side of the glyph bounds (default 384). */
  maxDim?: number;
  /** Transparent margin around the glyphs, as a fraction of the longer side
   *  (default 0.06) — keeps edge strokes off the mask border. */
  paddingFrac?: number;
  /** Supersampling factor per axis for anti-aliased edges (default 2). */
  supersample?: number;
}

/** Scan-fill closed 2D contours (even-odd rule) into a coverage mask, fit to
 *  their bounds with padding. Contours are in Y-up model space (as produced by
 *  `textToContours`); row 0 of the mask is the top (max Y). Pure. */
export function rasterizeContours(contours: Vec2[][], opts: RasterizeOptions = {}): StampMask {
  const maxDim = Math.max(8, Math.round(opts.maxDim ?? 384));
  const paddingFrac = Math.max(0, opts.paddingFrac ?? 0.06);
  const ss = Math.max(1, Math.round(opts.supersample ?? 2));

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of contours) {
    for (const [x, y] of c) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX) || maxX <= minX || maxY <= minY) {
    return { width: 1, height: 1, data: new Uint8Array(1) };
  }

  const spanX = maxX - minX, spanY = maxY - minY;
  const longer = Math.max(spanX, spanY);
  const pad = longer * paddingFrac;
  const minXp = minX - pad, maxXp = maxX + pad;
  const minYp = minY - pad, maxYp = maxY + pad;
  const spanXp = maxXp - minXp, spanYp = maxYp - minYp;
  const longerP = Math.max(spanXp, spanYp);
  const cell = longerP / maxDim;
  const width = Math.max(1, Math.round(spanXp / cell));
  const height = Math.max(1, Math.round(spanYp / cell));

  const data = new Uint8Array(width * height);
  const inv = 1 / ss;
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      let hits = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const px = c + (sx + 0.5) * inv;
          const py = r + (sy + 0.5) * inv;
          // Pixel center → world; row 0 is top (max Y).
          const wx = minXp + (px / width) * spanXp;
          const wy = maxYp - (py / height) * spanYp;
          if (pointInContours(contours, wx, wy)) hits++;
        }
      }
      data[r * width + c] = Math.round((hits / (ss * ss)) * 255);
    }
  }
  return { width, height, data };
}

/** Even-odd point-in-polygon over a set of contours (holes handled by parity). */
function pointInContours(contours: Vec2[][], x: number, y: number): boolean {
  let inside = false;
  for (const c of contours) {
    for (let i = 0, j = c.length - 1; i < c.length; j = i++) {
      const yi = c[i][1], yj = c[j][1];
      if ((yi > y) !== (yj > y)) {
        const xi = c[i][0], xj = c[j][0];
        const xCross = xi + ((y - yi) / (yj - yi)) * (xj - xi);
        if (x < xCross) inside = !inside;
      }
    }
  }
  return inside;
}

/** Reduce decoded RGBA pixels to an ink-coverage mask. Ink = opaque · dark by
 *  default (black text/logo on a light or transparent background); `invert`
 *  treats light pixels as ink instead. Pure (no canvas) — unit-testable. */
export function maskFromRGBA(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  opts: { invert?: boolean } = {},
): StampMask {
  const invert = opts.invert ?? false;
  const data = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2], a = rgba[i * 4 + 3];
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const dark = invert ? lum : 1 - lum;
    data[i] = Math.round((a / 255) * dark * 255);
  }
  return { width, height, data };
}

/** Where the stamp lives on the model.
 *  - `planar`: projects onto one of the six axis-aligned faces. `posU`/`posV`
 *    are the stamp *center* as a fraction [0,1] of the bbox along the face's two
 *    in-plane axes (0.5 = centered; 0.25/0.75 = quarter points). Good for flat
 *    axis-aligned faces (cubes, slabs) where the position sliders make sense.
 *  - `free`: lies flat on an arbitrary surface point — `origin` + outward
 *    `normal` define the plane, so the stamp follows a sloped or curved face
 *    (a pyramid side, a sphere). Used when you click a non-axis-aligned face.
 *  - `cylindrical`: wraps the stamp around the Z axis.
 *  `rotationDeg` rotates the stamp in its plane (planar/free) or around Z. */
export type EngraveProjection =
  | { mode: 'planar'; axis: 'x' | 'y' | 'z'; side: 'min' | 'max'; posU?: number; posV?: number; rotationDeg?: number }
  | { mode: 'free'; origin: [number, number, number]; normal: [number, number, number]; rotationDeg?: number }
  | { mode: 'cylindrical'; side: 'outer' | 'inner'; rotationDeg?: number };

export interface EngraveFieldOptions {
  mask: StampMask;
  projection: EngraveProjection;
  /** Cut all the way through the wall (true) or only recess to `depth` (false). */
  through: boolean;
  /** Engrave depth in world units (ignored when `through`). */
  depth: number;
  /** Stamp width in world units (the mask's wider dimension maps to this). */
  size: number;
}

export interface Bbox {
  min: [number, number, number];
  max: [number, number, number];
  size: [number, number, number];
}

/** The two in-plane axes for a planar face normal axis. */
const PLANE_AXES: Record<'x' | 'y' | 'z', [0 | 1 | 2, 0 | 1 | 2]> = {
  // [u-axis index, v-axis index]
  z: [0, 1], // top/bottom: u→x, v→y
  y: [0, 2], // front/back: u→x, v→z
  x: [1, 2], // left/right: u→y, v→z
};

type Vec3 = [number, number, number];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Orthonormal in-plane axes (u, v) for a surface normal, with an in-plane
 *  rotation applied; `n` is the unit outward normal. v completes a right-handed
 *  frame. Shared by the free-projection field and its footprint outline so they
 *  stay in lockstep. Pure. */
export function tangentFrame(normal: Vec3, rotationDeg = 0): { u: Vec3; v: Vec3; n: Vec3 } {
  const len = Math.hypot(normal[0], normal[1], normal[2]) || 1;
  const n: Vec3 = [normal[0] / len, normal[1] / len, normal[2] / len];
  // A reference axis not parallel to n, so the cross product is well-conditioned.
  const ref: Vec3 = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  const u0raw = cross(ref, n);
  const ul = Math.hypot(u0raw[0], u0raw[1], u0raw[2]) || 1;
  const u0: Vec3 = [u0raw[0] / ul, u0raw[1] / ul, u0raw[2] / ul];
  const v0 = cross(n, u0); // unit (n ⟂ u0, both unit)
  const rot = (rotationDeg * Math.PI) / 180;
  const c = Math.cos(rot), s = Math.sin(rot);
  const u: Vec3 = [u0[0] * c + v0[0] * s, u0[1] * c + v0[1] * s, u0[2] * c + v0[2] * s];
  const v: Vec3 = [-u0[0] * s + v0[0] * c, -u0[1] * s + v0[1] * c, -u0[2] * s + v0[2] * c];
  return { u, v, n };
}

/** Build the SDF `combine` that cuts the stamp into a solid with the given
 *  bbox. `< 0` = inside the result solid (sdfModifier convention). Pure. */
export function engraveCombine(bbox: Bbox, opts: EngraveFieldOptions): SdfCombine {
  const { mask, projection, through, depth, size } = opts;
  const cx = (bbox.min[0] + bbox.max[0]) / 2;
  const cy = (bbox.min[1] + bbox.max[1]) / 2;
  const cz = (bbox.min[2] + bbox.max[2]) / 2;
  const aspect = maskAspect(mask);
  const stampW = Math.max(1e-6, size);
  const stampH = stampW / Math.max(1e-6, aspect);

  // project(p) → coverage m in [0,1] (0 = outside the stamp rectangle).
  let project: (x: number, y: number, z: number) => number;
  // depthInto(p) → distance from the chosen face into the model (≥0 inside),
  // used only for the engrave (non-through) depth band.
  let depthInto: (x: number, y: number, z: number) => number;

  if (projection.mode === 'planar') {
    const [ui, vi] = PLANE_AXES[projection.axis];
    const axisIdx = projection.axis === 'x' ? 0 : projection.axis === 'y' ? 1 : 2;
    // Stamp center: a fraction of the bbox span along each in-plane axis
    // (default 0.5 = centered). Clamp so a stray value can't push it off-model.
    const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5);
    const posU = clamp01(projection.posU ?? 0.5);
    const posV = clamp01(projection.posV ?? 0.5);
    const centerU = bbox.min[ui] + posU * bbox.size[ui];
    const centerV = bbox.min[vi] + posV * bbox.size[vi];
    const rot = ((projection.rotationDeg ?? 0) * Math.PI) / 180;
    const cosR = Math.cos(rot), sinR = Math.sin(rot);
    const facePos = projection.side === 'max' ? bbox.max[axisIdx] : bbox.min[axisIdx];
    const sign = projection.side === 'max' ? 1 : -1;
    project = (x, y, z) => {
      const p = [x, y, z];
      // In-plane offset from the stamp center, then rotate into stamp space.
      const du = p[ui] - centerU, dv = p[vi] - centerV;
      const ru = cosR * du + sinR * dv;
      const rv = -sinR * du + cosR * dv;
      const u = ru / stampW + 0.5;
      const v = 0.5 - rv / stampH;
      return sampleMask(mask, u, v);
    };
    depthInto = (x, y, z) => {
      const p = [x, y, z];
      return sign * (facePos - p[axisIdx]);
    };
  } else if (projection.mode === 'free') {
    // Free plane: the stamp lies flat on an arbitrary surface point. Project
    // world points into the tangent frame at `origin`; depth runs along −normal.
    const o = projection.origin;
    const { u, v, n } = tangentFrame(projection.normal, projection.rotationDeg ?? 0);
    project = (x, y, z) => {
      const dx = x - o[0], dy = y - o[1], dz = z - o[2];
      const du = dx * u[0] + dy * u[1] + dz * u[2];
      const dv = dx * v[0] + dy * v[1] + dz * v[2];
      return sampleMask(mask, du / stampW + 0.5, 0.5 - dv / stampH);
    };
    depthInto = (x, y, z) => {
      const dx = x - o[0], dy = y - o[1], dz = z - o[2];
      return -(dx * n[0] + dy * n[1] + dz * n[2]); // ≥0 below the surface (into the solid)
    };
  } else {
    // Cylindrical: wrap around Z. u = angle fraction, v = height fraction.
    // A representative radius to convert arc length ↔ world units.
    const rRef = Math.max(1e-6, Math.max(
      Math.abs(bbox.max[0] - cx), Math.abs(bbox.min[0] - cx),
      Math.abs(bbox.max[1] - cy), Math.abs(bbox.min[1] - cy),
    ));
    const sign = projection.side === 'outer' ? 1 : -1;
    // rotationDeg shifts which way the stamp faces around Z (0 = +X).
    const offset = ((projection.rotationDeg ?? 0) * Math.PI) / 180;
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a)); // → [-π, π]
    project = (x, y, z) => {
      const theta = wrap(Math.atan2(y - cy, x - cx) - offset); // [-π, π], re-centered
      const arc = theta * rRef;                    // signed arc length at rRef
      const u = arc / stampW + 0.5;
      const v = 0.5 - (z - cz) / stampH;
      // Points on the far side wrap to u outside [0,1] → sampleMask returns 0,
      // so the stamp doesn't mirror onto the back of the cylinder.
      return sampleMask(mask, u, v);
    };
    depthInto = (x, y) => {
      const r = Math.hypot(x - cx, y - cy);
      return sign === 1 ? rRef - r : r - rRef;
    };
  }

  return (s: SdfSample): number => {
    const { d, x, y, z, voxelSize } = s;
    // Far outside the solid — nothing to carve; cheapest branch first.
    if (d > voxelSize) return d;
    const m = project(x, y, z);
    const scale = Math.max(voxelSize, (through ? bbox.size[0] : depth) * 0.25);
    const stampSdf = (0.5 - m) * scale; // < 0 where ink
    if (through) {
      return Math.max(d, -stampSdf);
    }
    // Engrave: intersect ink with the face-relative depth band, then subtract.
    const band = depthInto(x, y, z) - depth; // < 0 within `depth` of the face
    const removal = Math.max(stampSdf, band); // intersection (both < 0 to remove)
    return Math.max(d, -removal);
  };
}

/** The four world-space corners of the stamp's rectangular footprint on its
 *  planar face, in order (CCW). Mirrors {@link engraveCombine}'s planar center +
 *  rotation math so a UI outline lands exactly where the carve will. `lift`
 *  nudges the rect off the face (along its normal) to avoid z-fighting when it's
 *  drawn as an overlay. Pure. */
export function engravePlanarFootprint(
  bbox: Bbox,
  opts: { axis: 'x' | 'y' | 'z'; side: 'min' | 'max'; posU?: number; posV?: number; rotationDeg?: number; size: number; aspect: number; lift?: number },
): [number, number, number][] {
  const [ui, vi] = PLANE_AXES[opts.axis];
  const axisIdx = opts.axis === 'x' ? 0 : opts.axis === 'y' ? 1 : 2;
  const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5);
  const hw = Math.max(1e-6, opts.size) / 2;
  const hh = hw / Math.max(1e-6, opts.aspect);
  const centerU = bbox.min[ui] + clamp01(opts.posU ?? 0.5) * bbox.size[ui];
  const centerV = bbox.min[vi] + clamp01(opts.posV ?? 0.5) * bbox.size[vi];
  const facePos = (opts.side === 'max' ? bbox.max[axisIdx] : bbox.min[axisIdx])
    + (opts.lift ?? 0) * (opts.side === 'max' ? 1 : -1);
  const rot = ((opts.rotationDeg ?? 0) * Math.PI) / 180;
  const c = Math.cos(rot), s = Math.sin(rot);
  const local: [number, number][] = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
  return local.map(([su, sv]) => {
    const du = c * su - s * sv, dv = s * su + c * sv;
    const p: [number, number, number] = [0, 0, 0];
    p[ui] = centerU + du; p[vi] = centerV + dv; p[axisIdx] = facePos;
    return p;
  });
}

/** The four world-space corners of a free-projection stamp footprint — the
 *  rectangle lying flat on the surface at `origin` with the given `normal`,
 *  matching the free branch of {@link engraveCombine}. `lift` nudges it off the
 *  surface (along the normal) so an overlay doesn't z-fight. Pure. */
export function engraveFreeFootprint(
  origin: [number, number, number],
  normal: [number, number, number],
  opts: { size: number; aspect: number; rotationDeg?: number; lift?: number },
): [number, number, number][] {
  const { u, v, n } = tangentFrame(normal, opts.rotationDeg ?? 0);
  const hw = Math.max(1e-6, opts.size) / 2;
  const hh = hw / Math.max(1e-6, opts.aspect);
  const lift = opts.lift ?? 0;
  const local: [number, number][] = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
  return local.map(([su, sv]) => [
    origin[0] + u[0] * su + v[0] * sv + n[0] * lift,
    origin[1] + u[1] * su + v[1] * sv + n[1] * lift,
    origin[2] + u[2] * su + v[2] * sv + n[2] * lift,
  ] as [number, number, number]);
}
