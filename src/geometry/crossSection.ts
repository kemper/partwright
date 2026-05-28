import type { CrossSectionResult } from './types';
import { getModule } from './engine';

// The expensive part of a cross-section is the geometric `manifold.slice(z)`
// call plus extracting its contour polygons — both run synchronously on the
// main thread. We memoize that core per (manifold, z) so the work happens at
// most once for a given height: the per-run stats payload, an AI slice view,
// and the inspect batch frequently ask for the same heights, and recomputing
// each time is what makes cross-sections feel slow on dense models.
//
// The cache is a WeakMap keyed by the Manifold object. Each code run produces a
// fresh Manifold (the old one is `.delete()`d), so entries auto-evict once the
// previous run's geometry is garbage-collected — the cache never outlives the
// geometry it describes.
interface SliceCore {
  polygons: number[][][];
  boundingBox: { minX: number; minY: number; maxX: number; maxY: number };
  area: number;
}
const sliceCache = new WeakMap<object, Map<number, SliceCore | null>>();

const EMPTY_BB = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function computeSliceCore(manifold: any, z: number): SliceCore | null {
  let perZ = sliceCache.get(manifold as object);
  if (perZ) {
    const cached = perZ.get(z);
    if (cached !== undefined) return cached;
  } else {
    perZ = new Map();
    sliceCache.set(manifold as object, perZ);
  }

  let core: SliceCore | null = null;
  try {
    const cross = manifold.slice(z);
    const polys = cross.toPolygons();
    const area = cross.area();

    const polygons: number[][][] = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const poly of polys) {
      const points: number[][] = [];
      for (const pt of poly) {
        const x = pt[0] ?? pt.x;
        const y = pt[1] ?? pt.y;
        points.push([x, y]);
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
      polygons.push(points);
    }
    cross.delete();

    core = polygons.length === 0
      ? { polygons: [], boundingBox: { ...EMPTY_BB }, area: 0 }
      : { polygons, boundingBox: { minX, minY, maxX, maxY }, area };
  } catch {
    core = null;
  }

  perZ.set(z, core);
  return core;
}

const NO_SECTION_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><text x="200" y="200" text-anchor="middle" fill="#666" font-size="14">No cross-section at this Z level</text></svg>';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function sliceAtZ(manifold: any, z: number): CrossSectionResult | null {
  const mod = getModule();
  if (!mod || !manifold) return null;

  const core = computeSliceCore(manifold, z);
  if (!core) return null;

  if (core.polygons.length === 0) {
    return { polygons: [], svg: NO_SECTION_SVG, boundingBox: { ...EMPTY_BB }, area: 0 };
  }

  return {
    polygons: core.polygons,
    svg: generateSVG(core.polygons, core.boundingBox, z),
    boundingBox: core.boundingBox,
    area: core.area,
  };
}

/** Lightweight cross-section metrics — area and contour count only, skipping the
 *  SVG string build. The per-run geometry-stats payload needs just these numbers
 *  for each quartile, so building a 400×400 SVG three times per run was pure
 *  waste. Shares the memoized slice core with `sliceAtZ`, so a later visual slice
 *  at the same height reuses this computation. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function sliceMetrics(manifold: any, z: number): { area: number; contours: number } | null {
  const mod = getModule();
  if (!mod || !manifold) return null;

  const core = computeSliceCore(manifold, z);
  if (!core) return null;
  return { area: core.area, contours: core.polygons.length };
}

function generateSVG(
  polygons: number[][][],
  bb: { minX: number; minY: number; maxX: number; maxY: number },
  z: number,
): string {
  const padding = 20;
  const size = 400;
  const contentSize = size - padding * 2;

  const rangeX = bb.maxX - bb.minX || 1;
  const rangeY = bb.maxY - bb.minY || 1;
  const scale = contentSize / Math.max(rangeX, rangeY);

  const offsetX = padding + (contentSize - rangeX * scale) / 2;
  const offsetY = padding + (contentSize - rangeY * scale) / 2;

  const paths = polygons.map(poly => {
    const d = poly
      .map((pt, i) => {
        const x = offsetX + (pt[0] - bb.minX) * scale;
        const y = size - (offsetY + (pt[1] - bb.minY) * scale);
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');
    return `<path d="${d} Z" fill="#dbeafe" stroke="#1d4ed8" stroke-width="1.5"/>`;
  }).join('\n    ');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <rect width="${size}" height="${size}" fill="#18181b"/>
  <g>
    ${paths}
  </g>
  <text x="${size - 10}" y="${size - 10}" text-anchor="end" fill="#71717a" font-size="11" font-family="monospace">Z = ${z.toFixed(2)}</text>
</svg>`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getBoundingBox(manifold: any): { min: [number, number, number]; max: [number, number, number] } | null {
  try {
    const bbox = manifold.boundingBox();
    return {
      min: [bbox.min[0], bbox.min[1], bbox.min[2]],
      max: [bbox.max[0], bbox.max[1], bbox.max[2]],
    };
  } catch {
    return null;
  }
}
