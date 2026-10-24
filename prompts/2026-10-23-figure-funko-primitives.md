---
date: 2026-10-23
branch: worktree-agent-ab845f0e0d9f03b8b
issue: kemper/partwright#1055
files_changed:
  - src/geometry/sdfFigure.ts
  - public/ai/figure.md
  - tests/unit/figureFunko.test.ts
---

## Human

Extend the SDF figure builder with the primitives a photo-to-figure agent
lacked when it built a Funko Pop "Captain Tsubasa" (~40 lines of rig.r/face
mutation for the head, hand-built capsule hair, brute-force arm probing to hold
a ball, manual floor/rotation fixes): `rig({ headScale })` + a `proportions`
preset, a shaggy `'mop'` hair style, a two-hand sphere hold, `rig.floorZ` +
`F.place`, docs and tests. Everything opt-in — existing figures must render
byte-identically. Rewrite the model with the new primitives and compare.

## Assistant

- **headScale grows the head up from the chin, and `height` stays the total
  crown height** (the canon height shrinks by `1 + (hs.z−1)/N`). An AI writes
  `height: 100` and gets 100; the chin pivot keeps the neck from stretching.
  Face anchors scale about the head centre in the head frame; the body keys off
  the unscaled head-unit (`r.headBody` via `bodyHeadRadius`) so the torso is
  untouched. A scaled `F.head` builds its cheeks as stretched ellipsoids — with
  width-sized cheek spheres a wide head buried the eyes.
- **`faceLayout { eyeSpread, eyeHeight }`** was needed for the Funko look (low,
  wide eyes); brows/nose/mouth follow at 60% so gaps stay readable. Every new
  branch is guarded so the default path runs the original arithmetic (verified:
  6 example figures' preview stats identical before/after).
- **Hold is a rig option (`pose.hold`), not a post-hoc helper**: solving inside
  `buildRig` with the rig's own `armChain` keeps grips, forearm frames and
  `F.hands` consistent; a helper returning a second rig invites building arms
  from the stale one. Deterministic multi-seed pattern search; wrist roll is the
  existing closed-form `palmFacing` solve. `F.heldSphere(rig)` returns the ball.
- **Mop hair** = an offset of the real head SDF (`on: head`) plus seeded tapered
  capsule locks marched onto the head/cap surface. Tapered cylinders were tried
  first and rejected: the taper's near-zero field past the tip smooth-unioned
  into stray specks and blew up the bounds.
- **`F.place` works on the built Manifold** (so faceDetail regions still line
  up) and **`F.surfacePoint`** replaces the hand-rolled face-surface march.
- Documented the `model:preview --view` azimuth convention for +X figures
  (az 0 front / 180 back / 270 profile; named views stay −Y-based).
