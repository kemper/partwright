---
session: "01QnZGNLbg"
timestamp: "2026-11-15T04:39:45Z"
tools: [playwright, cdp-cpu-profile, vite-node]
---

## Human

Importing a 3MF is freezing on a file I attached (a third-party single-object
Bambu project, ~1.8M triangles, kept local). I thought we fixed that?
Investigate and report back.

After the report: go ahead with fixes 1 and 2, and do 3 as well.
(1 = cap the colour matcher's search at the seeder's own acceptance distance;
2 = skip the per-triangle region when the file has only one colour;
3 = move the colour matching into a worker for big meshes.)

## Assistant

## Key decisions

**Root cause**: the earlier fix moved 3MF *parsing* into a Worker. The lockup
is in a later step. After the import wrapper runs, `build3MFSeeder` matched
every output triangle to its nearest source triangle (`nearestTriangleMap`) on
the main thread. For triangles that are part of the import the lookup ends in
ring 0–1. For any other triangle — the rest of an object the import is added
to — the ring search walks the whole grid (measured ~0.5 s per triangle at
~100 mm, ~2 s at 150 mm on this mesh), and the seeder then discards the match
because it only accepts centroids within `diag × 1e-5`. "Add to object" on an
object holding a 12-triangle cube blocked the page for 11.7 s; on one holding
1.8M triangles the tab sat at 100% CPU until killed.

**Fix 1 — cap the search** (`colorTransfer.ts`): `nearestTriangleMap` takes
`maxDistance`; the hash stops at the cells that can hold a centroid that close
and returns -1 otherwise. The seeder passes its acceptance tolerance, so the
separate distance re-check goes away. I left the uncapped path's O(R⁴) ring
walk alone: every other caller queries meshes that coincide with the ref.

**Fix 2 — single-colour files import unpainted**: when every triangle of the
*whole file* carries the same palette entry (any unpainted single-filament
slicer project), the seeder returns no regions and leaves the active palette
alone. Judged per file, not per object: a split import whose objects each sit
on a different filament still gets its colours. The toast and the
`importMeshData` result (`singleColor`) say which colour was left off, so
nothing disappears silently. Chosen over a cheaper "whole model" region
because that would need a new persisted descriptor kind (schema bump) and
still pays the per-triangle-coloured render path.

**Fix 3 — Worker**: the match is a pure function (`import/colorSeed.ts`) run
by `colorSeedWorker.ts` through the shared `runImportWorkerJob` runner when
either mesh reaches `renderer.lazyManifoldMinTriangles` (the existing "big
mesh" threshold — no new knob), inline below it, with a main-thread fallback
if the Worker can't start. Seeding became async, so `seedImportRegions`
checks the live mesh is still the one the match started on before applying
ids (a newer run or object switch drops them, logged to the Diagnostic Log).

**Verification**: on the reported file — add to a small object 11.7 s → 4.6 s
longest stall; add to a 1.8M-triangle object never-finishes → 50 s; new object
6.2 s → 3.2 s final stall (the STL baseline). A locally generated two-colour
variant of the same mesh exercises the Worker at full size (all 1.79M
triangles coloured, no fallback).

**Not fixed here** (filed separately): "Add to object" on a multi-million
triangle object still has 5–10 s stalls unrelated to colour matching, and the
engine rebuild of a big import takes ~3× longer in the browser than the same
`ofMesh` in Node.

## Assistant

## Review follow-ups (same session)

**Single-colour skip narrowed to big models.** The reviewer pointed out that
skipping unconditionally breaks round-trips: a uniformly painted model
exported as 3MF, or a CAD file with one material, would come back grey with no
filament slot. The costs the skip avoids only exist at size, so it now applies
at or above `renderer.lazyManifoldMinTriangles` (the same big-mesh threshold
the Worker uses). Small single-colour files import exactly as on main. This is
narrower than what the human approved; flagged to them in the report.

**Stale results do nothing lasting.** The seeder gets an `isStale` callback
and returns before adopting a palette or counting colours when the live mesh
changed during the match; `seedImportRegions` then shows a warn toast instead
of only logging.

**The Worker match sits behind the progress modal** (with Cancel = import
without colours), so the model can't be switched under it. That closes the
window the async match would otherwise have widened, rather than threading a
"stale" result through every save path.

**Colours never fail an import.** A Worker failure falls back to the main
thread (bounded now that the search is capped); if that throws too, the import
lands uncoloured with a warn toast.

**Tolerance scales with coordinate size** as well as the source's diagonal:
"Add to object" shifts the import beside the object and back in float32, which
for a small part far from the origin exceeded `diag × 1e-5`.
