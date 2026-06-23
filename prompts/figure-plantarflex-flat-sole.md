---
date: 2026-06-18
component: figure footwear — plantarflexed (lifted) shoe sole
---

## Human

rock climber and sprinter both have a bubble-foot problem that most other
figures don't have. Can you investigate?

## Assistant

The "bubble foot" is the **plantarflexed (lifted) shoe**. `buildFootwear` builds
the shoe body from a shared `last` ellipsoid centred on the sole plane (local
z 0), so its lower half hangs ~1.5·r.foot below the foot. The **flat** (grounded)
path slices that off at `groundZ`; the **plantarflexed** path (a foot lifted clear
of the ground — rock-climber's foothold leg, sprinter's deeply-bent lead leg)
deliberately skipped the floor clip ("the foot hangs in the air"), leaving that
whole lower half of the ellipsoid as a round BALL under the shoe. The footwear
resize (#737) shortened the shoe, which made the leftover blob read even more like
a bubble than the old long club did. Standing figures never hit this branch, so
"most other figures don't have it" — exactly the user's observation.

Fix: give the airborne shoe a real flat sole *in its own pitched plane*. Build the
foot-wrapping shell (body + coverage) in the LOCAL frame, clip it flat at
`soleClipZ = -0.75·r.foot` — a hair below the deepest bare-foot mass (the instep
dome bottoms ~0.65·r.foot under the sole plane), so the shoe still fully encloses
the foot — THEN pivot. The contrasting sole band moves down to the same plane.
The collar/boot-shaft stay world-anchored as before. The flat sole now tilts with
the foot, so the lifted shoe reads as a shoe (defined sole + toe-spring) instead
of a ball.

Verified: the lifted shoe's dip below the bare foot drops from 2.31 (0.96·r.foot,
the bubble) to 0.78 (0.33·r.foot, a normal sole). All 245 figure tests pass —
including the lifted-foot grid enclosure probe, so coverage is still complete —
plus a new regression test asserting the lifted shoe sits under the foot but
doesn't bulge >0.6·r.foot below it. Change is entirely inside the `if (pf)`
plantarflexed branch, so every standing/grounded shoe is byte-for-byte unchanged.
Before/after full-figure renders for rock-climber and sprinter confirm the ball
became a flat-soled shoe.

Catalog re-bake of the affected shod entries rides on PR #739.
