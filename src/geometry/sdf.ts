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

  twist(degreesPerUnit: number, axis: 'x' | 'y' | 'z' = 'z'): SdfNode {
    assertNumber(degreesPerUnit, 'twist(degreesPerUnit)');
    const a = assertEnum(axis, ['x', 'y', 'z'] as const, 'twist(axis)');
    return opTwist(this, degreesPerUnit as number, a);
  }

  bend(degreesPerUnit: number, axis: 'x' | 'y' | 'z' = 'x'): SdfNode {
    assertNumber(degreesPerUnit, 'bend(degreesPerUnit)');
    const a = assertEnum(axis, ['x', 'y', 'z'] as const, 'bend(axis)');
    return opBend(this, degreesPerUnit as number, a);
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

/** Box with rounded edges. `radius` is the round-over; clamped to half
 *  the smallest dimension. */
function primRoundedBox(size: Vec3 | number, radius: number): SdfNode {
  assertNumber(radius, 'roundedBox(radius)', { min: 0 });
  // Build using box + round modifier — keeps one source of truth.
  return primBox(size).round(radius);
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

/** Gyroid TPMS — an infinite triply-periodic surface. `cellSize` controls
 *  the period; `thickness` controls the shell width (0 = bare surface,
 *  positive = solid shell of that thickness). Unbounded — you MUST also
 *  intersect with a finite shape or pass explicit `bounds` to .build(). */
function primGyroid(cellSize: number, thickness: number): SdfNode {
  assertNumber(cellSize, 'gyroid(cellSize)', { min: 1e-6 });
  assertNumber(thickness, 'gyroid(thickness)', { min: 0 });
  const k = (2 * Math.PI) / (cellSize as number);
  const t = thickness as number;
  return new SdfNode({
    kind: 'gyroid',
    eval: (x, y, z) => {
      const sx = Math.sin(k * x), cx = Math.cos(k * x);
      const sy = Math.sin(k * y), cy = Math.cos(k * y);
      const sz = Math.sin(k * z), cz = Math.cos(k * z);
      const g = sx * cy + sy * cz + sz * cx;
      // |g| - t gives a shell of thickness t around the zero-surface.
      // Divide by k so the gradient is roughly normalized — keeps the
      // marching tetrahedra from over- or under-sampling the surface.
      return (Math.abs(g) - t) / k;
    },
    // Effectively unbounded — caller must intersect or pass bounds.
    bounds: { min: [-Infinity, -Infinity, -Infinity], max: [Infinity, Infinity, Infinity] },
    children: [],
    partitionable: false,
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
    children: [a, b],
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

function opTwist(child: SdfNode, degPerUnit: number, axis: 'x' | 'y' | 'z'): SdfNode {
  // Twist the cross-section by `rate` radians per unit along `axis`.
  // Note: this is not a true SDF — the swept geometry is correct, but
  // the field is a Lipschitz approximation. Marching tetrahedra still
  // produces a watertight mesh.
  const rate = degPerUnit * DEG;
  let evalFn: EvalFn;
  if (axis === 'z') {
    evalFn = (x, y, z) => {
      const a = z * rate;
      const c = Math.cos(a), s = Math.sin(a);
      return child._eval(c * x + s * y, -s * x + c * y, z);
    };
  } else if (axis === 'y') {
    evalFn = (x, y, z) => {
      const a = y * rate;
      const c = Math.cos(a), s = Math.sin(a);
      return child._eval(c * x + s * z, y, -s * x + c * z);
    };
  } else {
    evalFn = (x, y, z) => {
      const a = x * rate;
      const c = Math.cos(a), s = Math.sin(a);
      return child._eval(x, c * y + s * z, -s * y + c * z);
    };
  }
  // After twist, the swept volume fits in a bounding cylinder whose
  // radius is the worst-case distance from the axis. Use a conservative
  // expansion: the bbox diagonal projected onto the twist plane.
  const b = child._bounds;
  const sweep = (() => {
    if (axis === 'z') return Math.hypot(Math.max(Math.abs(b.min[0]), Math.abs(b.max[0])),
                                        Math.max(Math.abs(b.min[1]), Math.abs(b.max[1])));
    if (axis === 'y') return Math.hypot(Math.max(Math.abs(b.min[0]), Math.abs(b.max[0])),
                                        Math.max(Math.abs(b.min[2]), Math.abs(b.max[2])));
    return Math.hypot(Math.max(Math.abs(b.min[1]), Math.abs(b.max[1])),
                      Math.max(Math.abs(b.min[2]), Math.abs(b.max[2])));
  })();
  // Use sweep as the bound for the twisted axes. The axis-of-twist
  // direction keeps its original extent.
  let bounds: Box;
  if (axis === 'z') bounds = { min: [-sweep, -sweep, b.min[2]], max: [sweep, sweep, b.max[2]] };
  else if (axis === 'y') bounds = { min: [-sweep, b.min[1], -sweep], max: [sweep, b.max[1], sweep] };
  else bounds = { min: [b.min[0], -sweep, -sweep], max: [b.max[0], sweep, sweep] };
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

// --- Public namespace factory ------------------------------------------

export interface SdfNamespace {
  sphere(radius: number): SdfNode;
  box(size: Vec3 | number): SdfNode;
  roundedBox(size: Vec3 | number, radius: number): SdfNode;
  cylinder(radius: number, height: number): SdfNode;
  torus(majorRadius: number, minorRadius: number): SdfNode;
  capsule(a: Vec3, b: Vec3, radius: number): SdfNode;
  gyroid(cellSize: number, thickness: number): SdfNode;
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
    box: (size) => bound(primBox(size)),
    roundedBox: (size, radius) => bound(primRoundedBox(size, radius)),
    cylinder: (radius, height) => bound(primCylinder(radius, height)),
    torus: (R, r) => bound(primTorus(R, r)),
    capsule: (a, b, radius) => bound(primCapsule(a, b, radius)),
    gyroid: (cellSize, thickness) => bound(primGyroid(cellSize, thickness)),
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
  primBox,
  primRoundedBox,
  primCylinder,
  primTorus,
  primCapsule,
  primGyroid,
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
  partitionByLabel,
  defaultEdgeLength,
  expandedMeshBounds,
};
