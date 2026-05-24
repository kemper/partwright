// Local mesh subdivision for the smooth paintbrush.
//
// The blocky brush paints whole triangles, so a stroke's edge follows the
// existing tessellation. The smooth brush instead subdivides the triangles the
// brush boundary crosses (only those — never the deep interior or exterior), so
// the painted region's edge can follow the brush outline closely. Subdivision
// refines just those rim triangles 1→4 until they're below a target edge
// length; coarse neighbours are left as-is, which leaves zero-width T-junctions
// where the fine band meets the coarse interior. That keeps the result lean and
// fast (the painted band is not strictly 2-manifold — fine for rendering colours
// and most slicers; see the smooth-brush notes).
//
// Nothing here mutates the input mesh. The base (authored-code) mesh is always
// kept pristine; the refined mesh is rebuilt from base + stroke descriptors so
// it reconstructs deterministically when a saved version is reloaded.

import type { MeshData } from '../geometry/types';
import { closestPointOnTriangle } from './adjacency';

export type BrushShape = 'circle' | 'square' | 'diamond';

export interface BrushStroke {
  /** World-space surface points sampled along the stroke. */
  samples: [number, number, number][];
  /** Brush radius in mesh units. */
  radius: number;
  shape: BrushShape;
  /** Target triangle edge length near the stroke boundary, in mesh units.
   *  Triangles the brush edge crosses are refined until their edges fall below
   *  this — so the painted outline is smooth regardless of how coarse the base
   *  mesh is. Smaller = smoother + more triangles. */
  maxEdge: number;
}

export interface Aabb {
  min: [number, number, number];
  max: [number, number, number];
}

export type TriClass = 'inside' | 'outside' | 'straddle';

/** Classify a triangle (given its three world-space vertex coords) against a
 *  paint region: fully inside, fully outside, or straddling the boundary.
 *  Only `straddle` triangles get subdivided. A classifier must never report
 *  `outside` for a triangle the region actually crosses (a missed straddle
 *  leaves a coarse, blocky edge there) — reporting `straddle` for a triangle
 *  that turns out to be just outside is harmless (a few extra triangles). */
export type TriClassifier = (a: number[], b: number[], c: number[]) => TriClass;

/** A region to refine the mesh around: its boundary classifier, the target edge
 *  length near that boundary, and an optional AABB for cheap spatial rejection.
 *  Brush strokes, slabs, and oriented shapes all reduce to one of these. */
export interface RefineRegion {
  aabb: Aabb | null;
  maxEdge: number;
  classify: TriClassifier;
  /** When true, refine the FULL interior (every `inside` triangle), not just the
   *  rim the boundary straddles. The airbrush needs fine triangles throughout
   *  its footprint so its stochastic speckle reads as fine dots; brush / slab /
   *  shape leave this off (rim-only) because their interior paints solid. */
  fill?: boolean;
  /** Optional hard triangle budget for a `fill` region. Checked before each pass
   *  (in buildRefinedMesh): a pass that would cross it is skipped, so the mesh
   *  never exceeds the budget. Only `fill` regions set it — filling an area is
   *  quadratic in 1/maxEdge, so without it a fine airbrush could explode the
   *  mesh; rim refinement is boundary-bounded and needs none. */
  maxTriangles?: number;
}

/** Per-stroke depth bound so a single stroke can't run away (each pass ~doubles
 *  the boundary triangle count). There is deliberately NO cumulative triangle
 *  cap — the mesh may grow across many strokes; the UI surfaces a high-complexity
 *  warning and a live triangle count instead of silently degrading quality. */
const MAX_PASSES = 16;

/** Hard triangle budget for a single `fill` (airbrush) refine region, enforced
 *  as a pre-pass check so a stroke can never exceed it. Even though the airbrush
 *  now subdivides only its feathered edge band, a wide, very-fine spray could
 *  still add a lot; this keeps a single click bounded and responsive (the
 *  rim-only brush/slab/shape paths are naturally bounded and uncapped). */
const AIRBRUSH_MAX_FILL_TRIANGLES = 100_000;
/** Absolute safety ceiling on the refined triangle count. Normal painting stays
 *  far below this (the UI surfaces a high-complexity warning around 1M). It is
 *  NOT a quality cap on legitimate multi-stroke growth — it's an OOM guard so a
 *  single pathological region (e.g. a brush stroke handed a tiny absolute
 *  `maxEdge`) can't subdivide until the tab runs out of memory. When a pass
 *  would cross it, we stop refining and accept a coarser-than-requested edge
 *  rather than freeze. */
const MAX_REFINED_TRIANGLES = 5_000_000;

/** True when `p` is within the brush footprint of any of the stroke's samples,
 *  using the shape's distance metric (circle = Euclidean, square = Chebyshev,
 *  diamond = L1). */
function withinFootprint(
  px: number, py: number, pz: number,
  stroke: BrushStroke,
): boolean {
  const { samples, radius, shape } = stroke;
  const r = radius;
  for (let i = 0; i < samples.length; i++) {
    const dx = px - samples[i][0];
    const dy = py - samples[i][1];
    const dz = pz - samples[i][2];
    if (shape === 'square') {
      if (Math.abs(dx) <= r && Math.abs(dy) <= r && Math.abs(dz) <= r) return true;
    } else if (shape === 'diamond') {
      if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) <= r) return true;
    } else {
      if (dx * dx + dy * dy + dz * dz <= r * r) return true;
    }
  }
  return false;
}

function triVertex(mesh: MeshData, vi: number): [number, number, number] {
  const p = mesh.numProp;
  return [mesh.vertProperties[vi * p], mesh.vertProperties[vi * p + 1], mesh.vertProperties[vi * p + 2]];
}

/** Axis-aligned bounds of a stroke's footprint (samples expanded by radius).
 *  Used to cheaply reject the (usually vast majority of) triangles nowhere near
 *  the stroke before the per-triangle footprint math — the difference between
 *  O(whole mesh) and O(triangles under the brush) on an accumulated mesh. */
function strokeAabb(stroke: BrushStroke): { min: [number, number, number]; max: [number, number, number] } {
  const r = stroke.radius;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const s of stroke.samples) {
    for (let k = 0; k < 3; k++) {
      if (s[k] - r < min[k]) min[k] = s[k] - r;
      if (s[k] + r > max[k]) max[k] = s[k] + r;
    }
  }
  return { min, max };
}

/** True when triangle (a,b,c) is entirely outside the stroke's AABB. */
function triOutsideAabb(a: number[], b: number[], c: number[], box: { min: [number, number, number]; max: [number, number, number] }): boolean {
  for (let k = 0; k < 3; k++) {
    if (a[k] < box.min[k] && b[k] < box.min[k] && c[k] < box.min[k]) return true;
    if (a[k] > box.max[k] && b[k] > box.max[k] && c[k] > box.max[k]) return true;
  }
  return false;
}

/** Longest squared edge of a triangle's three vertices. */
function maxEdgeLen2(a: number[], b: number[], c: number[]): number {
  const e = (p: number[], q: number[]): number => {
    const dx = p[0] - q[0], dy = p[1] - q[1], dz = p[2] - q[2];
    return dx * dx + dy * dy + dz * dz;
  };
  return Math.max(e(a, b), e(b, c), e(c, a));
}

/** Classify a triangle against a brush footprint: inside when all three
 *  vertices are covered, straddle when some (but not all) are — or, for a brush
 *  smaller than the face, when the footprint's closest point on the triangle is
 *  within the radius (so a small brush in the middle of a big face still
 *  tessellates). */
function brushClassifier(stroke: BrushStroke): TriClassifier {
  const r2 = stroke.radius * stroke.radius;
  return (a, b, c) => {
    let inside = 0;
    if (withinFootprint(a[0], a[1], a[2], stroke)) inside++;
    if (withinFootprint(b[0], b[1], b[2], stroke)) inside++;
    if (withinFootprint(c[0], c[1], c[2], stroke)) inside++;
    if (inside === 3) return 'inside';
    if (inside >= 1) return 'straddle';
    for (let s = 0; s < stroke.samples.length; s++) {
      const sp = stroke.samples[s];
      const cp = closestPointOnTriangle(
        sp[0], sp[1], sp[2],
        a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2],
      );
      const dx = cp[0] - sp[0], dy = cp[1] - sp[1], dz = cp[2] - sp[2];
      if (dx * dx + dy * dy + dz * dz <= r2) return 'straddle';
    }
    return 'outside';
  };
}

/** Build a refine region for a brush stroke (its footprint classifier, AABB,
 *  and target edge length). */
export function brushRefineRegion(stroke: BrushStroke): RefineRegion {
  const maxEdge = stroke.maxEdge > 0 ? stroke.maxEdge : stroke.radius / 256;
  return { aabb: strokeAabb(stroke), maxEdge, classify: brushClassifier(stroke) };
}

/** Squared distance from a point to its nearest stroke sample. */
function nearestSampleDist2(px: number, py: number, pz: number, samples: [number, number, number][]): number {
  let best = Infinity;
  for (let i = 0; i < samples.length; i++) {
    const dx = px - samples[i][0], dy = py - samples[i][1], dz = pz - samples[i][2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < best) best = d2;
  }
  return best;
}

/** Classify a triangle for the airbrush refine. Two phases keep subdivision
 *  blob-local: a triangle bigger than a droplet that overlaps the footprint is
 *  split down toward droplet scale; once at droplet scale, only triangles that
 *  cross a droplet EDGE are refined further (to round it), while gaps between
 *  droplets and the fully-covered interior are left coarse. The solid core
 *  (inside `innerR`) and everything outside the footprint are never touched. */
function airbrushDropletClassifier(
  samples: [number, number, number][],
  innerR: number,
  outerR: number,
  dabR: number,
  strength: number,
  softness: number,
  seed: number,
): TriClassifier {
  const inner2 = innerR * innerR;
  const outer2 = outerR * outerR;
  const dab2 = dabR * dabR;
  const g = dabR;
  // Is the point inside any kept droplet? Same lattice + falloff test the
  // resolver uses, so refine and paint agree on where droplets are.
  const inDroplet = (x: number, y: number, z: number): boolean => {
    const gi = Math.round(x / g), gj = Math.round(y / g), gk = Math.round(z / g);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (let dk = -1; dk <= 1; dk++) {
      const ix = gi + di, iy = gj + dj, iz = gk + dk;
      const px = ix * g, py = iy * g, pz = iz * g;
      const ddx = x - px, ddy = y - py, ddz = z - pz;
      if (ddx * ddx + ddy * ddy + ddz * ddz > dab2) continue;
      const dn2 = nearestSampleDist2(px, py, pz, samples);
      if (dn2 > outer2) continue;
      const cov = airbrushProbability(Math.sqrt(dn2) / outerR, strength, softness);
      if (cov >= 1 || (cov > 0 && cellHash(ix, iy, iz, seed) < cov)) return true;
    }
    return false;
  };
  return (a, b, c) => {
    const da = nearestSampleDist2(a[0], a[1], a[2], samples);
    const db = nearestSampleDist2(b[0], b[1], b[2], samples);
    const dc = nearestSampleDist2(c[0], c[1], c[2], samples);
    // Solid core (all inside innerR) → leave coarse; the resolver paints it solid.
    if (inner2 > 0 && da < inner2 && db < inner2 && dc < inner2) return 'outside';
    // Entirely beyond the footprint → leave coarse, unless the spray still grazes
    // a triangle bigger than itself (a small spray inside one big face).
    if (da > outer2 && db > outer2 && dc > outer2) {
      let grazes = false;
      for (let s = 0; s < samples.length; s++) {
        const sp = samples[s];
        const cp = closestPointOnTriangle(sp[0], sp[1], sp[2], a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
        const dx = cp[0] - sp[0], dy = cp[1] - sp[1], dz = cp[2] - sp[2];
        if (dx * dx + dy * dy + dz * dz <= outer2) { grazes = true; break; }
      }
      if (!grazes) return 'outside';
    }
    // Coarse phase: still bigger than a droplet → split toward droplet scale.
    if (maxEdgeLen2(a, b, c) > dab2) return 'straddle';
    // Fine phase: refine only droplet edges; leave gaps + covered interior coarse.
    const va = inDroplet(a[0], a[1], a[2]);
    const vb = inDroplet(b[0], b[1], b[2]);
    const vc = inDroplet(c[0], c[1], c[2]);
    if (va && vb && vc) return 'inside';
    if (va || vb || vc) return 'straddle';
    return 'outside';
  };
}

/** Build a refine region for an airbrush footprint. Subdivision is blob-local:
 *  the dense core paints as whole coarse triangles, and around the scattered
 *  droplets only the droplet EDGES are refined (to a third of a droplet, so each
 *  circle is smooth) — gaps between droplets stay medium and the area outside the
 *  footprint stays coarse. `strength` below 1 has no fully-solid core (innerR 0).
 *  The triangle budget is the backstop. */
export function airbrushRefineRegion(
  samples: [number, number, number][],
  radius: number,
  dabRadius: number,
  strength: number,
  softness: number,
  seed: number,
): RefineRegion {
  const dab = dabRadius > 0 ? dabRadius : radius / 12;
  const roundEdge = dab / 3;
  // The core paints solid only when coverage reaches 1 (strength >= 1); below
  // that every droplet may have gaps, so there is no fully-solid core to skip.
  const innerR = strength >= 1 ? Math.max(0, 1 - softness) * radius : 0;
  const stroke: BrushStroke = { samples, radius, shape: 'circle', maxEdge: roundEdge };
  return {
    aabb: strokeAabb(stroke),
    maxEdge: roundEdge,
    classify: airbrushDropletClassifier(samples, innerR, radius, dab, strength, softness, seed | 0),
    maxTriangles: AIRBRUSH_MAX_FILL_TRIANGLES,
  };
}

/** Triangles worth subdividing for a region: those it straddles (the rim) and,
 *  for a `fill` region, those fully inside it too — both only while still coarser
 *  than `region.maxEdge`. Fully-outside triangles never paint; rim-only regions
 *  leave their solid interior coarse; already-fine triangles are the stopping
 *  condition. */
function selectByClassify(mesh: MeshData, region: RefineRegion): Set<number> {
  const { triVerts, numTri } = mesh;
  const selected = new Set<number>();
  const maxEdge2 = region.maxEdge * region.maxEdge;
  const box = region.aabb;

  for (let t = 0; t < numTri; t++) {
    const a = triVertex(mesh, triVerts[t * 3]);
    const b = triVertex(mesh, triVerts[t * 3 + 1]);
    const c = triVertex(mesh, triVerts[t * 3 + 2]);

    // Cheap spatial reject: skip triangles nowhere near the region.
    if (box && triOutsideAabb(a, b, c, box)) continue;

    // Already fine enough → leave it (keeps the refined band tight and bounded).
    if (maxEdgeLen2(a, b, c) <= maxEdge2) continue;

    const cls = region.classify(a, b, c);
    if (cls === 'straddle' || (cls === 'inside' && region.fill)) selected.add(t);
  }
  return selected;
}

/** Triangles whose centroid falls within the stroke footprint — the set that
 *  receives the stroke's colour. Run against the refined mesh so the painted
 *  area hugs the brush outline. */
export function strokeFootprintTriangles(mesh: MeshData, stroke: BrushStroke): Set<number> {
  const { triVerts, numTri, vertProperties, numProp } = mesh;
  const out = new Set<number>();
  const box = strokeAabb(stroke);
  for (let t = 0; t < numTri; t++) {
    const v0 = triVerts[t * 3], v1 = triVerts[t * 3 + 1], v2 = triVerts[t * 3 + 2];
    const ax = vertProperties[v0 * numProp], ay = vertProperties[v0 * numProp + 1], az = vertProperties[v0 * numProp + 2];
    const bx = vertProperties[v1 * numProp], by = vertProperties[v1 * numProp + 1], bz = vertProperties[v1 * numProp + 2];
    const cx2 = vertProperties[v2 * numProp], cy2 = vertProperties[v2 * numProp + 1], cz2 = vertProperties[v2 * numProp + 2];
    if (triOutsideAabb([ax, ay, az], [bx, by, bz], [cx2, cy2, cz2], box)) continue;
    const cx = (ax + bx + cx2) / 3, cy = (ay + by + cy2) / 3, cz = (az + bz + cz2) / 3;
    if (withinFootprint(cx, cy, cz, stroke)) out.add(t);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Airbrush — a solid core ringed by round droplets that thin to a soft edge.
//
// No alpha or colour blending is ever used: every triangle is painted fully or
// not at all, so each one stays a single printable colour. The dense core paints
// solid; beyond it the spray is a scatter of round DROPLETS (circles of radius
// `dabR`) on a world-space lattice, each point kept with a falloff probability so
// they pack solid near the core and thin to isolated dots at the rim. Keyed by a
// stored seed + the world lattice, so the speckle is deterministic: it
// reproduces across reloads and re-subdivision.
// ---------------------------------------------------------------------------

export interface AirbrushStroke {
  /** World-space surface points sampled along the stroke. */
  samples: [number, number, number][];
  /** Brush radius in mesh units. */
  radius: number;
  /** Paint density through the core, 0..1. Lower = a lighter dusting. */
  strength: number;
  /** Fraction of the radius that fades out (the feathered rim), 0..1.
   *  0 = hard-edged disc; 1 = fades all the way from the centre. */
  softness: number;
  /** Stable per-stroke seed so the speckle reproduces across reloads but
   *  differs between strokes. */
  seed: number;
  /** Droplet radius in mesh units (also the lattice spacing), stored in the
   *  descriptor's `maxEdge` slot. The refine target is a third of this so each
   *  droplet renders as a smooth circle. */
  maxEdge: number;
}

/** Droplet keep-probability at normalized distance `dn` (0 at centre, 1 at the
 *  rim): a `strength`-dense core, then a linear fade to 0 across the outer
 *  `softness` fraction of the radius. Each lattice point becomes a droplet with
 *  this probability, so droplets pack solid in the core and thin out at the rim. */
export function airbrushProbability(dn: number, strength: number, softness: number): number {
  if (dn >= 1) return 0;
  if (dn < 0) dn = 0;
  const core = 1 - softness;          // softness 0 → core 1 → hard disc
  if (dn <= core) return strength;
  const u = (dn - core) / (1 - core); // 0..1 across the feather band
  return strength * (1 - u);
}

/** Deterministic hash of an integer grid cell + seed → [0, 1). */
function cellHash(qx: number, qy: number, qz: number, seed: number): number {
  let h = (seed | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (qx | 0), 0x85ebca6b);
  h = Math.imul(h ^ (qy | 0), 0xc2b2ae35);
  h = Math.imul(h ^ (qz | 0), 0x27d4eb2f);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Triangles the airbrush paints. The dense core (coverage 1) paints solid;
 *  beyond it the spray is a scatter of round DROPLETS — circles of radius `dabR`
 *  centred on a world-space lattice (spacing `dabR`), each lattice point kept
 *  with the falloff probability. A triangle is painted when its centroid is in
 *  the solid core or inside any kept droplet. Deterministic from the seed + the
 *  world lattice, so it reproduces across reloads and re-subdivision. */
export function airbrushFootprintTriangles(mesh: MeshData, stroke: AirbrushStroke): Set<number> {
  const { triVerts, numTri, vertProperties, numProp } = mesh;
  const out = new Set<number>();
  const r = stroke.radius;
  if (r <= 0 || stroke.samples.length === 0) return out;
  const r2 = r * r;
  const strength = Math.max(0, Math.min(1, stroke.strength));
  const softness = Math.max(0, Math.min(1, stroke.softness));
  const dabR = stroke.maxEdge > 0 ? stroke.maxEdge : r / 12;
  const g = dabR;                 // lattice spacing == droplet radius → packs solid when dense
  const dab2 = dabR * dabR;
  const innerR = strength >= 1 ? Math.max(0, 1 - softness) * r : 0;
  const innerR2 = innerR * innerR;
  const seed = stroke.seed | 0;
  const samples = stroke.samples;
  const box = strokeAabb({ samples, radius: r, shape: 'circle', maxEdge: dabR });

  // Is lattice point (ix,iy,iz) a kept droplet centre? Cached — each point is
  // tested by up to 27 surrounding triangles.
  const keptCache = new Map<string, boolean>();
  const isDroplet = (ix: number, iy: number, iz: number): boolean => {
    const key = ix + ',' + iy + ',' + iz;
    const cached = keptCache.get(key);
    if (cached !== undefined) return cached;
    const dn2 = nearestSampleDist2(ix * g, iy * g, iz * g, samples);
    let kept = false;
    if (dn2 <= r2) {
      const cov = airbrushProbability(Math.sqrt(dn2) / r, strength, softness);
      kept = cov >= 1 ? true : (cov > 0 && cellHash(ix, iy, iz, seed) < cov);
    }
    keptCache.set(key, kept);
    return kept;
  };

  for (let t = 0; t < numTri; t++) {
    const v0 = triVerts[t * 3], v1 = triVerts[t * 3 + 1], v2 = triVerts[t * 3 + 2];
    const ax = vertProperties[v0 * numProp], ay = vertProperties[v0 * numProp + 1], az = vertProperties[v0 * numProp + 2];
    const bx = vertProperties[v1 * numProp], by = vertProperties[v1 * numProp + 1], bz = vertProperties[v1 * numProp + 2];
    const cx2 = vertProperties[v2 * numProp], cy2 = vertProperties[v2 * numProp + 1], cz2 = vertProperties[v2 * numProp + 2];
    if (triOutsideAabb([ax, ay, az], [bx, by, bz], [cx2, cy2, cz2], box)) continue;
    const cx = (ax + bx + cx2) / 3, cy = (ay + by + cy2) / 3, cz = (az + bz + cz2) / 3;

    const dn2 = nearestSampleDist2(cx, cy, cz, samples);
    if (dn2 > r2) continue;
    if (dn2 <= innerR2) { out.add(t); continue; }      // solid core

    // Droplet test: any kept lattice point within dabR of the centroid (a point
    // within dabR == g of the centroid is in the 3×3×3 cell neighbourhood).
    const gi = Math.round(cx / g), gj = Math.round(cy / g), gk = Math.round(cz / g);
    let painted = false;
    for (let di = -1; di <= 1 && !painted; di++) {
      for (let dj = -1; dj <= 1 && !painted; dj++) {
        for (let dk = -1; dk <= 1 && !painted; dk++) {
          const ix = gi + di, iy = gj + dj, iz = gk + dk;
          const ddx = cx - ix * g, ddy = cy - iy * g, ddz = cz - iz * g;
          if (ddx * ddx + ddy * ddy + ddz * ddz <= dab2 && isDroplet(ix, iy, iz)) painted = true;
        }
      }
    }
    if (painted) out.add(t);
  }
  return out;
}

/** One refinement pass that splits ONLY the `selected` (rim) triangles 1→4,
 *  leaving every other triangle untouched. Edge midpoints are shared between
 *  adjacent selected triangles (watertight within the refined band), but where a
 *  selected triangle meets an unselected one the shared edge is split on the
 *  selected side only — a zero-width T-junction. That's deliberate: it keeps the
 *  disc interior coarse (just the rim is fine), which is ~10x leaner than a
 *  crack-free graded refinement. The seams are invisible when rendering colours
 *  and fine for GLB / most slicers, though the painted band is not strictly
 *  2-manifold (see the smooth-brush notes).
 *
 *  Returns the new mesh plus `childToParent`: for each output triangle, the
 *  index of the input triangle it came from (so callers can carry per-triangle
 *  data — e.g. existing colour regions — across the split). */
function subdivideSelected(
  mesh: MeshData,
  selected: Set<number>,
): { mesh: MeshData; childToParent: Int32Array } {
  const { vertProperties, triVerts, numVert, numTri, numProp } = mesh;
  const P = numProp;

  // Numeric key for an undirected edge. numVert is the multiplier and stays
  // fixed within a pass; products stay well under Number.MAX_SAFE_INTEGER for
  // any realistic mesh.
  const key = (a: number, b: number): number => (a < b ? a * numVert + b : b * numVert + a);

  // Shared midpoint vertex per split edge (lazily) — adjacent rim triangles
  // reuse midpoints so the band itself stays watertight.
  const midIndex = new Map<number, number>();
  const newVertProps: number[] = [];
  let nextV = numVert;
  const midOf = (a: number, b: number): number => {
    const k = key(a, b);
    const existing = midIndex.get(k);
    if (existing !== undefined) return existing;
    const m = nextV++;
    midIndex.set(k, m);
    for (let p = 0; p < P; p++) {
      newVertProps.push((vertProperties[a * P + p] + vertProperties[b * P + p]) / 2);
    }
    return m;
  };

  const outTris: number[] = [];
  const childParent: number[] = [];
  const emit = (a: number, b: number, c: number, parent: number): void => {
    outTris.push(a, b, c);
    childParent.push(parent);
  };

  for (let t = 0; t < numTri; t++) {
    const v0 = triVerts[t * 3], v1 = triVerts[t * 3 + 1], v2 = triVerts[t * 3 + 2];
    if (!selected.has(t)) { emit(v0, v1, v2, t); continue; }
    const m0 = midOf(v0, v1), m1 = midOf(v1, v2), m2 = midOf(v2, v0);
    emit(v0, m0, m2, t); emit(m0, v1, m1, t); emit(m2, m1, v2, t); emit(m0, m1, m2, t);
  }

  const totalVert = numVert + newVertProps.length / P;
  const vp = new Float32Array(totalVert * P);
  vp.set(vertProperties.subarray(0, numVert * P), 0);
  vp.set(newVertProps, numVert * P);

  const tv = new Uint32Array(outTris);
  const newMesh: MeshData = {
    vertProperties: vp,
    triVerts: tv,
    numVert: totalVert,
    numTri: outTris.length / 3,
    numProp: P,
    // Provenance/merge arrays describe the base tessellation and no longer
    // apply once triangles are split; drop them.
  };
  return { mesh: newMesh, childToParent: Int32Array.from(childParent) };
}

/** Rebuild a refined mesh from a pristine base mesh and an ordered list of
 *  refine regions (brush strokes, slabs, oriented shapes). Each region refines
 *  the (possibly already-refined) mesh near its own boundary until the boundary
 *  triangles fall below its `maxEdge`. Returns the refined mesh and a
 *  `childToParent` map from each final triangle back to its base-mesh triangle
 *  index (used to carry colour regions across the refinement). */
export function buildRefinedMesh(
  base: MeshData,
  regions: RefineRegion[],
): { mesh: MeshData; childToParent: Int32Array } {
  let mesh = base;
  let comp: Int32Array = new Int32Array(base.numTri);
  for (let i = 0; i < comp.length; i++) comp[i] = i;

  for (const region of regions) {
    const startTri = mesh.numTri;
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const selected = selectByClassify(mesh, region);
      if (selected.size === 0) break;
      // Hard budget on the triangles THIS region adds (a 1→4 split nets +3 per
      // selected triangle). Measured against the region's own additions — NOT the
      // whole mesh — so a detailed base model can't starve the refinement.
      if (region.maxTriangles && (mesh.numTri - startTri) + selected.size * 3 > region.maxTriangles) break;
      // Absolute OOM ceiling for any region (e.g. a tiny absolute maxEdge).
      if (mesh.numTri + selected.size * 3 > MAX_REFINED_TRIANGLES) break;
      const { mesh: nm, childToParent } = subdivideSelected(mesh, selected);
      mesh = nm;
      comp = composeMaps(comp, childToParent);
    }
  }
  return { mesh, childToParent: comp };
}

function composeMaps(parentToBase: Int32Array, childToParent: Int32Array): Int32Array {
  const out = new Int32Array(childToParent.length);
  for (let i = 0; i < out.length; i++) out[i] = parentToBase[childToParent[i]];
  return out;
}

/** Invert a final→base triangle map into base→[final children]. Used to carry
 *  a region defined on the base mesh (raw triangle ids, label ids) onto the
 *  refined mesh. */
export function childrenByParent(childToParent: Int32Array): Map<number, number[]> {
  const map = new Map<number, number[]>();
  for (let child = 0; child < childToParent.length; child++) {
    const parent = childToParent[child];
    let list = map.get(parent);
    if (!list) { list = []; map.set(parent, list); }
    list.push(child);
  }
  return map;
}
