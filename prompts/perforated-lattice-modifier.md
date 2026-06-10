---
date: 2026-06-09
branch: claude/perforated-lattice-modifier-7vnxgv
files_changed:
  - src/surface/latticePattern.ts
  - src/surface/perforatedLatticeSdf.ts
  - src/surface/modifiers.ts
  - src/ui/surfaceModal.ts
  - src/main.ts
  - src/ai/tools.ts
  - public/ai.md
  - public/ai/textures.md
  - tests/unit/surface.test.ts
  - tests/surface-perforate.spec.ts
---

## Human

Add a "Perforated lattice" volumetric surface modifier: like the Voronoi lamp
but with REGULAR patterns cut through a thin shell — square grid, hex, or
triangular truss windows. Reuse `sdfModifierMesh`; combine = max(shell(d),
strut(p)), strut(p) = distanceToNearestCellEdge(p) - halfStrut for a `pattern`
enum. Reuse the lamp's grain rotation; auto-raise resolution for thin struts.
Wire the whole loop like the lamp (SurfaceModifierId, applyPerforate, a modal
tab, command palette, window.partwright method + help() + tools.ts, docs), honor
UI<->JS API parity. Verify in-browser, add a golden-path spec + a combine unit
test.

## Assistant

Built it directly on the SDF scaffolding so I only wrote the field, exactly like
the Voronoi lamp (`voronoiLampSdf.ts` was the template throughout).

**Field design — the one real decision.** combine = max(shell(d), strut(p)) with
strut = latticeEdgeDist2D(p)·cell − halfStrut. The question was how to take a 2D
periodic pattern into 3D. I tried two approaches and verified both in the
browser:

1. *Triplanar min-blend* of the three coordinate planes' edge distances — kept
   material near a pattern line in ANY plane. This UNIONS three extruded grids,
   so it over-fills the wall: windows became shallow blind pockets, not open
   holes (a window must clear all three projections at once).
2. *True 3D strut lattice* (min over the three planes of distance-to-nearest
   cell-CORNER → thin 1D struts, e.g. the cubic frame for square). Opens windows
   from every angle on a cylinder, BUT on a thin spherical shell the struts that
   run perpendicular to the surface only graze it as nubs and don't connect
   adjacent surface struts — so the lattice fragments and `watertight` (keep
   largest component) discarded everything but one ring (genus 1, broken).

Landed on the task's literal baseline: a **2D pattern evaluated in XY, held
constant along Z**. The cell-edge network of every pattern is connected, so its
extrusion intersected with a thin shell stays one connected, watertight cage on
any shape — robust where the 3D lattice fragmented. Verified all three patterns
on a sphere (clean grid/hex/triangle windows on the caps, manifold, single
component, genus 49–95) and hex on a cylinder (the task's suggested check:
hexagons on the cap, axial louver slots on the Z-parallel wall). The documented
v1 limitation is exactly that: surfaces running parallel to Z see slots, not
cells.

Patterns (`latticePattern.ts`, pure + unit-tested): square = min(fracDist u,
fracDist v); triangle = nearest of three 60°-spaced line families; hex = bisector
distance to the nearest centre of a triangular point lattice (the Voronoi of that
lattice IS a honeycomb — the deterministic analogue of the lamp's jittered
`cellEdgeDist3D`).

**Wiring** mirrored the lamp end to end: `SurfaceModifierId 'perforate'`,
`applyPerforate` + `defaultPerforateOptions`, a Perforate modal tab (pattern
dropdown + cell/strut/wall/grain/resolution sliders + watertight), command
palette entry, `applyPerforatedLattice` on `window.partwright` + a help() row +
a tools.ts schema/dispatch/SAVE_GATED entry, and the `ai.md`/`textures.md` docs.

**Bug found + fixed along the way:** the whole-model-only tabs (voxelize,
voronoiLamp, and now perforate) hide the region selector, but `renderTab()` never
re-ran `updateApplyBtn()` on a tab switch — so opening the modal on `fuzzy`
(which disables Apply pending a region pick) and switching to a whole-only tab
left Apply permanently disabled. Added a `wholeOnly()` helper that short-circuits
`regionBlocked()`/`activeSelection()`, and an `updateApplyBtn()` call in
`renderTab()`. This repairs the same latent bug for voxelize/voronoiLamp.

## Follow-up (work-reviewer)

The reviewer caught a blocking docs/impl mismatch: when I pivoted the field from
the triplanar blend to the XY-constant-along-Z form, I updated the SDF module's
header comment but left "blended triplanar so windows open on every face"
language in the three user/agent-facing surfaces (`tools.ts` tool description,
`textures.md`, the modal help text) — and the docs even invented a non-existent
"triplanar thickens struts diagonally" artifact while hiding the real Z-slot
limitation. Rewrote all three to accurately describe the 2D-pattern-projected-
along-Z behaviour and its real limitation (axial slots on Z-parallel walls; reads
cleanly on faces turning toward Z; use `applyVoronoiLamp` for orientation-free).
Also aligned the `perforatedLatticeSdf` resolution JSDoc/fallback (140 → 110) to
the effective default. Re-synced `origin/main` (clean merge with the voxel-
rounding work).

## Follow-up 2 (user feedback: colors + render timer)

User reported (a) paint wasn't preserved at all through the perforated lattice and
(b) wanted a "Rendering…" message with a timer.

**Colors.** Root cause: `commitSurfaceModifier` only rehydrates paint when
`result.mesh.triColors` is set, but the SDF path returns brand-new Surface-Nets
topology with no colors (the displacement modifiers like fuzzy/knit keep topology
so their colors ride through — the SDF path can't). Added `carryTriColors(src,
dest)` to `colorTransfer.ts`: nearest-centroid transfer of the painted input's
per-triangle colors (plus the `_painted` mask) onto the new shell. Wired it into
`applyPerforate` AND the Voronoi-lamp mesh path (same latent bug). Verified in the
browser: a red-top/blue-bottom sphere keeps both colors on the struts;
`colorsCarried` ~336k, two regions survive.

**Render timer.** The SDF field sweep is synchronous and blocks the main thread,
so a live JS counter can't tick during the sweep itself — but the commit's async
phases (re-run, thumbnail, save) do yield. Added `runWithTimer` in the apply
handler: a paint yield so "Rendering…" shows before the block, a 100 ms
`setInterval` that advances during the async phases, and a "<label> rendered in
N.Ns" success toast (the modal closes on apply, so the toast is where the final
time lands). The preview path now appends "(rendered in N.Ns)" to its status.
Verified: modal shows a live "Rendering… 8.7s", toast shows "perforated lattice
rendered in 21.2s". Unit test added for `carryTriColors`.
