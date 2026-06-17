---
date: 2026-06-17
branch: claude/jolly-edison-qzzgpg
files_changed:
  - src/geometry/sdfFigure.ts
  - tests/unit/sdfFigure.test.ts
  - public/ai/figure.md
---

## Human

I recently merged fixes to improve figures — one goal was greater foot mobility
and the ability to hinge/point the foot. Now that's showing up as a defect with
shoes: feet appear outside the shoes or clip the shoe bodies, so the shoes
aren't following the feet as they move in 3D. Investigate and fix. (Reference
photos showed a lunge with a sneaker toe poking out, and an inverted/handstand
figure with feet poking out of red shoes.)

## Assistant

Root cause: `buildFeet` plantarflexes a LIFTED foot (#701/#707) — it pivots the
foot about the ankle so the toe points down along the leg's extension — but
`buildFootwear` never got the matching transform. It always placed the shoe flat
at `groundZ` (yaw only). So a pointed foot pitched out of its flat, horizontal
shoe. This is exactly the `SoleFrame` drift the code comment at `buildFeet`
warned about, opened up by the later plantarflexion change.

Fix — give footwear the same pivot, driven by the same source of truth:

- Added a plantarflexed branch in `buildFootwear`'s inner `foot()`. It calls the
  **same `footPitchFrame(shinDir, thighDir, fwd, groundZ - planeZ, r.foot)`**
  with the same inputs `buildFeet` uses (same `planeZ = min(soleL, soleR)`, same
  per-side shin/thigh bone directions, same heading), so it returns an identical
  pitch + heading. The shoe pivots about the **same world ankle** with that
  rotation, so shoe and foot stay concentric by construction.
- The shoe body, the guaranteed-coverage underlayer, and the contrasting sole
  region are all built in the local frame and run through one `place()` that
  pivots about the local ankle (`translate(−ankleLocal) → rotate(−pitch) →
  rotate(yaw) → translate(A)`), mirroring `buildFeet`'s pitched path. The
  collar/shaft stay in WORLD (they connect to the shank, which is already posed),
  and the airborne pitched shoe drops its ground floor-clip — like the foot, it
  hangs pointed.
- **Planted/standing feet are byte-for-byte unchanged.** `footPitchFrame` returns
  `null` below the lift threshold, so the early branch is skipped and the
  existing flat path runs verbatim — no regression for the ~18 standing catalog
  figures that were just re-baked.

Verification: isolated feet-only vs shoes-only comparison and colored
before/after renders of the soccer-striker (kick) and a sprinter lunge showed
the bare foot poking out of a flat shoe before, and the shoe pitched to enclose
the foot after. All affected figures stay `isManifold: true`, `componentCount:
1`. Added a regression unit test that grid-probes a lifted foot and asserts the
shoe is solid wherever the bare foot is solid — it fails on the pre-fix baseline
(9 poke-through points) and passes with the fix.

Note: `tests/unit/catalog.test.ts`'s "release_date inside the rolling year
window" failure is pre-existing on origin/main (a time-based AI-model-catalog
test), unrelated to this change.
