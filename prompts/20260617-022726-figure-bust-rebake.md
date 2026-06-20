---
session: "great-curie-g5nsu7"
timestamp: "2026-06-17T02:27:26Z"
model: claude-opus-4-8
---

## Human

[Continuation of the figure bust-placement fix.] Keep the current mound
*shape* (option A) — just the raise. Re-bake the affected catalog entries in
this PR so the shipped thumbnails/sessions reflect the fix.

## Assistant

## Key decisions

**Scope confirmed**: user picked option A (current mound shape, only raised), so
no proportion change — the prototyping `BUST_VAR` switch was removed and
`breastMounds` is back to its original shape params. The placement fix
(`nippleLineZ`) stays.

**Re-bake**: regenerated 20 figure catalog entries whose geometry the raise
touches — every `sex:'female'`/`bust>0` figure (mounds move) **and** every
bare-chested figure that calls `F.nipples` (the areola anchor moves). All use
`byLabel` paint, so a generator read each entry's latest `code` + `colorRegions`
(colour as `[r,g,b]` 0..1, which is what `paintByLabel` wants — hex is
rejected) and drove `scripts/catalog-regen.cjs` (mode `build`) against the dev
server at the standard 30°/45° hero camera, matching the existing thumbnails.

**Engine follow-on fix** (`buildNipples`): the first re-bake pass surfaced an
`areola → 0 triangles` regression on 4 *muscled bare-chested* figures (danseur,
sprinter, surfer, tai-chi). Cause: the pectoral masses bulge FORWARD of the
chest ellipsoid the areola anchor rides, so once the nipple line sits up on the
chest the pec swallows the flush disc. Fix: made the disc's proudness (`eps`)
muscle-scaled **for bare chests only** (`mounds ? 0 : chestY·0.35·muscle`) —
mound figures ride the already-proud apex, and at `muscle:0` it's a no-op
(byte-identical). Re-baked the 4; all now resolve the areola and read as flush
discs, not bumps.

**Verification**: every entry bakes to one watertight component; female targets
(diva/expectant/cheerleader/yoga/runway) show the bust covered on the chest and
the male chests read naturally. `npm run typecheck` clean; unit tier green
except the pre-existing `catalog.test.ts` rolling-year failure (filed #712,
unrelated AI-model time-bomb).
