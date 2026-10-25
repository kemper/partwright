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
