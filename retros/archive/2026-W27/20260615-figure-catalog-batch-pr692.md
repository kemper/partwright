<!-- Harvested from unmerged PR #692 (kemper/partwright). The catalog work on that
branch is not being merged, but this retro material is. Original path:
retros/inbox/2026-06-15-figure-catalog-batch.md -->

# Retro — 20 figure catalog entries via 10 subagents (PR #692)

## Liked
- The `api.sdf.figure` rig made 20 varied, *posed* full-body figures tractable to
  fan out across 10 parallel `model-sculpt` subagents — each owning its
  render→look→adjust loop in a disposable context and returning only text +
  palettes. The prop frames (`spanGrips` barbell, `standOn` skate blade,
  `placeOnHead` hat, `holdAt` ball) all worked as documented.
- `model:preview` running manifold-js headless in Node made geometry/pose
  verification fast and browser-free for the subagents.

## Lacked
- A colored-thumbnail bake (`build-catalog-entry.cjs`) drives the dev server, and
  **any write into `public/` triggers a Vite full-page reload that destroys an
  in-flight Playwright bake** ("Execution context was destroyed"). With 10
  subagents writing palette files into `public/catalog/palettes/` while I baked,
  bakes failed nondeterministically. No tooling warns about this.
- `model:preview` shades by surface normal only — it **cannot** reveal that an
  eye/areola label resolves to **0 paintable triangles** (buried under the
  skin). Two of twenty figures passed every normal-preview look yet baked
  *eyeless*; only the bake's `PAINT FAILED` report caught it.

## Learned
- **Bake catalog entries only after all file-writing subagents finish** (no
  concurrent `public/` writes), and wrap the bake in a retry loop — that
  eliminated the reload races entirely.
- **Audit every figure bake's `PAINT FAILED` lines as a QC gate.** A figure that
  "looks fine" in a shaded preview can still ship a blank face. Closed-eye
  figures (monk, `lids:'closed'`) *correctly* report eyes at 0 triangles — so the
  audit needs judgment, not a blanket gate.
- Back-facing thumbnails are fixable without re-posing: pin
  `THUMB_AZIMUTH`/`THUMB_ELEVATION` on the bake (baby/surfer faced away at the
  default iso).

## Longed for
- **Per-eye lid override (`lidsL`/`lidsR`) on `F.face.eyes`** — a literal one-eye
  wink can't be expressed today (filed in #689).
- `F.face.eyes` and `F.nipples` could floor their forward-push more
  aggressively so eyes/areola never bury on full-cheek (`cheek:1.2+`) or
  strongly-posed heads — it bit two of twenty figures and needed a manual
  `translate(headForward * extra)` fix.
