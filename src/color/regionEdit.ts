// Region clean-up edits — the glue between the pure set morphology in
// `regionOps.ts` and the region store. Backs `partwright.growRegion` /
// `shrinkRegion` / `despeckleRegion` / `combineRegions` and the `editRegion`
// AI tool. Each edit swaps the region's triangle set via `replaceRegion`
// (one undoable step) and rebakes it as a `triangles` descriptor, the same
// id-baked kind `paintFaces` produces.

import type { MeshData } from '../geometry/types';
import { buildAdjacency } from './adjacency';
import { getRegions, replaceRegion, type ColorRegion } from './regions';
import { descriptorRefines } from './refinePipeline';
import {
  growTriangles,
  shrinkTriangles,
  despeckleTriangles,
  combineTriangles,
  type RegionSetOp,
} from './regionOps';

type RegionRef = number | string;

type Vec3 = [number, number, number];

export type RegionEditOptions =
  | { op: 'grow'; region: RegionRef; steps?: number; withinBox?: { min?: Vec3; max?: Vec3 }; zMin?: number; zMax?: number }
  | { op: 'shrink'; region: RegionRef; steps?: number }
  | { op: 'despeckle'; region: RegionRef; minIslandTriangles?: number; maxHoleTriangles?: number }
  | { op: 'union' | 'subtract' | 'intersect'; region: RegionRef; with: RegionRef | RegionRef[] };

interface RegionEditResult {
  id: number;
  name: string;
  op: string;
  triangles: number;
  before: number;
  added: number;
  removed: number;
  islandsRemoved?: number;
  holesFilled?: number;
}

const DEFAULT_SPECK = 10;
const MAX_STEPS = 1000;

/** Look a region up by id (number) or name (string). */
function findRegionByRef(ref: RegionRef): ColorRegion | { error: string } {
  const regions = getRegions();
  const region = typeof ref === 'number' ? regions.find(r => r.id === ref) : regions.find(r => r.name === ref);
  if (region) return region;
  // Providers that coerce untyped tool params to strings (Gemini) send an id
  // as "17"; accept it when no region is literally named that.
  if (typeof ref === 'string' && /^\d+$/.test(ref)) {
    const byId = regions.find(r => r.id === Number(ref));
    if (byId) return byId;
  }
  const existing = regions.map(r => `"${r.name}" (id=${r.id})`).join(', ') || '(none)';
  return { error: `No region matching ${JSON.stringify(ref)}. Existing: ${existing}` };
}

function isRef(v: unknown): v is RegionRef {
  return (typeof v === 'number' && Number.isInteger(v)) || (typeof v === 'string' && v.length > 0);
}

function readCount(v: unknown, name: string, dflt: number, min: number): number | { error: string } {
  if (v === undefined) return dflt;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > MAX_STEPS * 1000) {
    return { error: `${name} must be an integer ≥ ${min}` };
  }
  return v;
}

function readVec3(v: unknown, name: string): Vec3 | undefined | { error: string } {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length !== 3 || v.some(c => typeof c !== 'number' || !Number.isFinite(c))) {
    return { error: `${name} must be [x,y,z] of finite numbers` };
  }
  return v as Vec3;
}

/** Why a region can't be rebaked into a plain triangle set, or null if it can. */
function uneditableReason(region: ColorRegion): string | null {
  if (descriptorRefines(region.descriptor)) {
    return `region "${region.name}" is a smooth (mesh-refining) ${region.descriptor.kind} region — editing it would discard the refined edge it owns. Edit a regular fill instead, or repaint the smooth one.`;
  }
  if (region.perTriColors) {
    return `region "${region.name}" carries per-triangle colours (${region.descriptor.kind}) — it can't be rebaked into a single-colour triangle set.`;
  }
  return null;
}

/** Apply one clean-up edit to a region. Pure w.r.t. the mesh (it never
 *  refines it); mutates only the region store. The caller re-renders. */
export function applyRegionEdit(
  mesh: MeshData,
  opts: RegionEditOptions,
  /** Maps the edited current-mesh set to the ids the `triangles` descriptor
   *  stores (base-mesh ids once the mesh is refined). Identity by default. */
  descriptorIds: (tris: Set<number>) => number[] = (tris) => [...tris],
): RegionEditResult | { error: string } {
  if (!opts || typeof opts !== 'object') return { error: 'region edit requires an options object' };
  if (!isRef(opts.region)) return { error: 'region must be a region id (integer) or name (string) — see listRegions()' };
  const found = findRegionByRef(opts.region);
  if ('error' in found) return found;
  const region = found;
  const why = uneditableReason(region);
  if (why) return { error: why };

  const before = region.triangles;
  const { neighbors, centroids } = buildAdjacency(mesh);
  let next: Set<number>;
  const extra: Partial<RegionEditResult> = {};

  switch (opts.op) {
    case 'grow': {
      const steps = readCount(opts.steps, 'steps', 1, 1);
      if (typeof steps !== 'number') return steps;
      const min = readVec3(opts.withinBox?.min, 'withinBox.min');
      if (min && 'error' in min) return min;
      const max = readVec3(opts.withinBox?.max, 'withinBox.max');
      if (max && 'error' in max) return max;
      for (const [k, v] of [['zMin', opts.zMin], ['zMax', opts.zMax]] as const) {
        if (v !== undefined && (typeof v !== 'number' || !Number.isFinite(v))) return { error: `${k} must be a finite number` };
      }
      const lo: Vec3 = [min?.[0] ?? -Infinity, min?.[1] ?? -Infinity, Math.max(min?.[2] ?? -Infinity, opts.zMin ?? -Infinity)];
      const hi: Vec3 = [max?.[0] ?? Infinity, max?.[1] ?? Infinity, Math.min(max?.[2] ?? Infinity, opts.zMax ?? Infinity)];
      const clamped = lo.some(Number.isFinite) || hi.some(Number.isFinite);
      const allow = clamped
        ? (t: number) => {
            for (let a = 0; a < 3; a++) {
              const c = centroids[t * 3 + a];
              if (c < lo[a] || c > hi[a]) return false;
            }
            return true;
          }
        : undefined;
      next = growTriangles(before, neighbors, Math.min(steps, MAX_STEPS), allow);
      break;
    }
    case 'shrink': {
      const steps = readCount(opts.steps, 'steps', 1, 1);
      if (typeof steps !== 'number') return steps;
      next = shrinkTriangles(before, neighbors, Math.min(steps, MAX_STEPS));
      break;
    }
    case 'despeckle': {
      const minIsland = readCount(opts.minIslandTriangles, 'minIslandTriangles', DEFAULT_SPECK, 0);
      if (typeof minIsland !== 'number') return minIsland;
      const maxHole = readCount(opts.maxHoleTriangles, 'maxHoleTriangles', DEFAULT_SPECK, 0);
      if (typeof maxHole !== 'number') return maxHole;
      const r = despeckleTriangles(before, neighbors, mesh.numTri, { minIslandTriangles: minIsland, maxHoleTriangles: maxHole });
      next = r.triangles;
      extra.islandsRemoved = r.islandsRemoved;
      extra.holesFilled = r.holesFilled;
      break;
    }
    case 'union':
    case 'subtract':
    case 'intersect': {
      const refs = Array.isArray(opts.with) ? opts.with : [opts.with];
      if (refs.length === 0 || !refs.every(isRef)) return { error: 'with must be a region id/name or a non-empty array of them' };
      const others: Set<number>[] = [];
      for (const ref of refs) {
        const o = findRegionByRef(ref);
        if ('error' in o) return o;
        if (o.id === region.id) return { error: `with cannot include the target region "${region.name}" itself` };
        others.push(o.triangles);
      }
      next = combineTriangles(before, others, opts.op as RegionSetOp);
      break;
    }
    default:
      return { error: `unknown region edit op ${JSON.stringify((opts as { op?: unknown }).op)} — expected grow | shrink | despeckle | union | subtract | intersect` };
  }

  let added = 0, removed = 0;
  for (const t of next) if (!before.has(t)) added++;
  for (const t of before) if (!next.has(t)) removed++;
  if (next.size === 0) {
    return { error: `${opts.op} would leave region "${region.name}" empty — nothing changed. Use removeRegion(${region.id}) to delete it.` };
  }
  if (added > 0 || removed > 0) {
    replaceRegion(region.id, next, { kind: 'triangles', ids: descriptorIds(next) }, mesh);
  }
  return { id: region.id, name: region.name, op: opts.op, triangles: next.size, before: before.size, added, removed, ...extra };
}
