---
session: "01MG8C81"
timestamp: "2026-10-23T16:00:00Z"
tools: [model-preview, playwright]
---

## Human

It would be cool if the character builder had a random option where it
randomly builds a new character. Maybe it would also be good to have a preset
list of characters that someone can scroll through and pick one to start.

## Assistant

## Key decisions

**Random is a pure, seeded generator in `characterSpec.ts`.** `randomSpec(rng)`
picks an age archetype first (adult / child / teen / elder / chibi), and that
drives proportions (height, heads-tall), bust/muscle eligibility and hair greying.
That's what keeps a roll coherent rather than a bag of independent sliders. The
pose is always a named preset so the Pose dropdown still reads correctly.
`seededRandom` (mulberry32) makes rolls reproducible, which the unit tests and
the `randomCharacter({seed})` console API both rely on.

**I built samples headlessly and excluded the combos that fail.** I ran every
preset plus about 50 random rolls through `model:preview`.
- `locs` / `boxBraids` hair leaves detached strands (2-4 pieces) even on the
  default body, so those styles are out of random rolls and presets.
- Hooded lids and an upward gaze can bury the pupils, so those are out of random
  rolls too.
- Thin brows can sink under the brow ridge, so they're out of random rolls.

All of these stay selectable by hand in the panel. Unit tests pin the exclusions.
Hair occasionally still hides the brows. That's cosmetic, so I accepted it.

**The preset list is a scrollable two-column card grid with baked thumbnails.**
`scripts/bake-character-presets.mjs` (`npm run bake:character-presets`) builds
each preset with the real engine under Node and writes
`public/character-presets/<id>.webp` (19 files, about 80 KB in total). It fails
if any preset isn't one manifold piece. It starts a fresh engine per figure,
because one long-lived WASM heap died after about 12 heavy SDF figures. Each card
falls back to a colour silhouette if its image is missing, and a unit test
asserts that every preset ships a thumbnail. The list went from 6 to 19 presets
and none of the original labels changed, so the existing e2e selectors still
match. Each card is a real button, wrapped in a separate listitem element so the
button role survives.

**UI ↔ API parity.** The console API gains `listCharacterPresets()` and
`randomCharacter({seed?, save?, label?})`, both validated and returning the seed.
I added them to the help() table, ai.md, ai/figure.md and the help page. There's
no in-app AI tool, matching `buildCharacter`, which doesn't have one either.

**Playwright config.** The sandbox browser detector only looked under
`chrome-linux/`. This image ships `chrome-linux64/`, so local Playwright runs
failed until I added the second path.

## Assistant

## CI follow-up: editor-hints race (not caused by this PR)

The e2e shard 1 failed on `editor-hints.spec.ts` ("lays out on one row…"). It
fails the same way on an untouched `origin/main` checkout, even though the
staging gate passed it earlier the same day. The hints strip first lays out in
a 335 px slot, which is under the 360 px cut-off, so it hides the "Did you
know?" badge. The test then widens the slot and immediately samples. On that
first sample the badge's bounding box is null, so the helper threw, and
`expect.poll` doesn't retry thrown errors. The helper now returns `'pending'`,
so the poll keeps sampling until the ResizeObserver relayout catches up. The
change is test-only. I carried it on this branch because the session may only
push here.
