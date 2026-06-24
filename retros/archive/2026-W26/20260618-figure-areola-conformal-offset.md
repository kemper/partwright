# Retro — figure areola: conformal offset (the user designed the fix)

4-Ls from the arc that converged the bare-chest areola after several failed shapes.

## Liked
- **Stopping to discuss before coding the third attempt.** After flush-by-construction shipped a dither and the raised disc was wobbly, I laid out options with honest trade-offs and asked. The user picked the direction *and then proposed the actual mechanism* (treat it like clothing — a thin conformal offset). Their idea was better than mine. The lesson: when 2+ attempts miss on a subjective/visual target, the cheapest next move is a candid "here's what's possible, what do you want", not attempt #3.
- `round(t)` (SDF `f − t`) turned out to be the perfect primitive for "ultra-thin layer that follows any surface" — already in the API. Worth remembering it exists for any conformal-shell need.

## Lacked
- **A model for WHY paint dithers.** I burned two whole geometric approaches before naming the root cause: the bake's nearest-source-centroid label transfer can't disambiguate two *coincident* surfaces, so any flush colored region hatches. That's a general law (it'll bite any future "paint a flat marking flush on a surface" feature — tattoos, logos, freckles), and it isn't written down anywhere. Should be a one-paragraph note in the color/paint docs: *a paint region needs ≳1 triangle of relief over its neighbour to win label assignment cleanly.*
- Pixel-peeking `model:preview` multi-tile crops to judge protrusion was flaky (kept hitting the tile gap). An empirical "measure protrusion along the normal" probe would have been faster and unambiguous than eyeballing — I eventually computed it analytically but should have reached for measurement first.

## Learned
- "Totally flush" is the *hardest* case to paint, not the easiest — the opposite of the user's (reasonable) intuition and my early framing. Coincident surfaces are maximally ambiguous for label transfer.
- The relief floor is set by local mesh density: a paint region must clear ~1 detail triangle. So "make it more flush" is really "refine the local mesh, then thin the relief" — the two move together. Refinement was already nipple-local (two small detail spheres), so thinning cost ~1% triangles.
- Catalog bakes are the deliverable, not the source fix — I re-baked the 9 figures **three times** this arc as the approach changed (flush → raised disc → conformal). Each blind re-bake was ~12 min. A stat-only headless catalog-freshness check (filed as #732) would also have let me iterate the *geometry* without the full colored bake until the very end.

## Longed for
- A documented "paint relief floor" rule (above) so the next agent doesn't rediscover the dither law by shipping it twice.
- The #732 catalog-freshness gate, again: it would have caught that my first two "fixed" pushes left the catalog showing a worse areola than the source implied, before the user had to eyeball the deployed site.
