---
date: "2026-06-14T20:07:00Z"
task: "feat: flatter realistic feet with optional sculpted toes"
pr: 672
areas: [figure-api, sdf, modeling, tooling]
cost: medium
---

## Liked / Worked
- `model:preview` against the real engine in Node was the whole game for an
  aesthetic geometry change — render → look → adjust in ~2s, no browser. Custom
  `--view "az,el;…"` multi-angle tiles + native `sharp` crops let me judge a
  ~2-unit-wide foot's toes at 1200px+ without ever upscaling.
- Delegating the multi-pass toe-shape iteration to the `model-sculpt` subagent
  kept dozens of preview PNGs out of my context — it returned only text (final
  block + stats + one best-PNG path). The compounding image-token cost the docs
  warn about never materialized in the main thread.
- `buildFootwear` building its own foot-mass underlayer inline (not calling
  `buildFeet`) meant the foot redesign was cleanly decoupled from shoe coverage
  — verified once, then free.

## Lacked
- Several round-trips were spent rediscovering that `SdfNode.bounds()` is a
  *loose conservative AABB*, not the true surface extent: my first envelope test
  asserted against `bounds()` and failed by ~1.6·footLen even though the real
  toe surface was within spec. The reviewer's well-meant "assert the absolute
  0.5·footLen bound" nit hit the same trap. Both had to move to `evaluate()`.
- The exposed ankle-column dome dominated every feet-only top-down render and
  briefly read as a defect — it's just hidden by the leg on a real figure. A few
  renders wasted before I realized the occluder was a test-harness artifact.
- 5 anatomically-distinct toes are simply infeasible at figure scale (foot ~2
  units wide); the working answer was a *scalloped toe row*, not separate digits.
  Took a few passes to converge on "stylized cohesion" over "anatomical count."

## Learned
- For figure-scale digit features, the hand API's "3 fat fingers" lesson
  generalizes: don't fight overlap with resolution — overlapping `smoothUnion`
  capsules merge regardless of `edgeLength`. Spread to the full width with small
  welds and accept a lobed/scalloped read.
- A `smoothUnion` blend-halo can dip the SDF slightly negative *below* a flat
  clip plane (breaching `groundZ`). Fix: apply the flat-clip `intersect` LAST,
  after the ankle weld — a hard `max` leaves no halo below the plane.
- `model-preview` cleans old per-model PNG stamps each run, so a "before" render
  vanishes once you re-render the same snippet — capture before/after under
  different filenames if you want to montage them.

## Longed for
- A documented note in CLAUDE.md/figure docs that `bounds()` is conservative and
  surface-position assertions must use `evaluate()` (the figure docs already say
  this for `smoothUnion` extents — extend it to "and never assert envelopes from
  `bounds()`"). Would have saved 3+ turns across me and the reviewer.
- A tiny `feet-only` preview helper that omits the ankle column (or a flag to
  cap it at the leg) so the toe row is unoccluded from above without the
  misleading dome.
