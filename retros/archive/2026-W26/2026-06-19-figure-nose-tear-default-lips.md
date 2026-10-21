# Retro — figure nose tear + default lips (PR #770)

**Liked.** The head+nose-only `model:preview` harness (genus-0, ~30s/render) let me
isolate the nostril carve from the 47-genus locs hair and iterate the fix in tight
loops with profile + underside views. Cropping the front bake with `sharp` to a
tight nose box turned "looks fine in the thumbnail" into an obvious shattered
crater. And rendering `bust_natural_lips` through the *same* engine — with
`api.paint.*` colors resolving headlessly — let me disprove the user's "lips were
reverted" worry with a real colored image instead of a grep assertion.

**Lacked.** Confidence about *blast radius*: the nose fix and the default-lips
change both touch a shared builder used by 40+ catalog figures, but the catalog
ships pre-baked snapshots, so none of it is visible until a separate re-bake PR.
Easy to "fix" something and have the user still see the old thumbnail. I had to
make the main↔baked-catalog distinction explicit to avoid a false "done."

**Learned.** The nostril carve has now been "fixed" twice (#703 soft-blend ramp,
then this) and still tore — because a *deep* SDF subtraction tunneling ~60% through
a small marching-cubes feature is fundamentally fragile: the crescent rims and the
inter-nostril septum drop below the cell size and shatter regardless of blend
ramps. The robust shape is a **shallow, well-separated, large-blend dish**, not a
deep tunnel. General rule: at figure-tip scale, carve shallow + wide-blend, never
deep + thin.

**Longed for.** A headless "figure face QC" gate that bakes a few representative
figures (small/large head, each nose preset) and flags genus spikes / near-zero
min-edge / torn-rim signatures around the nose+mouth detail region — the nose tore
on *every* normal figure for two PRs running and only a user's screenshot caught
it. The `model:preview` warnings already have most of the signal (min-edge, genus);
they just aren't aimed at the face.
