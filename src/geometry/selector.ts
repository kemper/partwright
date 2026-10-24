// Selectors — one serializable way to say "this part of the shape" for every
// mesh-shaping op (sculpt, deforms, scatter, …) instead of each op inventing
// its own scope (#1093). A selector is plain data, so it lives in model code
// and survives edits that move triangles around:
//
//   { label: 'arm' }                             an api.label part (or a detected import part)
//   { label: ['hair', 'brows'] }                 any of several parts
//   { region: { center: [0, 0, 40], radius: 8 } }  a ball
//   { where: { facing: 'up', tolerance: 20 } }   faces pointing a direction
//   { where: { min: [null, null, 30] } }         faces above z = 30 (null = unbounded)
//   { where: { box: { min: [..], max: [..] } } } faces inside a box
//   { label: 'body', where: { facing: '+y' } }   several keys AND together
//   [{ label: 'hand' }, { label: 'arm' }]        an array ORs its entries
//   { label: 'body', except: { label: 'base' } } subtract another selector
//
// Resolution is triangle-first (a triangle is in when its label run / its
// centroid / its normal match), then spread to the triangles' vertices, then
// optionally feathered outward by `blend` world units so the edit fades into
// its surroundings instead of tearing at the seam. Everything here is pure
// (no WASM) and unit-tested; the Manifold-touching entry point is
// `selectionWeights`, called by the sandbox ops after any auto-refine.

/* eslint-disable @typescript-eslint/no-explicit-any */

export type Vec3 = [number, number, number];

export interface SelectorWhere {
  /** Faces whose outward normal is within `tolerance` of this direction:
   *  'up' | 'down' | '+x' | '-x' | '+y' | '-y' | '+z' | '-z' or a vector. */
  facing?: Vec3;
  /** Degrees of slack for `facing` (default 30). */
  tolerance?: number;
  /** Face centroid lower bounds per axis; null = unbounded. */
  min?: [number | null, number | null, number | null];
  /** Face centroid upper bounds per axis; null = unbounded. */
  max?: [number | null, number | null, number | null];
}

export interface SelectorTerm {
  label?: string[];
  region?: { center: Vec3; radius: number };
  where?: SelectorWhere;
  except?: Selector;
}

/** A normalized selector: an OR of AND-terms. */
export type Selector = SelectorTerm[];

/** Label name → the originalIDs its triangles carry, for the current run. */
export interface LabelLookup {
  ids(name: string): number[] | null;
  names(): string[];
}

export interface SelectorMesh {
  vertProperties: Float32Array;
  triVerts: Uint32Array;
  numProp: number;
  numTri: number;
  runIndex?: Uint32Array;
  runOriginalID?: Uint32Array;
}

function fail(name: string, msg: string): never {
  throw new Error(`meshOps: ${name}: ${msg}`);
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isVec3(v: unknown): v is Vec3 {
  return Array.isArray(v) && v.length === 3 && v.every(isFiniteNum);
}

const FACING: Record<string, Vec3> = {
  up: [0, 0, 1], down: [0, 0, -1],
  '+x': [1, 0, 0], '-x': [-1, 0, 0],
  '+y': [0, 1, 0], '-y': [0, -1, 0],
  '+z': [0, 0, 1], '-z': [0, 0, -1],
};

function parseBounds(v: unknown, name: string): [number | null, number | null, number | null] {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(x => x === null || isFiniteNum(x))) {
    fail(name, 'must be [x, y, z] with numbers or null (null = unbounded on that axis)');
  }
  return v as [number | null, number | null, number | null];
}

function parseTerm(raw: unknown, name: string): SelectorTerm {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    fail(name, 'a selector is an object like { label: "arm" }, { region: { center, radius } } or { where: { facing: "up" } } (or an array of them)');
  }
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (!['label', 'region', 'where', 'except'].includes(k)) fail(name, `unknown selector key "${k}" (allowed: label, region, where, except)`);
  }
  const term: SelectorTerm = {};
  if (o.label !== undefined) {
    const labels = typeof o.label === 'string' ? [o.label] : o.label;
    if (!Array.isArray(labels) || labels.length === 0 || !labels.every(l => typeof l === 'string' && l.length > 0)) {
      fail(`${name}.label`, 'must be a part name or a non-empty array of part names');
    }
    term.label = labels as string[];
  }
  if (o.region !== undefined) {
    const r = o.region as { center?: unknown; radius?: unknown } | null;
    if (!r || typeof r !== 'object') fail(`${name}.region`, 'must be { center: [x, y, z], radius }');
    for (const k of Object.keys(r)) if (k !== 'center' && k !== 'radius') fail(`${name}.region`, `unknown key "${k}" (allowed: center, radius)`);
    if (!isVec3(r.center)) fail(`${name}.region.center`, 'must be [x, y, z]');
    if (!isFiniteNum(r.radius) || r.radius <= 0) fail(`${name}.region.radius`, 'must be a positive number');
    term.region = { center: r.center as Vec3, radius: r.radius as number };
  }
  if (o.where !== undefined) {
    const w = o.where as Record<string, unknown> | null;
    if (!w || typeof w !== 'object' || Array.isArray(w)) fail(`${name}.where`, 'must be an object like { facing: "up" } or { min: [null, null, 10] }');
    const where: SelectorWhere = {};
    for (const k of Object.keys(w)) {
      if (!['facing', 'tolerance', 'min', 'max', 'box'].includes(k)) fail(`${name}.where`, `unknown key "${k}" (allowed: facing, tolerance, min, max, box)`);
    }
    if (w.facing !== undefined) {
      let dir: Vec3 | undefined;
      if (typeof w.facing === 'string') dir = FACING[w.facing];
      else if (isVec3(w.facing)) dir = w.facing;
      if (!dir) fail(`${name}.where.facing`, `must be ${Object.keys(FACING).map(k => `'${k}'`).join(' | ')} or a [x, y, z] direction`);
      const len = Math.hypot(dir[0], dir[1], dir[2]);
      if (len < 1e-9) fail(`${name}.where.facing`, 'must have non-zero length');
      where.facing = [dir[0] / len, dir[1] / len, dir[2] / len];
    }
    if (w.tolerance !== undefined) {
      if (!isFiniteNum(w.tolerance) || w.tolerance < 0 || w.tolerance > 180) fail(`${name}.where.tolerance`, 'must be degrees in [0, 180]');
      if (!where.facing) fail(`${name}.where.tolerance`, 'only applies together with facing');
      where.tolerance = w.tolerance;
    }
    if (w.min !== undefined) where.min = parseBounds(w.min, `${name}.where.min`);
    if (w.max !== undefined) where.max = parseBounds(w.max, `${name}.where.max`);
    if (w.box !== undefined) {
      const b = w.box as { min?: unknown; max?: unknown } | null;
      if (!b || typeof b !== 'object' || !isVec3(b.min) || !isVec3(b.max)) fail(`${name}.where.box`, 'must be { min: [x, y, z], max: [x, y, z] }');
      if (where.min || where.max) fail(`${name}.where`, 'use either box or min/max, not both');
      where.min = b.min as Vec3;
      where.max = b.max as Vec3;
    }
    if (!where.facing && !where.min && !where.max) fail(`${name}.where`, 'needs at least one of facing, min, max or box');
    term.where = where;
  }
  if (o.except !== undefined) term.except = parseSelector(o.except, `${name}.except`);
  if (!term.label && !term.region && !term.where) fail(name, 'a selector needs at least one of label, region or where');
  return term;
}

/** Validate and normalize a selector (object or array of objects). Throws an
 *  actionable error naming the op (`name`) on bad input. */
export function parseSelector(raw: unknown, name: string): Selector {
  if (Array.isArray(raw)) {
    if (raw.length === 0) fail(name, 'an empty selector array selects nothing');
    return raw.map((t, i) => parseTerm(t, `${name}[${i}]`));
  }
  return [parseTerm(raw, name)];
}

function labelNamesOf(sel: Selector, out = new Set<string>()): Set<string> {
  for (const t of sel) {
    for (const l of t.label ?? []) out.add(l);
    if (t.except) labelNamesOf(t.except, out);
  }
  return out;
}

/** Per-triangle originalID (or -1 when the mesh carries no run info). */
function triangleOriginalIds(mesh: SelectorMesh): Int32Array {
  const ids = new Int32Array(mesh.numTri).fill(-1);
  const ri = mesh.runIndex, rid = mesh.runOriginalID;
  if (!ri || !rid) return ids;
  for (let r = 0; r < rid.length; r++) {
    const t0 = Math.floor(ri[r] / 3), t1 = Math.min(mesh.numTri, Math.floor(ri[r + 1] / 3));
    for (let t = t0; t < t1; t++) ids[t] = rid[r];
  }
  return ids;
}

/** One triangle mask (1 = selected) for `sel` on `mesh`. `name` prefixes errors. */
export function selectTriangles(mesh: SelectorMesh, sel: Selector, labels: LabelLookup | null, name: string): Uint8Array {
  const { vertProperties: vp, numProp, triVerts: tv, numTri } = mesh;
  const wanted = labelNamesOf(sel);
  const idSets = new Map<string, Set<number>>();
  if (wanted.size > 0) {
    if (!labels) fail(name, 'a label selector needs labelled parts — wrap shapes with api.label(shape, "name") (or load an import with api.importWithParts(i))');
    for (const l of wanted) {
      const ids = labels.ids(l);
      if (!ids) {
        const known = labels.names();
        fail(name, `no part "${l}" in this run.${known.length ? ` Parts: ${known.map(n => `"${n}"`).join(', ')}.` : ' Label parts with api.label(shape, "name") first.'}`);
      }
      idSets.set(l, new Set(ids));
    }
  }
  const triIds = wanted.size > 0 ? triangleOriginalIds(mesh) : null;

  const centroid = new Float64Array(3);
  const normal = new Float64Array(3);
  const evalTerm = (t: SelectorTerm, tri: number): boolean => {
    if (t.label) {
      const id = triIds![tri];
      if (!t.label.some(l => idSets.get(l)!.has(id))) return false;
    }
    if (t.region || t.where) {
      const a = tv[tri * 3] * numProp, b = tv[tri * 3 + 1] * numProp, c = tv[tri * 3 + 2] * numProp;
      for (let k = 0; k < 3; k++) centroid[k] = (vp[a + k] + vp[b + k] + vp[c + k]) / 3;
      if (t.region) {
        const dx = centroid[0] - t.region.center[0], dy = centroid[1] - t.region.center[1], dz = centroid[2] - t.region.center[2];
        if (dx * dx + dy * dy + dz * dz > t.region.radius * t.region.radius) return false;
      }
      if (t.where) {
        const w = t.where;
        for (let k = 0; k < 3; k++) {
          const lo = w.min?.[k], hi = w.max?.[k];
          if (lo !== undefined && lo !== null && centroid[k] < lo) return false;
          if (hi !== undefined && hi !== null && centroid[k] > hi) return false;
        }
        if (w.facing) {
          const ux = vp[b] - vp[a], uy = vp[b + 1] - vp[a + 1], uz = vp[b + 2] - vp[a + 2];
          const vx = vp[c] - vp[a], vy = vp[c + 1] - vp[a + 1], vz = vp[c + 2] - vp[a + 2];
          normal[0] = uy * vz - uz * vy; normal[1] = uz * vx - ux * vz; normal[2] = ux * vy - uy * vx;
          const len = Math.hypot(normal[0], normal[1], normal[2]);
          if (len < 1e-30) return false;
          const cos = (normal[0] * w.facing[0] + normal[1] * w.facing[1] + normal[2] * w.facing[2]) / len;
          if (cos < Math.cos(((w.tolerance ?? 30) * Math.PI) / 180) - 1e-9) return false;
        }
      }
    }
    if (t.except && evalSel(t.except, tri)) return false;
    return true;
  };
  const evalSel = (s: Selector, tri: number): boolean => s.some(t => evalTerm(t, tri));

  const mask = new Uint8Array(numTri);
  for (let tri = 0; tri < numTri; tri++) if (evalSel(sel, tri)) mask[tri] = 1;
  return mask;
}

/** Wendland-style falloff: smooth (C²) 1 → 0 over t ∈ [0, 1]. */
function falloff(t: number): number {
  if (t >= 1) return 0;
  if (t <= 0) return 1;
  const u = 1 - t * t;
  return u * u;
}

/** Per-vertex weights in [0, 1]: 1 on every vertex of a selected triangle,
 *  fading to 0 over `blend` world units outside it (0 = hard edge). */
export function vertexWeights(mesh: SelectorMesh, triMask: Uint8Array, blend = 0): Float32Array {
  const nv = mesh.vertProperties.length / mesh.numProp;
  const w = new Float32Array(nv);
  const tv = mesh.triVerts;
  for (let t = 0; t < mesh.numTri; t++) {
    if (!triMask[t]) continue;
    w[tv[t * 3]] = 1; w[tv[t * 3 + 1]] = 1; w[tv[t * 3 + 2]] = 1;
  }
  if (!(blend > 0)) return w;
  // Feather: distance from each unselected vertex to the nearest selected one,
  // via a uniform grid with cell = blend (only the 27 neighbouring cells can
  // hold a vertex closer than `blend`).
  const vp = mesh.vertProperties, np = mesh.numProp;
  const cells = new Map<string, number[]>();
  const key = (i: number, j: number, k: number) => `${i},${j},${k}`;
  for (let v = 0; v < nv; v++) {
    if (w[v] !== 1) continue;
    const k = key(Math.floor(vp[v * np] / blend), Math.floor(vp[v * np + 1] / blend), Math.floor(vp[v * np + 2] / blend));
    let bucket = cells.get(k);
    if (!bucket) { bucket = []; cells.set(k, bucket); }
    bucket.push(v);
  }
  for (let v = 0; v < nv; v++) {
    if (w[v] === 1) continue;
    const x = vp[v * np], y = vp[v * np + 1], z = vp[v * np + 2];
    const ci = Math.floor(x / blend), cj = Math.floor(y / blend), ck = Math.floor(z / blend);
    let best = blend * blend;
    for (let dk = -1; dk <= 1; dk++) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const bucket = cells.get(key(ci + di, cj + dj, ck + dk));
      if (!bucket) continue;
      for (const s of bucket) {
        const dx = x - vp[s * np], dy = y - vp[s * np + 1], dz = z - vp[s * np + 2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < best) best = d2;
      }
    }
    if (best < blend * blend) w[v] = falloff(Math.sqrt(best) / blend);
  }
  return w;
}

/** Position-keyed weight lookup for `Manifold.warp`, which hands the callback
 *  only a vertex position. Coincident vertices take the larger weight.
 *
 *  Keyed on the exact Float32 value: `getMesh()` exports positions as Float32
 *  while `warp` passes the kernel's doubles, so both sides are rounded to the
 *  same float (`Math.fround`). A decimal grid instead splits vertices whose
 *  double and float straddle a grid line — they'd get weight 0 inside the
 *  selection and fold the surface. */
export function weightLookup(mesh: SelectorMesh, weights: Float32Array): (v: ArrayLike<number>) => number {
  const vp = mesh.vertProperties, np = mesh.numProp;
  const map = new Map<string, number>();
  const nv = weights.length;
  const f = Math.fround;
  const k = (x: number, y: number, z: number) => `${f(x)},${f(y)},${f(z)}`;
  for (let v = 0; v < nv; v++) {
    if (weights[v] <= 0) continue;
    const key = k(vp[v * np], vp[v * np + 1], vp[v * np + 2]);
    const prev = map.get(key);
    if (prev === undefined || weights[v] > prev) map.set(key, weights[v]);
  }
  return (v) => map.get(k(v[0], v[1], v[2])) ?? 0;
}

/** Wrap a warp callback so each vertex moves `weight` of the way to where `fn`
 *  would put it (weight 0 = untouched). The weight is read from the vertex's
 *  ORIGINAL position, before `fn` moves it. */
export function weightedWarp(fn: (v: number[]) => void, weightOf: (v: ArrayLike<number>) => number): (v: number[]) => void {
  return (v) => {
    const w = weightOf(v);
    if (w <= 0) return;
    const x = v[0], y = v[1], z = v[2];
    fn(v);
    if (w < 1) {
      v[0] = x + (v[0] - x) * w;
      v[1] = y + (v[1] - y) * w;
      v[2] = z + (v[2] - z) * w;
    }
  };
}

/** Bounds + centroid of the fully-selected vertices (weight 1). */
export function selectionBounds(mesh: SelectorMesh, weights: Float32Array): { min: Vec3; max: Vec3; centroid: Vec3; count: number } {
  const vp = mesh.vertProperties, np = mesh.numProp;
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const sum: Vec3 = [0, 0, 0];
  let count = 0;
  for (let v = 0; v < weights.length; v++) {
    if (weights[v] !== 1) continue;
    for (let k = 0; k < 3; k++) {
      const x = vp[v * np + k];
      if (x < min[k]) min[k] = x;
      if (x > max[k]) max[k] = x;
      sum[k] += x;
    }
    count++;
  }
  const centroid: Vec3 = count ? [sum[0] / count, sum[1] / count, sum[2] / count] : [0, 0, 0];
  return { min, max, centroid, count };
}

// ---------------------------------------------------------------------------
// Run-scoped label lookup (published by the manifold-js sandbox per run)
// ---------------------------------------------------------------------------

let activeLabels: LabelLookup | null = null;

/** Set by the sandbox before running model code (null after), so selector
 *  `label` terms resolve against THIS run's api.label / import parts. */
export function setSelectorLabels(lookup: LabelLookup | null): void {
  activeLabels = lookup;
}

export interface SelectionWeights {
  mesh: SelectorMesh;
  weights: Float32Array;
  weightOf: (v: ArrayLike<number>) => number;
  bounds: ReturnType<typeof selectionBounds>;
}

/** Resolve a parsed selector on a Manifold (after any refine) to per-vertex
 *  weights. Throws when nothing matches, so a typo'd label or an empty region
 *  is loud instead of a silent no-op. */
export function selectionWeights(shape: any, sel: Selector, blend: number, name: string): SelectionWeights {
  const mesh = shape.getMesh() as SelectorMesh;
  const triMask = selectTriangles(mesh, sel, activeLabels, name);
  let any = false;
  for (let t = 0; t < triMask.length && !any; t++) if (triMask[t]) any = true;
  if (!any) fail(name, 'the selector matched no faces of this shape — check the part name, region or where bounds (selectors apply to the shape passed in, after earlier ops)');
  const weights = vertexWeights(mesh, triMask, blend);
  return { mesh, weights, weightOf: weightLookup(mesh, weights), bounds: selectionBounds(mesh, weights) };
}

/** Parse the shared `select` / `blend` options of an op (both optional). */
export function parseSelectOpts(opts: { select?: unknown; blend?: unknown }, name: string): { select: Selector | null; blend: number } {
  const select = opts.select === undefined ? null : parseSelector(opts.select, `${name}.select`);
  let blend = 0;
  if (opts.blend !== undefined) {
    if (!isFiniteNum(opts.blend) || opts.blend < 0) fail(`${name}.blend`, 'must be a distance >= 0 (world units the edit fades over)');
    if (!select) fail(`${name}.blend`, 'only applies together with select');
    blend = opts.blend;
  }
  return { select, blend };
}

/** Triangle mask for a selector on a plain mesh (scatter's declarative `where`). */
export function selectTrianglesActive(mesh: SelectorMesh, sel: Selector, name: string): Uint8Array {
  return selectTriangles(mesh, sel, activeLabels, name);
}
