// BREP runtime — wraps replicad (OpenCASCADE.js WASM) behind a thin namespace
// that mirrors Partwright's existing api.* style. Two ways it's consumed:
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
// The OpenCASCADE WASM is heavy (~30 MB). We lazy-import the wrapper so that
// users who never touch BREP don't pay the download. `ensureBrepLoaded()` is
// called from the engine Worker only when the user's code mentions `BREP` (or
// when the session's active language is `replicad`).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ReplicadModule = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyShape = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ManifoldModule = any;

let replicadModule: ReplicadModule | null = null;
let initPromise: Promise<void> | null = null;

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

export interface BrepShape {
  /** Internal — the underlying replicad AnyShape. Kept out of public docs. */
  readonly _shape: AnyShape;
  /** Round (radius) all edges of the shape. */
  fillet(radius: number): BrepShape;
  /** Bevel (distance) all edges of the shape. */
  chamfer(distance: number): BrepShape;
  /** Boolean union with another BREP shape. */
  fuse(other: BrepShape): BrepShape;
  /** Boolean subtraction (this − other). */
  cut(other: BrepShape): BrepShape;
  /** Boolean intersection. */
  intersect(other: BrepShape): BrepShape;
  /** Translate by [x,y,z]. */
  translate(offset: [number, number, number]): BrepShape;
  /** Rotate by `degrees` around the axis through `origin` in direction `axis`. */
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
  const w: BrepShape = {
    _shape: shape,
    fillet(radius: number) {
      if (typeof radius !== 'number' || !isFinite(radius) || radius <= 0) {
        throw new Error('BREP.fillet(radius): radius must be a positive number.');
      }
      return wrap(shape.fillet(radius));
    },
    chamfer(distance: number) {
      if (typeof distance !== 'number' || !isFinite(distance) || distance <= 0) {
        throw new Error('BREP.chamfer(distance): distance must be a positive number.');
      }
      return wrap(shape.chamfer(distance));
    },
    fuse(other: BrepShape) {
      assertShape(other, 'BREP.fuse');
      return wrap(shape.fuse(other._shape));
    },
    cut(other: BrepShape) {
      assertShape(other, 'BREP.cut');
      return wrap(shape.cut(other._shape));
    },
    intersect(other: BrepShape) {
      assertShape(other, 'BREP.intersect');
      return wrap(shape.intersect(other._shape));
    },
    translate(offset: [number, number, number]) {
      assertVec3(offset, 'BREP.translate(offset)');
      return wrap(shape.translate(offset));
    },
    rotate(degrees: number, axis: [number, number, number], origin: [number, number, number] = [0, 0, 0]) {
      if (typeof degrees !== 'number' || !isFinite(degrees)) {
        throw new Error('BREP.rotate(degrees, axis, origin?): degrees must be a number.');
      }
      assertVec3(axis, 'BREP.rotate(axis)');
      assertVec3(origin, 'BREP.rotate(origin)');
      return wrap(shape.rotate(degrees, origin, axis));
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
  /** Convenience helper — same as `shape.toMesh(opts)`. */
  toMesh(shape: BrepShape, opts?: { tolerance?: number; angularTolerance?: number }): BrepMesh;
  /** Convenience helper — same as `shape.toManifold(Manifold, opts)`. */
  toManifold(shape: BrepShape, Manifold: ManifoldModule, opts?: { tolerance?: number; angularTolerance?: number }): unknown;
  /** Identity check used by sandbox runtime and engines. */
  readonly _isBrep: true;
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
