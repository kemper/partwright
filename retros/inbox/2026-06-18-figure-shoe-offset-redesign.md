# Retro — figure shoe redesign: derive from foot via SDF offset (PRs #750, #739; issue #747)

## Liked
- The redesign was de-risked by a one-line throwaway (`F.feet(rig).round(t)`)
  rendered next to the current shoe BEFORE committing to the refactor. Proving the
  idea with a prototype + a render the user could see turned a "maybe rethink?"
  into a confident "yes, do it."
- Factoring `footMassLocal` + `footPlacement` out of `buildFeet` let the shoe reuse
  the EXACT foot shape, so the two can never drift again — the structural fix the
  three prior band-aids (#737/#745) were each patching locally.

## Lacked
- SDF `bounds()` is loose for `round()` + `smoothUnion` (a sole actually at
  z≈groundZ reported as −2.90). Two footwear tests asserted on `bounds()` and
  failed spuriously; I had to re-probe actual geometry to tell "real defect" from
  "loose bound." A `tightMinZ(node)` sampling helper in the test util would have
  saved a couple of probe round-trips — and a lint/comment warning "don't assert
  exact extents on offset/smoothUnion bounds" would stop the next person writing
  the same brittle test.
- Three sessions in a row now have re-discovered that footwear tests are calibrated
  to specific shoe dimensions; each shoe change breaks ~3 threshold tests. Tests
  that assert RELATIONSHIPS (shoe ⊇ foot, welt ⊋ flush, lifted-dip < X) survive
  redesigns; tests that assert absolute probe coordinates don't.

## Learned
- `.round(t)` IS the outward surface offset (`f − t`); `.shell(t)` is `|f| − t`
  (a hollow shell). For "grow a solid by t" you want `round`, not `shell`.
- The conformal-offset helpers (`surfaceMarking` = `body.round(t).smoothIntersect`)
  generalise: any feature that should sit "proud of the real surface by t" (areola,
  shoe-over-foot) is an offset of the host SDF, not a hand-placed primitive.
- A plantarflexed foot reads far better with a flat sole clipped in the LOCAL frame
  before pivoting (sole tilts with the foot) than as the rounded unclipped nub.

## Longed for
- A standing "shoe gallery" smoke spec (render N posed feet shod + bare, montage)
  the way figure:smoke gates paint labels — so a footwear change is eyeballed
  across grounded + lifted + turnout in one command instead of ad-hoc scratch files.
