---
date: 2026-06-17
task: replace the frayed brow ridge with a flush, preset-driven eyebrow system in the figure API (PR #725, tracking #724, refs #703)
---

## Liked
- The repo already had the right *idiom* documented for the new design: iris/pupil
  and areola are flush, self-labelled, top-level-unioned discs, and figure.md even
  said "Brows can use the same top-level pattern." So the redesign was "apply an
  existing proven pattern to a new feature," not invent one — fast and low-risk.
- `NOSE_TYPE` / `LIP_SHAPES` gave a copy-the-shape template for `BROW_SHAPE`, so
  the preset-table + override-knobs API came out consistent with its siblings with
  zero design debate.
- The headless loop was the whole game: `model:preview --require-labels brows`
  (2s) for shape, `figure:smoke` for the paint-label gate, and the colored
  `build-catalog-entry.cjs` bake for true color — caught the "0-triangle buried
  label" risk and confirmed the dark brow before any browser round-trip.
- Delegating the 2-round aesthetic prototyping to `model-sculpt` kept dozens of
  preview PNGs out of the main context; I only `Read` the final contact sheets to
  ship to the user.

## Lacked
- `model:preview` shades by normal and does NOT show `api.label` palette colors,
  so the flush brow looked nearly invisible there — I had to switch to the slow
  (~75s, xvfb) colored bake to judge the *painted* look. A flag to tint declared
  labels in the preview rasterizer would have collapsed two render paths into one.
- The thumbnail camera azimuth convention is undocumented: `THUMB_AZIMUTH=180`
  gave the BACK of the head (front = −Y), and the default catalog angle is 3/4
  back. I burned two bakes finding the front (az 0). Worth a line in CLAUDE.md.

## Learned
- A test that filters detail regions "near the eye" silently broke when I added
  brow spheres near the eye — the brow anchors fall inside the eye-proximity ball.
  Proximity-based test filters are fragile against new nearby features; matching
  the *exact* anchor was the robust discriminator.
- The faceDetail `chest`/`brows` boolean+`edgeLength` pair is a clean, repeatable
  recipe for "refine one small flush feature so its rim doesn't sliver" — the same
  shape solved nostrils, iris, areola, and now brows.

## Longed for
- A first-class "flush painted feature" helper in the figure API (patch geometry +
  curvature clip + self-label + the matching faceDetail sphere, in one call). Iris,
  areola, and brows each hand-roll the same flush-disc + detail-sphere combo; a
  shared builder would make the next painted feature a one-liner and keep the
  detail-region bookkeeping from drifting.
- A `model:preview --palette <file>` mode that bakes label colors into the fast
  preview, so paint correctness doesn't require the slow headed bake.
