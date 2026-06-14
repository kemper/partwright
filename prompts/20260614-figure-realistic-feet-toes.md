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

## Follow-up 2 (feet were too short)

User feedback: the first-pass feet looked short, and asked whether the mined
anthropometric data carried per-demographic foot length. Investigated: the mined
model (`anthroGirth`, MakeHuman-CC0) covers **girth/breadth** by sex/age/weight
only — there is **no** mined segment-length or foot-length table. Foot length was
a hardcoded `r.foot × 2.4` ≈ 0.08–0.10·stature — about half the real ~0.15·stature
(foot ≈ one head-length), which is why it read short.

Fix: foot length is a SEGMENT length, so it now scales with **stature** (`H * 0.15`)
like the arm/leg lengths — not with head-unit girth (girth scales with the head;
lengths scale with height, per the existing canon). `r.foot` still drives foot
width/height, so the foot got longer and more slender (less blobby), and footwear
(which reads `sole.length`) lengthened in step. Added a unit test pinning
`sole.length ≈ 0.15·height` and length > 2.5×width. Verified visually (side
profile + iso): the foot now extends forward like a real foot, balanced, not
leaning back.

## Follow-up 3 (length goes to the forefoot, heel stays shallow)

User feedback on the lengthened feet: don't lengthen the heel — the heel bump
should be shallow, and the added length should go into the FRONT of the foot.
The first length pass extended the foot symmetrically about the footprint centre
(and the heel/arch masses scaled with footLen), so both ends grew.

Fix (buildFeet only — footwear/SoleFrame untouched, so coverage is unchanged and
the footwear-enclosure tests still pass):
- The heel is now a SHALLOW rounded bump seated just behind the ankle, sized off
  the foot WIDTH (`r.foot`), NOT `footLen` — so a longer (stature-scaled) foot
  keeps the same short heel.
- The instep/arch dome is pinned near the ankle at the rear and reaches FORWARD
  to the ball, so the stature length is carried by the forefoot + toes ahead of
  the ankle (ankle ≈ 28% from the heel — anatomically right).
Verified the side profile: short heel under the ankle, long flat forefoot, toes
at the front. Footwear coverage unaffected (bare foot now strictly inside the
shoe envelope).

## Follow-up 4 (toes were upturned)

User: the toes curled UP off the foot plane. The toe capsules pointed from a low
base (foreH·0.30) up to a tip above the forefoot crown (foreH·1.45) — a strong
upward tilt. Flattened them: base foreH·0.6, tip foreH·0.46 (a hair lower), so
the toe row lies roughly flat along the foot's plane, pointing forward and
resting slightly toward the ground like real toes — not curling up.
