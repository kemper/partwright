---
date: 2026-06-16
branch: worktree-agent-ad01e0447bcb05f87
files_changed:
  - src/geometry/sdfFigure.ts
  - tests/unit/sdfFigure.test.ts
  - public/ai/figure.md
---

## Human

GitHub #703: small carved/disc face features on the figure API render jagged and
torn at the figure grid. Fix four cases without restyling good faces: nostril
"craters" on small/button noses, ragged eyebrow strips, a torn carved lip line,
and the torn areola flush-disc edge. Keep normal-sized faces essentially
unchanged and keep tri-count increases local. The `'areola'` paint label must
still resolve to >0 triangles.

## Assistant

Four independent edge-quality fixes, all in `sdfFigure.ts`, each chosen so a
*normal* feature is left essentially untouched and only the torn small/disc case
is cleaned up.

**Nostrils.** Two root causes. (1) On small noses the cavity's tiny smoothSubtract
blend (`tipR * 0.045` ≈ 0.02) is far below the march cell, so the rim aliased
into a torn crater. Made the carve blend scale on the *nostril radius* (the real
feature size) with an absolute floor, and ramp softer as the tip nears the skip
floor — so a just-above-floor nose meshes a rounded crater, not a torn one, while
big noses keep a crisp crease (good faces unchanged). (2) Genuinely small
(button/chibi) noses can't carve cleanly at any blend, so I made the *default*
safe: auto-skip the carve when `tipR < 0.46` (an absolute world size — the
rim-to-cell ratio is scale-invariant). `nostrils: true` still force-carves;
`nostrils: false` still force-skips. Added an extra-fine `nostrilEdgeLength`
detail sphere in `faceDetail` over the tip underside so normal-nose rims mesh
crisply.

**Eyebrows.** The brow was a 4-segment HARD union of straight capsules — faceted
kinks at every joint that frayed into a ragged strip. Doubled to 8 segments and
welded the joints with a small `smoothUnion` so the ridge is one continuous strip.

**Carved lip line.** Same hard-union-of-capsules failure on the bowed smile line
(6 segments). Denser 10-segment chain with a small `smoothUnion` blend → one
continuous groove that carves a clean edge. The line *shape* is unchanged (only
the edge quality). The `'lips'`-style path already used `smoothUnion` (lipChain),
so it was left alone.

**Areola disc.** The flush coin was a HARD `cylinder ∩ sphere` — a knife rim that
slivered at the coarse torso grid (no detail region runs over the chest). Swapped
to a small `smoothIntersect` (bevels just the rim; disc face stays flat) and added
two chest detail spheres to `faceDetail` over the nipple anchors so the disc
meshes round. Verified the `'areola'` label still resolves: 6955 triangles (up
from ~3173) on the boxer repro.

**Verification.** Reproduced all four on representative rigs (button-nose baby,
slim adult, tai-chi/yogi for brows+lip, stocky boxer for areola) via
`model:preview`, cropping the feature at 1600px and comparing before/after — the
baseline tears are gone and a normal-nose regression case (runway) keeps its nose
silhouette. All stay `isManifold: true`, `componentCount: 1`. Tri-count deltas are
+4–7%, local to the detail regions. Added 6 unit tests (small-nose auto-skip,
forced carve, normal-nose still carves, chest detail presence/`chest:false`/bad
keys); full unit suite green (1439).
