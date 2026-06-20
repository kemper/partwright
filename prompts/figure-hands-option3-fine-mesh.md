---
date: 2026-06-19
branch: claude/hands-opt3-twopass
files_changed:
  - src/geometry/sdf.ts
  - src/geometry/sdfFigure.ts
  - tests/unit/sdfFigure.test.ts
  - public/ai/figure.md
---

## Human

Option 1 and Option 2 hands both showed triangle spikes on the fingers and
fingers leaning into each other (catalog screenshots attached). Investigate the
real cause and make high-quality fingers — fix 1 & 2 or do Option 3. (Chose:
build Option 3 fully.)

## Assistant

Root-caused the spikes empirically: the whole figure is meshed by ONE coarse
`Manifold.levelSet` march, and `handDetail` only does a post-march *refine*
(subdivide + reproject). Refinement cannot change topology — the coarse march
WEBS the thin, closely-spaced fingers into a topological handle (proved: a
rotated hand is `genus 1` coarse+refine vs `genus 0` at a uniform fine march),
and the refine pass frays that handle into the radial spikes. So Options 1 & 2
were unfixable in place; both ride the same flawed path.

Option 3 = mesh each hand on its OWN uniform fine grid and hard-union it onto
the coarse body. Validated the clean architecture first (arm built separately +
hand built separately, hard-unioned = `genus -1`, two clean genus-0 solids — a
tapered forearm and a palm slab are distinct enough shapes to union with no
seam). A boolean splice of the *fused* arm+hand field does NOT work (coarse vs
fine arm cross-sections coincide at the wrist → handles), so the hands must be
their own solid.

Implementation (transparent — zero example churn, additive so non-figure SDF
models are byte-identical):
- `sdf.ts`: a `fineHands` marker node (`opFineHands` / internal `__fineHands`)
  carrying per-hand spheres. `partitionByLabel` gained an ADDITIVE branch: a
  labelled subtree containing markers is split into the coarse "rest" (hands
  removed from its eval) + one per-hand region that still paints with the same
  label. `buildSdf` meshes a `fineRegions` region by marching each sphere's
  small bbox at a uniform fine grid and unioning — resolving the fingers at the
  source. Gated entirely on the marker (no marker → existing path untouched).
- `sdfFigure.ts`: `buildHands` tags sculpted hands with `sdf.__fineHands(...)`;
  `weldBody` pulls markers OUT of the smooth weld into a hard union (so the body
  field never contains the fingers to web). `handDetail` is now a deprecated
  no-op (hands self-mesh) — existing `detail: [...F.handDetail(rig)]` still works.
- Fixed a separate geometry bug: wide-splay straight-finger grips (open/spread/
  wave) formed real handles because fanned capsules crowd at the base on the flat
  palm. Fanning the finger BASES outward (clamped to the palm) past ~10° opens
  those gaps. Grip genus sweep: all clean except open/wave at a tiny base-tunnel
  (genus 1, not visible) and `ok` (genus ≥1 is correct — the OK sign is a real
  thumb-index ring).

Verified: full multi-label figure (skin+pants+eyes) builds manifold, 1
component, 203k tris, clean separated spike-free fingers in the REAL browser
(`renderViews`) AND headless `model:preview`. 1511 unit tests pass; preflight
green (no new dep cycles). Catalog rebake (#751) still needed for the baked
`.partwright.json` thumbnails to show the new hands.

## Human (follow-up)

The relaxed hand looks good but the open hand looks alien — fingers fuse and arch
into the centre. Do close-up previews of EACH grip to confirm appearance
holistically. Make hands a bit bigger by default, and add a hand-size parameter.
Also: even relaxed shows mesh garbage between fingers on some models — we may need
finer hand resolution.

## Assistant (follow-up)

Three real bugs behind the "alien open hand" + inter-finger garbage:
1. **Spread sign was inverted** — outer fingers (index on −X, pinky on +X) fanned
   toward the palm CENTRE instead of outward, so they arched in (the alien look)
   AND converged into near-contact, whose union valleys the marcher bridged into
   handles. Flipped every grip's spread so outer fingers fan outward; tuned
   `peace` to a real index/middle V.
2. **Palm used `smoothUnion`** (smin = non-Lipschitz). Its marching artifacts get
   WORSE at the finer hand resolution (genus rose with resolution — the tell).
   Switched to a plain Lipschitz `union` of the two coplanar palm slabs.
3. **Hands meshed in WORLD space** (rotated onto the wrist), so the thin
   inter-finger gaps marched diagonally to the grid → pose-dependent webbing.
   Now each hand is meshed in its CANONICAL (axis-aligned) frame on a tight fine
   grid, then the MESH is `rotate(euler).translate(c)`-ed onto the wrist (SDF
   `.rotate` matches `Manifold.rotate`, verified). Tight bbox also makes a finer
   grid cheap.

Result: all 11 grips genus-clean and resolution-stable (genus stays 0 as the grid
refines). Reviewed every grip in close-up palm-on previews — open/spread/wave fan
naturally, fist/claw/clutch curl, point/peace/ok/thumbsup read correctly. Added a
`hands({ size })` knob (default 1.15× baseline so hands read a bit bigger) and
lengthened the fingers slightly. Full figure: genus 0, 242k tris, verified in the
real browser. 1511 unit tests pass; preflight green.

## Human (follow-up 2)

The fingers look good now but the palms are too short and rectangular — I want
more natural palms and hands that extend from the wrist to the fingers.

## Assistant (follow-up 2)

Redesigned the palm in `canonicalHand`: replaced the two short coplanar slabs
with a LONGER tapered rounded slab (wrist→knuckles, gently narrower at the wrist
via `.taper`) plus a rounded heel ellipsoid that plugs into the forearm — so the
hand reads as a continuous form from wrist through palm to fingers instead of a
rectangular block with finger-stubs. Kept everything plain-union (Lipschitz) so
the fine march stays clean. Learned the palm WIDTH (~1.9·r.hand) is constrained
by needing clean gaps between 4 fat fingers, so naturalness came from LENGTHENING
the palm (knuckle line at 1.2·r.hand, heel below the wrist joint) to balance the
width, not narrowing it (narrowing crowds the fingers → webbing). Over-taper made
a teardrop; settled on a gentle 0.06 taper. All 11 grips genus-clean; full figure
genus 0, ~258k tris, verified in the real browser.

## Human (follow-up 3)

The hands look like robot hands — I'd like them more organic. (Also a separate
sleeve defect on the diva — tracked separately.)

## Assistant (follow-up 3)

The robotic look was straight uniform-radius capsule fingers. Rebuilt each finger
as THREE tapered phalange segments (radius steps down each segment → knuckle
ridges) with a gentle progressive bend toward the palm, so fingers taper to the
tip and curve naturally even when "extended" (real fingers aren't ramrod rods).
Plain unions only (one finger's segments overlap collinearly) so the fine march
stays clean. All 11 grips still genus-clean; fists/curls now show natural
knuckles. Full figure genus 0. The diva sleeve-cuff aliasing is a separate
clothing-subsystem issue, filed and handled apart from this hands PR.
