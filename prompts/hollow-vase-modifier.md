---
date: 2026-06-09
author: claude (opus-4-8)
area: surface modifiers / hollow (vase mode)
---

## Human

"Add a 'Hollow / vase' volumetric surface modifier to Partwright. It turns a
solid model into a thin hollow shell (optionally open-topped, with drain holes)
— vase mode."

The shared SDF pipeline (`sdfModifierMesh`) already existed; the Voronoi lamp was
named as the end-to-end template to mirror exactly. Field math was specified:
`shell(d) = max(d, -(d + wall))`, `bandWorld = wall`; open top = union the cavity
with the upward half-space above `z = modelTopZ - rim`; drain holes = N small
vertical cylinders subtracted near the base. Wire the full loop (id, modifiers,
modal tab + palette, defaults, window.partwright method + help + AI tool schema +
dispatch + gating, docs), honor the UI↔JS parity rule, verify in a real browser,
add a golden-path e2e + a unit test for the combine.

## Assistant

**The combine (`src/surface/hollowShell.ts`).** A single `combine` closure over
the existing `sdfModifierMesh` scaffolding:
`v = max(d, -(d+wall))` (the wall band); open top folds in `max(v, z - openZ)`
with `openZ = topZ - rimHeight` (algebraically the union-with-upward-half-space
the prompt described); drain holes subtract finite vertical cylinders
(`max(v, -cyl)`), bounded to a short z-band above the floor so a *closed* top is
never accidentally pierced. A single hole sits at the centre; several arrange on
a ring inside the cavity.

**Two real bugs surfaced only in the browser — the spec-driven screenshot earned
its keep:**

1. *Thin walls meshed non-manifold.* A sub-~5-voxel wall pinches into
   non-manifold edges that `Manifold.ofMesh` rejects ("Not manifold"). I verified
   this is a property of the shared SDF/Surface-Nets path (the shipped
   `applyVoronoiLamp` fails identically on the same frustum), not the combine.
   Fix: raised the wall-voxel floor to `MIN_WALL_VOXELS = 5` and the default wall
   to `d*0.03` so default + reasonable inputs stay manifold.

2. *A sealed shell collapsed back to a solid.* `sdfModifier` reduced the mesh to
   its largest connected *surface* component — fine for a perforated lamp (one
   surface), fatal for a sealed shell whose inner and outer walls are two
   disconnected closed surfaces: the inner wall was dropped and volume came back
   nearly full. Fix: added a `keepLargestMeshComponent` option to `sdfModifier`
   (default = `watertight`, so the lamp is untouched); hollow passes `false` and
   keeps the field-level fragment cull. Closed shells now report `componentCount
   2` (outer + inner surfaces) with the interior genuinely removed (≈⅓ volume).

**A pre-existing UI bug, fixed in passing.** The whole-model-only tabs (Voxelize,
Voronoi lamp, and now Hollow) hide the region section, but `regionBlocked()` still
gated Apply on a region selection the user could never make — so Apply was
*disabled* on all three. Centralized them in a `WHOLE_ONLY` set, made
`regionBlocked()` return false for them, and refreshed the button in `renderTab`.

**Parity wiring (same PR):** `SurfaceModifierId` + `applyHollow`/
`defaultHollowOptions` in `modifiers.ts`; the `hollow` tab + sliders + palette
entry in `surfaceModal.ts`; `buildSurfaceModifier` branch + `applyHollow`
`window.partwright` method + `help()` entry in `main.ts`; `applyHollow` AI tool
schema + dispatch + `SAVE_GATED` in `tools.ts`; `public/ai/textures.md` section +
`public/ai.md` line.

**Verification:** browser screenshots of an open-top cup, a hollow bowl, and a
5-hole planter (drains viewed from below) — all single-component manifolds. Unit
tests cover the combine (`hollowShellMesh`: hollows, empty-in/empty-out, open top
shortens) and codegen; a permanent `tests/surface-hollow.spec.ts` golden path
covers the API (closed/open/planter) and the panel-tab Apply. `npm run build` +
`test:unit` (968) green; existing `surface-voronoi` spec still green.
