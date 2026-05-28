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

/** Per-face spatial signature captured at label time. Used by the
 *  resolver as the propagation mechanism for boolean ops — replicad
 *  doesn't expose OCCT History cleanly enough to track face provenance
 *  through `fuse`/`cut`/`intersect` in this opencascade.js build, so we
 *  fall back on the spatial signature, which is robust across all face
 *  types.
 *
 *  The signature carries *both* an axis-aligned bbox of the labeled face
 *  and a small sample point cloud. Resolution uses a two-stage match:
 *  bbox-containment with smallest-volume-wins (rejects faces outside the
 *  bbox cheaply and picks the more-localised face when several contain),
 *  then point-cloud nearest as a tie-breaker. Both work because they're
 *  computed from the same per-face tessellation collected at label time.
 *
 *  Translate offsets the bbox and points; rotate transforms them via
 *  Rodrigues' formula and refits the bbox envelope. Booleans take the
 *  union of signatures from both inputs. */
export interface LabelSignature {
  label: string;
  /** World-space axis-aligned bounding box of the labeled face. */
  min: [number, number, number];
  max: [number, number, number];
  /** Flat sample of world-space points (x,y,z,x,y,z,…) on the face's
   *  surface — used as the tie-breaker when bbox-containment alone is
   *  ambiguous. Capped at 64 points to keep memory bounded. */
  points: Float32Array;
}

export interface BrepShape {
  /** Internal — the underlying replicad AnyShape. Kept out of public docs. */
  readonly _shape: AnyShape;
  /** Internal — face hashcode → label, propagated through every op. Empty
   *  by default; populated by `BREP.label(shape, name)`. Kept on the wrapper
   *  rather than on the OCCT shape itself because OCCT doesn't have a place
   *  to hang user metadata that survives `clone()`. */
  readonly _faceLabels: ReadonlyMap<number, string>;
  /** Internal — spatial fallback signatures for label resolution. See the
   *  comment on `LabelSignature`. Each labeled face contributes one. */
  readonly _labelSignatures: ReadonlyArray<LabelSignature>;
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

function wrap(
  shape: AnyShape,
  faceLabels?: Map<number, string>,
  labelSignatures?: ReadonlyArray<LabelSignature>,
): BrepShape {
  if (!replicadModule) throw new Error('BREP runtime not loaded — call ensureBrepLoaded() first.');
  const w: BrepShape = wrapInner(shape, faceLabels ?? new Map(), labelSignatures ?? []);
  // Track every shape we hand out so the engine can free it at run end —
  // see the resource note at the top of the file. The returned value is
  // spared by the engine if user code returns it.
  pushBrepAllocation(w);
  return w;
}

// ── Label-propagation helpers ───────────────────────────────────────────────

/** Iterate the faces of a replicad shape in TopExp order (the same order
 *  replicad's `.mesh()` walks for faceGroups), returning their hashcodes
 *  paired with the live `Face` objects. The Face wrappers are still owned by
 *  the shape — don't `.delete()` them. */
function listFaceHashes(shape: AnyShape): Array<{ hash: number; face: AnyShape }> {
  // `shape.faces` is replicad's enumerator. Each `face.hashCode` is the
  // OCCT TopoDS_Face hashcode, which matches what `mesh()` puts on faceGroups.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const faces: any[] = shape.faces;
  return faces.map((f) => ({ hash: f.hashCode as number, face: f }));
}

function wrapInner(
  shape: AnyShape,
  faceLabels: Map<number, string>,
  labelSignatures: ReadonlyArray<LabelSignature>,
): BrepShape {
  // Helpers that capture `shape` in their closure. Each mutating op clones
  // before invoking replicad so the input wrapper stays usable — see the
  // immutability note at the top of the file. The clone count is one per op
  // for unary ops, two for binary (clone both sides) — small enough that the
  // per-run cleanup absorbs it without ceremony.
  const w: BrepShape = {
    _shape: shape,
    _faceLabels: faceLabels,
    _labelSignatures: labelSignatures,
    fillet(radius: number, filter?: EdgeFilter) {
      if (typeof radius !== 'number' || !isFinite(radius) || radius <= 0) {
        throw new Error('BREP.fillet(radius): radius must be a positive number.');
      }
      // Pre-check: when a filter is given, ask the underlying EdgeFinder how
      // many edges it actually matches before we hand the work to OCCT. A
      // zero-match filter and a too-large radius both surface as the same
      // opaque "no edge selected" message otherwise, and three agents in a
      // row burned iterations against that conflation.
      if (filter) {
        const matched = countMatchedEdges(shape, filter);
        if (matched === 0) {
          throw new Error(buildNoEdgeMatchError(shape, filter, 'fillet'));
        }
      }
      try {
        const finder = filter ? buildEdgeFinder(filter) : undefined;
        const next = shape.clone().fillet(radius, finder);
        return wrap(next, propagateByHashSurvivor(next, faceLabels), labelSignatures);
      } catch (e) {
        throw new Error(formatOcctError(e, 'fillet', { radius, hadFilter: !!filter }));
      }
    },
    chamfer(distance: number, filter?: EdgeFilter) {
      if (typeof distance !== 'number' || !isFinite(distance) || distance <= 0) {
        throw new Error('BREP.chamfer(distance): distance must be a positive number.');
      }
      if (filter) {
        const matched = countMatchedEdges(shape, filter);
        if (matched === 0) {
          throw new Error(buildNoEdgeMatchError(shape, filter, 'chamfer'));
        }
      }
      try {
        const finder = filter ? buildEdgeFinder(filter) : undefined;
        const next = shape.clone().chamfer(distance, finder);
        return wrap(next, propagateByHashSurvivor(next, faceLabels), labelSignatures);
      } catch (e) {
        throw new Error(formatOcctError(e, 'chamfer', { distance, hadFilter: !!filter }));
      }
    },
    fuse(other: BrepShape) {
      assertShape(other, 'BREP.fuse');
      try {
        return labeledBooleanOp('fuse', w, other);
      } catch (e) {
        throw new Error(formatOcctError(e, 'fuse', {}));
      }
    },
    cut(other: BrepShape) {
      assertShape(other, 'BREP.cut');
      try {
        return labeledBooleanOp('cut', w, other);
      } catch (e) {
        throw new Error(formatOcctError(e, 'cut', {}));
      }
    },
    intersect(other: BrepShape) {
      assertShape(other, 'BREP.intersect');
      try {
        return labeledBooleanOp('intersect', w, other);
      } catch (e) {
        throw new Error(formatOcctError(e, 'intersect', {}));
      }
    },
    translate(offset: [number, number, number]) {
      assertVec3(offset, 'BREP.translate(offset)');
      const next = shape.clone().translate(offset);
      // Pure rigid transform — TopExp face order is preserved, so we pair
      // the input/output face lists positionally and remap hashcodes. The
      // spatial signatures get translated alongside so the centroid
      // fallback continues to find them post-translate.
      return wrap(
        next,
        propagateByTopExpOrder(shape, next, faceLabels),
        translateSignatures(labelSignatures, offset),
      );
    },
    rotate(degrees: number, axis: [number, number, number], origin: [number, number, number] = [0, 0, 0]) {
      if (typeof degrees !== 'number' || !isFinite(degrees)) {
        throw new Error('BREP.rotate(degrees, axis, origin?): degrees must be a number.');
      }
      assertVec3(axis, 'BREP.rotate(axis)');
      assertVec3(origin, 'BREP.rotate(origin)');
      const next = shape.clone().rotate(degrees, origin, axis);
      return wrap(
        next,
        propagateByTopExpOrder(shape, next, faceLabels),
        rotateSignatures(labelSignatures, degrees, axis, origin),
      );
    },
    toMesh(opts) {
      return toMeshData(shape, opts);
    },
    toManifold(Manifold, opts) {
      if (!Manifold || typeof Manifold.ofMesh !== 'function') {
        throw new Error('BREP.toManifold(Manifold): pass api.Manifold as the first arg.');
      }
      const mesh = toMeshData(shape, opts);
      // If this BrepShape carries labels, stash the resolved triangle-label
      // map for the engine to merge into its run labelMap. The Manifold we
      // return doesn't have a place to carry BREP-side labels itself (its
      // `runOriginalID` system is for manifold-3d's own provenance), so the
      // side-channel is how `paintByLabel` ends up seeing them.
      if (faceLabels.size > 0 || labelSignatures.length > 0) {
        const labelMap = buildLabelMapFromShape(shape, faceLabels, labelSignatures);
        if (labelMap.size > 0) pendingToManifoldLabels.push(labelMap);
      }
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

/** Translate every signature by `offset` — bbox AND cloud points. */
function translateSignatures(sigs: ReadonlyArray<LabelSignature>, offset: [number, number, number]): LabelSignature[] {
  if (sigs.length === 0) return [];
  return sigs.map(s => {
    const nextPts = new Float32Array(s.points.length);
    for (let i = 0; i + 2 < s.points.length; i += 3) {
      nextPts[i] = s.points[i] + offset[0];
      nextPts[i + 1] = s.points[i + 1] + offset[1];
      nextPts[i + 2] = s.points[i + 2] + offset[2];
    }
    return {
      label: s.label,
      min: [s.min[0] + offset[0], s.min[1] + offset[1], s.min[2] + offset[2]],
      max: [s.max[0] + offset[0], s.max[1] + offset[1], s.max[2] + offset[2]],
      points: nextPts,
    };
  });
}

/** Rotate every signature around `origin` by `degrees` about `axis`
 *  (Rodrigues' formula). The bbox is refit from the rotated cloud points
 *  so it stays tight regardless of axis. */
function rotateSignatures(
  sigs: ReadonlyArray<LabelSignature>,
  degrees: number,
  axis: [number, number, number],
  origin: [number, number, number],
): LabelSignature[] {
  if (sigs.length === 0) return [];
  const rad = (degrees * Math.PI) / 180;
  const c = Math.cos(rad), s = Math.sin(rad);
  const [ax, ay, az] = axis;
  const al = Math.hypot(ax, ay, az);
  if (al === 0) return sigs.map(x => ({
    label: x.label,
    min: [...x.min] as [number, number, number],
    max: [...x.max] as [number, number, number],
    points: new Float32Array(x.points),
  }));
  const ux = ax / al, uy = ay / al, uz = az / al;
  const [ox, oy, oz] = origin;
  return sigs.map(({ label, points }) => {
    const nextPts = new Float32Array(points.length);
    let mnx = Infinity, mny = Infinity, mnz = Infinity;
    let mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
    for (let i = 0; i + 2 < points.length; i += 3) {
      const px = points[i] - ox, py = points[i + 1] - oy, pz = points[i + 2] - oz;
      const dot = ux * px + uy * py + uz * pz;
      const crx = uy * pz - uz * py;
      const cry = uz * px - ux * pz;
      const crz = ux * py - uy * px;
      const rx = px * c + crx * s + ux * dot * (1 - c) + ox;
      const ry = py * c + cry * s + uy * dot * (1 - c) + oy;
      const rz = pz * c + crz * s + uz * dot * (1 - c) + oz;
      nextPts[i] = rx; nextPts[i + 1] = ry; nextPts[i + 2] = rz;
      if (rx < mnx) mnx = rx; if (rx > mxx) mxx = rx;
      if (ry < mny) mny = ry; if (ry > mxy) mxy = ry;
      if (rz < mnz) mnz = rz; if (rz > mxz) mxz = rz;
    }
    return {
      label,
      min: [mnx, mny, mnz],
      max: [mxx, mxy, mxz],
      points: nextPts,
    };
  });
}

/** Hash-survivor propagation — used by fillet/chamfer. Walk the output
 *  shape's faces; whichever ones still appear in the input label map (by
 *  hashcode) keep their label. Faces that got remeshed by the solver have
 *  fresh hashes and no label. Cheap and correct for the typical case. */
function propagateByHashSurvivor(outputShape: AnyShape, inputLabels: Map<number, string>): Map<number, string> {
  if (inputLabels.size === 0) return new Map();
  const next = new Map<number, string>();
  for (const { hash } of listFaceHashes(outputShape)) {
    const lab = inputLabels.get(hash);
    if (lab !== undefined) next.set(hash, lab);
  }
  return next;
}

/** Positional propagation — used by translate/rotate. The TopoDS transform
 *  produces a new shape whose face hashcodes differ from the input, but the
 *  TopExp iteration order is preserved one-to-one. Walk both lists in
 *  parallel and copy labels position-by-position. */
function propagateByTopExpOrder(inputShape: AnyShape, outputShape: AnyShape, inputLabels: Map<number, string>): Map<number, string> {
  if (inputLabels.size === 0) return new Map();
  const inFaces = listFaceHashes(inputShape);
  const outFaces = listFaceHashes(outputShape);
  const next = new Map<number, string>();
  // OCCT preserves face count and order under rigid transforms; if for any
  // reason the counts diverge we fall back to hash-survivor so we never crash
  // a paint workflow.
  if (inFaces.length === outFaces.length) {
    for (let i = 0; i < inFaces.length; i++) {
      const lab = inputLabels.get(inFaces[i].hash);
      if (lab !== undefined) next.set(outFaces[i].hash, lab);
    }
    return next;
  }
  return propagateByHashSurvivor(outputShape, inputLabels);
}

/** Boolean op for labeled shapes — uses replicad's `.fuse()` / `.cut()` /
 *  `.intersect()` (which themselves wrap BRepAlgoAPI under the hood) and
 *  propagates labels via *spatial signature* matching at toMesh time.
 *
 *  An earlier version of this function dropped down to BRepAlgoAPI directly
 *  to use the OCCT History API for label provenance — that read better on
 *  paper but `Modified()` / `Generated()` returned empty or surprising lists
 *  for trimmed sphere faces in this opencascade.js build, mislabelling
 *  features. Spatial-signature matching (per-labeled-face centroids,
 *  carried on the wrapper) doesn't need History to be correct — it just
 *  matches output faces to their nearest pre-fuse centroid at resolution
 *  time. Robust across all op types, including ones we don't try to handle
 *  via History (fillet, chamfer). */
function labeledBooleanOp(
  op: 'fuse' | 'cut' | 'intersect',
  self: BrepShape,
  other: BrepShape,
): BrepShape {
  if (!replicadModule) {
    throw new Error('BREP runtime not loaded — call ensureBrepLoaded() first.');
  }
  const aClone = self._shape.clone();
  const bClone = other._shape.clone();
  let next: AnyShape;
  if (op === 'fuse') next = aClone.fuse(bClone);
  else if (op === 'cut') next = aClone.cut(bClone);
  else next = aClone.intersect(bClone);
  // Booleans don't transform geometry; both inputs' signatures pass through
  // (the resolver picks nearest across the union at toMesh time). Face
  // hashes don't propagate cleanly through replicad's fuse, so we leave
  // _faceLabels empty for the result and lean entirely on signatures.
  const mergedSignatures: LabelSignature[] = [...self._labelSignatures, ...other._labelSignatures];
  return wrap(next, new Map(), mergedSignatures);
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

/** Per-edge geometric summary returned by `BREP.listEdges`. World-space.
 *  Centroid is the world-space midpoint of the edge's start/end points
 *  (not the arc midpoint — adequate for the common debug case of "which
 *  edge am I looking at?"). */
export interface EdgeInfo {
  /** Stable index within this shape's edge enumeration (TopExp order).
   *  Not portable across operations — only meaningful for the snapshot
   *  this list was taken from. */
  index: number;
  /** [x, y, z] world-space midpoint between the edge's endpoints. */
  midpoint: [number, number, number];
  /** Unit direction from start to end. For closed circular edges (no
   *  start≠end), this is `[NaN, NaN, NaN]` and `isClosed` is true. */
  direction: [number, number, number];
  /** Axis-aligned bounding box of the edge, [minX,minY,minZ,maxX,maxY,maxZ]. */
  bbox: [number, number, number, number, number, number];
  /** Straight-line distance from start to end. For closed/curved edges
   *  this underestimates arc length; the `bbox` carries the spatial
   *  extent. */
  chord: number;
  /** True if the edge is a closed loop (e.g. a circular rim where
   *  start === end). */
  isClosed: boolean;
}

/** Snapshot every edge of `shape` (optionally narrowed by a filter) into a
 *  small debug-friendly array. Use this to figure out why a filter isn't
 *  matching what you expected — the saved iterations across multiple
 *  agents' fillet attempts justified shipping this as a first-class
 *  surface. */
export function listShapeEdges(shape: AnyShape, filter?: EdgeFilter): EdgeInfo[] {
  if (!replicadModule) throw new Error('BREP runtime not loaded — call ensureBrepLoaded() first.');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allEdges: any[] = shape.edges;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let edges: any[];
  if (filter) {
    const { EdgeFinder } = replicadModule;
    const finder = buildEdgeFinder(filter)(new EdgeFinder());
    edges = finder.find(shape);
  } else {
    edges = allEdges;
  }
  const out: EdgeInfo[] = [];
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    const bb = edge.boundingBox;
    let midpoint: [number, number, number] = [0, 0, 0];
    let direction: [number, number, number] = [NaN, NaN, NaN];
    let chord = 0;
    let isClosed = false;
    try {
      const start = edge.startPoint;
      const end = edge.endPoint;
      const sx = start.x, sy = start.y, sz = start.z;
      const ex = end.x, ey = end.y, ez = end.z;
      midpoint = [(sx + ex) * 0.5, (sy + ey) * 0.5, (sz + ez) * 0.5];
      const dx = ex - sx, dy = ey - sy, dz = ez - sz;
      chord = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (chord > 1e-9) {
        direction = [dx / chord, dy / chord, dz / chord];
      } else {
        isClosed = true;
        // For closed loops, fall back to bbox centre for midpoint so the
        // caller still gets a usable spatial cue.
        midpoint = [(bb.bounds[0][0] + bb.bounds[1][0]) * 0.5,
                    (bb.bounds[0][1] + bb.bounds[1][1]) * 0.5,
                    (bb.bounds[0][2] + bb.bounds[1][2]) * 0.5];
      }
      try { start.delete?.(); } catch { /* not all replicad builds emit deletable points */ }
      try { end.delete?.(); } catch { /* not all replicad builds emit deletable points */ }
    } catch {
      // Degenerate edge — emit a stub so the index sequence stays intact.
    }
    out.push({
      index: i,
      midpoint,
      direction,
      bbox: [bb.bounds[0][0], bb.bounds[0][1], bb.bounds[0][2], bb.bounds[1][0], bb.bounds[1][1], bb.bounds[1][2]],
      chord,
      isClosed,
    });
  }
  return out;
}

function countMatchedEdges(shape: AnyShape, filter: EdgeFilter): number {
  if (!replicadModule) return 0;
  try {
    const { EdgeFinder } = replicadModule;
    const finder = buildEdgeFinder(filter)(new EdgeFinder());
    return finder.find(shape).length;
  } catch {
    // If the count probe itself throws, swallow and let the real fillet/chamfer
    // call surface the underlying error — better than a misleading "0 matches".
    return -1;
  }
}

/** Build a focused "your filter matched zero edges" error message that
 *  names the filter, summarises the shape's edge distribution, and points
 *  at the documented workaround for the inBox-on-box-edges defect. */
function buildNoEdgeMatchError(shape: AnyShape, filter: EdgeFilter, op: 'fillet' | 'chamfer'): string {
  const edges = listShapeEdges(shape);
  const total = edges.length;
  const summary = summariseEdgeOrientations(edges);
  const filterStr = JSON.stringify(filter);
  const hasBoxFilter =
    filter.minX !== undefined || filter.maxX !== undefined ||
    filter.minY !== undefined || filter.maxY !== undefined ||
    filter.minZ !== undefined || filter.maxZ !== undefined;
  const inBoxHint = hasBoxFilter
    ? '\n  • inBox-style filters (minZ/maxZ/minX/...) are unreliable on box-axis-aligned edges of a `BREP.box` because OCCT\'s containment test leaves planar coincident edges JUST outside tolerance. Workaround: pair the box bounds with `parallelToPlane` or `inDirection` to also require the edge orientation match. See replicad.md "Common errors".'
    : '';
  return `BREP.${op}: filter ${filterStr} matched 0 of ${total} edges; nothing to ${op}.
Edge summary on this shape: ${summary}
Hints:
  • Call BREP.listEdges(shape, filter) (no fillet) to see exactly which edges your filter is/isn't catching, with their bbox + midpoint + direction. Iterate from there.${inBoxHint}
  • Loosen the bounds (e.g. widen the maxZ window to 0.1 instead of 0.001) — bbox tolerances in OCCT can be lax on planar coincident edges.`;
}

/** Bucket a shape's edges by primary axis alignment for a short error
 *  hint. Not a precise classifier — just enough to tell the caller "you
 *  said vertical edges but this shape only has horizontal rings". */
function summariseEdgeOrientations(edges: EdgeInfo[]): string {
  if (edges.length === 0) return '(no edges)';
  let xParallel = 0, yParallel = 0, zParallel = 0, other = 0, closed = 0;
  for (const e of edges) {
    if (e.isClosed) { closed++; continue; }
    const [dx, dy, dz] = e.direction;
    const ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz);
    if (ax > 0.99) xParallel++;
    else if (ay > 0.99) yParallel++;
    else if (az > 0.99) zParallel++;
    else other++;
  }
  const parts: string[] = [];
  if (xParallel) parts.push(`${xParallel} X-parallel`);
  if (yParallel) parts.push(`${yParallel} Y-parallel`);
  if (zParallel) parts.push(`${zParallel} Z-parallel`);
  if (other) parts.push(`${other} oblique/curved`);
  if (closed) parts.push(`${closed} closed-loop`);
  return parts.join(', ') || '(only degenerate edges)';
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

/** Build a `Map<label, Set<triangleId>>` for a labeled BrepShape, where the
 *  triangle ids index the WELDED mesh that `toMeshData` returns. Walks the
 *  replicad tessellation's `faceGroups` (each one tagged with the BREP face
 *  hashcode) and buckets the triangles by label. Returns an empty map when
 *  the shape has no labels.
 *
 *  Two-stage resolution per faceGroup:
 *    1. Hash match against `_faceLabels` — fast, exact, set by OCCT History.
 *    2. Spatial fallback against `_labelSignatures` — robust for faces that
 *       History missed (most commonly the trimmed-sphere face after a fuse;
 *       OCCT's Modified() comes back empty in some builds and the hash
 *       changes from the input). The face's centroid is matched against the
 *       nearest label signature; close enough → label inherited.
 *
 *  The spatial fallback is conservative — it only fires when stage 1 misses,
 *  and only when there's a "clearly closest" signature (the runner-up is
 *  meaningfully farther). False positives near boundary triangles would
 *  paint slightly-wrong regions, so the threshold is generous. */
function buildLabelMapFromShape(
  shape: AnyShape,
  faceLabels: ReadonlyMap<number, string>,
  labelSignatures: ReadonlyArray<LabelSignature> = [],
): BrepLabelMap {
  const out: BrepLabelMap = new Map();
  if (faceLabels.size === 0 && labelSignatures.length === 0) return out;
  const tolerance = 0.01;
  const angularTolerance = 12;
  const mesh = shape.mesh({ tolerance, angularTolerance });
  // `faceGroups` is { start, count, faceId } where start/count index into the
  // *raw* triangles array (pre-weld) and faceId is the face's hashcode. Our
  // welder doesn't change triangle ids — only vertex indices inside each
  // triangle get remapped — so a faceGroup's [start..start+count) range still
  // maps directly to triangle ids in the welded mesh.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const faceGroups: Array<{ start: number; count: number; faceId: number }> = mesh.faceGroups;
  const vertices: number[] = mesh.vertices;
  const triangles: number[] = mesh.triangles;

  const addTriRange = (label: string, startTri: number, endTri: number) => {
    let set = out.get(label);
    if (!set) {
      set = new Set<number>();
      out.set(label, set);
    }
    for (let t = startTri; t < endTri; t++) set.add(t);
  };

  for (const group of faceGroups) {
    const startTri = (group.start / 3) | 0;
    const endTri = startTri + ((group.count / 3) | 0);
    // Stage 1: hash match.
    const lab = faceLabels.get(group.faceId);
    if (lab !== undefined) {
      addTriRange(lab, startTri, endTri);
      continue;
    }
    // Stage 2: spatial resolution. Two passes:
    //   1) bbox-containment with smallest-volume tiebreak — eliminates faces
    //      whose source bbox doesn't even reach the output centroid, and
    //      picks the more-localised face when several contain it (a sphere's
    //      bbox engulfs a cylinder, so the cylinder wins on its own seam).
    //   2) if no bbox contained the centroid (rare; happens when the boolean
    //      slightly displaces a face past its source bbox), fall back to
    //      nearest cloud point across all signatures so we still produce a
    //      label rather than dropping the face.
    if (labelSignatures.length === 0) continue;
    let cx = 0, cy = 0, cz = 0, n = 0;
    for (let t = startTri; t < endTri; t++) {
      const i0 = triangles[t * 3] * 3, i1 = triangles[t * 3 + 1] * 3, i2 = triangles[t * 3 + 2] * 3;
      cx += (vertices[i0] + vertices[i1] + vertices[i2]) / 3;
      cy += (vertices[i0 + 1] + vertices[i1 + 1] + vertices[i2 + 1]) / 3;
      cz += (vertices[i0 + 2] + vertices[i1 + 2] + vertices[i2 + 2]) / 3;
      n++;
    }
    if (n === 0) continue;
    cx /= n; cy /= n; cz /= n;

    const eps = 1e-3;
    // Pass 1: bbox containment + smallest-volume.
    //
    // Known limitation — five subagents reported `paintByLabel` painting
    // wrong triangles on multi-feature BREP composites. The
    // smallest-volume tiebreak fails for nested features (an eye sphere
    // inside a head cone): both bboxes contain a head surface triangle's
    // centroid near the eye, and the smaller eye-bbox wins even though
    // the triangle is geometrically on the head's surface. A point-cloud
    // distance tiebreak was tried but didn't help — the 64-sample-per-face
    // signatures are too sparse to reliably distinguish "on the eye
    // surface" from "on the head surface near the eye". Documented as a
    // known limit in `public/ai/replicad.md` "Gotchas cheat sheet" with
    // the working workaround: coordinate-based selectors
    // (paintInCylinder / paintSlab / paintInBox / paintNear) for
    // multi-feature composites.
    let bestLabel: string | null = null;
    let bestVolume = Infinity;
    for (const sig of labelSignatures) {
      if (cx < sig.min[0] - eps || cx > sig.max[0] + eps) continue;
      if (cy < sig.min[1] - eps || cy > sig.max[1] + eps) continue;
      if (cz < sig.min[2] - eps || cz > sig.max[2] + eps) continue;
      const dx = Math.max(sig.max[0] - sig.min[0], eps);
      const dy = Math.max(sig.max[1] - sig.min[1], eps);
      const dz = Math.max(sig.max[2] - sig.min[2], eps);
      const vol = dx * dy * dz;
      if (vol < bestVolume) {
        bestVolume = vol;
        bestLabel = sig.label;
      }
    }
    if (bestLabel !== null) {
      addTriRange(bestLabel, startTri, endTri);
      continue;
    }
    // Pass 2: nearest cloud point across all signatures.
    let bestD = Infinity;
    for (const sig of labelSignatures) {
      const pts = sig.points;
      for (let i = 0; i + 2 < pts.length; i += 3) {
        const dx = pts[i] - cx;
        const dy = pts[i + 1] - cy;
        const dz = pts[i + 2] - cz;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestD) {
          bestD = d;
          bestLabel = sig.label;
        }
      }
    }
    if (bestLabel !== null) addTriRange(bestLabel, startTri, endTri);
  }
  return out;
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
  /** Axis-aligned box centred on the Z axis (X and Y from -size/2 to +size/2)
   *  but with its base on the XY plane (z = 0 to +zLength). To centre in Z too,
   *  follow with `.translate([0, 0, -h/2])`. `BREP.box([10, 10, 10])`. */
  box(size: [number, number, number]): BrepShape;
  /** Cylinder of radius `r` and height `h` along +Z, base on the XY plane. */
  cylinder(r: number, h: number): BrepShape;
  /** Sphere of radius `r` centred at the origin. */
  sphere(r: number): BrepShape;
  /** Attach a name to every face of a shape. The label survives the BREP
   *  pipeline: through boolean ops (`fuse`/`cut`/`intersect`), through rigid
   *  transforms (`translate`/`rotate`), and best-effort through
   *  `fillet`/`chamfer` (faces remeshed by the solver lose their label;
   *  unchanged ones keep it). At `.toMesh()` / `.toManifold()` time the
   *  labels resolve to a triangle-set per label so `paintByLabel({label})`
   *  works just like the manifold-js `api.label` path. */
  label(shape: BrepShape, name: string): BrepShape;
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
  /** Snapshot the shape's edges (optionally narrowed by an EdgeFilter) into
   *  a debug list of `{index, midpoint, direction, bbox, chord, isClosed}`.
   *  Call before a tricky fillet/chamfer to confirm your filter is picking
   *  the right edges — saves trial-and-error against the silent
   *  "0 matched" failure mode. */
  listEdges(shape: BrepShape, filter?: EdgeFilter): EdgeInfo[];
  /** N copies of `shape` arranged on a circle, fused into one solid.
   *  `count` ≥ 1, `radius` ≥ 0. Each copy is the original `shape`
   *  translated to (cos θ × radius, sin θ × radius) at θ = 2π·i / count,
   *  then rotated to face outward by default. Use this for bolt circles,
   *  fan blades, gear teeth, etc.
   *
   *  The `axis` defaults to `[0,0,1]` (rotation about Z). To pattern in
   *  the XZ plane use `axis: [0,1,0]`; for YZ use `[1,0,0]`. */
  circularPattern(shape: BrepShape, count: number, opts: {
    radius: number;
    /** Rotation axis. Must be one of `[1,0,0]`, `[0,1,0]`, `[0,0,1]` — the
     *  perpendicular-seed-axis logic only handles cardinal axes; an
     *  off-cardinal vector silently produced a tilted-cone layout.
     *  Defaults to `[0,0,1]` (rotation about Z). */
    axis?: [number, number, number];
    /** Sweep angle in degrees. Defaults to 360 (full circle, evenly spaced).
     *  Pass `angle: 90, count: 5` to fit five copies across a 90° arc. */
    angle?: number;
  }): BrepShape;
  /** N copies of `shape` arranged on a straight line, fused into one
   *  solid. The first copy is at the origin (unmoved); the i-th copy is
   *  translated by `i * step` along `axis` (default `[1,0,0]`). Use for
   *  vent slots, button rows, gear racks. */
  linearPattern(shape: BrepShape, count: number, opts: {
    step: number;
    axis?: [number, number, number];
  }): BrepShape;
  /** Truncated cone (frustum) with radius `rBottom` at z=0 tapering to
   *  `rTop` at z=h. Set either radius to zero for a full cone. */
  cone(rBottom: number, rTop: number, h: number): BrepShape;
  /** Donut with the given major (centre-of-ring to centre-of-tube)
   *  and minor (tube) radius. Axis along Z, lying in the XY plane. */
  torus(majorRadius: number, minorRadius: number): BrepShape;
  /** Revolve a 2D polygon profile (in the XZ plane, the X axis being the
   *  radial direction from the Z rotation axis) into a solid of
   *  revolution. `profile` is an array of `[x, z]` points; the polygon
   *  is closed automatically. All x ≥ 0; touching the Z axis (x=0) is
   *  allowed and produces a closed solid (no central hole). Use this for
   *  V-grooves, vases, flanges with non-trivial cross-sections, and any
   *  rotational shape `cylinder`/`cone`/`sphere` can't express. */
  revolve(profile: Array<[number, number]>): BrepShape;
  /** Hollow the solid by removing the face(s) that match `openFaceFilter`
   *  and leaving a wall of `thickness` units. The filter is REQUIRED —
   *  OCCT's shell needs to know which face to remove for the opening.
   *  The face filter shape mirrors EdgeFilter loosely: `{topZ: true}`,
   *  `{bottomZ: true}`, `{minZ}`, `{maxZ}`, `{normalAxis}`.
   *  Labels on faces that survive the shell are preserved (the same
   *  hash-survivor propagation that `fillet`/`chamfer` use). */
  shell(shape: BrepShape, thickness: number, openFaceFilter: FaceFilter): BrepShape;
  /** Identity check used by sandbox runtime and engines. */
  readonly _isBrep: true;
}

/** Friendly face filter — analogous to EdgeFilter but for the `shell` op.
 *  Picks faces by their bbox or normal direction. Used to name "the top
 *  face" / "the bottom face" / "the +X face" of a box-like solid. */
export interface FaceFilter {
  /** Pick faces whose centroid Z is ≥ minZ. */
  minZ?: number;
  /** Pick faces whose centroid Z is ≤ maxZ. */
  maxZ?: number;
  /** Shortcut: pick THE single face with the largest +Z (the top face).
   *  Mutually exclusive with `bottomZ`. */
  topZ?: boolean;
  /** Shortcut: pick THE single face with the smallest -Z (the bottom face). */
  bottomZ?: boolean;
  /** Pick faces whose outward normal is within 15° of this axis. */
  normalAxis?: [number, number, number];
}

/** Identify which cardinal axis the input vector aligns with. Returns
 *  `'x' | 'y' | 'z' | null`. Tolerant of unit-vector roundoff (the input
 *  doesn't have to be exactly `[1,0,0]`, just dominant on one axis with
 *  the others below 1e-3). */
function pickCardinalAxis(v: [number, number, number]): 'x' | 'y' | 'z' | null {
  const ax = Math.abs(v[0]), ay = Math.abs(v[1]), az = Math.abs(v[2]);
  const TOL = 1e-3;
  if (ax > 0.99 && ay < TOL && az < TOL) return 'x';
  if (ay > 0.99 && ax < TOL && az < TOL) return 'y';
  if (az > 0.99 && ax < TOL && ay < TOL) return 'z';
  return null;
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

// ── Label provenance side-channel ───────────────────────────────────────────
//
// Each BrepShape carries a `_faceLabels: Map<number, string>` mapping OCCT
// face hashcodes to user-chosen names. The labels are attached by
// `BREP.label(shape, name)` (which sets every face of `shape` to `name`)
// and propagated through every operation:
//
//   - translate / rotate: faces preserve TopExp iteration order; we walk the
//     input + output face lists in parallel and remap hashcodes by position.
//   - fillet / chamfer: most input faces survive (slightly modified); new
//     rounded surfaces are unlabeled. We use replicad's wrappers and rely on
//     hashcode-equality for the survivors — losing labels on faces that the
//     fillet solver remeshed beyond recognition, which is acceptable.
//   - fuse / cut / intersect: drop down to OCCT directly (BRepAlgoAPI_Fuse_3
//     etc.) and use the BooleanOperation's History (.Modified / .Generated)
//     to find which output faces came from which input face. This is the
//     "correct" propagation path the AI feedback specifically asked for.
//
// At toMesh() / toManifold() time we walk the result's tessellation
// faceGroups (replicad emits `{start, count, faceId}` per BREP face where
// `faceId` is the face's hashcode) and bucket triangles by label. The
// engine surfaces that as a `Map<label, Set<triangleId>>` so `paintByLabel`
// works identically to the manifold-js `api.label` path.

/** A label map shaped exactly like manifold-js's engine output, so the rest
 *  of the painting pipeline doesn't need a BREP-specific path. */
export type BrepLabelMap = Map<string, Set<number>>;

/** Per-run pending labels — populated by `BrepShape.toManifold()` calls
 *  inside a sandbox so the engine can drain + merge into its labelMap when
 *  the run ends. Module-level for the same reason as `brepAllocations`. */
let pendingToManifoldLabels: BrepLabelMap[] = [];

/** Imported BREP shapes the replicad engine should expose as `api.imports`
 *  on the next run. Populated by the STEP import flow when the user picks
 *  "BREP" as the import target. Persists across runs (cleared only when
 *  the user explicitly drops them or starts a new session) since a typical
 *  workflow is `return api.imports[0].fillet(2)` — repeated re-runs against
 *  the same import.
 *
 *  Each entry pairs a friendly name (the source filename) with the parsed
 *  shape, so the engine can mention it in error messages without leaking
 *  raw replicad internals. */
interface PendingBrepImport {
  filename: string;
  shape: BrepShape;
}
let pendingBrepImports: PendingBrepImport[] = [];

/** Read a STEP / STP file blob and return a BrepShape ready for use inside
 *  a replicad-language session (via `api.imports`) or for tessellation into
 *  a manifold-js mesh. Lazy-loads OCCT — the first call pays the WASM
 *  download. Returns the shape wrapped in our standard tracker so the engine
 *  cleanup hooks free it like any other intermediate. */
export async function parseStepBlob(blob: Blob): Promise<BrepShape> {
  await ensureBrepLoaded();
  if (!replicadModule) throw new Error('BREP runtime failed to load.');
  // replicad's `importSTEP` opens the file with STEPControl_Reader, transfers
  // roots, and returns a typed Shape — exactly what our wrapper expects.
  const shape = await replicadModule.importSTEP(blob);
  return wrap(shape);
}

/** Push an imported STEP shape so the replicad engine picks it up as
 *  `api.imports[i]` on the next run. The shape is retained for the session;
 *  call `clearPendingBrepImports` to drop it. */
export function pushPendingBrepImport(filename: string, shape: BrepShape): void {
  pendingBrepImports.push({ filename, shape });
}

/** Engine-side accessor: read the current pending import list (BrepShapes
 *  the replicad sandbox should see as `api.imports`). Returns a stable
 *  array reference until `clearPendingBrepImports` runs. */
export function getPendingBrepImports(): ReadonlyArray<PendingBrepImport> {
  return pendingBrepImports;
}

/** Drop all pending BREP imports. Called when the user opens a different
 *  session or explicitly clears them. */
export function clearPendingBrepImports(): void {
  for (const { shape } of pendingBrepImports) {
    try { shape.delete(); } catch { /* already freed */ }
  }
  pendingBrepImports = [];
}

/** Engine helper: take and clear the queued labelMaps from BREP.toManifold
 *  calls during the just-finished run. The manifold-js engine merges these
 *  into its own labelRegistry-derived map so `paintByLabel` finds them. */
export function consumeBrepToManifoldLabels(): BrepLabelMap[] {
  const out = pendingToManifoldLabels;
  pendingToManifoldLabels = [];
  return out;
}

/** Engine helper for the replicad-language engine: pull the resolved
 *  `Map<label, Set<triangleId>>` out of a returned BrepShape so the engine
 *  can attach it to the MeshResult and paintByLabel works. */
export function extractLabelMap(shape: BrepShape): BrepLabelMap {
  return buildLabelMapFromShape(shape._shape, shape._faceLabels, shape._labelSignatures);
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
  const { makeBaseBox, makeCylinder, makeSphere, drawCircle, draw } = replicadModule;
  return {
    box(size) {
      assertVec3(size, 'BREP.box(size)');
      // Replicad's makeBaseBox centres the box in X and Y (range
      // [-size/2, +size/2] on each) but extrudes UP from z=0, so the
      // z range is [0, size[2]], not centred. Documented this way in
      // replicad.md; agents have tripped on the prior "centred at origin"
      // wording assuming Z was symmetric too.
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
    label(shape, name) {
      assertShape(shape, 'BREP.label');
      if (typeof name !== 'string' || name.length === 0) {
        throw new Error('BREP.label(shape, name): name must be a non-empty string.');
      }
      // Stamp every current face with the given name. Two pieces of state
      // travel forward through subsequent ops:
      //   - `labels` (face hashcode → name) — fast exact path that works
      //     when face hashes happen to survive an op.
      //   - `signatures` (face centroid + label) — spatial fallback used
      //     by the resolver when hashes don't carry. Centroids come from
      //     the per-face triangulation that replicad emits while building
      //     the whole-shape mesh — that's the cleanest robust way to find
      //     each face's centre regardless of surface type (planar, cylinder,
      //     sphere, NURBS) and is what `buildLabelMapFromShape` consumes
      //     too, so the resolver and labeler see the same data.
      const labels = new Map<number, string>(shape._faceLabels);
      const signatures: LabelSignature[] = [...shape._labelSignatures];
      const mesh = shape._shape.mesh({ tolerance: 0.01, angularTolerance: 12 });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const faceGroups: Array<{ start: number; count: number; faceId: number }> = mesh.faceGroups;
      const vertices: number[] = mesh.vertices;
      const triangles: number[] = mesh.triangles;
      // Per-face signature: bbox + sample point cloud. Both come from the
      // face's portion of the global tessellation; the cap on MAX_PTS keeps
      // a pathological fine-tess sphere from pinning megabytes per signature.
      const MAX_PTS = 64;
      for (const group of faceGroups) {
        labels.set(group.faceId, name);
        const startTri = (group.start / 3) | 0;
        const endTri = startTri + ((group.count / 3) | 0);
        const seen = new Set<number>();
        let mnx = Infinity, mny = Infinity, mnz = Infinity;
        let mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
        for (let t = startTri; t < endTri; t++) {
          for (let k = 0; k < 3; k++) {
            const vIdx = triangles[t * 3 + k];
            seen.add(vIdx);
            const i = vIdx * 3;
            const x = vertices[i], y = vertices[i + 1], z = vertices[i + 2];
            if (x < mnx) mnx = x; if (x > mxx) mxx = x;
            if (y < mny) mny = y; if (y > mxy) mxy = y;
            if (z < mnz) mnz = z; if (z > mxz) mxz = z;
          }
        }
        if (seen.size === 0) continue;
        const all = Array.from(seen);
        const stride = all.length > MAX_PTS ? Math.max(1, Math.floor(all.length / MAX_PTS)) : 1;
        const points = new Float32Array(Math.min(all.length, MAX_PTS) * 3);
        let p = 0;
        for (let i = 0; i < all.length && p < points.length; i += stride) {
          const idx = all[i] * 3;
          points[p++] = vertices[idx];
          points[p++] = vertices[idx + 1];
          points[p++] = vertices[idx + 2];
        }
        signatures.push({
          label: name,
          min: [mnx, mny, mnz],
          max: [mxx, mxy, mxz],
          points: points.subarray(0, p),
        });
      }
      return wrap(shape._shape.clone(), labels, signatures);
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
    listEdges(shape, filter) {
      assertShape(shape, 'BREP.listEdges');
      return listShapeEdges(shape._shape, filter);
    },
    circularPattern(shape, count, opts) {
      assertShape(shape, 'BREP.circularPattern');
      if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) {
        throw new Error('BREP.circularPattern(shape, count, opts): count must be a positive integer.');
      }
      if (!opts || typeof opts !== 'object') {
        throw new Error('BREP.circularPattern(shape, count, opts): opts is required ({radius, axis?, rotateCopies?, angle?}).');
      }
      const { radius, axis = [0, 0, 1], angle = 360 } = opts;
      if (typeof radius !== 'number' || !isFinite(radius) || radius < 0) {
        throw new Error('BREP.circularPattern.radius must be a non-negative finite number.');
      }
      assertVec3(axis, 'BREP.circularPattern.axis');
      if (typeof angle !== 'number' || !isFinite(angle) || angle <= 0) {
        throw new Error('BREP.circularPattern.angle must be a positive finite number (degrees).');
      }
      // Cardinal-axis restriction — the perpendicular-seed picker below
      // assumes the rotation axis is one of [±1,0,0] / [0,±1,0] / [0,0,±1].
      // An off-cardinal vector silently produced a tilted-cone layout
      // (the seed offset wasn't actually perpendicular to the axis), so
      // reject it explicitly rather than ship a wrong-looking pattern.
      const cardinal = pickCardinalAxis(axis);
      if (cardinal === null) {
        throw new Error('BREP.circularPattern.axis must be one of [1,0,0], [0,1,0], [0,0,1] (or their negatives). Off-cardinal rotation axes are not supported.');
      }
      // Full-circle: divide evenly into count slots, no copy at θ=2π
      // duplicating θ=0. Partial: span [0, angle] inclusive with count
      // points (so 5 copies over 90° lands at 0/22.5/45/67.5/90 deg).
      const isFull = Math.abs(angle - 360) < 1e-9;
      const step = isFull ? angle / count : (count > 1 ? angle / (count - 1) : 0);
      // Perpendicular seed offset — pick whichever cardinal direction is
      // perpendicular to the rotation axis. Translate→rotate puts each
      // copy in the plane perpendicular to the rotation axis.
      const perp: [number, number, number] =
        cardinal === 'z' ? [radius, 0, 0] :
        cardinal === 'x' ? [0, radius, 0] :
        [radius, 0, 0];
      const copies: BrepShape[] = [];
      for (let i = 0; i < count; i++) {
        const theta = i * step;
        let copy = shape.translate(perp);
        if (theta !== 0) copy = copy.rotate(theta, axis);
        copies.push(copy);
      }
      return reduceShapes(copies, 'fuse', 'BREP.circularPattern');
    },
    linearPattern(shape, count, opts) {
      assertShape(shape, 'BREP.linearPattern');
      if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) {
        throw new Error('BREP.linearPattern(shape, count, opts): count must be a positive integer.');
      }
      if (!opts || typeof opts !== 'object') {
        throw new Error('BREP.linearPattern(shape, count, opts): opts is required ({step, axis?}).');
      }
      const { step, axis = [1, 0, 0] } = opts;
      if (typeof step !== 'number' || !isFinite(step) || step === 0) {
        throw new Error('BREP.linearPattern.step must be a non-zero finite number.');
      }
      assertVec3(axis, 'BREP.linearPattern.axis');
      const al = Math.sqrt(axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2]);
      if (al < 1e-9) {
        throw new Error('BREP.linearPattern.axis must be a non-zero vector.');
      }
      const ux = axis[0] / al, uy = axis[1] / al, uz = axis[2] / al;
      const copies: BrepShape[] = [];
      for (let i = 0; i < count; i++) {
        const d = step * i;
        copies.push(i === 0 ? wrap(shape._shape.clone(), new Map(shape._faceLabels), shape._labelSignatures) : shape.translate([ux * d, uy * d, uz * d]));
      }
      return reduceShapes(copies, 'fuse', 'BREP.linearPattern');
    },
    cone(rBottom, rTop, h) {
      if (typeof rBottom !== 'number' || !isFinite(rBottom) || rBottom < 0) {
        throw new Error('BREP.cone(rBottom, rTop, h): rBottom must be a non-negative number.');
      }
      if (typeof rTop !== 'number' || !isFinite(rTop) || rTop < 0) {
        throw new Error('BREP.cone(rBottom, rTop, h): rTop must be a non-negative number.');
      }
      if (typeof h !== 'number' || !isFinite(h) || h <= 0) {
        throw new Error('BREP.cone(rBottom, rTop, h): h must be a positive number.');
      }
      if (rBottom === 0 && rTop === 0) {
        throw new Error('BREP.cone(rBottom, rTop, h): both radii zero — degenerate cone.');
      }
      // Build a trapezoidal / triangular profile in the XZ half-plane
      // (x ≥ 0) and revolve around Z. When either radius is exactly
      // zero, build a true triangle that terminates at the Z axis so
      // the revolve produces a true apex (not a frustum with an
      // EPS-radius cap that misbehaves under .fillet / .shell).
      let pen;
      if (rTop === 0) {
        // Bottom disk → apex at (0, h).
        pen = draw([0, 0]).hLineTo(rBottom).lineTo([0, h]).close();
      } else if (rBottom === 0) {
        // Apex at (0, 0) → top disk.
        pen = draw([0, 0]).lineTo([rTop, h]).hLineTo(0).close();
      } else {
        // Frustum — both radii nonzero.
        pen = draw([0, 0]).hLineTo(rBottom).lineTo([rTop, h]).hLineTo(0).close();
      }
      const profile = pen.sketchOnPlane('XZ');
      return wrap(profile.revolve([0, 0, 1]));
    },
    torus(majorRadius, minorRadius) {
      if (typeof majorRadius !== 'number' || !isFinite(majorRadius) || majorRadius <= 0) {
        throw new Error('BREP.torus(major, minor): majorRadius must be a positive number.');
      }
      if (typeof minorRadius !== 'number' || !isFinite(minorRadius) || minorRadius <= 0) {
        throw new Error('BREP.torus(major, minor): minorRadius must be a positive number.');
      }
      if (minorRadius >= majorRadius) {
        throw new Error('BREP.torus(major, minor): minorRadius must be < majorRadius (otherwise the tube self-intersects through the centre).');
      }
      // Circle of radius `minor` centred at (major, 0) in XZ, revolved
      // about Z. drawCircle returns a centred drawing; translate it to
      // major before sketching.
      const tube = drawCircle(minorRadius).translate(majorRadius, 0);
      const profile = tube.sketchOnPlane('XZ');
      return wrap(profile.revolve([0, 0, 1]));
    },
    revolve(profile) {
      if (!Array.isArray(profile) || profile.length < 3) {
        throw new Error('BREP.revolve(profile): expected an array of [x, z] points (length ≥ 3).');
      }
      for (let i = 0; i < profile.length; i++) {
        const pt = profile[i];
        if (!Array.isArray(pt) || pt.length !== 2 || typeof pt[0] !== 'number' || typeof pt[1] !== 'number') {
          throw new Error(`BREP.revolve(profile): point ${i} must be [x, z] (two finite numbers).`);
        }
        if (!isFinite(pt[0]) || !isFinite(pt[1])) {
          throw new Error(`BREP.revolve(profile): point ${i} contains a non-finite coordinate.`);
        }
        if (pt[0] < -1e-9) {
          throw new Error(`BREP.revolve(profile): point ${i} has x=${pt[0]} < 0; profile must stay in the half-plane x ≥ 0 (X is the radial axis from Z).`);
        }
      }
      const [first, ...rest] = profile;
      let pen = draw([first[0], first[1]]);
      for (const [x, z] of rest) pen = pen.lineTo([x, z]);
      const drawing = pen.close();
      const sketch = drawing.sketchOnPlane('XZ');
      return wrap(sketch.revolve([0, 0, 1]));
    },
    shell(shape, thickness, openFaceFilter) {
      assertShape(shape, 'BREP.shell');
      if (typeof thickness !== 'number' || !isFinite(thickness) || thickness === 0) {
        throw new Error('BREP.shell(shape, thickness, filter): thickness must be a non-zero finite number (positive = outward, negative = inward).');
      }
      if (!openFaceFilter) {
        throw new Error('BREP.shell(shape, thickness, filter): an openFaceFilter is required — OCCT shell needs to know which face to remove for the opening. Try {topZ: true} to open the top face of a box/cylinder.');
      }
      try {
        const finderFn = (f: AnyShape) => applyFaceFilter(f, openFaceFilter, shape._shape);
        const next = shape._shape.clone().shell(thickness, finderFn);
        // Faces that survive the shell keep their position; labels
        // propagate via the same hash-survivor mechanism fillet/chamfer
        // use. Removed face's label is dropped (correct — it no longer
        // exists). Signatures pass through unchanged.
        return wrap(next, propagateByHashSurvivor(next, new Map(shape._faceLabels)), shape._labelSignatures);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`BREP.shell failed (thickness: ${thickness}): ${msg}
Hints:
  • Shell thickness must be small relative to the smallest local curvature radius — try a smaller value.
  • The openFaceFilter must match exactly one face (the open side). For a box or cylinder, {topZ: true} picks the top face. For a sphere, this op generally won't work (no flat face to remove).`);
      }
    },
    _isBrep: true,
  };
}

/** Apply a FaceFilter to a replicad FaceFinder. Mirrors `buildEdgeFinder`
 *  but for the smaller face-filter surface. */
function applyFaceFilter(finder: AnyShape, filter: FaceFilter, sourceShape: AnyShape): AnyShape {
  let f = finder;
  if (filter.topZ === true || filter.bottomZ === true) {
    // Pick the face whose centroid Z is highest (or lowest). Replicad's
    // FaceFinder doesn't expose an extremum picker directly, so we
    // enumerate the faces, find the bbox-Z extreme, and add a centroid
    // predicate that hits only that one face.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const faces: any[] = sourceShape.faces;
    let bestZ = filter.topZ ? -Infinity : Infinity;
    for (const face of faces) {
      const bb = face.boundingBox;
      const cz = (bb.bounds[0][2] + bb.bounds[1][2]) * 0.5;
      if (filter.topZ ? cz > bestZ : cz < bestZ) bestZ = cz;
    }
    const target = bestZ;
    if (filter.topZ) f = f.inPlane('XY', target);
    else f = f.inPlane('XY', target);
  }
  if (filter.minZ !== undefined || filter.maxZ !== undefined) {
    const huge = 1e9;
    f = f.inBox([-huge, -huge, filter.minZ ?? -huge], [huge, huge, filter.maxZ ?? huge]);
  }
  if (filter.normalAxis !== undefined) {
    assertVec3(filter.normalAxis, 'FaceFilter.normalAxis');
    f = f.parallelTo(filter.normalAxis as [number, number, number]);
  }
  return f;
}

/** Source-level test: does the user's code reference `BREP`? Used by the
 *  engine Worker to decide whether to pre-load OCCT before executing. The
 *  heuristic is intentionally coarse — better to occasionally load BREP for
 *  code that mentions the string in a comment than to miss a real use. */
export function sourceUsesBrep(code: string): boolean {
  // Word-boundary match avoids hits inside identifiers like `aBREPb`.
  return /\bBREP\b/.test(code);
}
