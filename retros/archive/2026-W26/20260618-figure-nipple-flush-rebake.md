# Retro — figure areola: flush-by-construction + rebake-the-catalog

4-Ls from the follow-up session that took the generic `F.nipples` fix from "pec-apex anchored" to "dead flush on the real surface", then re-baked all 9 catalog entries.

## Liked
- **Flush-by-construction beat every tuned-offset approach.** The pec-apex anchor still needed a `surfR`/`eps` to sit the coin right, and that knob was the whole problem (burger-patty when too proud, buried when too deep). Switching to `body.intersect(forward-cylinder)` — front cap *is* the surface, back cap bounded inside — removed the tunable entirely. When a feature's correctness hinges on a fragile offset, deleting the offset (carve from the actual surface) is more robust than tuning it.
- `--require-labels areola` exit-code gating caught 0-triangle (buried/unpaintable) areolae in ~2s headless, so I never shipped an invisible label. Much faster than the colored bake.

## Lacked
- **The catalog was stale and nothing flagged it.** The user saw old bakes (giant nipples, errors) and *correctly* guessed "they weren't rebaked" — the source was fixed but the `.partwright.json` wasn't regenerated. 7 of the 9 figures aren't even in `bake-manifest.json`, so `catalog-regen.cjs` wouldn't touch them; they were hand-baked once and drift silently when the engine changes. There's no check that a figure example and its committed bake agree.
- Palette recovery (`--palette-from-existing`) silently can't supply a color for a *newly appearing* label — danseur/sprinter gained an `areola` region the old palette never had, so I had to hand-derive an areola hex from the skin color. A "new label, no palette entry" warning would have surfaced that instead of me noticing it by eye.

## Learned
- `MAX_DETAIL_REGIONS` 16 was a real ship-blocker, not just a rebake nuisance: surfer/tai-chi/lotus **failed to render at all** because face detail (14, post eyebrows/ears) + foot/hand (4) = 18 > 16. Raised to 24. The matching unit test (`caps the region count`, hardcoded 17) then failed in CI — a cap constant and its test threshold are coupled; bump both in the same change (or export the constant and assert `CAP+1`).
- `model:preview` shades by normal so a flush nipple is *barely* visible there; the front-crop at `--size 1200` was enough to confirm "no protrusion, no burial", but paint color still needs the bake thumbnail.

## Longed for
- **A catalog freshness gate**: CI (or a `lint`) that re-bakes each figure example headlessly and diffs key stats (label tri-counts, componentCount) against the committed `.partwright.json`, failing when source and bake disagree. That single check would have turned "user notices stale nipples in the deployed catalog" into "CI fails the PR that changed the engine". The whole rebake-9-by-hand step exists only because nothing enforces source↔bake agreement.
- Add the 7 hand-baked figures to `bake-manifest.json` so `catalog-regen.cjs` owns them — right now they're orphaned from the regen path.
