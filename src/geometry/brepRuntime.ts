// BREP runtime — wraps replicad (OpenCASCADE.js WASM) behind a thin namespace
// that mirrors Partwright's existing api.* style.
//
// Immutability note: replicad's underlying OCCT operations *consume* their
// inputs — `a.fillet(2)` invalidates `a`, `a.fuse(b)` invalidates both.
// That's the opposite of how Partwright's manifold-js sandbox works and a
// well-documented footgun for AI authors (they reach for the same patterns
// they'd use against Manifold and get "this object has been deleted" errors
// on the second use of a shape). Our `BrepShape` wrapper makes shapes
// behave like values by `.clone()`-ing inputs before every mutating op.
// This costs an extra OCCT shape allocation per call; the per-run cleanup
// (see below) keeps the heap bounded.
//
// Resource note: OCCT shapes live on the WASM heap and must be `.delete()`d
// by hand. To match manifold-3d's per-run cleanup in the manifold-js sandbox,
// every BrepShape we hand to user code is appended to a module-level
// allocation list — see `pushBrepAllocation` / `consumeBrepAllocations`. The
// manifold-js engine drains that list in its `finally` block (freeing
// everything except the returned value) so the editor's auto-run keystroke
// loop doesn't leak shapes the same way it would leak Manifolds.
//
// Two ways the runtime is consumed:
//
//   1. Phase C — exposed as `api.BREP` inside manifold-js sandboxes so the AI
//      can do `const filleted = api.BREP.box([10,10,10]).fillet(2); return
//      api.BREP.toManifold(filleted, api.Manifold);` Mixes BREP precision
//      (true fillets/chamfers) into the existing mesh-native workflow at the
//      cost of losing parametric history at the BREP→mesh boundary.
//
//   2. Phase A — used as the runtime for full `replicad`-language sessions
//      (see src/geometry/engines/replicad.ts), where the BREP shape is the
//      session's representation and survives across runs for STEP export and
//      future BREP-only features.
//
// The OpenCASCADE WASM is heavy (~10 MB). We lazy-import the wrapper so that
// users who never touch BREP don't pay the download. `ensureBrepLoaded()` is
// called from the engine Worker only when the user's code mentions `BREP` (or
// when the session's active language is `replicad`).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ReplicadModule = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyShape = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OcctModule = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ManifoldModule = any;

let replicadModule: ReplicadModule | null = null;
// The OpenCASCADE module itself (returned by the opencascadejs Emscripten
// factory). Stored so we can call `formatException(ptr)` on integer
// exceptions thrown out of OCCT — that's how we turn an opaque
// "BindingError: number 21428768" into a human-readable fillet failure.
let occtModule: OcctModule | null = null;
let initPromise: Promise<void> | null = null;

// Per-run allocation list — see the resource note at the top of the file. The
// list is module-level (not bound to a specific run) because the BREP namespace
// itself is a singleton; the engine drains and resets it between runs.
let brepAllocations: BrepShape[] = [];

function pushBrepAllocation(s: BrepShape): void {
  brepAllocations.push(s);
}

/** Take and clear the current BREP allocation list. The engine calls this in
 *  its `finally` block to free every shape created during the run, except the
 *  one the user returned (which the caller spares manually). */
export function consumeBrepAllocations(): BrepShape[] {
  const out = brepAllocations;
  brepAllocations = [];
  return out;
}

/** Free every BREP shape produced during the run, sparing `keep`. Mirrors
 *  `disposeAllExcept` in manifoldJs.ts; centralised here so the engine and
 *  any tests can share one implementation. */
export function disposeBrepAllocationsExcept(allocations: BrepShape[], keep: unknown): void {
  for (const s of allocations) {
    if (s === keep) continue;
    try { s.delete(); } catch { /* already freed by user code */ }
  }
}

/** Idempotent, cached. Resolves once OpenCASCADE.js is initialised and
 *  `replicad.setOC` has been called. */
export function ensureBrepLoaded(): Promise<void> {
  if (replicadModule !== null) return Promise.resolve();
  if (initPromise !== null) return initPromise;
  initPromise = doInit().catch((err) => {
    // Don't cache a failed init — next call should retry.
    initPromise = null;
    throw err;
  });
  return initPromise;
}

async function doInit(): Promise<void> {
  const replicad = await import('replicad');
  // The single-build variant of opencascade.js is lighter and is enough for
  // the operations we expose. The Vite ?url import gives us the file path so
  // the Emscripten module can fetch the .wasm side-car at runtime.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opencascade = (await import('replicad-opencascadejs/src/replicad_single.js' as any)).default;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wasmUrl = (await import('replicad-opencascadejs/src/replicad_single.wasm?url' as any)).default;
  const OC = await opencascade({ locateFile: () => wasmUrl });
  replicad.setOC(OC);
  replicadModule = replicad;
  occtModule = OC;
}

export function isBrepLoaded(): boolean {
  return replicadModule !== null;
}

// ── Type-light shape wrapper ─────────────────────────────────────────────────
//
// We don't re-export replicad's types into Partwright's surface because the
// real type names (`AnyShape`, `Solid`, `Shape3D`, …) are an OCCT-shaped
// vocabulary that would leak through into ai.md, the system prompt, and tool
// schemas — confusing the AI and growing the docs surface 1:1 with replicad's
// API changes. Instead we hand back a small chainable wrapper object whose
// surface we control: callers see `BrepShape` with `.fillet`, `.chamfer`,
// `.fuse`, `.cut`, `.intersect`, `.toMesh`, `.toManifold`, `.blobSTEP`.

export interface BrepMesh {
  /** Vertex positions, flat [x,y,z,...] in Float32 form. */
  vertProperties: Float32Array;
  /** Triangle indices, flat. */
  triVerts: Uint32Array;
  numVert: number;
  numTri: number;
  numProp: number;
}

/** Friendly filter object for selective edge fillet / chamfer. Each field is
 *  AND-combined with the others — leave anything off to skip that filter.
 *  Translated to a replicad EdgeFinder chain at op-time. Start small; grow
 *  as the AI surfaces patterns the current set can't express. */
export interface EdgeFilter {
  /** Only edges every vertex of which has z ≥ minZ. */
  minZ?: number;
  /** Only edges every vertex of which has z ≤ maxZ. */
  maxZ?: number;
  /** Only edges every vertex of which has x ≥ minX. */
  minX?: number;
  /** Only edges every vertex of which has x ≤ maxX. */
  maxX?: number;
  /** Only edges every vertex of which has y ≥ minY. */
  minY?: number;
  /** Only edges every vertex of which has y ≤ maxY. */
  maxY?: number;
  /** Only edges that pass within `withinDist` of this world-space point.
   *  Defaults to the smallest of the bbox dimensions when `withinDist` is
   *  omitted, but it's better to pass an explicit number. */
  nearPoint?: [number, number, number];
  /** Required when `nearPoint` is set; ignored otherwise. */
  withinDist?: number;
  /** Only edges parallel to a standard plane. */
  parallelToPlane?: 'XY' | 'XZ' | 'YZ';
  /** Only edges whose direction matches this axis (unit vector). Useful for
   *  "fillet all vertical edges" (`[0, 0, 1]`) without specifying a region. */
  inDirection?: [number, number, number];
}

export interface BrepShape {
  /** Internal — the underlying replicad AnyShape. Kept out of public docs. */
  readonly _shape: AnyShape;
  /** Round (radius) edges of the shape. Without a filter every edge is
   *  rounded; pass an `EdgeFilter` for selective filleting (the headline BREP
   *  feature mesh kernels can't match — e.g. only the top rim of a cylinder
   *  via `{minZ: h - 0.001}`). */
  fillet(radius: number, filter?: EdgeFilter): BrepShape;
  /** Bevel (distance) edges of the shape. Same filter shape as `.fillet`. */
  chamfer(distance: number, filter?: EdgeFilter): BrepShape;
  /** Boolean union with another BREP shape. Inputs are not consumed —
   *  cloning happens internally so the originals stay usable for subsequent
   *  ops, matching the manifold-js mental model. */
  fuse(other: BrepShape): BrepShape;
  /** Boolean subtraction (this − other). Inputs not consumed. */
  cut(other: BrepShape): BrepShape;
  /** Boolean intersection. Inputs not consumed. */
  intersect(other: BrepShape): BrepShape;
  /** Translate by [x,y,z]. Input not consumed. */
  translate(offset: [number, number, number]): BrepShape;
  /** Rotate by `degrees` around the axis through `origin` in direction `axis`.
   *  Input not consumed. */
  rotate(degrees: number, axis: [number, number, number], origin?: [number, number, number]): BrepShape;
  /** Tessellate the BREP into a mesh suitable for rendering / Manifold.ofMesh.
   *  Larger tolerance = coarser triangles. Default tracks Partwright's quality
   *  preset. */
  toMesh(opts?: { tolerance?: number; angularTolerance?: number }): BrepMesh;
  /** Tessellate then promote to a Manifold via Manifold.ofMesh. */
  toManifold(Manifold: ManifoldModule, opts?: { tolerance?: number; angularTolerance?: number }): unknown;
  /** STEP file bytes (BREP-exact). Only meaningful in `replicad`-language
   *  sessions — Manifold sessions strip parametricity at toManifold() time. */
  blobSTEP(): Blob;
  /** Free the underlying OCCT shape. Called by the engine after a run; user
   *  code generally doesn't need to. */
  delete(): void;
}

function wrap(shape: AnyShape): BrepShape {
  if (!replicadModule) throw new Error('BREP runtime not loaded — call ensureBrepLoaded() first.');
  const w: BrepShape = wrapInner(shape);
  // Track every shape we hand out so the engine can free it at run end —
  // see the resource note at the top of the file. The returned value is
  // spared by the engine if user code returns it.
  pushBrepAllocation(w);
  return w;
}

function wrapInner(shape: AnyShape): BrepShape {
  // Helpers that capture `shape` in their closure. Each mutating op clones
  // before invoking replicad so the input wrapper stays usable — see the
  // immutability note at the top of the file. The clone count is one per op
  // for unary ops, two for binary (clone both sides) — small enough that the
  // per-run cleanup absorbs it without ceremony.
  const w: BrepShape = {
    _shape: shape,
    fillet(radius: number, filter?: EdgeFilter) {
      if (typeof radius !== 'number' || !isFinite(radius) || radius <= 0) {
        throw new Error('BREP.fillet(radius): radius must be a positive number.');
      }
      try {
        const finder = filter ? buildEdgeFinder(filter) : undefined;
        const next = shape.clone().fillet(radius, finder);
        return wrap(next);
      } catch (e) {
        throw new Error(formatOcctError(e, 'fillet', { radius, hadFilter: !!filter }));
      }
    },
    chamfer(distance: number, filter?: EdgeFilter) {
      if (typeof distance !== 'number' || !isFinite(distance) || distance <= 0) {
        throw new Error('BREP.chamfer(distance): distance must be a positive number.');
      }
      try {
        const finder = filter ? buildEdgeFinder(filter) : undefined;
        const next = shape.clone().chamfer(distance, finder);
        return wrap(next);
      } catch (e) {
        throw new Error(formatOcctError(e, 'chamfer', { distance, hadFilter: !!filter }));
      }
    },
    fuse(other: BrepShape) {
      assertShape(other, 'BREP.fuse');
      try {
        return wrap(shape.clone().fuse(other._shape.clone()));
      } catch (e) {
        throw new Error(formatOcctError(e, 'fuse', {}));
      }
    },
    cut(other: BrepShape) {
      assertShape(other, 'BREP.cut');
      try {
        return wrap(shape.clone().cut(other._shape.clone()));
      } catch (e) {
        throw new Error(formatOcctError(e, 'cut', {}));
      }
    },
    intersect(other: BrepShape) {
      assertShape(other, 'BREP.intersect');
      try {
        return wrap(shape.clone().intersect(other._shape.clone()));
      } catch (e) {
        throw new Error(formatOcctError(e, 'intersect', {}));
      }
    },
    translate(offset: [number, number, number]) {
      assertVec3(offset, 'BREP.translate(offset)');
      return wrap(shape.clone().translate(offset));
    },
    rotate(degrees: number, axis: [number, number, number], origin: [number, number, number] = [0, 0, 0]) {
      if (typeof degrees !== 'number' || !isFinite(degrees)) {
        throw new Error('BREP.rotate(degrees, axis, origin?): degrees must be a number.');
      }
      assertVec3(axis, 'BREP.rotate(axis)');
      assertVec3(origin, 'BREP.rotate(origin)');
      return wrap(shape.clone().rotate(degrees, origin, axis));
    },
    toMesh(opts) {
      return toMeshData(shape, opts);
    },
    toManifold(Manifold, opts) {
      if (!Manifold || typeof Manifold.ofMesh !== 'function') {
        throw new Error('BREP.toManifold(Manifold): pass api.Manifold as the first arg.');
      }
      const mesh = toMeshData(shape, opts);
      return Manifold.ofMesh({
        numProp: mesh.numProp,
        vertProperties: mesh.vertProperties,
        triVerts: mesh.triVerts,
      });
    },
    blobSTEP() {
      return shape.blobSTEP();
    },
    delete() {
      try { shape.delete?.(); } catch { /* already freed */ }
    },
  };
  return w;
}

/** Translate an integer OCCT exception (or a plain JS error) into a
 *  human-readable string with an op-specific hint. The Emscripten/OCCT
 *  binding throws an integer pointer for native exceptions; `OC.formatException`
 *  resolves that to the underlying message. The OpenSCAD engine does the
 *  same dance with `instance.formatException(e)`. */
function formatOcctError(
  e: unknown,
  op: 'fillet' | 'chamfer' | 'fuse' | 'cut' | 'intersect',
  ctx: { radius?: number; distance?: number; hadFilter?: boolean },
): string {
  let base: string;
  if (typeof e === 'number' && occtModule && typeof occtModule.formatException === 'function') {
    try { base = occtModule.formatException(e); } catch { base = `OCCT exception #${e}`; }
  } else if (e instanceof Error) {
    base = e.message;
  } else {
    base = String(e);
  }
  // Surface the most common cause for each op — these are the ones the AI
  // feedback flagged as "wasted iterations because the error said nothing".
  if (op === 'fillet' || op === 'chamfer') {
    const noun = op === 'fillet' ? 'fillet' : 'chamfer';
    const param = op === 'fillet' ? `radius: ${ctx.radius}` : `distance: ${ctx.distance}`;
    return `BREP.${op} failed (${param}): ${base}
Hints:
  • The ${noun} radius is too large for at least one edge — try a smaller value.
  • OCCT's ${noun} solver is sensitive to edge-graph complexity AFTER boolean ops; apply .${op}() on fused solids BEFORE .cut() / .fuse() when you can.${ctx.hadFilter ? '' : '\n  • If only some edges need rounding, pass an EdgeFilter as the second arg (e.g. {minZ: 5}) so the solver has fewer edges to consider.'}`;
  }
  return `BREP.${op} failed: ${base}
Hint: degenerate or non-intersecting inputs are the usual cause — verify both shapes are solids and that they overlap (for fuse/intersect) or that the cutter is inside the body (for cut).`;
}

/** Map our friendly `EdgeFilter` object onto a replicad EdgeFinder callback.
 *  The returned function is what replicad's `.fillet(r, filter?)` expects:
 *  it receives the seed `EdgeFinder` and returns one with the filters
 *  chained. Each filter narrows the selection (AND-combined). */
function buildEdgeFinder(filter: EdgeFilter): (finder: AnyShape) => AnyShape {
  if (!filter || typeof filter !== 'object') {
    throw new Error('EdgeFilter must be an object — keys: minZ, maxZ, minX, maxX, minY, maxY, nearPoint+withinDist, parallelToPlane, inDirection.');
  }
  return (finder: AnyShape) => {
    let f = finder;
    // Box-range filters collapse to a single `.inBox(corner1, corner2)` call —
    // replicad treats axes we leave at ±Infinity as unbounded which is exactly
    // what we want for one-axis ranges.
    const hasBoxFilter = (
      filter.minX !== undefined || filter.maxX !== undefined ||
      filter.minY !== undefined || filter.maxY !== undefined ||
      filter.minZ !== undefined || filter.maxZ !== undefined
    );
    if (hasBoxFilter) {
      const huge = 1e9;
      const c1: [number, number, number] = [
        filter.minX ?? -huge,
        filter.minY ?? -huge,
        filter.minZ ?? -huge,
      ];
      const c2: [number, number, number] = [
        filter.maxX ?? huge,
        filter.maxY ?? huge,
        filter.maxZ ?? huge,
      ];
      f = f.inBox(c1, c2);
    }
    if (filter.nearPoint !== undefined) {
      assertVec3(filter.nearPoint, 'EdgeFilter.nearPoint');
      const dist = filter.withinDist;
      if (typeof dist !== 'number' || !isFinite(dist) || dist <= 0) {
        throw new Error('EdgeFilter.nearPoint requires EdgeFilter.withinDist (a positive number).');
      }
      f = f.withinDistance(dist, filter.nearPoint);
    }
    if (filter.parallelToPlane !== undefined) {
      if (filter.parallelToPlane !== 'XY' && filter.parallelToPlane !== 'XZ' && filter.parallelToPlane !== 'YZ') {
        throw new Error('EdgeFilter.parallelToPlane must be "XY", "XZ", or "YZ".');
      }
      f = f.parallelTo(filter.parallelToPlane);
    }
    if (filter.inDirection !== undefined) {
      assertVec3(filter.inDirection, 'EdgeFilter.inDirection');
      f = f.inDirection(filter.inDirection);
    }
    return f;
  };
}

function assertShape(s: unknown, where: string): asserts s is BrepShape {
  if (!s || typeof s !== 'object' || !('_shape' in s)) {
    throw new Error(`${where}(other): expected a BREP shape (returned by BREP.box/cylinder/etc.).`);
  }
}

function assertVec3(v: unknown, where: string): asserts v is [number, number, number] {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(n => typeof n === 'number' && isFinite(n))) {
    throw new Error(`${where}: expected [x, y, z] (three finite numbers).`);
  }
}

function toMeshData(shape: AnyShape, opts?: { tolerance?: number; angularTolerance?: number }): BrepMesh {
  const tolerance = opts?.tolerance ?? 0.01;
  const angularTolerance = opts?.angularTolerance ?? 12;
  const mesh = shape.mesh({ tolerance, angularTolerance });
  // Replicad's tessellator emits one vertex *per face*, so two BREP faces that
  // share an edge produce duplicate vertex positions in the output. manifold's
  // `ofMesh()` interprets that as a non-watertight mesh and rejects it with
  // "Not manifold" — we have to weld duplicates back together before the
  // round-trip. Welding uses a position hash with a small tolerance so points
  // that differ only by float-roundoff are treated as the same vertex.
  return weldDuplicateVertices(mesh.vertices, mesh.triangles);
}

/** Merge vertices that share a position (within a tiny tolerance) and rewrite
 *  triangle indices to point at the canonical copy. Returns a `BrepMesh`
 *  whose vertex/triangle counts reflect the welded shape — the input arrays
 *  are not mutated. */
/** Exported for unit testing only — see `tests/unit/brepRuntime.test.ts`.
 *  Production callers should reach for `toMeshData` (which wraps this) via a
 *  `BrepShape.toMesh()` call. */
export function _weldDuplicateVerticesForTests(
  rawVertices: number[],
  rawTriangles: number[],
): BrepMesh {
  return weldDuplicateVertices(rawVertices, rawTriangles);
}

function weldDuplicateVertices(rawVertices: number[], rawTriangles: number[]): BrepMesh {
  // Tolerance chosen empirically: tight enough that distinct features don't
  // collapse, loose enough to catch float-roundoff between adjacent BREP
  // faces. The mesh comes out of OCCT in millimetre-scale so 1e-6 is roughly
  // 1 nanometre — well below any real feature, well above ULP noise.
  const TOL = 1e-6;
  const scale = 1 / TOL;
  const indexMap = new Map<string, number>();
  // Pre-size for the worst case (every vertex unique) to avoid reallocations;
  // we'll truncate at the end.
  const welded = new Float32Array(rawVertices.length);
  const remap = new Uint32Array(rawVertices.length / 3);
  let nextIndex = 0;
  for (let i = 0; i < rawVertices.length; i += 3) {
    const x = rawVertices[i];
    const y = rawVertices[i + 1];
    const z = rawVertices[i + 2];
    const key = `${Math.round(x * scale)}|${Math.round(y * scale)}|${Math.round(z * scale)}`;
    let canonical = indexMap.get(key);
    if (canonical === undefined) {
      canonical = nextIndex++;
      indexMap.set(key, canonical);
      welded[canonical * 3] = x;
      welded[canonical * 3 + 1] = y;
      welded[canonical * 3 + 2] = z;
    }
    remap[i / 3] = canonical;
  }
  const vertProperties = welded.slice(0, nextIndex * 3);
  const triVerts = new Uint32Array(rawTriangles.length);
  for (let i = 0; i < rawTriangles.length; i++) triVerts[i] = remap[rawTriangles[i]];
  return {
    vertProperties,
    triVerts,
    numVert: nextIndex,
    numTri: triVerts.length / 3,
    numProp: 3,
  };
}

// ── Public namespace ─────────────────────────────────────────────────────────

export interface BrepNamespace {
  /** Axis-aligned box centred at the origin. `BREP.box([10, 10, 10])`. */
  box(size: [number, number, number]): BrepShape;
  /** Cylinder of radius `r` and height `h` along +Z, base on the XY plane. */
  cylinder(r: number, h: number): BrepShape;
  /** Sphere of radius `r` centred at the origin. */
  sphere(r: number): BrepShape;
  /** Boolean union over an array of shapes — `BREP.fuseAll([a, b, c, …])`
   *  returns `a ∪ b ∪ c ∪ …`. Each input is treated immutably (the wrapper
   *  clones internally), so the originals stay usable. Throws on empty input;
   *  returns a clone of the single shape for one-element arrays. The
   *  AI-facing reason this exists: writing `shapes.reduce((acc, s) =>
   *  acc.fuse(s))` against the old destructive model would invalidate
   *  `shapes[0]` on the first iteration. With immutable `fuse` that's now
   *  safe too, but `fuseAll` reads clearer and is one fewer surprise. */
  fuseAll(shapes: BrepShape[]): BrepShape;
  /** Boolean subtract-everything-from-first — `BREP.cutAll([body, hole1,
   *  hole2, …])` returns `body − hole1 − hole2 − …`. */
  cutAll(shapes: BrepShape[]): BrepShape;
  /** Boolean intersect-all — `BREP.intersectAll([a, b, c])` returns
   *  `a ∩ b ∩ c`. */
  intersectAll(shapes: BrepShape[]): BrepShape;
  /** Convenience helper — same as `shape.toMesh(opts)`. */
  toMesh(shape: BrepShape, opts?: { tolerance?: number; angularTolerance?: number }): BrepMesh;
  /** Convenience helper — same as `shape.toManifold(Manifold, opts)`. */
  toManifold(shape: BrepShape, Manifold: ManifoldModule, opts?: { tolerance?: number; angularTolerance?: number }): unknown;
  /** Identity check used by sandbox runtime and engines. */
  readonly _isBrep: true;
}

function reduceShapes(
  shapes: BrepShape[],
  op: 'fuse' | 'cut' | 'intersect',
  apiName: string,
): BrepShape {
  if (!Array.isArray(shapes)) {
    throw new Error(`${apiName}(shapes): expected an array of BREP shapes.`);
  }
  if (shapes.length === 0) {
    throw new Error(`${apiName}(shapes): array must have at least one shape.`);
  }
  for (let i = 0; i < shapes.length; i++) {
    assertShape(shapes[i], apiName);
  }
  if (shapes.length === 1) {
    // Return a clone so the caller can mutate / dispose without affecting
    // the original — matches the immutability contract of every other op.
    if (op === 'fuse' || op === 'cut' || op === 'intersect') {
      return wrap(shapes[0]._shape.clone());
    }
  }
  // Reduce left-to-right. `fuse`/`cut`/`intersect` on our wrapper already
  // clones internally, so accumulating produces fresh wrappers each step;
  // the per-run cleanup drains the intermediates.
  let acc = shapes[0];
  for (let i = 1; i < shapes.length; i++) acc = acc[op](shapes[i]);
  return acc;
}

let cachedNamespace: BrepNamespace | null = null;

/** Returns the BREP namespace if `ensureBrepLoaded()` has completed,
 *  otherwise `null`. Cached after first build. The sandbox sets
 *  `api.BREP` to this value, so users get `undefined` (rather than a
 *  half-initialised wrapper) when they touch BREP without a preload. */
export function getBrepNamespace(): BrepNamespace | null {
  if (!replicadModule) return null;
  if (!cachedNamespace) cachedNamespace = createBrepNamespace();
  return cachedNamespace;
}

/** Build the namespace. Requires `ensureBrepLoaded()` to have completed. */
export function createBrepNamespace(): BrepNamespace {
  if (!replicadModule) throw new Error('BREP runtime not loaded — call ensureBrepLoaded() first.');
  const { makeBaseBox, makeCylinder, makeSphere } = replicadModule;
  return {
    box(size) {
      assertVec3(size, 'BREP.box(size)');
      // Replicad's makeBaseBox centres the box at the origin.
      return wrap(makeBaseBox(size[0], size[1], size[2]));
    },
    cylinder(r, h) {
      if (typeof r !== 'number' || r <= 0 || typeof h !== 'number' || h <= 0) {
        throw new Error('BREP.cylinder(r, h): r and h must be positive numbers.');
      }
      return wrap(makeCylinder(r, h));
    },
    sphere(r) {
      if (typeof r !== 'number' || r <= 0) {
        throw new Error('BREP.sphere(r): r must be a positive number.');
      }
      return wrap(makeSphere(r));
    },
    fuseAll(shapes) {
      return reduceShapes(shapes, 'fuse', 'BREP.fuseAll');
    },
    cutAll(shapes) {
      return reduceShapes(shapes, 'cut', 'BREP.cutAll');
    },
    intersectAll(shapes) {
      return reduceShapes(shapes, 'intersect', 'BREP.intersectAll');
    },
    toMesh(shape, opts) {
      assertShape(shape, 'BREP.toMesh');
      return shape.toMesh(opts);
    },
    toManifold(shape, Manifold, opts) {
      assertShape(shape, 'BREP.toManifold');
      return shape.toManifold(Manifold, opts);
    },
    _isBrep: true,
  };
}

/** Source-level test: does the user's code reference `BREP`? Used by the
 *  engine Worker to decide whether to pre-load OCCT before executing. The
 *  heuristic is intentionally coarse — better to occasionally load BREP for
 *  code that mentions the string in a comment than to miss a real use. */
export function sourceUsesBrep(code: string): boolean {
  // Word-boundary match avoids hits inside identifiers like `aBREPb`.
  return /\bBREP\b/.test(code);
}
