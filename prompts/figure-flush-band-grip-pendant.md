---
date: 2026-06-23
branch: claude/admiring-goodall-1tlwna
files_changed:
  - src/geometry/sdfFigure.ts
  - tests/unit/figureAttachment.test.ts
  - examples/figure_knight.js
  - examples/figure_scholar.js
  - examples/figure_noble_lady.js
  - public/ai/figure.md
  - public/catalog/knight.partwright.json
  - public/catalog/scholar.partwright.json
  - public/catalog/noble_lady.partwright.json
  - public/catalog/manifest.json
---

## Human

Third review round on the accessory showcase figures: (1) the knight's hand is
still wrong — it must rotate so the palm holds the heavy sword and the blade
points the way a hand bearing weight would hold it; give AI agents a HINT for
how a hand holding a heavy object orients itself, fixing the root cause not just
this model. (2) The noble lady's necklace still penetrates her shoulders and
dress instead of wrapping her neck and being covered by hair (chose: a draping
necklace down the chest). (3) "The scholar is a bit better but I think you
cheated by using a non-flush loop that you welded on somehow" — the belt must be
a FLUSH band, not a round tube. Fix the categories, not one model each.

## Assistant

Three root-cause fixes, all SDF-native:

- **`F.band` — a FLUSH conformal band (the belt fix).** `F.ring` sweeps a round
  TUBE, which always reads as a cord welded on. `F.band` instead uses the CLOTHING
  mechanism: offset the real `surface` out by `clearance + thickness` and slice
  that solid to a `height`-tall band, so the band is a literal slice of the body
  surface — it lies flat/flush, conforms to the posed non-circular cross-section,
  and can't float or balloon. It still subtracts its occluders (`rig` → arms) so
  it terminates where limbs cross it. Re-did the knight + scholar belts with it
  (flush sashes with a buckle, terminating at the arms).
- **`palm` grip hint (the hand fix).** A held bar lies along `gripAxis`, which is
  ⊥ the forearm — so the prop's direction is driven by the ARM POSE, not `holdAt`.
  The wrist-roll DOF was left arbitrary. Added a declarative `palm` hint on the arm
  pose (`'up'|'down'|'forward'|'back'|'in'|'out'`) that solves the forearm roll so
  the palm faces the requested way (a hand bearing weight). With the forearm posed
  horizontal-forward, the knight now raises the sword BLADE-UP
  (`armR:{raiseSide:10,raiseFwd:58,bend:68,palm:'out'}` → `gripAxis≈[0,0,0.85]`).
  `F.poseProbe(rig).grips.R.gripAxis` IS the blade vector, so agents can verify
  the aim without rendering. Documented the forearm-must-be-horizontal coupling and
  the `bend≳95` singularity.
- **Draping pendant necklace (the necklace fix).** The old big-`drape` ring spread
  across the chest at neckline width (it read as a collar trim and chorded through
  the shoulders). Rebuilt it as a small neck-hugging `F.ring` (occluded by hair) +
  a separate pendant dropped down the chest centreline as a chain of CONFORMED
  `F.ringPoint` samples (flush, never chords through the bust) ending in a gem.

Also tucked the knight's scabbard (it was full-blade length and poked below the
base) — shortened it and hung it with a slight backward tilt so the chape clears
the base disc. Added unit tests for `F.band` (flush conformance + occlude carve),
updated `figure.md`, and re-baked all three catalog entries (self-coloured, no
palette flag). Verified each headlessly at high res from front/iso/underside.
