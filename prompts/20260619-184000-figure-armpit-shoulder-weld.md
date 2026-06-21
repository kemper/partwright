---
session: "practical-bohr"
timestamp: "2026-06-19T18:40:00Z"
model: claude-opus-4-8
---

## Human

On the figure API: when a figure has its arms DOWN by its sides (e.g. the pool
swimmer catalog entry), a huge portion of the upper arm gets welded to the torso
— a flying-squirrel "web" with no armpit — which looks unrealistic. Arms-UP
figures weld correctly (only at the shoulder). Also, in that same swimmer, the
shoulders sit way too high as a default stance, giving a bumpy look. Make both
situations better.

## Assistant

## Key decisions

**Root cause of the arm "web"**: `weldBody`'s default blend radius was
`0.85·min(lowerArm, neck)` — a large, pose-independent `smoothUnion` k. Body
masses join *end-to-end* (neck atop chest, legs below pelvis), so even a tiny k
gives those coaxial seams a smooth transition. But a hanging arm runs *parallel*
to the torso, separated only by the armpit slot; a large k bridges that slot and
fuses the whole upper arm to the ribcage. A raised arm runs clear of the torso,
so it only ever welds at the shoulder — which is why arms-up always looked right.
Verified empirically by overriding `weld(rig, parts, {k})` on the swimmer before
touching source: a small k opened a clean armpit on every angle while neck/leg
seams stayed smooth. **Fix**: halved the default to `0.45·min(lowerArm, neck)`.
The `{k}` override remains for anyone wanting the old chunkier/blobbier look.

**Root cause of the "bumpy high shoulders"**: the deltoid cap was a sphere of
`upperArm·1.15` centred exactly ON the shoulder joint S, so its mass sat ABOVE
the shoulder line as two humps flanking the neck. **Fix**: seat it a little down
the arm (`lerp(S, E, 0.18)`) and trim it to `upperArm·1.0`. Now the delt bulges
the shoulder laterally and the top reads as the upper-arm capsule cap — a natural
slope. Because the offset follows the arm vector, a RAISED arm still carries the
delt up exactly as before (no regression to the arms-up case).

**Why this is safe across the catalog**: muscle masses (pecs/traps/lats) are
welded inside `buildTorso` with their own k values, untouched. Shoulder→chest
connectivity is guaranteed by the upper-arm *capsule* (its inner edge overlaps
the chest ellipsoid), not by the deltoid, so shrinking/moving the delt can't
split the figure. Spot-checked bodybuilder (heavy muscle, arms out), ballerina
(arms overhead), and basketball-dunk (one arm up) — all clean, no regressions.
All 267 sdfFigure + joints unit tests pass.
