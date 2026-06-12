---
session: "1utra1"
timestamp: "2026-06-07T18:00:00Z"
model: claude-opus-4-8
tools: [explore]
---

## Human

Feedback from a modeling agent: voxel smoothing is "all-or-nothing", which is
the biggest hurdle to print-safe voxel models. Three requests: (1) `flatBottom`
/ `pinZMin` to keep the build-plate face flat, (2) masking / `excludeBox` to keep
a custom base region blocky, (3) `pinNormals` to freeze faces by direction. The
user's real goal: smooth voxel models with a solid non-smooth base; also open to
alternate smoothing algorithms that leave the bottom layer flat. Think critically
and report a plan rather than blindly implementing.

User chose scope: all three (flatBottom + baseLayers + lockBox), flatBottom = Z-only pin.

## Assistant

## Key decisions

**Unifying primitive: vertex pinning in the Taubin pass.** All three requests
reduce to "which vertices don't move." Rather than three bespoke code paths, I
added a per-vertex axis-freeze mask to `taubinSmooth` (`smooth.ts`) and derived
it from the vertex positions — no changes to the mesher's topology or the grid
encoding. The mesh is boundary-only with vertices at exact integer voxel
corners, so a geometric `minZ` / band / box test identifies the pinned set
exactly.

**flatBottom = Z-only pin (Neumann/reflective boundary).** Freezes only Z on the
minimum-Z plane: the build-plate face stays flat while sides/edges still round.
This is the textbook "flat against a plane" smoothing boundary condition and
matches the agent's literal request.

**baseLayers + lockBox = full pin (Dirichlet boundary).** `baseLayers: N` freezes
all axes for `z <= minZ + N`, keeping the bottom N voxel layers blocky as a solid
pedestal — this is what the user actually described ("solid non-smooth base"),
which is distinct from (and more print-stable than) flatBottom. `lockBox` does
the same for an arbitrary voxel-coordinate box. A pinned region acts as a fixed
boundary the smoothed part still relaxes toward, so the base↔body seam stays clean.

**Declined `pinNormals` (agent option 3).** The only useful normal is straight-down,
which `flatBottom` already covers more robustly; general normal-pinning needs
per-vertex normal estimation on a welded blocky mesh (ambiguous at corners) for
near-zero added value.

**Coordinate handling.** Options are authored in grid (voxel) coordinates and
stored on `Surfacing`; `meshGrid` resolves them to mesh space, scaling thresholds
by `detail` (flatBottom is plane-relative and needs none) since smoothing runs on
the supersampled grid before the `1/detail` rescale. `applyVoxelize` codegen left
unchanged — agents reach the new options directly via `v.smooth({...})`.

**Validation** follows the repo's strict contract: booleans/integers checked,
unknown keys rejected, `lockBox` validated as two integer triples and normalized
to sorted `{min,max}`.

**Verification:** new pure-logic unit tests (`tests/unit/voxelSmooth.test.ts`)
assert the pinned planes/bands/boxes stay exactly in place while the body still
moves; a new real-WASM e2e (`voxel-engine.spec.ts`) proves each option still
feeds `ofMesh` as a single watertight component. Browser screenshots confirmed a
smooth sphere on a sharp pedestal and a plate-flat smoothed sphere.
