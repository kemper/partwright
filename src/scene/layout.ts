// Scene layout — deterministic instance placement.
//
// generateSceneGraph turns a SceneSpec into a SceneGraph: a list of placed
// instances (asset id + sampled params + position/rotation/scale) plus stats.
// It dispatches on layout.kind to a candidate-point generator, then walks the
// candidates in deterministic order doing zone clipping, weighted asset pick,
// per-instance param/scale/rotation sampling, and disc-overlap rejection
// (uniform-grid spatial hash for near-linear packing).
//
// Pure + dependency-free (vitest unit tier).

import type {
  AssetSpec,
  LayoutControl,
  SceneGraph,
  SceneInstance,
  SceneSpec,
  Vec2,
  Zone,
} from './types';
import { makeRng, type Rng } from './prng';
import { sampleParams, sampleScale, sampleRotation } from './sampling';

const DEFAULT_MAX_INSTANCES = 400;
// Hard ceiling on placed instances, independent of the requested maxInstances.
// Bounds the O(n^2) critique pass and the size of the Manifold.compose() the
// generated code builds, so a huge cap can't wedge the engine.
const HARD_MAX_INSTANCES = 5000;
// Cap on *candidate* points any generator materializes. Candidate arrays are
// built synchronously on the main thread before any WASM runs, so without this
// a pathological density/bounds (tiny spacing over huge bounds) would freeze or
// OOM the tab long before maxInstances (which only caps placement) applies.
const MAX_CANDIDATES = 50000;
// Cap on the Poisson background-grid allocation (gw*gh) to avoid a giant
// new Array() for tiny radii over huge bounds.
const MAX_POISSON_CELLS = 1_000_000;

/** Ray-casting point-in-polygon (even-odd rule). Points on the boundary are
 *  treated inclusively enough for placement use. */
export function pointInPolygon(point: Vec2, polygon: Vec2[]): boolean {
  if (polygon.length < 3) return false;
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersect = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Do two XY discs overlap? Centers a/b with radii ra/rb. */
export function discsOverlap(a: Vec2, ra: number, b: Vec2, rb: number): boolean {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const rr = ra + rb;
  return dx * dx + dy * dy < rr * rr;
}

/** Resample a polyline into points spaced `spacing` apart along its arc length.
 *  Always includes the first vertex; the last sample lands at or before the end. */
export function polylineResample(path: Vec2[], spacing: number): Vec2[] {
  if (path.length === 0 || spacing <= 0) return [];
  if (path.length === 1) return [[path[0][0], path[0][1]]];
  const out: Vec2[] = [[path[0][0], path[0][1]]];
  let carry = 0; // distance accumulated past the last emitted sample
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const segLen = Math.hypot(dx, dy);
    if (segLen === 0) continue;
    const ux = dx / segLen;
    const uy = dy / segLen;
    let dist = spacing - carry; // distance from segment start to next sample
    while (dist <= segLen) {
      out.push([a[0] + ux * dist, a[1] + uy * dist]);
      dist += spacing;
    }
    carry = segLen - (dist - spacing);
  }
  return out;
}

// ---- candidate-point generators ---------------------------------------------

function spacingFromDensity(layout: LayoutControl): number {
  if (layout.spacing !== undefined && layout.spacing > 0) return layout.spacing;
  // density = instances per unit area => spacing = 1/sqrt(density).
  const d = layout.density > 0 ? layout.density : 0.01;
  return 1 / Math.sqrt(d);
}

function gridPoints(layout: LayoutControl): Vec2[] {
  const { min, max } = layout.bounds;
  const step = spacingFromDensity(layout);
  const out: Vec2[] = [];
  for (let y = min[1] + step / 2; y <= max[1] && out.length < MAX_CANDIDATES; y += step) {
    for (let x = min[0] + step / 2; x <= max[0] && out.length < MAX_CANDIDATES; x += step) {
      out.push([x, y]);
    }
  }
  return out;
}

function jitteredGridPoints(layout: LayoutControl, rng: Rng): Vec2[] {
  const { min, max } = layout.bounds;
  const step = spacingFromDensity(layout);
  const jitter = (layout.jitter ?? 0.5) * step;
  const out: Vec2[] = [];
  for (let y = min[1] + step / 2; y <= max[1] && out.length < MAX_CANDIDATES; y += step) {
    for (let x = min[0] + step / 2; x <= max[0] && out.length < MAX_CANDIDATES; x += step) {
      const jx = x + rng.range(-jitter / 2, jitter / 2);
      const jy = y + rng.range(-jitter / 2, jitter / 2);
      out.push([clamp(jx, min[0], max[0]), clamp(jy, min[1], max[1])]);
    }
  }
  return out;
}

/** Bridson Poisson-disk sampling within the bounds; min sample distance = radius. */
function poissonDiskPoints(layout: LayoutControl, rng: Rng, radius: number): Vec2[] {
  const { min, max } = layout.bounds;
  const w = max[0] - min[0];
  const h = max[1] - min[1];
  if (w <= 0 || h <= 0 || radius <= 0) return [];
  let cell = radius / Math.SQRT2;
  // Enlarge the cell if the background grid would allocate too many buckets
  // (tiny radius over huge bounds). The neighbor search below uses a reach
  // derived from radius/cell, so widening the cell stays correct.
  if (w * h / (cell * cell) > MAX_POISSON_CELLS) {
    cell = Math.sqrt((w * h) / MAX_POISSON_CELLS);
  }
  const gw = Math.max(1, Math.ceil(w / cell));
  const gh = Math.max(1, Math.ceil(h / cell));
  const reach = Math.max(2, Math.ceil(radius / cell) + 1);
  const grid: Array<Vec2 | null> = new Array(gw * gh).fill(null);
  const samples: Vec2[] = [];
  const active: Vec2[] = [];
  const k = 30;

  const gridIndex = (p: Vec2) => {
    const cx = Math.min(gw - 1, Math.floor((p[0] - min[0]) / cell));
    const cy = Math.min(gh - 1, Math.floor((p[1] - min[1]) / cell));
    return cy * gw + cx;
  };
  const fits = (p: Vec2): boolean => {
    if (p[0] < min[0] || p[0] > max[0] || p[1] < min[1] || p[1] > max[1]) return false;
    const cx = Math.min(gw - 1, Math.floor((p[0] - min[0]) / cell));
    const cy = Math.min(gh - 1, Math.floor((p[1] - min[1]) / cell));
    for (let yy = Math.max(0, cy - reach); yy <= Math.min(gh - 1, cy + reach); yy++) {
      for (let xx = Math.max(0, cx - reach); xx <= Math.min(gw - 1, cx + reach); xx++) {
        const s = grid[yy * gw + xx];
        if (s) {
          const dx = s[0] - p[0];
          const dy = s[1] - p[1];
          if (dx * dx + dy * dy < radius * radius) return false;
        }
      }
    }
    return true;
  };

  const first: Vec2 = [min[0] + rng.next() * w, min[1] + rng.next() * h];
  samples.push(first);
  active.push(first);
  grid[gridIndex(first)] = first;

  while (active.length > 0 && samples.length < MAX_CANDIDATES) {
    const idx = rng.int(0, active.length - 1);
    const origin = active[idx];
    let found = false;
    for (let i = 0; i < k; i++) {
      const ang = rng.next() * 2 * Math.PI;
      const rad = radius * (1 + rng.next());
      const cand: Vec2 = [origin[0] + Math.cos(ang) * rad, origin[1] + Math.sin(ang) * rad];
      if (fits(cand)) {
        samples.push(cand);
        active.push(cand);
        grid[gridIndex(cand)] = cand;
        found = true;
        break;
      }
    }
    if (!found) {
      active.splice(idx, 1);
    }
  }
  return samples;
}

function clusteredPoints(layout: LayoutControl, rng: Rng): Vec2[] {
  const { min, max } = layout.bounds;
  const w = max[0] - min[0];
  const h = max[1] - min[1];
  const clusters = Math.max(1, Math.floor(layout.clusters ?? 4));
  const spread = layout.clusterSpread ?? Math.min(w, h) / 8;
  const area = Math.max(1e-6, w * h);
  const target = Math.min(MAX_CANDIDATES, Math.max(clusters, Math.round(layout.density * area)));
  const perCluster = Math.max(1, Math.ceil(target / clusters));
  const centers: Vec2[] = [];
  for (let c = 0; c < clusters; c++) {
    centers.push([min[0] + rng.next() * w, min[1] + rng.next() * h]);
  }
  const out: Vec2[] = [];
  for (const center of centers) {
    for (let i = 0; i < perCluster; i++) {
      const x = clamp(rng.gaussian(center[0], spread), min[0], max[0]);
      const y = clamp(rng.gaussian(center[1], spread), min[1], max[1]);
      out.push([x, y]);
    }
  }
  return out;
}

function alongPathPoints(layout: LayoutControl): Vec2[] {
  const path = layout.path ?? [];
  let spacing = layout.pathSpacing && layout.pathSpacing > 0
    ? layout.pathSpacing
    : spacingFromDensity(layout);
  // Bound the sample count: enlarge spacing if a tiny step over a long path
  // would emit more than MAX_CANDIDATES points.
  let totalLen = 0;
  for (let i = 1; i < path.length; i++) {
    totalLen += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  }
  if (spacing > 0 && totalLen / spacing > MAX_CANDIDATES) {
    spacing = totalLen / MAX_CANDIDATES;
  }
  return polylineResample(path, spacing);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// ---- spatial hash for overlap rejection -------------------------------------

interface Placed {
  pos: Vec2;
  radius: number;
}

class SpatialHash {
  private cells = new Map<string, Placed[]>();
  private cell: number;
  private maxRadius = 0;
  constructor(cell: number) {
    this.cell = cell > 0 ? cell : 1;
  }
  private key(cx: number, cy: number): string {
    return cx + ',' + cy;
  }
  insert(p: Placed): void {
    const cx = Math.floor(p.pos[0] / this.cell);
    const cy = Math.floor(p.pos[1] / this.cell);
    const key = this.key(cx, cy);
    let bucket = this.cells.get(key);
    if (!bucket) {
      bucket = [];
      this.cells.set(key, bucket);
    }
    bucket.push(p);
  }
  /** True if `cand` (with radius `r`) overlaps any inserted disc. `maxRadius`
   *  bounds the neighbor search to ±reach cells. */
  overlaps(cand: Vec2, r: number): boolean {
    const reach = Math.ceil((r + this.maxRadius) / this.cell) + 1;
    const cx = Math.floor(cand[0] / this.cell);
    const cy = Math.floor(cand[1] / this.cell);
    for (let yy = cy - reach; yy <= cy + reach; yy++) {
      for (let xx = cx - reach; xx <= cx + reach; xx++) {
        const bucket = this.cells.get(this.key(xx, yy));
        if (!bucket) continue;
        for (const p of bucket) {
          if (discsOverlap(cand, r, p.pos, p.radius)) return true;
        }
      }
    }
    return false;
  }
  noteRadius(r: number): void {
    if (r > this.maxRadius) this.maxRadius = r;
  }
}

// ---- main entry -------------------------------------------------------------

function maxFootprint(assets: AssetSpec[]): number {
  let m = 0;
  for (const a of assets) if (a.footprintRadius > m) m = a.footprintRadius;
  return m;
}

/** Pick the asset for a candidate position, honoring zone-local weights when the
 *  candidate falls inside a zone that declares assetWeights. */
function pickAsset(assets: AssetSpec[], zone: Zone | null, rng: Rng): AssetSpec {
  const weights = zone?.assetWeights;
  if (weights) {
    const w = assets.map(a => (typeof weights[a.id] === 'number' ? Math.max(0, weights[a.id]) : 0));
    if (w.some(x => x > 0)) return rng.pick(assets, w);
  }
  return rng.pick(assets);
}

/** Find the first zone whose polygon contains the point. Returns the zone (for
 *  weighting) and whether the point passed polygon clipping. When no zone
 *  declares a polygon, clipping always passes and the first zone (if any) with
 *  weights is used as a global bias. */
function resolveZone(
  point: Vec2,
  zones: Zone[] | undefined,
): { zone: Zone | null; clipped: boolean } {
  if (!zones || zones.length === 0) return { zone: null, clipped: false };
  const withPolys = zones.filter(z => z.polygon && z.polygon.length >= 3);
  if (withPolys.length === 0) {
    // No polygons — zones are global weight overrides; use the first one.
    return { zone: zones[0] ?? null, clipped: false };
  }
  for (const z of withPolys) {
    if (pointInPolygon(point, z.polygon!)) return { zone: z, clipped: false };
  }
  return { zone: null, clipped: true };
}

export function generateSceneGraph(spec: SceneSpec): SceneGraph {
  const { layout, assets } = spec;
  const rng = makeRng(spec.seed);
  const maxInstances = Math.min(
    HARD_MAX_INSTANCES,
    spec.maxInstances && spec.maxInstances > 0
      ? Math.floor(spec.maxInstances)
      : DEFAULT_MAX_INSTANCES,
  );
  const minClearance = layout.minClearance ?? 0;
  const maxFoot = maxFootprint(assets);

  // Candidate points (deterministic order per kind).
  let candidates: Vec2[];
  switch (layout.kind) {
    case 'grid':
      candidates = gridPoints(layout);
      break;
    case 'jittered-grid':
      candidates = jitteredGridPoints(layout, rng);
      break;
    case 'poisson-disk': {
      const radius = 2 * maxFoot + minClearance;
      candidates = poissonDiskPoints(layout, rng, radius > 0 ? radius : 1);
      break;
    }
    case 'clustered':
      candidates = clusteredPoints(layout, rng);
      break;
    case 'along-path':
      candidates = alongPathPoints(layout);
      break;
    default:
      candidates = [];
  }

  const cellSize = Math.max(maxFoot * 2 + minClearance, 1);
  const hash = new SpatialHash(cellSize);
  const instances: SceneInstance[] = [];
  let rejectedOverlap = 0;
  const requested = candidates.length;

  for (const cand of candidates) {
    if (instances.length >= maxInstances) break;

    const { zone, clipped } = resolveZone(cand, layout.zones);
    if (clipped) continue;

    const asset = pickAsset(assets, zone, rng);
    // Sample params / transform in a fixed order so the stream stays
    // deterministic regardless of placement outcome.
    const paramValues = sampleParams(asset, rng);
    const scale = sampleScale(layout, rng);
    const rotationZ = sampleRotation(layout, rng);

    const effRadius = asset.footprintRadius * scale + minClearance;
    if (hash.overlaps(cand, effRadius)) {
      rejectedOverlap++;
      continue;
    }
    hash.noteRadius(effRadius);
    hash.insert({ pos: cand, radius: effRadius });
    instances.push({
      assetId: asset.id,
      paramValues,
      position: [cand[0], cand[1]],
      rotationZ,
      scale,
      footprintRadius: asset.footprintRadius,
    });
  }

  return {
    seed: spec.seed,
    instances,
    stats: {
      requested,
      placed: instances.length,
      rejectedOverlap,
      bounds: { min: [layout.bounds.min[0], layout.bounds.min[1]], max: [layout.bounds.max[0], layout.bounds.max[1]] },
    },
  };
}
