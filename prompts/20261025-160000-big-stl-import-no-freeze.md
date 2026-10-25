---
session: "0124MugS7aLdW18UJDeEAS17"
timestamp: "2026-10-25T16:00:00Z"
model: claude-opus-5-5
tools: [subagent, playwright-cdp-profiler]
---

## Human

When importing a large STL file or one that's got a lot of triangles, the app
hangs. I don't want that. Please fix. Create PR.

Follow-up: switching between large objects in the object list also freezes and
lags. The app should always be snappy — a "complex model, processing" message
with a progress bar is fine, but it must never freeze. [Shared a 187 MB,
3.7M-triangle STL (NED_V2.stl) via a Drive link for reference.]

## Assistant

## Key decisions

**Measure first.** A CDP CPU profile + a 20 ms heartbeat during imports of a
synthetic 500k / 2M-triangle sphere and the user's 3.7M file located every
main-thread stall instead of guessing. On `main` the user's file froze the tab
for 27 s and then 64 s.

**Parser.** The STL was parsed up to five times (a probe plus one parse per weld
tolerance), each welding with a string-keyed Map (~6 s at 2M tris). Now it parses
once into a triangle soup and re-welds per tolerance with an open-addressing
numeric hash (~10× faster). 3MF's `weldMesh` shares the same `weldPositions`.

**Import probe in a Worker.** Parse + weld ladder + `Manifold.ofMesh` trials run
in a dedicated `stlProbeWorker` (own manifold-3d instance; one Worker per probe,
terminated afterwards because a WASM heap never shrinks), behind the shared
cancellable progress modal. Bytes are transferred, not cloned (a 100 MB clone was
a 0.4 s stall). If the Worker can't start, the same pure `probeSTL` runs on the
main thread.

**Deferred main-thread Manifold.** After every run, main rebuilt a Manifold via
`Manifold.ofMesh` (~6 s at 2M tris, ~12 s at 3.7M) only so stats and the
slice/decompose APIs have one. For runs ≥ `renderer.lazyManifoldMinTriangles`
(250k, so the auto-quartile slices are already skipped), the engine Worker
computes the Manifold-dependent stats over its live result
(`computeManifoldFacts`, shared with statsComputation). Main stores the mesh and
builds the Manifold lazily through `liveManifold()` on first real use. Small
models keep the exact old eager path, so the change is limited to big meshes.
Worker facts are validated like every other Worker→main field.

**Object switching.** `preserveCurrentEditsIfNeeded` captured a thumbnail on
every switch even when nothing changed (2.5 s offscreen render of a big mesh); it
now runs saveVersion's dedup check (`currentPartIsDirty`) first. The paint
adjacency idle-prewarm (one 1.6 s synchronous task) is skipped above
`ui.paintPrewarmMaxTriangles`. The part-mesh cache keeps the Worker facts, so a
cache hit also defers the rebuild.

**Thumbnails.** The crease-edge overlay (`EdgesGeometry`, 2.5 s at 500k) is
skipped above `renderer.creaseEdgeMaxTriangles`; at that density the lines are
noise at thumbnail size.

**Deferred (tracked as follow-ups, not widened here):** the remaining ~3–4 s of
main-thread work to display a 3.7M mesh (BufferGeometry + normals built twice,
part summary, edge stats); the engine re-running `ofMesh` after the probe already
did; paint activation's synchronous adjacency build on huge meshes; the 3MF
probe still on the main thread.

Also made a pre-existing flaky assertion in import-merge-select.spec.ts poll
(it fails 2/6 on unmodified main — one-shot URL read racing updateURL).

## Assistant

## Review follow-ups (work-reviewer pass)

**Worker fallback was dead after the transfer.** The bytes were transferred in
the same tick as `new Worker`, so a Worker that failed to load (a stale chunk
after a deploy, a WASM init failure) left nothing for the main-thread fallback.
The Worker now loads manifold-3d first and posts `ready`, and only then does the
client transfer the bytes. `onmessageerror` and a failing `postMessage` reject
cleanly. The three API import paths (`importMeshData`, `inspectMeshData`,
`importFromUrl`) catch and return `{ error }`, keeping the no-throw API contract.

**Simplify forced the deferred build.** Its open-time "is this solid?" check now
reads the Worker facts. Restoring the simplify baseline re-defers using the
baseline's stored facts.

**A failed deferred build left "manifold" stats.** `liveManifold()`'s catch now
drops the facts, logs the failure and refreshes the stats, so the stats and the
tools agree the model is render-only.

**Facts are now paired with the mesh they describe** (`deferManifold` /
`manifoldFactsFor`), so the part-mesh cache and Simplify only reuse facts for
that exact mesh.

**Smaller fixes.**
- `getBoundingBox` returns a copy of the bbox.
- `query({ boundingBox })` no longer forces the build.
- The weld's per-vertex arrays grow with the unique-vertex count. On the user's
  file the probe went from 14 s to 10.9 s, with a far lower peak heap.

## Human

Work on the remaining stalls in #1129. Also: on the first import the object is
named "Object 1" instead of the file name, but later imports get the file name.
Please fix that too.

## Assistant

## Round 2 — remaining stalls (#1129) + first-object name

**First object name.** `createSession` always named its one object
"Object 1", while the "new object" import path used `createPart(fileBase)`.
`createSession` now takes an optional first-object name, and the session-
creating import paths (mesh, code file, STEP→BREP) pass the session/file name.

**Profiling-driven, again with the user's 3.7M-triangle file.** Each fix
targets a measured stall:
- **Geometry built twice (~1 s each).** `renderer/meshGeometry.ts` now builds
  indexed positions + area-weighted normals once per MeshData, with
  typed-array loops instead of Three's Vector3-based `computeVertexNormals`.
  The arrays are cached in a WeakMap and shared by the viewport and offscreen
  renders. The un-indexed coloured path is shared too. A unit test checks the
  normals equal Three's.
- **Thumbnail (4.5 s, GPU).** Offscreen renders draw meshes over
  `renderer.previewMaxTriangles` (400k) from a vertex-clustered proxy
  (`previewProxy.ts`, one linear pass). The cell is sized from the surface
  area so the proxy lands near the budget. `weldPositions` moved to
  `geometry/` (with a stride) so the renderer can use it.
- **Edge stats and the piece split.** The engine Worker now computes these
  next to `manifoldFacts` (validated; `pieceOfTri` is range-checked). The
  piece summary uses counting sort into one typed buffer instead of per-piece
  JS arrays.
- **The probe's ofMesh (~10 s).** A CSR edge-topology check
  (`isOrientedEdgeManifold`, ~0.4 s): every directed edge must occur exactly
  as often as its reverse, which is the halfedge-pairing property ofMesh
  enforces. It accepts the pinched edges real sculpts have, as ofMesh does
  (the user's file has 10). Verified against ofMesh on clean, pinched-edge,
  pinched-vertex and open meshes. A mesh that fails still gets the exact
  ofMesh ladder. The STEP and 3MF paths use the same quick check.
- **Paint adjacency.** `AdjacencyGraph` is now CSR (`nbStart`/`nbFlat`). One
  typed-array view per triangle cost 2.1 s of the 3.9 s build, and the build
  is now 1.1 s. Big meshes (`ui.paintAdjacencyWorkerMinTriangles`) build it in
  a Worker when Paint opens, with a "Preparing…" toast. There is no idle
  prewarm, since even the clone into the Worker cost 0.45 s per switch.

**Result:** import 45 s → 37 s. Paint opens without a freeze. The remaining
end-of-import busy time in this headless container is mostly software-GPU
frame rendering, plus IndexedDB serializing the 67 MB mesh on `put()`.
