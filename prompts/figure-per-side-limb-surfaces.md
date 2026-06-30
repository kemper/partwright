---
date: 2026-06-25
branch: claude/admiring-goodall-1tlwna
files_changed:
  - src/geometry/sdfFigure.ts
  - examples/figure_knight.js
  - public/ai/figure.md
  - tests/unit/figureAttachment.test.ts
  - public/catalog/knight.partwright.json
---

## Human

"yeah, let's do per side conform surfaces"

(Following the discussion of generalizing the garment-parts conform technique: the
agreed next step was per-side limb conform surfaces, demand-driven, validated by a
real one-sided accessory.)

## Assistant

Added per-side limb conform surfaces and proved them with a real accessory.

- `buildArms`/`buildLegs` gained an optional `side: 'L' | 'R'` (an inner per-arm/
  per-leg closure selected by side; undefined = both, the body-weld input — fully
  back-compatible). Exposed as **`F.arm(rig, 'L'|'R')`** and **`F.leg(rig, 'L'|'R')`**
  (validated with `assertEnum`). A single side never includes the other, so a
  one-sided accessory conformed to it structurally can't reach the far limb.
- Validated on the **knight**: a **vambrace** (forearm guard) on the SWORD (right)
  arm only — `F.arm(rig, 'R').round(shirtThick + r.lowerArm*0.14).intersect(<forearm
  capsule zone>)`, offset PAST the sleeve so it reads as proud armor (a first pass
  with a thinner gap sat inside the sleeve and barely changed the tri count — caught
  by the near-zero volume delta, fixed by offsetting past shirtThick). Render
  confirms a distinct grey guard on the right forearm; the left arm stays bare
  sleeve. Manifold, 1 component; catalog re-baked.
- Unit tests: the two arms (and two legs) are disjoint, and a guard conformed to one
  side has zero shared volume with the other — the per-side structural guarantee.
- Documented `F.arm`/`F.leg` + the vambrace pattern in figure.md.

Kept it demand-driven per the earlier discussion: exposed exactly the per-side
surfaces an accessory needed, validated by that accessory, rather than a speculative
parts taxonomy (the mistake that produced the just-deleted `F.parts`).
