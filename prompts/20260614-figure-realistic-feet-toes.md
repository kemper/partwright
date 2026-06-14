---
date: 2026-06-14
branch: claude/figure-api-realistic-feet-xoo4uo
files_changed:
  - src/geometry/sdfFigure.ts
  - public/ai/figure.md
  - tests/unit/sdfFigure.test.ts
---

## Human

In the figure API, make the feet more realistic — the current feet are large,
blobby and bulbous; they should be flatter, like a real foot. Also enable
*toes* (look at how the hand API sculpts fingers for an approach). Create
preview images along the way, then open a PR if confident.

## Assistant

Redesigned `buildFeet` and added opt-in toes, mirroring the sculpted-hands path.

- **Flatter foot is the new default.** The old foot was a heel→toe capsule
  (radius 0.62·foot — round in cross-section) plus an instep ellipsoid that
  bulged up around the ankle: a rounded club. The new foot is built in a LOCAL
  frame (origin = footprint centre, +Y = toe) from an instep-crown ellipsoid, a
  low rounded forefoot pad, and a rounded heel, then **flat-clipped at the sole
  plane** so the underside is a true flat ground contact instead of a curved
  blob. Low and long — a recognisable real-foot profile.

- **`F.feet(rig, { toes: true })`** adds five toes as a *scalloped toe row*
  rather than five long separate digits. At figure scale the foot is only ~2
  units wide, so independent toes melt into one blob with a lone protruding big
  toe (looks like a thumb). The toes are short upward-forward capsule lobes
  spanning the full forefoot width with small inter-toe welds, so they read as a
  cohesive toe group from the top and 3/4 views. Big toe is thicker and on the
  medial side. Tips stay at 0.44·footLen < the 0.5·footLen envelope, so footwear
  (which builds its own independent coverage) still encloses the foot.

- **`F.footDetail(rig)`** detail-region helper, mirroring `F.handDetail`: the
  toes are finer than the 0.4–0.6 figure grid, so they need a local fine march
  or they alias away.

- **Decoupling check:** `buildFootwear` builds its own foot-mass underlayer
  inline (it does not call `buildFeet`), so reshaping the bare foot can't break
  shoe/boot coverage as long as the footprint envelope is preserved — it is.

- **Subtle SDF trap fixed:** the ankle-column `smoothUnion` halo dipped the
  field slightly negative just below the flat sole, breaching `groundZ`. Fixed
  by flat-clipping the sole **last** (a hard `intersect`), after the ankle weld.

Verified each step headlessly against the real engine with `model:preview`
(top-down + 3/4 + underside angles, high-res crops). Tests: new feet/footDetail
unit coverage; existing sole-frame and footwear-enclosure invariants still pass.

## Follow-up (review hardening)

work-reviewer (clean: 0 blocking, 0 should-fix) raised two test nits. Applied both:
- The flat-sole test now exercises BOTH the smooth default and the toed foot
  (the default flat sole is the headline feature).
- The footprint-envelope test now probes the true toe-tip SURFACE via `evaluate`
  (air at 0.6·footLen forward) instead of relying only on the loose conservative
  `bounds()` AABB, pinning the absolute envelope the footwear coverage depends on.
