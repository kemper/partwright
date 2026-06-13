---
date: "2026-06-13"
task: "feat: reshape figure footwear into a natural shoe (toe box, instep, heel, flat sole)"
pr: 634
areas: [figure, sdf, catalog]
---

## Human

The soles are terrible — like extruded blocks in the feet, with skin still showing through. I want a flat sole that follows the structure of the foot and looks reasonably natural. Make a base-less model to see the feet clearly while iterating. (Attached: bad current boot, and a target red ankle boot.)

## Assistant

The previous sole was a narrow inset slab with the upper clipped away above it — that left gaps (skin poking through) and read as a block, not a sole. Reshaped the per-foot geometry in `buildFootwear`'s inner `foot()` (only that geometry — the label/sole/ground wiring is untouched):

- **Upper = one smooth ellipsoid "last"** spanning the whole footprint, so it tapers to a toe-spring at the front and rounds into a heel at the back as one continuous shoe form (separate toe-box + vamp + heel primitives read as lobes). Plus a low heel-fill cylinder and the existing ankle-collar capsule (shaft for boots) that welds the shoe to the shank.
- **Sole = a wide flat two-tier slab** following the full footprint outline (reaches heel and toe), flat bottom exactly at `groundZ`, proud of the upper all around — a real shoe sole, its own paint region.
- Kept the guaranteed-coverage underlayer so skin can never poke through.

Delegated the render→adjust shape loop to a subagent (it owns the image-heavy iteration in its own context) with a hard gate: a deterministic sample-grid coverage probe that must report **0 uncovered skin** for shoes and boots in neutral and posed rigs. Verified the result myself in COLOR from the side and underside (the angles the defect lived at): natural shoe profile with a distinct dark sole, and solid flat dark soles underneath with no skin. `isManifold: true`, `componentCount: 1`, 1297/1297 unit tests pass. Rebaked the superhero (now 13 regions incl. 'sole').
