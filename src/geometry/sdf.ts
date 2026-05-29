// SDF (signed distance field) modeling, lowered to Manifold via levelSet.
//
// What this is for: shapes that mesh CSG can't say cleanly — smooth blends
// between primitives (free fillets), domain warps (twist/bend), periodic
// lattices/gyroids, constant-thickness shells. The agent reaches for it
// whenever a request implies "blend", "smooth", "lattice", "gyroid", or
// "twisted". For sharp-edged mechanical work, native Manifold is faster
// and crisper and remains the default.
//
// Convention: nodes use the STANDARD SDF sign convention — f(p) < 0
// inside, > 0 outside, = 0 on the surface. (Internally we negate at
// the call to Manifold.levelSet, which uses the opposite convention.)
//
// Painting: `.label(name)` marks a subtree as a paint region. At build
// time the tree is partitioned at each `.label()` boundary, each
// labelled subtree is meshed independently via Manifold.levelSet,
// wrapped with `api.label` (so triangles inherit a stable originalID),
// and the pieces are hard-unioned. This is the price of the existing
// paint-by-label flow being mesh-id based: smooth blends ACROSS labels
// degrade to a hard union. To keep a smooth blend paintable, label the
// outer expression instead of the individual primitives.

import {
  assertEnum,
  assertNumber,
  assertNumberTuple,
  assertObject,
  assertString,
  assertFunction,
  assertNoUnknownKeys,
  ValidationError,
} from '../validation/apiValidation';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ManifoldClass = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ManifoldInstance = any;
type LabelFn = (shape: ManifoldInstance, name: string) => ManifoldInstance;

/** Closure-bound engine context attached to every SdfNode at construction
 *  time so the chain method `.build(opts)` can lower through Manifold
 *  without the caller threading the engine. The namespace factory in
 *  createSdfNamespace seeds it on every primitive; chain methods + ops
 *  inherit it from their input node(s). Pure-logic unit tests leave it
 *  undefined — only `.build()` requires it. */
interface BuildContext { Manifold: ManifoldClass; label: LabelFn }

export type Vec3 = [number, number, number];
export interface Box { min: Vec3; max: Vec3 }

const DEG = Math.PI / 180;

// --- Math helpers --------------------------------------------------------

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function bbUnion(a: Box, b: Box): Box {
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
  };
}

function bbIntersect(a: Box, b: Box): Box {
  // May produce inverted bounds when there is no overlap — that's fine for
  // levelSet (no surface in an empty region) and we re-expand by margin
  // before calling levelSet anyway.
  return {
    min: [Math.max(a.min[0], b.min[0]), Math.max(a.min[1], b.min[1]), Math.max(a.min[2], b.min[2])],
    max: [Math.min(a.max[0], b.max[0]), Math.min(a.max[1], b.max[1]), Math.min(a.max[2], b.max[2])],
  };
}

function bbExpand(a: Box, by: number): Box {
  return {
    min: [a.min[0] - by, a.min[1] - by, a.min[2] - by],
    max: [a.max[0] + by, a.max[1] + by, a.max[2] + by],
  };
}

function bbTransformCorners(a: Box, fn: (p: Vec3) => Vec3): Box {
  const corners: Vec3[] = [
    [a.min[0], a.min[1], a.min[2]], [a.max[0], a.min[1], a.min[2]],
    [a.min[0], a.max[1], a.min[2]], [a.max[0], a.max[1], a.min[2]],
    [a.min[0], a.min[1], a.max[2]], [a.max[0], a.min[1], a.max[2]],
    [a.min[0], a.max[1], a.max[2]], [a.max[0], a.max[1], a.max[2]],
  ];
  const out: Box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const c of corners) {
    const p = fn(c);
    for (let i = 0; i < 3; i++) {
      if (p[i] < out.min[i]) out.min[i] = p[i];
      if (p[i] > out.max[i]) out.max[i] = p[i];
    }
  }
  return out;
}

// --- Node type -----------------------------------------------------------

type EvalFn = (x: number, y: number, z: number) => number;

interface NodeData {
  kind: string;
  eval: EvalFn;
  bounds: Box;
  /** Children of this node — used by label partitioning to walk the tree
   *  and find labelled subtrees. Leaf primitives have no children. */
  children: readonly SdfNode[];
  /** Whether this node's children should be considered as separate label
   *  candidates by the partitioner. For unions/intersects/subtracts this
   *  is true (each operand can carry its own label); for transforms,
   *  shells, twists etc. this is false (the operation owns the whole
   *  subtree). */
  partitionable: boolean;
  /** User-supplied label name. When set, this whole subtree (and any
   *  nested labels below it) is meshed as one chunk; nested labels are
   *  ignored because the outer label wins. */
  labelName?: string;
  /** Engine binding for `.build()`. Threaded through chain methods and
   *  ops from the input node(s). Undefined for pure-logic unit-test
   *  factories — only callers of `.build()` need it. */
  ctx?: BuildContext;
}

let nextId = 1;

/** A node in the SDF expression tree. Construction is functional: every
 *  chain method returns a NEW node, never mutates `this`. Build by calling
 *  `.build(opts)` once at the end. */
export class SdfNode {
  readonly id: string;
  readonly kind: string;
  readonly labelName: string | undefined;
  /** @internal */ readonly _eval: EvalFn;
  /** @internal */ readonly _bounds: Box;
  /** @internal */ readonly _children: readonly SdfNode[];
  /** @internal */ readonly _partitionable: boolean;
  /** @internal */ readonly _ctx: BuildContext | undefined;

  constructor(data: NodeData) {
    this.id = `sdf_${nextId++}`;
    this.kind = data.kind;
    this._eval = data.eval;
    this._bounds = data.bounds;
    this._children = data.children;
    this._partitionable = data.partitionable;
    this.labelName = data.labelName;
    // Inherit ctx from data, else from the first child that has one.
    // Lets `union(a, b)` keep the engine binding from either operand.
    this._ctx = data.ctx ?? (data.children.find(c => c._ctx !== undefined)?._ctx);
  }

  evaluate(x: number, y: number, z: number): number {
    return this._eval(x, y, z);
  }

  bounds(): Box {
    return { min: [...this._bounds.min] as Vec3, max: [...this._bounds.max] as Vec3 };
  }

  // ---- Booleans -------------------------------------------------------

  union(other: SdfNode): SdfNode { return opUnion(this, other); }
  add(other: SdfNode): SdfNode { return opUnion(this, other); }
  subtract(other: SdfNode): SdfNode { return opSubtract(this, other); }
  intersect(other: SdfNode): SdfNode { return opIntersect(this, other); }

  smoothUnion(other: SdfNode, k: number): SdfNode {
    assertNumber(k, 'smoothUnion(k)', { min: 1e-6 });
    return opSmoothUnion(this, other, k);
  }
  smoothSubtract(other: SdfNode, k: number): SdfNode {
    assertNumber(k, 'smoothSubtract(k)', { min: 1e-6 });
    return opSmoothSubtract(this, other, k);
  }
  smoothIntersect(other: SdfNode, k: number): SdfNode {
    assertNumber(k, 'smoothIntersect(k)', { min: 1e-6 });
    return opSmoothIntersect(this, other, k);
  }

  // ---- Transforms -----------------------------------------------------

  translate(t: Vec3 | number, ty?: number, tz?: number): SdfNode {
    const v = parseVec3('translate', t, ty, tz);
    return opTranslate(this, v);
  }

  rotate(r: Vec3 | number, ry?: number, rz?: number): SdfNode {
    const v = parseVec3('rotate', r, ry, rz);
    return opRotate(this, v);
  }

  scale(s: number): SdfNode {
    assertNumber(s, 'scale(s)', { min: 1e-6 });
    return opScale(this, s as number);
  }

  mirror(axis: 'x' | 'y' | 'z'): SdfNode {
    const a = assertEnum(axis, ['x', 'y', 'z'] as const, 'mirror(axis)');
    return opMirror(this, a);
  }

  // ---- Domain warps + modifiers --------------------------------------

  shell(thickness: number): SdfNode {
    assertNumber(thickness, 'shell(thickness)', { min: 1e-6 });
    return opShell(this, thickness as number);
  }

  round(r: number): SdfNode {
    assertNumber(r, 'round(r)', { min: 0 });
    return opRound(this, r as number);
  }

  twist(degreesPerUnit: number, axis: 'x' | 'y' | 'z' = 'z', center?: [number, number]): SdfNode {
    assertNumber(degreesPerUnit, 'twist(degreesPerUnit)');
    const a = assertEnum(axis, ['x', 'y', 'z'] as const, 'twist(axis)');
    // center is the [u, v] offset of the twist axis in the plane
    // perpendicular to `axis` (e.g. [x, y] for a z-twist). Defaults to
    // the origin. Lets you spiral around an off-centre line.
    const c = center === undefined ? [0, 0] as [number, number]
      : assertNumberTuple(center, 2, 'twist(center)') as [number, number];
    return opTwist(this, degreesPerUnit as number, a, c);
  }

  bend(degreesPerUnit: number, axis: 'x' | 'y' | 'z' = 'x'): SdfNode {
    assertNumber(degreesPerUnit, 'bend(degreesPerUnit)');
    const a = assertEnum(axis, ['x', 'y', 'z'] as const, 'bend(axis)');
    return opBend(this, degreesPerUnit as number, a);
  }

  /** Taper the cross-section perpendicular to `axis` linearly along it.
   *  `rate` is the fractional size change per unit (positive widens
   *  toward +axis, negative narrows); the scale is 1 at the origin. */
  taper(rate: number, axis: 'x' | 'y' | 'z' = 'z'): SdfNode {
    assertNumber(rate, 'taper(rate)');
    const a = assertEnum(axis, ['x', 'y', 'z'] as const, 'taper(axis)');
    return opTaper(this, rate as number, a);
  }

  // ---- Combinators ----------------------------------------------------

  /** Union of `count` copies of this node rotated evenly around `axis`.
   *  `angle` is the total sweep in degrees (360 default = full ring with
   *  no duplicate at the seam; any other angle places endpoints
   *  inclusively). `radius` pushes each copy outward (along the first
   *  perpendicular axis) before rotating. */
  polarArray(count: number, opts: PolarArrayOptions = {}): SdfNode {
    return opPolarArray(this, count, opts);
  }

  /** Union of this node with its mirror image across `axis` — the quick
   *  way to make a symmetric part from one half. */
  mirrorPair(axis: 'x' | 'y' | 'z'): SdfNode {
    const a = assertEnum(axis, ['x', 'y', 'z'] as const, 'mirrorPair(axis)');
    return opUnion(this, opMirror(this, a));
  }

  /** Tile this node infinitely on a grid. `periods` is [px, py, pz];
   *  a 0 on any axis disables repetition there. The result is unbounded
   *  on every repeated axis, so you MUST intersect it with a finite
   *  shape or pass explicit `bounds` to `.build()`. */
  repeat(periods: Vec3): SdfNode {
    const p = assertNumberTuple(periods, 3, 'repeat(periods)') as Vec3;
    for (let i = 0; i < 3; i++) {
      if (p[i] < 0) throw new ValidationError('repeat(periods): each period must be >= 0 (0 disables that axis).');
    }
    return opRepeat(this, p);
  }

  /** Finite-count cousin of `.repeat()`. `counts` is [nx, ny, nz] —
   *  the number of copies on each axis (integer >= 0; 0 disables). The
   *  array centres on the origin and uses limit-modulo: points outside
   *  the array snap to the nearest cell rather than carrying the tiling
   *  infinitely. Bounds are finite even before any intersect.
   *
   *  Optional `opts.stagger` brick-shifts alternating rows: cells in
   *  every other row along `by` get nudged by `amount * period` along
   *  `along`. The classic brick wall is `{ along: 'x', by: 'y' }`
   *  with the default amount of 0.5. */
  repeatN(counts: Vec3, periods: Vec3, opts: RepeatNOptions = {}): SdfNode {
    const n = assertNumberTuple(counts, 3, 'repeatN(counts)') as Vec3;
    const p = assertNumberTuple(periods, 3, 'repeatN(periods)') as Vec3;
    for (let i = 0; i < 3; i++) {
      if (!Number.isInteger(n[i]) || n[i] < 0) {
        throw new ValidationError(`repeatN(counts)[${i}]: must be a non-negative integer.`);
      }
      if (p[i] < 0) {
        throw new ValidationError(`repeatN(periods)[${i}]: must be >= 0.`);
      }
    }
    const o = assertObject(opts, 'repeatN(opts)') ?? {};
    assertNoUnknownKeys(o as Record<string, unknown>, REPEAT_N_FIELDS, 'repeatN(opts)');
    let stagger: ResolvedStagger | undefined;
    if (o.stagger !== undefined) {
      const s = assertObject(o.stagger, 'repeatN(opts.stagger)')!;
      assertNoUnknownKeys(s, STAGGER_FIELDS, 'repeatN(opts.stagger)');
      const along = assertEnum(s.along, ['x', 'y', 'z'] as const, 'repeatN(opts.stagger.along)');
      const by = assertEnum(s.by, ['x', 'y', 'z'] as const, 'repeatN(opts.stagger.by)');
      if (along === by) {
        throw new ValidationError('repeatN(opts.stagger): along and by must be different axes.');
      }
      const amount = s.amount === undefined ? 0.5
        : assertNumber(s.amount, 'repeatN(opts.stagger.amount)', { min: 0, max: 1 }) as number;
      stagger = { along, by, amount };
    }
    return opRepeatN(this, n, p, stagger);
  }

  /** Tile this node `count` times around an `axis` (full revolution).
   *  Like `.polarArray`, but as a DOMAIN WARP: the child is evaluated
   *  ONCE per sample instead of unioned N times — much cheaper for
   *  large counts (gears, sun rays, fan blades). Optional `radius`
   *  pushes the seed outward along the first perpendicular axis before
   *  tiling, matching polarArray's convention. */
  polarRepeat(count: number, opts: PolarRepeatOptions = {}): SdfNode {
    assertNumber(count, 'polarRepeat(count)', { min: 1, integer: true });
    const o = assertObject(opts, 'polarRepeat(opts)') ?? {};
    // Targeted hint: someone porting from polarArray will reach for
    // `angle` first. Domain-warp folds need full periodicity so partial
    // sweeps aren't supported; point them at the right tool instead of
    // the generic "unknown key" error.
    if ('angle' in o) {
      throw new ValidationError(
        'polarRepeat(opts): `angle` is not supported — polarRepeat is full-revolution only because the domain-warp fold needs angular periodicity. '
        + 'For a partial sweep, use polarArray(count, {axis, angle, radius}) instead. See /ai/sdf.md#combinators.',
      );
    }
    assertNoUnknownKeys(o as Record<string, unknown>, POLAR_REPEAT_FIELDS, 'polarRepeat(opts)');
    const axis = o.axis === undefined ? 'z' : assertEnum(o.axis, ['x', 'y', 'z'] as const, 'polarRepeat(axis)');
    const radius = o.radius === undefined ? 0 : assertNumber(o.radius, 'polarRepeat(radius)', { min: 0 }) as number;
    return opPolarRepeat(this, count as number, axis, radius);
  }

  // ---- Labelling ------------------------------------------------------

  label(name: string): SdfNode {
    const n = assertString(name, 'label(name)')!;
    // Return a new node that wraps `this` and tags it. Nested labels
    // below this one are ignored at partition time — the outermost
    // label wins (smooth blends across nested labels are preserved
    // within this region).
    return new SdfNode({
      kind: 'labelled',
      eval: this._eval,
      bounds: this._bounds,
      children: [this],
      partitionable: false,
      labelName: n,
    });
  }

  // ---- Build ----------------------------------------------------------

  /** Lower this SDF tree to a Manifold. Requires the node to have been
   *  created via `api.sdf` (which binds the engine context) — pure
   *  unit-test factories produce nodes without context, and calling
   *  `.build()` on those throws with a clear message. */
  build(opts: SdfBuildOptions = {}): ManifoldInstance {
    if (!this._ctx) {
      throw new ValidationError(
        '.build() can only be called on SDF nodes created via api.sdf.* — '
        + 'the engine binding (Manifold + label) is set up by the namespace '
        + 'and inherited through chain methods.',
      );
    }
    return buildSdf(this, this._ctx.Manifold, this._ctx.label, opts);
  }
}

// --- Build options + driver ---------------------------------------------

export interface SdfBuildOptions {
  edgeLength?: number;
  bounds?: Box;
  level?: number;
  tolerance?: number;
}

const BUILD_FIELDS = ['edgeLength', 'bounds', 'level', 'tolerance'] as const;

function assertBuildOpts(opts: unknown): SdfBuildOptions {
  if (opts === undefined) return {};
  const o = assertObject(opts, 'build(opts)')!;
  assertNoUnknownKeys(o, BUILD_FIELDS, 'build(opts)');
  if (o.edgeLength !== undefined) assertNumber(o.edgeLength, 'build.edgeLength', { min: 1e-4 });
  if (o.bounds !== undefined) {
    const b = assertObject(o.bounds, 'build.bounds')!;
    assertNoUnknownKeys(b, ['min', 'max'], 'build.bounds');
    assertNumberTuple(b.min, 3, 'build.bounds.min');
    assertNumberTuple(b.max, 3, 'build.bounds.max');
  }
  if (o.level !== undefined) assertNumber(o.level, 'build.level');
  if (o.tolerance !== undefined) assertNumber(o.tolerance, 'build.tolerance', { min: 0 });
  return o as SdfBuildOptions;
}

/** Pick a reasonable edgeLength from the model's smallest bbox extent.
 *  Tuned for "you typed `.build()` and want something usable in a couple
 *  of seconds" — about a 32-cell grid across the smaller dimension.
 *  Users can override via `.build({edgeLength})` when they want detail. */
function defaultEdgeLength(b: Box): number {
  const sx = b.max[0] - b.min[0];
  const sy = b.max[1] - b.min[1];
  const sz = b.max[2] - b.min[2];
  const minExt = Math.min(sx, sy, sz);
  if (!Number.isFinite(minExt) || minExt <= 0) return 1;
  return clamp(minExt / 32, 0.1, 5);
}

function buildSdf(
  root: SdfNode,
  Manifold: ManifoldClass,
  label: LabelFn,
  optsRaw: SdfBuildOptions,
): ManifoldInstance {
  const opts = assertBuildOpts(optsRaw);
  const bounds = opts.bounds ?? root._bounds;
  if (!Number.isFinite(bounds.min[0] + bounds.min[1] + bounds.min[2]
                       + bounds.max[0] + bounds.max[1] + bounds.max[2])) {
    throw new ValidationError(
      'api.sdf.build(): could not infer finite bounds for this SDF (e.g. a bare gyroid, which is mathematically infinite). '
      + 'Intersect with a finite shape, or pass an explicit { bounds: { min:[x,y,z], max:[x,y,z] } }.',
    );
  }
  const edgeLength = opts.edgeLength ?? defaultEdgeLength(bounds);
  const level = opts.level ?? 0;
  const tolerance = opts.tolerance;

  // Partition the tree into labelled regions. If there are no labels,
  // returns a single anonymous region covering the whole root.
  const regions = partitionByLabel(root);

  const meshed: ManifoldInstance[] = [];
  for (const region of regions) {
    const evalFn = region.node._eval;
    // Manifold's levelSet uses the OPPOSITE sign convention from
    // standard SDF: positive=inside, negative=outside. Negate so user
    // code can keep writing distance functions the normal way.
    const negated: (p: Vec3) => number = (p) => -evalFn(p[0], p[1], p[2]);
    // Expand bounds slightly so the iso-surface closes cleanly; if the
    // SDF reaches the boundary, marching tetrahedra would emit egg-crate
    // closing faces. A margin of max(edgeLength, 1) is empirical — large
    // enough to fully contain typical primitives' falloff regions.
    const meshBounds = expandedMeshBounds(region.node._bounds, bounds, edgeLength);
    let m: ManifoldInstance;
    if (tolerance !== undefined) {
      m = Manifold.levelSet(negated, meshBounds, edgeLength, level, tolerance);
    } else {
      m = Manifold.levelSet(negated, meshBounds, edgeLength, level);
    }
    if (region.labelName) {
      m = label(m, region.labelName);
    }
    meshed.push(m);
  }

  if (meshed.length === 0) {
    // Shouldn't reach here — partitionByLabel always returns ≥ 1 region.
    throw new ValidationError('api.sdf.build(): SDF produced no regions to mesh.');
  }
  if (meshed.length === 1) return meshed[0];
  // Hard-union the labelled pieces. Smooth blends across labels are lost
  // here by design (see header comment); to preserve them, label the
  // outer expression instead of individual primitives.
  return Manifold.union(meshed);
}

function expandedMeshBounds(nodeBounds: Box, userBounds: Box, edgeLength: number): Box {
  // The user-supplied bounds (if any) clip the region. The node's own
  // bounds (where the surface actually lives) cap the work. Take the
  // intersection, then expand by margin so marching tetrahedra has
  // room to close the iso-surface.
  const clipped = bbIntersect(nodeBounds, userBounds);
  const margin = Math.max(edgeLength, 1);
  return bbExpand(clipped, margin);
}

// --- Label partitioning -------------------------------------------------

interface Partition { node: SdfNode; labelName?: string }

/** Walk the tree top-down. When we hit a labelled node, that whole
 *  subtree becomes one region (with the label). When we hit a
 *  partitionable op (union of two labelled things), each child becomes
 *  its own region. Otherwise the current root is one anonymous region —
 *  unless it's a single-child wrapper (transform, shell, subtract from
 *  the perspective of its surviving A side) in which case the inner
 *  label propagates up. */
export function partitionByLabel(root: SdfNode): Partition[] {
  // If the root itself is labelled, the whole tree is one region.
  if (root.labelName !== undefined) {
    return [{ node: root, labelName: root.labelName }];
  }
  // If the root is a partitionable boolean (union/etc.) AND any
  // descendant carries a label, walk into the children.
  if (root._partitionable && hasLabelledDescendant(root)) {
    const parts: Partition[] = [];
    for (const child of root._children) {
      parts.push(...partitionByLabel(child));
    }
    return parts;
  }
  // Non-partitionable nodes with EXACTLY ONE exposed child are
  // transparent for label propagation — they wrap their child's
  // surface (transforms, shells, twists, subtract's A side). The
  // child's label semantically applies to the wrapping geometry too.
  // Multi-child non-partitionable nodes (smooth booleans, intersect)
  // stop propagation because the result's surface mixes both inputs
  // and "which label wins" is ambiguous — the user should label the
  // outer expression instead.
  if (root._children.length === 1) {
    const inner = findPropagatableLabel(root._children[0]);
    if (inner !== undefined) {
      return [{ node: root, labelName: inner }];
    }
  }
  return [{ node: root }];
}

function hasLabelledDescendant(node: SdfNode): boolean {
  if (node.labelName !== undefined) return true;
  for (const c of node._children) {
    if (hasLabelledDescendant(c)) return true;
  }
  return false;
}

/** Find a label to propagate up through a single-child chain. Stops at
 *  multi-child non-partitionable nodes (e.g. smoothUnion) because
 *  propagating either child's label there would be arbitrary. */
function findPropagatableLabel(node: SdfNode): string | undefined {
  if (node.labelName !== undefined) return node.labelName;
  if (node._children.length === 1) {
    return findPropagatableLabel(node._children[0]);
  }
  return undefined;
}

// --- Primitives ---------------------------------------------------------

function leafNode(kind: string, evalFn: EvalFn, bounds: Box): SdfNode {
  return new SdfNode({ kind, eval: evalFn, bounds, children: [], partitionable: false });
}

/** Sphere centered at the origin. */
function primSphere(radius: number): SdfNode {
  assertNumber(radius, 'sphere(radius)', { min: 1e-6 });
  const r = radius as number;
  return leafNode(
    'sphere',
    (x, y, z) => Math.sqrt(x * x + y * y + z * z) - r,
    { min: [-r, -r, -r], max: [r, r, r] },
  );
}

/** Axis-aligned box centered at the origin with the given full size. */
function primBox(size: Vec3 | number): SdfNode {
  const s = typeof size === 'number'
    ? assertNumber(size, 'box(size)', { min: 1e-6 }) as number
    : null;
  let sx: number, sy: number, sz: number;
  if (s !== null) {
    sx = sy = sz = s;
  } else {
    const tup = assertNumberTuple(size, 3, 'box(size)');
    if (tup[0] <= 0 || tup[1] <= 0 || tup[2] <= 0) {
      throw new ValidationError('box(size): every component must be > 0');
    }
    [sx, sy, sz] = tup;
  }
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  return leafNode(
    'box',
    (x, y, z) => {
      const qx = Math.abs(x) - hx;
      const qy = Math.abs(y) - hy;
      const qz = Math.abs(z) - hz;
      const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
      const outside = Math.sqrt(ox * ox + oy * oy + oz * oz);
      const inside = Math.min(Math.max(qx, Math.max(qy, qz)), 0);
      return outside + inside;
    },
    { min: [-hx, -hy, -hz], max: [hx, hy, hz] },
  );
}

/** Box with rounded edges. `radius` is the round-over. The OUTER size
 *  stays `size` — we shrink the core box by 2*radius on each axis and
 *  round it back out, so `roundedBox([10,10,10], 2)` is a 10×10×10 box
 *  with 2-unit rounded edges (NOT 14×14×14). radius must be < half the
 *  smallest dimension. */
function primRoundedBox(size: Vec3 | number, radius: number): SdfNode {
  assertNumber(radius, 'roundedBox(radius)', { min: 0 });
  const r = radius as number;
  // Resolve size to a tuple so we can shrink it.
  let sx: number, sy: number, sz: number;
  if (typeof size === 'number') {
    assertNumber(size, 'roundedBox(size)', { min: 1e-6 });
    sx = sy = sz = size;
  } else {
    const tup = assertNumberTuple(size, 3, 'roundedBox(size)');
    [sx, sy, sz] = tup;
  }
  if (r === 0) return primBox([sx, sy, sz]);
  const minDim = Math.min(sx, sy, sz);
  if (2 * r >= minDim) {
    throw new ValidationError(`roundedBox(size, radius): radius (${r}) must be < half the smallest dimension (${minDim / 2}).`);
  }
  return primBox([sx - 2 * r, sy - 2 * r, sz - 2 * r]).round(r);
}

/** Cylinder with rounded top/bottom edges. Like `roundedBox`, the OUTER
 *  radius and height stay as given — the core is shrunk and rounded back
 *  out, so `roundedCylinder(5, 20, 1)` has radius 5 and height 20 with a
 *  1-unit edge fillet (NOT radius 6 / height 22 the way `.round(1)` on a
 *  plain cylinder would give). edgeRadius must be < radius and < height/2. */
function primRoundedCylinder(radius: number, height: number, edgeRadius: number): SdfNode {
  assertNumber(radius, 'roundedCylinder(radius)', { min: 1e-6 });
  assertNumber(height, 'roundedCylinder(height)', { min: 1e-6 });
  assertNumber(edgeRadius, 'roundedCylinder(edgeRadius)', { min: 0 });
  const er = edgeRadius as number;
  if (er === 0) return primCylinder(radius, height);
  if (er >= (radius as number)) {
    throw new ValidationError(`roundedCylinder(radius, height, edgeRadius): edgeRadius (${er}) must be < radius (${radius}).`);
  }
  if (2 * er >= (height as number)) {
    throw new ValidationError(`roundedCylinder(radius, height, edgeRadius): edgeRadius (${er}) must be < half the height (${(height as number) / 2}).`);
  }
  return primCylinder((radius as number) - er, (height as number) - 2 * er).round(er);
}

/** Ellipsoid centered at the origin with semi-axes rx, ry, rz. Uses
 *  Inigo Quilez's bounded distance approximation — exact on the surface,
 *  slightly off in magnitude inside/outside (which marching tetrahedra
 *  tolerates). This recovers the "squashed sphere" that uniform `.scale()`
 *  intentionally can't produce. */
function primEllipsoid(rx: number, ry: number, rz: number): SdfNode {
  assertNumber(rx, 'ellipsoid(rx)', { min: 1e-6 });
  assertNumber(ry, 'ellipsoid(ry)', { min: 1e-6 });
  assertNumber(rz, 'ellipsoid(rz)', { min: 1e-6 });
  const ax = rx as number, ay = ry as number, az = rz as number;
  const minR = Math.min(ax, ay, az);
  return leafNode(
    'ellipsoid',
    (x, y, z) => {
      const k0 = Math.sqrt((x / ax) ** 2 + (y / ay) ** 2 + (z / az) ** 2);
      const k1 = Math.sqrt((x / (ax * ax)) ** 2 + (y / (ay * ay)) ** 2 + (z / (az * az)) ** 2);
      // At the exact centre both are 0 (0/0) — the deepest interior
      // point, so just report the most-negative distance there.
      if (k1 < 1e-12) return -minR;
      return (k0 * (k0 - 1)) / k1;
    },
    { min: [-ax, -ay, -az], max: [ax, ay, az] },
  );
}

/** Cylinder of radius `r` and height `h`, centered at the origin and
 *  aligned to Z (z=-h/2 to z=h/2). Matches the manifold-3d convention of
 *  cylinders being Z-aligned. */
function primCylinder(radius: number, height: number): SdfNode {
  assertNumber(radius, 'cylinder(radius)', { min: 1e-6 });
  assertNumber(height, 'cylinder(height)', { min: 1e-6 });
  const r = radius as number;
  const h = height as number;
  const hh = h / 2;
  return leafNode(
    'cylinder',
    (x, y, z) => {
      const dx = Math.sqrt(x * x + y * y) - r;
      const dz = Math.abs(z) - hh;
      const ox = Math.max(dx, 0), oz = Math.max(dz, 0);
      const outside = Math.sqrt(ox * ox + oz * oz);
      const inside = Math.min(Math.max(dx, dz), 0);
      return outside + inside;
    },
    { min: [-r, -r, -hh], max: [r, r, hh] },
  );
}

/** Torus in the XY plane: major radius `R`, tube radius `r`. */
function primTorus(majorRadius: number, minorRadius: number): SdfNode {
  assertNumber(majorRadius, 'torus(majorRadius)', { min: 1e-6 });
  assertNumber(minorRadius, 'torus(minorRadius)', { min: 1e-6 });
  const R = majorRadius as number;
  const r = minorRadius as number;
  return leafNode(
    'torus',
    (x, y, z) => {
      const q = Math.sqrt(x * x + y * y) - R;
      return Math.sqrt(q * q + z * z) - r;
    },
    { min: [-(R + r), -(R + r), -r], max: [R + r, R + r, r] },
  );
}

/** Capsule between two points with the given radius. */
function primCapsule(a: Vec3, b: Vec3, radius: number): SdfNode {
  const A = assertNumberTuple(a, 3, 'capsule(a)') as Vec3;
  const B = assertNumberTuple(b, 3, 'capsule(b)') as Vec3;
  assertNumber(radius, 'capsule(radius)', { min: 1e-6 });
  const r = radius as number;
  const dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2];
  const ll = dx * dx + dy * dy + dz * dz;
  if (ll < 1e-12) {
    throw new ValidationError('capsule(a, b, radius): a and b must be distinct points.');
  }
  return leafNode(
    'capsule',
    (x, y, z) => {
      const px = x - A[0], py = y - A[1], pz = z - A[2];
      let t = (px * dx + py * dy + pz * dz) / ll;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      const cx = px - dx * t, cy = py - dy * t, cz = pz - dz * t;
      return Math.sqrt(cx * cx + cy * cy + cz * cz) - r;
    },
    {
      min: [Math.min(A[0], B[0]) - r, Math.min(A[1], B[1]) - r, Math.min(A[2], B[2]) - r],
      max: [Math.max(A[0], B[0]) + r, Math.max(A[1], B[1]) + r, Math.max(A[2], B[2]) + r],
    },
  );
}

const INFINITE_BOUNDS: Box = {
  min: [-Infinity, -Infinity, -Infinity],
  max: [Infinity, Infinity, Infinity],
};

/** Shared builder for triply-periodic minimal surfaces (TPMS). `field`
 *  receives the cell-scaled coordinates (kx, ky, kz) and returns the
 *  implicit value whose zero-set is the surface; we wrap it as a shell
 *  of `thickness` (|field| - t) and divide by k to roughly normalize the
 *  gradient. All TPMS are infinite — caller must intersect with a finite
 *  shape or pass explicit `bounds` to .build(). */
function tpmsNode(
  kind: string,
  cellSize: number,
  thickness: number,
  field: (kx: number, ky: number, kz: number) => number,
): SdfNode {
  assertNumber(cellSize, `${kind}(cellSize)`, { min: 1e-6 });
  assertNumber(thickness, `${kind}(thickness)`, { min: 0 });
  const k = (2 * Math.PI) / (cellSize as number);
  const t = thickness as number;
  return new SdfNode({
    kind,
    eval: (x, y, z) => (Math.abs(field(k * x, k * y, k * z)) - t) / k,
    bounds: INFINITE_BOUNDS,
    children: [],
    partitionable: false,
  });
}

/** Gyroid TPMS — the famous one. `cellSize` is the period; `thickness`
 *  is the shell width (0 = bare surface). Infinite — intersect or pass
 *  bounds. */
function primGyroid(cellSize: number, thickness: number): SdfNode {
  return tpmsNode('gyroid', cellSize, thickness, (x, y, z) =>
    Math.sin(x) * Math.cos(y) + Math.sin(y) * Math.cos(z) + Math.sin(z) * Math.cos(x));
}

/** Schwarz Primitive (P) TPMS — a rounded-cubic cell lattice, blockier
 *  than the gyroid. Same (cellSize, thickness) contract; infinite. */
function primSchwarzP(cellSize: number, thickness: number): SdfNode {
  return tpmsNode('schwarzP', cellSize, thickness, (x, y, z) =>
    Math.cos(x) + Math.cos(y) + Math.cos(z));
}

/** Schwarz Diamond (D) TPMS — interpenetrating diamond channels, the
 *  "scaffold" look. Same (cellSize, thickness) contract; infinite. */
function primDiamond(cellSize: number, thickness: number): SdfNode {
  return tpmsNode('diamond', cellSize, thickness, (x, y, z) => {
    const sx = Math.sin(x), cx = Math.cos(x);
    const sy = Math.sin(y), cy = Math.cos(y);
    const sz = Math.sin(z), cz = Math.cos(z);
    return sx * sy * sz + sx * cy * cz + cx * sy * cz + cx * cy * sz;
  });
}

/** Lidinoid TPMS — a higher-genus surface with a woven appearance. Uses
 *  double-frequency terms. Same (cellSize, thickness) contract; infinite. */
function primLidinoid(cellSize: number, thickness: number): SdfNode {
  return tpmsNode('lidinoid', cellSize, thickness, (x, y, z) => {
    const s2x = Math.sin(2 * x), s2y = Math.sin(2 * y), s2z = Math.sin(2 * z);
    const c2x = Math.cos(2 * x), c2y = Math.cos(2 * y), c2z = Math.cos(2 * z);
    const sx = Math.sin(x), sy = Math.sin(y), sz = Math.sin(z);
    const cx = Math.cos(x), cy = Math.cos(y), cz = Math.cos(z);
    return 0.5 * (s2x * cy * sz + s2y * cz * sx + s2z * cx * sy)
      - 0.5 * (c2x * c2y + c2y * c2z + c2z * c2x) + 0.15;
  });
}

/** Shared builder for graded-thickness TPMS — the constant-thickness
 *  cousin of `tpmsNode`. `thicknessFn(x,y,z)` returns the local wall
 *  thickness in world units; called millions of times during meshing,
 *  so keep it cheap. All graded TPMS are infinite — caller must
 *  intersect with a finite shape or pass explicit `bounds` to .build(). */
function gradedTpmsNode(
  kind: string,
  cellSize: number,
  thicknessFn: (x: number, y: number, z: number) => number,
  field: (kx: number, ky: number, kz: number) => number,
): SdfNode {
  assertNumber(cellSize, `${kind}(cellSize)`, { min: 1e-6 });
  assertFunction(thicknessFn, `${kind}(thicknessFn)`);
  const k = (2 * Math.PI) / (cellSize as number);
  return new SdfNode({
    kind,
    eval: (x, y, z) => {
      const f = field(k * x, k * y, k * z);
      const t = thicknessFn(x, y, z);
      // Guard against a user fn returning non-number — fall back to a
      // bare surface (t=0) rather than poisoning the mesh with NaN.
      const tt = typeof t === 'number' && Number.isFinite(t) ? Math.max(t, 0) : 0;
      return (Math.abs(f) - tt) / k;
    },
    bounds: INFINITE_BOUNDS,
    children: [],
    partitionable: false,
  });
}

/** Gyroid whose wall thickness varies through space. */
function primGradedGyroid(cellSize: number, thicknessFn: (x: number, y: number, z: number) => number): SdfNode {
  return gradedTpmsNode('gradedGyroid', cellSize, thicknessFn, (x, y, z) =>
    Math.sin(x) * Math.cos(y) + Math.sin(y) * Math.cos(z) + Math.sin(z) * Math.cos(x));
}

/** Schwarz Primitive with spatially-varying wall thickness. */
function primGradedSchwarzP(cellSize: number, thicknessFn: (x: number, y: number, z: number) => number): SdfNode {
  return gradedTpmsNode('gradedSchwarzP', cellSize, thicknessFn, (x, y, z) =>
    Math.cos(x) + Math.cos(y) + Math.cos(z));
}

/** Schwarz Diamond with spatially-varying wall thickness. */
function primGradedDiamond(cellSize: number, thicknessFn: (x: number, y: number, z: number) => number): SdfNode {
  return gradedTpmsNode('gradedDiamond', cellSize, thicknessFn, (x, y, z) => {
    const sx = Math.sin(x), cx = Math.cos(x);
    const sy = Math.sin(y), cy = Math.cos(y);
    const sz = Math.sin(z), cz = Math.cos(z);
    return sx * sy * sz + sx * cy * cz + cx * sy * cz + cx * cy * sz;
  });
}

/** Lidinoid with spatially-varying wall thickness. */
function primGradedLidinoid(cellSize: number, thicknessFn: (x: number, y: number, z: number) => number): SdfNode {
  return gradedTpmsNode('gradedLidinoid', cellSize, thicknessFn, (x, y, z) => {
    const s2x = Math.sin(2 * x), s2y = Math.sin(2 * y), s2z = Math.sin(2 * z);
    const c2x = Math.cos(2 * x), c2y = Math.cos(2 * y), c2z = Math.cos(2 * z);
    const sx = Math.sin(x), sy = Math.sin(y), sz = Math.sin(z);
    const cx = Math.cos(x), cy = Math.cos(y), cz = Math.cos(z);
    return 0.5 * (s2x * cy * sz + s2y * cz * sx + s2z * cx * sy)
      - 0.5 * (c2x * c2y + c2y * c2z + c2z * c2x) + 0.15;
  });
}

// --- Boolean operations -------------------------------------------------

function opUnion(a: SdfNode, b: SdfNode): SdfNode {
  return new SdfNode({
    kind: 'union',
    eval: (x, y, z) => Math.min(a._eval(x, y, z), b._eval(x, y, z)),
    bounds: bbUnion(a._bounds, b._bounds),
    children: [a, b],
    partitionable: true,
  });
}

function opSubtract(a: SdfNode, b: SdfNode): SdfNode {
  return new SdfNode({
    kind: 'subtract',
    eval: (x, y, z) => Math.max(a._eval(x, y, z), -b._eval(x, y, z)),
    // A minus B can't extend beyond A — A's bounds are a safe outer cap.
    bounds: a._bounds,
    // Only the first child (the thing being subtracted FROM) is exposed
    // to the partitioner. The B side is a carving tool — its labels
    // would refer to surfaces that no longer exist post-subtract — so
    // we deliberately hide it. This lets A's label propagate through
    // subtract (e.g. `sphere.label('shell').subtract(hole)` paints
    // 'shell') without exposing meaningless B labels.
    children: [a],
    partitionable: false,
  });
}

function opIntersect(a: SdfNode, b: SdfNode): SdfNode {
  return new SdfNode({
    kind: 'intersect',
    eval: (x, y, z) => Math.max(a._eval(x, y, z), b._eval(x, y, z)),
    bounds: bbIntersect(a._bounds, b._bounds),
    children: [a, b],
    partitionable: false,
  });
}

function opSmoothUnion(a: SdfNode, b: SdfNode, k: number): SdfNode {
  return new SdfNode({
    kind: 'smoothUnion',
    eval: (x, y, z) => {
      const da = a._eval(x, y, z), db = b._eval(x, y, z);
      const h = clamp(0.5 + 0.5 * (db - da) / k, 0, 1);
      return mix(db, da, h) - k * h * (1 - h);
    },
    // Smooth union may extend slightly beyond the sharp union (the
    // blend bulges outward by up to ~k/4). Expand a touch to keep the
    // mesh bounds safe.
    bounds: bbExpand(bbUnion(a._bounds, b._bounds), k * 0.5),
    children: [a, b],
    // Smooth booleans collapse to a hard union when split by label, so
    // partitioning destroys the smoothness. Treat as a single piece;
    // the user labels the smooth union as a whole if they want paint.
    partitionable: false,
  });
}

function opSmoothSubtract(a: SdfNode, b: SdfNode, k: number): SdfNode {
  return new SdfNode({
    kind: 'smoothSubtract',
    eval: (x, y, z) => {
      const da = a._eval(x, y, z), db = b._eval(x, y, z);
      const h = clamp(0.5 - 0.5 * (db + da) / k, 0, 1);
      return mix(da, -db, h) + k * h * (1 - h);
    },
    // The smooth-subtract seam can push the iso-surface up to ~k/4
    // outward near the blend, same as smoothUnion. Expand by k*0.5
    // so the mesh bbox doesn't crop a lid into the blend region.
    bounds: bbExpand(a._bounds, k * 0.5),
    // Only the first child is exposed to the partitioner — same as
    // sharp opSubtract. The B side is a carving tool whose surface
    // contribution is the soft "bite", not paintable real estate, so
    // labels on B can never resolve. Exposing only [a] lets the A-side
    // label propagate up through the smooth subtract (the result IS
    // A's surface, with a softened pocket), matching sharp-subtract
    // semantics and avoiding the silent label-drop trap.
    children: [a],
    partitionable: false,
  });
}

function opSmoothIntersect(a: SdfNode, b: SdfNode, k: number): SdfNode {
  return new SdfNode({
    kind: 'smoothIntersect',
    eval: (x, y, z) => {
      const da = a._eval(x, y, z), db = b._eval(x, y, z);
      const h = clamp(0.5 - 0.5 * (db - da) / k, 0, 1);
      return mix(db, da, h) + k * h * (1 - h);
    },
    // Same blend-bulge concern as smoothUnion/Subtract — expand the
    // sharp-intersect bbox so the meshed iso-surface closes cleanly.
    bounds: bbExpand(bbIntersect(a._bounds, b._bounds), k * 0.5),
    children: [a, b],
    partitionable: false,
  });
}

// --- Transforms ---------------------------------------------------------

function parseVec3(opName: string, a: Vec3 | number, b?: number, c?: number): Vec3 {
  if (typeof a === 'number') {
    assertNumber(a, `${opName}(x)`);
    assertNumber(b, `${opName}(y)`);
    assertNumber(c, `${opName}(z)`);
    return [a, b as number, c as number];
  }
  return assertNumberTuple(a, 3, `${opName}(v)`) as Vec3;
}

function opTranslate(child: SdfNode, t: Vec3): SdfNode {
  const [tx, ty, tz] = t;
  return new SdfNode({
    kind: 'translate',
    eval: (x, y, z) => child._eval(x - tx, y - ty, z - tz),
    bounds: {
      min: [child._bounds.min[0] + tx, child._bounds.min[1] + ty, child._bounds.min[2] + tz],
      max: [child._bounds.max[0] + tx, child._bounds.max[1] + ty, child._bounds.max[2] + tz],
    },
    children: [child],
    partitionable: false,
  });
}

function opRotate(child: SdfNode, r: Vec3): SdfNode {
  // Manifold's rotate is X -> Y -> Z applied in that order. Match it.
  const rx = r[0] * DEG, ry = r[1] * DEG, rz = r[2] * DEG;
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  // Forward matrix R = Rz * Ry * Rx (applied to a column vector =
  // rotate X then Y then Z).
  const m00 = cy * cz, m01 = sx * sy * cz - cx * sz, m02 = cx * sy * cz + sx * sz;
  const m10 = cy * sz, m11 = sx * sy * sz + cx * cz, m12 = cx * sy * sz - sx * cz;
  const m20 = -sy,     m21 = sx * cy,                m22 = cx * cy;
  // For the SDF we need the INVERSE rotation applied to the query
  // point: evaluate child at R^T * p (rotation matrices are orthogonal,
  // R^-1 = R^T).
  return new SdfNode({
    kind: 'rotate',
    eval: (x, y, z) => child._eval(
      m00 * x + m10 * y + m20 * z,
      m01 * x + m11 * y + m21 * z,
      m02 * x + m12 * y + m22 * z,
    ),
    bounds: bbTransformCorners(child._bounds, ([x, y, z]) => [
      m00 * x + m01 * y + m02 * z,
      m10 * x + m11 * y + m12 * z,
      m20 * x + m21 * y + m22 * z,
    ]),
    children: [child],
    partitionable: false,
  });
}

function opScale(child: SdfNode, s: number): SdfNode {
  const inv = 1 / s;
  return new SdfNode({
    kind: 'scale',
    eval: (x, y, z) => child._eval(x * inv, y * inv, z * inv) * s,
    bounds: {
      min: [child._bounds.min[0] * s, child._bounds.min[1] * s, child._bounds.min[2] * s],
      max: [child._bounds.max[0] * s, child._bounds.max[1] * s, child._bounds.max[2] * s],
    },
    children: [child],
    partitionable: false,
  });
}

function opMirror(child: SdfNode, axis: 'x' | 'y' | 'z'): SdfNode {
  return new SdfNode({
    kind: 'mirror',
    eval: axis === 'x'
      ? (x, y, z) => child._eval(-x, y, z)
      : axis === 'y'
        ? (x, y, z) => child._eval(x, -y, z)
        : (x, y, z) => child._eval(x, y, -z),
    bounds: (() => {
      const b = child._bounds;
      if (axis === 'x') return { min: [-b.max[0], b.min[1], b.min[2]] as Vec3, max: [-b.min[0], b.max[1], b.max[2]] as Vec3 };
      if (axis === 'y') return { min: [b.min[0], -b.max[1], b.min[2]] as Vec3, max: [b.max[0], -b.min[1], b.max[2]] as Vec3 };
      return { min: [b.min[0], b.min[1], -b.max[2]] as Vec3, max: [b.max[0], b.max[1], -b.min[2]] as Vec3 };
    })(),
    children: [child],
    partitionable: false,
  });
}

function opShell(child: SdfNode, thickness: number): SdfNode {
  // |f| - t — solid of given thickness centered on the original surface.
  // The shell is the surface offset both inward and outward by t/2.
  const half = thickness / 2;
  return new SdfNode({
    kind: 'shell',
    eval: (x, y, z) => Math.abs(child._eval(x, y, z)) - half,
    bounds: bbExpand(child._bounds, half),
    children: [child],
    partitionable: false,
  });
}

function opRound(child: SdfNode, r: number): SdfNode {
  // f - r — pushes the iso-surface outward by r, rounding sharp edges
  // and growing the shape by r in every direction.
  return new SdfNode({
    kind: 'round',
    eval: (x, y, z) => child._eval(x, y, z) - r,
    bounds: bbExpand(child._bounds, r),
    children: [child],
    partitionable: false,
  });
}

function opTwist(child: SdfNode, degPerUnit: number, axis: 'x' | 'y' | 'z', center: [number, number] = [0, 0]): SdfNode {
  // Twist the cross-section by `rate` radians per unit along `axis`,
  // around a line offset by `center` (the [u, v] coords in the plane
  // perpendicular to `axis`). Note: this is not a true SDF — the swept
  // geometry is correct, but the field is a Lipschitz approximation.
  // Marching tetrahedra still produces a watertight mesh.
  const rate = degPerUnit * DEG;
  const [cu, cv] = center;
  let evalFn: EvalFn;
  if (axis === 'z') {
    evalFn = (x, y, z) => {
      const px = x - cu, py = y - cv;
      const a = z * rate;
      const c = Math.cos(a), s = Math.sin(a);
      return child._eval(c * px + s * py + cu, -s * px + c * py + cv, z);
    };
  } else if (axis === 'y') {
    evalFn = (x, y, z) => {
      const px = x - cu, pz = z - cv;
      const a = y * rate;
      const c = Math.cos(a), s = Math.sin(a);
      return child._eval(c * px + s * pz + cu, y, -s * px + c * pz + cv);
    };
  } else {
    evalFn = (x, y, z) => {
      const py = y - cu, pz = z - cv;
      const a = x * rate;
      const c = Math.cos(a), s = Math.sin(a);
      return child._eval(x, c * py + s * pz + cu, -s * py + c * pz + cv);
    };
  }
  // After twist, the swept volume is a disc of radius = the farthest
  // in-plane bbox corner FROM THE CENTRE (so an offset axis enlarges the
  // sweep). Measure from `center` and recentre the perpendicular bounds
  // on it. Reduces to the origin-centred case when center is [0, 0].
  const b = child._bounds;
  const inPlaneSweep = (u0: number, u1: number, v0: number, v1: number): number => {
    const du = Math.max(Math.abs(u0 - cu), Math.abs(u1 - cu));
    const dv = Math.max(Math.abs(v0 - cv), Math.abs(v1 - cv));
    return Math.hypot(du, dv);
  };
  let bounds: Box;
  if (axis === 'z') {
    const r = inPlaneSweep(b.min[0], b.max[0], b.min[1], b.max[1]);
    bounds = { min: [cu - r, cv - r, b.min[2]], max: [cu + r, cv + r, b.max[2]] };
  } else if (axis === 'y') {
    const r = inPlaneSweep(b.min[0], b.max[0], b.min[2], b.max[2]);
    bounds = { min: [cu - r, b.min[1], cv - r], max: [cu + r, b.max[1], cv + r] };
  } else {
    const r = inPlaneSweep(b.min[1], b.max[1], b.min[2], b.max[2]);
    bounds = { min: [b.min[0], cu - r, cv - r], max: [b.max[0], cu + r, cv + r] };
  }
  return new SdfNode({ kind: 'twist', eval: evalFn, bounds, children: [child], partitionable: false });
}

function opBend(child: SdfNode, degPerUnit: number, axis: 'x' | 'y' | 'z'): SdfNode {
  // Bend rotates the cross-section perpendicular to `axis` by an angle
  // proportional to distance along that axis. Same Lipschitz caveat as
  // twist. Conventions:
  //   axis='x' → bend in XY plane (rotation around Z is a function of X)
  //   axis='y' → bend in YZ plane (rotation around X is a function of Y)
  //   axis='z' → bend in XZ plane (rotation around Y is a function of Z)
  const rate = degPerUnit * DEG;
  let evalFn: EvalFn;
  if (axis === 'x') {
    evalFn = (x, y, z) => {
      const a = x * rate;
      const c = Math.cos(a), s = Math.sin(a);
      return child._eval(c * x + s * y, -s * x + c * y, z);
    };
  } else if (axis === 'y') {
    evalFn = (x, y, z) => {
      const a = y * rate;
      const c = Math.cos(a), s = Math.sin(a);
      return child._eval(x, c * y + s * z, -s * y + c * z);
    };
  } else {
    evalFn = (x, y, z) => {
      const a = z * rate;
      const c = Math.cos(a), s = Math.sin(a);
      return child._eval(c * x + s * z, y, -s * x + c * z);
    };
  }
  // Conservative bound: same diagonal heuristic as twist.
  const b = child._bounds;
  const ext = Math.max(
    Math.hypot(b.min[0], b.min[1], b.min[2]),
    Math.hypot(b.max[0], b.max[1], b.max[2]),
  );
  return new SdfNode({
    kind: 'bend',
    eval: evalFn,
    bounds: { min: [-ext, -ext, -ext], max: [ext, ext, ext] },
    children: [child],
    partitionable: false,
  });
}

function opTaper(child: SdfNode, rate: number, axis: 'x' | 'y' | 'z'): SdfNode {
  // Scale the cross-section perpendicular to `axis` by s = 1 + rate*a,
  // where `a` is the coordinate along the axis. Like twist/bend, this is
  // a Lipschitz approximation, not a true SDF; we multiply by min(s, 1)
  // to keep the field from OVER-estimating distance in the widened
  // region (under-estimating is the safe direction for marching).
  const MIN_S = 1e-3; // floor so a steep taper can't invert the cross-section
  let evalFn: EvalFn;
  if (axis === 'z') {
    evalFn = (x, y, z) => {
      let s = 1 + rate * z;
      if (s < MIN_S) s = MIN_S;
      return child._eval(x / s, y / s, z) * Math.min(s, 1);
    };
  } else if (axis === 'y') {
    evalFn = (x, y, z) => {
      let s = 1 + rate * y;
      if (s < MIN_S) s = MIN_S;
      return child._eval(x / s, y, z / s) * Math.min(s, 1);
    };
  } else {
    evalFn = (x, y, z) => {
      let s = 1 + rate * x;
      if (s < MIN_S) s = MIN_S;
      return child._eval(x, y / s, z / s) * Math.min(s, 1);
    };
  }
  // The cross-section grows by up to smax = max scale over the axis
  // range; expand the perpendicular bounds by that factor.
  const b = child._bounds;
  const axisIdx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  const sLo = 1 + rate * b.min[axisIdx];
  const sHi = 1 + rate * b.max[axisIdx];
  const smax = Math.max(Math.abs(sLo), Math.abs(sHi), 1);
  const min: Vec3 = [...b.min] as Vec3;
  const max: Vec3 = [...b.max] as Vec3;
  for (let i = 0; i < 3; i++) {
    if (i === axisIdx) continue;
    min[i] = b.min[i] * smax;
    max[i] = b.max[i] * smax;
  }
  return new SdfNode({ kind: 'taper', eval: evalFn, bounds: { min, max }, children: [child], partitionable: false });
}

export interface PolarArrayOptions {
  axis?: 'x' | 'y' | 'z';
  /** Total sweep in degrees. 360 (default) = full ring, no seam dup. */
  angle?: number;
  /** Push each copy outward (along the first perpendicular axis) by this
   *  much before rotating. */
  radius?: number;
}

export interface PolarRepeatOptions {
  axis?: 'x' | 'y' | 'z';
  /** Push the seed outward (along the first perpendicular axis) by this
   *  much before tiling — same convention as polarArray. */
  radius?: number;
}

export interface RepeatNStaggerOptions {
  /** Axis the cells SHIFT ALONG (X for a brick wall). */
  along: 'x' | 'y' | 'z';
  /** Axis whose row parity DECIDES the shift (Y for a brick wall — every
   *  other Y row is shifted). Must differ from `along`. */
  by: 'x' | 'y' | 'z';
  /** Shift size as a fraction of `along`'s period. Defaults to 0.5
   *  (classic brick half-bond). 0 disables; 1 means a full period (which
   *  reads as no stagger because each shifted row aligns with the next
   *  unshifted column). Range [0, 1]. */
  amount?: number;
}

export interface RepeatNOptions {
  stagger?: RepeatNStaggerOptions;
}

const POLAR_FIELDS = ['axis', 'angle', 'radius'] as const;
const POLAR_REPEAT_FIELDS = ['axis', 'radius'] as const;
const REPEAT_N_FIELDS = ['stagger'] as const;
const STAGGER_FIELDS = ['along', 'by', 'amount'] as const;

function opPolarArray(child: SdfNode, count: number, opts: PolarArrayOptions): SdfNode {
  assertNumber(count, 'polarArray(count)', { min: 1, integer: true });
  const o = assertObject(opts, 'polarArray(opts)') ?? {};
  assertNoUnknownKeys(o as Record<string, unknown>, POLAR_FIELDS, 'polarArray(opts)');
  const axis = o.axis === undefined ? 'z' : assertEnum(o.axis, ['x', 'y', 'z'] as const, 'polarArray(axis)');
  const angle = o.angle === undefined ? 360 : assertNumber(o.angle, 'polarArray(angle)') as number;
  const radius = o.radius === undefined ? 0 : assertNumber(o.radius, 'polarArray(radius)', { min: 0 }) as number;
  const n = count as number;

  // Optionally push the source copy out along the first axis
  // perpendicular to the rotation axis (matches meshOps.circularPattern).
  let seed = child;
  if (radius > 0) {
    const push: Vec3 = axis === 'z' ? [radius, 0, 0] : axis === 'x' ? [0, radius, 0] : [0, 0, radius];
    seed = opTranslate(child, push);
  }
  // Full-circle: N copies at 360/N (no duplicate at the seam). Partial:
  // endpoints inclusive, step = angle/(N-1).
  const full = Math.abs(angle) === 360;
  const step = full ? angle / n : (n > 1 ? angle / (n - 1) : 0);
  const rotVec = (deg: number): Vec3 => axis === 'z' ? [0, 0, deg] : axis === 'x' ? [deg, 0, 0] : [0, deg, 0];

  let acc: SdfNode = opRotate(seed, rotVec(0));
  for (let i = 1; i < n; i++) {
    acc = opUnion(acc, opRotate(seed, rotVec(i * step)));
  }
  return acc;
}

function opRepeat(child: SdfNode, periods: Vec3): SdfNode {
  const [px, py, pz] = periods;
  // Centred modulo: maps each cell onto one around the origin. A period
  // of 0 means "don't repeat on this axis".
  const pmod = (v: number, p: number): number => (p > 0 ? v - p * Math.round(v / p) : v);
  const b = child._bounds;
  // Repeated axes become infinite; non-repeated keep the child's extent.
  const min: Vec3 = [
    px > 0 ? -Infinity : b.min[0],
    py > 0 ? -Infinity : b.min[1],
    pz > 0 ? -Infinity : b.min[2],
  ];
  const max: Vec3 = [
    px > 0 ? Infinity : b.max[0],
    py > 0 ? Infinity : b.max[1],
    pz > 0 ? Infinity : b.max[2],
  ];
  return new SdfNode({
    kind: 'repeat',
    eval: (x, y, z) => child._eval(pmod(x, px), pmod(y, py), pmod(z, pz)),
    bounds: { min, max },
    children: [child],
    partitionable: false,
  });
}

interface ResolvedStagger {
  along: 'x' | 'y' | 'z';
  by: 'x' | 'y' | 'z';
  amount: number;
}

function opRepeatN(child: SdfNode, counts: Vec3, periods: Vec3, stagger?: ResolvedStagger): SdfNode {
  // Finite-count cousin of opRepeat. Centred on the origin: N copies on
  // each axis with N>0 span (N-1)*period. Points outside that span snap
  // to the nearest cell (Inigo Quilez's `clampedRepeat` trick) — gives
  // the boundary cells a "filled-in" distance field without leaking the
  // tiling beyond the array. count=0 on an axis means "don't repeat
  // there" (pass-through, same as opRepeat).
  //
  // Optional `stagger` brick-shifts alternating rows: cells in every
  // other row along the `by` axis get nudged by `amount * period`
  // along the `along` axis. Coupling the two axes via the by-row
  // parity means the modulo has to be computed in a specific order:
  // resolve the by-axis cell FIRST (so we know which row we're in),
  // THEN apply the offset, THEN resolve along's cell.
  const [nx, ny, nz] = counts;
  const [px, py, pz] = periods;
  // Per-axis cell-index limits, centred on the origin:
  // - N=1: only cell 0.
  // - even N: cells [-N/2 .. N/2-1] (origin lies on the boundary between two cells).
  // - odd  N: cells [-(N-1)/2 .. (N-1)/2] (origin is centred on a cell).
  // This matches the visual "ring of N copies symmetric about the origin".
  const cellMin = (n: number): number => n > 0 ? -Math.floor(n / 2) : 0;
  const cellMax = (n: number): number => n > 0 ? Math.ceil(n / 2) - 1 : 0;
  const cellIdx = (v: number, p: number, n: number): number => {
    if (n <= 0 || p <= 0 || n === 1) return 0;
    return Math.max(cellMin(n), Math.min(cellMax(n), Math.round(v / p)));
  };
  const lmod = (v: number, p: number, n: number): number => {
    if (n <= 0 || p <= 0 || n === 1) return v;
    return v - cellIdx(v, p, n) * p;
  };
  let evalFn: EvalFn;
  if (!stagger) {
    evalFn = (x, y, z) => child._eval(lmod(x, px, nx), lmod(y, py, ny), lmod(z, pz, nz));
  } else {
    const alongIdx = stagger.along === 'x' ? 0 : stagger.along === 'y' ? 1 : 2;
    const byIdx = stagger.by === 'x' ? 0 : stagger.by === 'y' ? 1 : 2;
    const byP = periods[byIdx], byN = counts[byIdx];
    const shift = stagger.amount * periods[alongIdx];
    evalFn = (x, y, z) => {
      const v: Vec3 = [x, y, z];
      // Resolve the by-axis row FIRST.
      const cBy = cellIdx(v[byIdx], byP, byN);
      // Apply the along-axis offset based on row parity.
      const offset = (Math.abs(cBy) % 2 === 1) ? shift : 0;
      v[alongIdx] -= offset;
      // Now reduce all three axes.
      return child._eval(
        lmod(v[0], px, nx),
        lmod(v[1], py, ny),
        lmod(v[2], pz, nz),
      );
    };
  }
  const b = child._bounds;
  const axisBounds = (n: number, p: number, lo: number, hi: number): [number, number] => {
    if (n <= 0 || p <= 0 || n === 1) return [lo, hi];
    return [cellMin(n) * p + lo, cellMax(n) * p + hi];
  };
  let [xLo, xHi] = axisBounds(nx, px, b.min[0], b.max[0]);
  let [yLo, yHi] = axisBounds(ny, py, b.min[1], b.max[1]);
  let [zLo, zHi] = axisBounds(nz, pz, b.min[2], b.max[2]);
  // Stagger pushes the along-axis bounds outward by `amount * period`
  // because alternating rows shift by that much beyond the unshifted span.
  if (stagger) {
    const expand = stagger.amount * (stagger.along === 'x' ? px : stagger.along === 'y' ? py : pz);
    if (stagger.along === 'x') { xLo -= 0; xHi += expand; }
    else if (stagger.along === 'y') { yLo -= 0; yHi += expand; }
    else { zLo -= 0; zHi += expand; }
  }
  return new SdfNode({
    kind: 'repeatN',
    eval: evalFn,
    bounds: { min: [xLo, yLo, zLo], max: [xHi, yHi, zHi] },
    children: [child],
    partitionable: false,
  });
}

function opPolarRepeat(child: SdfNode, count: number, axis: 'x' | 'y' | 'z', radius: number): SdfNode {
  // Domain-warp cousin of opPolarArray: instead of unioning N rotated
  // copies, we fold the angular coordinate around `axis` into one
  // sector and evaluate the child inside it. The result has perfect
  // N-fold symmetry around the axis for any count, with no per-copy
  // boolean cost (the child is evaluated ONCE per sample).
  const n = count as number;
  const sector = (2 * Math.PI) / n;
  // Optionally pre-translate the child along the first perpendicular
  // axis by `radius`, matching polarArray's convention. Lets you say
  // "ring of teeth at radius R" without writing the translate.
  let seed = child;
  if (radius > 0) {
    const push: Vec3 = axis === 'z' ? [radius, 0, 0] : axis === 'x' ? [0, radius, 0] : [0, 0, radius];
    seed = opTranslate(child, push);
  }
  const b = seed._bounds;
  // Reduce p's angular coordinate around `axis` into [-sector/2, sector/2),
  // rotating back so the child sees a "first sector" query.
  let evalFn: EvalFn;
  if (axis === 'z') {
    evalFn = (x, y, z) => {
      const theta = Math.atan2(y, x);
      const wrap = theta - sector * Math.round(theta / sector);
      const r = Math.hypot(x, y);
      return seed._eval(r * Math.cos(wrap), r * Math.sin(wrap), z);
    };
  } else if (axis === 'y') {
    evalFn = (x, y, z) => {
      const theta = Math.atan2(z, x);
      const wrap = theta - sector * Math.round(theta / sector);
      const r = Math.hypot(x, z);
      return seed._eval(r * Math.cos(wrap), y, r * Math.sin(wrap));
    };
  } else {
    evalFn = (x, y, z) => {
      const theta = Math.atan2(z, y);
      const wrap = theta - sector * Math.round(theta / sector);
      const r = Math.hypot(y, z);
      return seed._eval(x, r * Math.cos(wrap), r * Math.sin(wrap));
    };
  }
  // Bounds: the polar fold produces N-fold symmetry around the axis.
  // The radial extent equals the seed's max distance from the axis;
  // the axial extent matches the seed's range along the axis.
  let bounds: Box;
  if (axis === 'z') {
    const r = Math.max(Math.abs(b.min[0]), Math.abs(b.max[0]),
                       Math.abs(b.min[1]), Math.abs(b.max[1]));
    bounds = { min: [-r, -r, b.min[2]], max: [r, r, b.max[2]] };
  } else if (axis === 'y') {
    const r = Math.max(Math.abs(b.min[0]), Math.abs(b.max[0]),
                       Math.abs(b.min[2]), Math.abs(b.max[2]));
    bounds = { min: [-r, b.min[1], -r], max: [r, b.max[1], r] };
  } else {
    const r = Math.max(Math.abs(b.min[1]), Math.abs(b.max[1]),
                       Math.abs(b.min[2]), Math.abs(b.max[2]));
    bounds = { min: [b.min[0], -r, -r], max: [b.max[0], r, r] };
  }
  return new SdfNode({ kind: 'polarRepeat', eval: evalFn, bounds, children: [child], partitionable: false });
}

// --- Public namespace factory ------------------------------------------

export interface SdfNamespace {
  sphere(radius: number): SdfNode;
  ellipsoid(rx: number, ry: number, rz: number): SdfNode;
  box(size: Vec3 | number): SdfNode;
  roundedBox(size: Vec3 | number, radius: number): SdfNode;
  cylinder(radius: number, height: number): SdfNode;
  roundedCylinder(radius: number, height: number, edgeRadius: number): SdfNode;
  torus(majorRadius: number, minorRadius: number): SdfNode;
  capsule(a: Vec3, b: Vec3, radius: number): SdfNode;
  gyroid(cellSize: number, thickness: number): SdfNode;
  schwarzP(cellSize: number, thickness: number): SdfNode;
  diamond(cellSize: number, thickness: number): SdfNode;
  lidinoid(cellSize: number, thickness: number): SdfNode;
  gradedGyroid(cellSize: number, thicknessFn: (x: number, y: number, z: number) => number): SdfNode;
  gradedSchwarzP(cellSize: number, thicknessFn: (x: number, y: number, z: number) => number): SdfNode;
  gradedDiamond(cellSize: number, thicknessFn: (x: number, y: number, z: number) => number): SdfNode;
  gradedLidinoid(cellSize: number, thicknessFn: (x: number, y: number, z: number) => number): SdfNode;
  union(...nodes: SdfNode[]): SdfNode;
  smoothUnion(a: SdfNode, b: SdfNode, k: number): SdfNode;
  smoothSubtract(a: SdfNode, b: SdfNode, k: number): SdfNode;
  smoothIntersect(a: SdfNode, b: SdfNode, k: number): SdfNode;
  subtract(a: SdfNode, b: SdfNode): SdfNode;
  intersect(a: SdfNode, b: SdfNode): SdfNode;
  /** Build the SDF tree into a Manifold via Manifold.levelSet, with
   *  optional explicit bounds / edgeLength / level / tolerance. */
  build(node: SdfNode, opts?: SdfBuildOptions): ManifoldInstance;
}

/** Construct a fresh SDF namespace for one engine run. Bound to the
 *  current run's Manifold class and `label` closure so labelled
 *  subtrees flow into the existing paint-by-label registry. Every
 *  primitive returned by this namespace carries the engine binding;
 *  chain methods + ops inherit it from their input node(s). */
export function createSdfNamespace(Manifold: ManifoldClass, label: LabelFn): SdfNamespace {
  const ctx: BuildContext = { Manifold, label };

  function bound(node: SdfNode): SdfNode {
    // Attach the engine ctx to the node's internal field. Cast through
    // unknown because _ctx is declared readonly — that's the contract
    // for the rest of the codebase, but the namespace is the one place
    // that legitimately seeds it.
    (node as unknown as { _ctx: BuildContext })._ctx = ctx;
    return node;
  }

  function assertSdfNode(val: unknown, paramName: string): SdfNode {
    if (!(val instanceof SdfNode)) {
      throw new ValidationError(
        `${paramName} must be an SDF node (e.g. api.sdf.sphere(5)). Got ${val === null ? 'null' : typeof val}. See /ai.md#argument-validation`,
      );
    }
    return val;
  }

  return {
    sphere: (radius) => bound(primSphere(radius)),
    ellipsoid: (rx, ry, rz) => bound(primEllipsoid(rx, ry, rz)),
    box: (size) => bound(primBox(size)),
    roundedBox: (size, radius) => bound(primRoundedBox(size, radius)),
    cylinder: (radius, height) => bound(primCylinder(radius, height)),
    roundedCylinder: (radius, height, edgeRadius) => bound(primRoundedCylinder(radius, height, edgeRadius)),
    torus: (R, r) => bound(primTorus(R, r)),
    capsule: (a, b, radius) => bound(primCapsule(a, b, radius)),
    gyroid: (cellSize, thickness) => bound(primGyroid(cellSize, thickness)),
    schwarzP: (cellSize, thickness) => bound(primSchwarzP(cellSize, thickness)),
    diamond: (cellSize, thickness) => bound(primDiamond(cellSize, thickness)),
    lidinoid: (cellSize, thickness) => bound(primLidinoid(cellSize, thickness)),
    gradedGyroid: (cellSize, thicknessFn) => bound(primGradedGyroid(cellSize, thicknessFn)),
    gradedSchwarzP: (cellSize, thicknessFn) => bound(primGradedSchwarzP(cellSize, thicknessFn)),
    gradedDiamond: (cellSize, thicknessFn) => bound(primGradedDiamond(cellSize, thicknessFn)),
    gradedLidinoid: (cellSize, thicknessFn) => bound(primGradedLidinoid(cellSize, thicknessFn)),
    union: (...nodes) => {
      if (nodes.length === 0) throw new ValidationError('api.sdf.union(): need at least one SDF node.');
      let acc = assertSdfNode(nodes[0], 'union(nodes[0])');
      for (let i = 1; i < nodes.length; i++) acc = opUnion(acc, assertSdfNode(nodes[i], `union(nodes[${i}])`));
      return acc;
    },
    smoothUnion: (a, b, k) => assertSdfNode(a, 'smoothUnion(a)').smoothUnion(assertSdfNode(b, 'smoothUnion(b)'), k),
    smoothSubtract: (a, b, k) => assertSdfNode(a, 'smoothSubtract(a)').smoothSubtract(assertSdfNode(b, 'smoothSubtract(b)'), k),
    smoothIntersect: (a, b, k) => assertSdfNode(a, 'smoothIntersect(a)').smoothIntersect(assertSdfNode(b, 'smoothIntersect(b)'), k),
    subtract: (a, b) => opSubtract(assertSdfNode(a, 'subtract(a)'), assertSdfNode(b, 'subtract(b)')),
    intersect: (a, b) => opIntersect(assertSdfNode(a, 'intersect(a)'), assertSdfNode(b, 'intersect(b)')),
    build: (node, opts) => assertSdfNode(node, 'build(node)').build(opts ?? {}),
  };
}

// --- Test hooks ---------------------------------------------------------

/** @internal Exposed for unit tests (vitest). Not part of the runtime API. */
export const __testables__ = {
  primSphere,
  primEllipsoid,
  primBox,
  primRoundedBox,
  primCylinder,
  primRoundedCylinder,
  primTorus,
  primCapsule,
  primGyroid,
  primSchwarzP,
  primDiamond,
  primLidinoid,
  primGradedGyroid,
  primGradedSchwarzP,
  primGradedDiamond,
  primGradedLidinoid,
  opUnion,
  opSubtract,
  opIntersect,
  opSmoothUnion,
  opSmoothSubtract,
  opSmoothIntersect,
  opTranslate,
  opRotate,
  opScale,
  opMirror,
  opShell,
  opRound,
  opTwist,
  opBend,
  opTaper,
  opPolarArray,
  opRepeat,
  opRepeatN,
  opPolarRepeat,
  partitionByLabel,
  defaultEdgeLength,
  expandedMeshBounds,
};
