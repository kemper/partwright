---
session: "01BsPPSVZ2oFGFXTxRyBtu1M"
timestamp: "2026-10-25T00:15:00Z"
model: claude-opus-5-5
sequence: 4
---

## Human

Review findings on #1109 to fix on the branch:
1. Harden fetchAppAsset: prefix allow-list, no dot or empty segments, a
   `redirect: 'error'` null-proto init, and loaders that patched built-ins
   can't steer.
2. Stop isPlainData DAG blow-up.
3. Bring back a paint-kind allow-list from one constant shared with the
   recorder, with per-kind field checks, and re-validate surfaceOps,
   paramsSchema and materialSpec.
4. Fix the stale voxel grid after a part-cache hit, and capture paramsKey when
   the run is requested.
5. Drop the merge-import epoch bump.
6. Make session-isolation recycles quiet in the health panel and the
   Diagnostic Log.
7. Bind the trust domain at loop entry points, guard the pool against respawn
   after dispose, and re-check the claim after awaiting workerReady.
8. Refuse SharedArrayBuffer-backed typed arrays.
9. Add a startup domain sentinel, and tag Workers on every claim.
10. Show `await` for setReferenceGeometry in ai.md and help().

## Assistant

## Key decisions

**Asset gate.** `toAppAssetPath` accepts only `<base>assets/` and
`<base>openscad-libs/` (plus `<base>node_modules/` on the dev server, which is
where Vite serves the `?url` OCCT WASM). It allows the characters
`[A-Za-z0-9/._~-]` and nothing else, and rejects empty, `.` and `..`
segments, queries and fragments. The check still uses primitive operations
only. The fetch init is a `{ __proto__: null, redirect: 'error' }` literal. The
loaders now build frozen URL lists at module load, before any model code
exists, and iterate with index loops. They capture `JSON.parse` and
`Promise.all` up front. BOSL2 manifest names must pass `isSafeAssetName`
before a URL is built from them.

**One paint-kind constant.** `src/geometry/apiPaintSpec.ts` exports
`API_PAINT_DESCRIPTOR_KINDS`. The recorder's `paintOps` array is typed
`RegionDescriptor & { kind: ApiPaintDescriptorKind }`, so a new kind won't
compile until it is added to the constant. The validator allow-lists the same
constant and checks each kind's exact fields: box, slab, cylinder, byLabel,
and pattern with its scope. The recorder-scan test now asserts that the
scanned kinds equal the constant. The other trusted sub-fields are re-run
through their real validators instead of hand-written duplicates:
`parseSurfaceOpts`, `normalizeParamSchema`, and the material preset table.

**Trust domain as a leaf module.** `src/geometry/trustDomain.ts` holds the
domain, with a `(startup)` sentinel. main.ts sets it from an `onStateChange`
listener registered at the top of `main()`, before anything can open a
session. engine.ts claims a Worker per request: it tags the Worker even for
data-only requests, recycles quietly (`'debug'`: no restart count, no log
entry), and re-checks the claim after `await workerReady`. Flows that capture
code and then await pass the domain they captured, and are refused once it is
stale: the thumbnail backfill, param-sweep frames, compose bakes, multi-object
export bakes and the Assembly view. The pool subscribes to domain changes and
disposes itself, and it refuses builds for a stale domain, so an old flow
can't respawn it. Merge imports no longer bump an epoch: the merged code
joins the session, and STEP-as-BREP objects keep their Worker-held imports.

**Voxel grid cache.** `PartMeshCacheEntry` now carries the voxel run, which
is restored on a cache hit. paramsKey is captured when the run is requested.
The async VOX exports fall back to the Worker's `voxel_grid` message when the
cache is stale.
