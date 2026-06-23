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

import type { MeshData } from '../geometry/types';
import { getTriangleCentroid } from './adjacency';
import { meshBounds } from './slabPaint';
import { makeNoise, mulberry32 } from '../geometry/noise';

export type RGB = [number, number, number];
export type ColorPatternKind = 'stripes' | 'spots' | 'patches' | 'gradient';

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
   *  base-coat fraction for patches, or the distance threshold for gradient. */
  coverage?: number;
  /** Seed for reproducible noise / feature scatter. Default 1. */
  seed?: number;
}

export const COLOR_PATTERN_KINDS: ReadonlyArray<ColorPatternKind> = ['stripes', 'spots', 'patches', 'gradient'];

const AXIS_IDX: Record<'x' | 'y' | 'z', number> = { x: 0, y: 1, z: 2 };
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Assign every triangle in `scope` a palette colour from the chosen field.
 *  Returns a `triId → rgb` map (the `perTriColors` substrate). */
export function computePatternColors(
  mesh: MeshData,
  scope: Iterable<number>,
  spec: ColorPatternSpec,
): Map<number, RGB> {
  const out = new Map<number, RGB>();
  const ids = [...scope];
  const colors = spec.colors;
  if (ids.length === 0 || colors.length === 0) return out;
  const base = colors[0];
  const mark = colors[1] ?? colors[0];

  const b = meshBounds(mesh);
  const size: RGB = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
  const center: RGB = [(b.max[0] + b.min[0]) / 2, (b.max[1] + b.min[1]) / 2, (b.max[2] + b.min[2]) / 2];
  const diag = Math.hypot(size[0], size[1], size[2]) || 1;
  const seed = spec.seed ?? 1;
  const scale = spec.scale && spec.scale > 0 ? spec.scale : diag / 8;

  let pick: (c: RGB) => RGB;

  switch (spec.pattern) {
    case 'stripes': {
      const axis = AXIS_IDX[spec.axis ?? 'z'];
      const warp = spec.warp ?? 0.35;
      const duty = clamp01(spec.coverage ?? 0.5);     // fraction of each cycle in the mark colour
      const period = Math.max(scale, 1e-3);
      const warpNoise = makeNoise({ seed, frequency: 1.3 / period, octaves: 2 });
      pick = (c) => {
        const w = warp * period * warpNoise(c[0], c[1], c[2]);
        const phase = (c[axis] + w) / period;
        const frac = phase - Math.floor(phase);        // 0..1 sawtooth along the axis
        return frac < duty ? mark : base;
      };
      break;
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
      pick = (c) => {
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
      };
      break;
    }
    case 'patches': {
      // Irregular blotches (calico / cow / tortoiseshell): a low-frequency fBm
      // split into 2 zones, or 3 via a second decorrelated field inside the marks.
      const warp = spec.warp ?? 0;
      const f1 = makeNoise({ seed, frequency: 1 / Math.max(scale, 1e-3), octaves: 2, gain: 0.6 });
      const f2 = makeNoise({ seed: seed * 2 + 17, frequency: 1.0 / Math.max(scale, 1e-3), octaves: 2, gain: 0.6 });
      const baseFrac = clamp01(spec.coverage ?? 0.5);
      const third = colors[2];
      pick = (c) => {
        const wj = warp ? warp * (f2(c[0], c[1], c[2])) * scale * 0.3 : 0;
        const v = (f1(c[0] + wj, c[1], c[2]) + 1) / 2;   // 0..1
        if (v < baseFrac) return base;
        if (third) return f2(c[0], c[1], c[2]) > 0 ? mark : third;
        return mark;
      };
      break;
    }
    case 'gradient': {
      // Points/colourpoint (siamese): mark the extremities — triangles far from the
      // model centre — with a noise-jittered threshold so the edge isn't a hard ring.
      const lo = clamp01(spec.coverage ?? 0.58);
      const warp = spec.warp ?? 0.12;
      const maxR = diag / 2;
      const jitter = makeNoise({ seed, frequency: 4 / diag, octaves: 2 });
      pick = (c) => {
        const dx = c[0] - center[0], dy = c[1] - center[1], dz = c[2] - center[2];
        const d = Math.hypot(dx, dy, dz) / maxR + warp * jitter(c[0], c[1], c[2]);
        return d > lo ? mark : base;
      };
      break;
    }
    default:
      pick = () => base;
  }

  for (const t of ids) out.set(t, pick(getTriangleCentroid(t, mesh)));
  return out;
}
