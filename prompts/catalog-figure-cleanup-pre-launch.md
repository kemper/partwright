---
session: "b33cd8de"
timestamp: "2026-06-28T01:45:00Z"
---

## Human

I want to start presenting this website to others. The catalog has rough edges
that look like "AI slop," and there are too many figure models. Step 1: open a
PR that gets the bad and/or superfluous figures out of the catalog. Step 2 (a
separate follow-up): understand WHY they fail so we can make them better.

User explicitly called out as broken:
- Archer Drawing a Bow — bow not aligned with the body
- Flexing Strongman — has no hands
- All bust models — basically tests, don't want them
- Crawling Baby — creepy + several latent defects
- Chef Presenting a Dish — hat too high
- Soccer Striker — foot completely embedded in ball

User general guidance: "almost anything being held in a hand is bad at this
point."

## Assistant

## Key decisions

**Cut scope: 21 figures (67 → 46) in one PR. Sources stay in `examples/`.**
Removed the 10 explicit defective callouts (archer-draw, flexing-strongman,
crawling-baby, chef-presenting, soccer-striker, plus the five bust models
cross-eyed-bust / stargazer-bust / bust-elf / bust-listener / bust-pixie) and
11 held-item figures (elf-archer, staff-mage, witch-casting, viking-warrior,
rock-guitarist, locs-musician, grandfather-cane, toddler-teddy, storytime-reader,
kneeling-gardener, olympic-weightlifter). Kept the `examples/figure_*.js`
sources untouched so the step-2 root-cause investigation has the artifacts to
dissect — the catalog is the user-facing surface, the sources aren't.

**Three surfaces stripped per removed entry, not just the manifest.** The
catalog is rendered from `public/catalog/manifest.json`, bakes from
`public/catalog/bake-manifest.json`, and serves the `.partwright.json` payload
directly. Removing only the manifest entry would leave the bake artifact
reachable by deep-link URL. So for each removed id we (a) stripped its entry
from `manifest.json`, (b) stripped its entry from `bake-manifest.json` where
present (only 8 of the 21 were baked — bake-manifest is opt-in), and (c)
deleted the `.partwright.json` payload from `public/catalog/`.

**Three e2e specs were pinned to `archer.partwright.json` and had to be
re-pointed.** `render-cancel-deeplink.spec.ts`,
`catalog-cancel-color-preserve.spec.ts`, and `fast-preview-color.spec.ts` all
deep-link to a slow SDF catalog figure to exercise the Cancel button + paint-
region preservation during the initial render. Swapped to
`superhero.partwright.json` — also a slow SDF figure, also carries 14
`byLabel` colour regions (matched the archer entry exactly), survives the
cull. Updated the comments in the same edit so the next reader sees the
right reference figure name.

**`scripts/rebake-shod-figures.cjs` had stale entries scrubbed.** This is a
one-off historical rebake script, but it carried the removed names
(`soccer_striker`, `elf_archer`, `gardener`, `weightlifter`, `archer`) in its
`FILES` list. Left as-is it would error on a future re-run; trimmed to the
surviving names instead.

**Left `public/ai/figure.md` references alone.** That doc mentions
`figure_strongman.js`, `figure_rocker.js`, `figure_staff_mage.js`,
`figure_elf_archer.js` as illustrative API examples. The `.js` sources still
exist in `examples/`, so the references are still valid — the cleanup is
catalog-only, not source-only.
