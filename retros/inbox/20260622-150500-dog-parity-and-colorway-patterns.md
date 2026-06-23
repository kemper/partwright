---
session: "sharpbell"
date: "2026-06-22"
task: "chibi dog → cat parity + tuxedo/points colorway patterns"
---

## Liked
- Porting a *known-good* sibling (the merged chibi cat) into a new model was fast
  and low-risk: same paramsSchema shape, same eye/lid/nose/mouth machinery, only
  the anatomy deltas (projecting snout, drooping ears) were new. The cat was a
  ready-made spec.
- Delegating the dog's visual-polish loop to `model-sculpt` kept dozens of render
  PNGs out of the main context; I only Read the final + one face close-up.

## Lacked
- No way to do **flush per-triangle surface paint** over an SDF `body` label.
  Tabby stripes / calico are blocked on this — the only label mechanism is
  whole-sub-SDF, so flush patterns need a blob that wins nearest-centroid. Stripes
  via blobs would emboss as welts, so I had to defer them. A real surface-paint
  region API would unlock the whole "patterned coat" axis.

## Learned
- **Proud blob, not `intersect`, for a flush color patch.** A `body.intersect(region)`
  patch is *coincident* with the body surface, so it ties with the `body` label in
  the nearest-centroid color remap and salt-and-peppers the boundary (verified in a
  render). A blob that sits a hair *proud* (the existing muzzle recipe) wins the
  assignment cleanly → solid flush color. This is the reusable trick for any
  flat color zone (bib, socks, points, mask).
- `model:preview` cleans old PNG stamps **per model**, so back-to-back renders of
  the same file clobber each other — always pass an explicit `--png <path>` you
  control and Read that, or the second render deletes the first.

## Longed for
- A headless **catalog-bake-and-register** one-liner. These polished models still
  live only in the eval corpus; getting them into `/catalog` is a separate
  dev-server + per-entry bake dance. A `model:preview`-style "bake this to a
  catalog entry + thumbnail + manifest row" command would close the
  eval-corpus → usable-in-app gap in one step.
