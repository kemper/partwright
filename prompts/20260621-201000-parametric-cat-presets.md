---
session: "sharpbell"
timestamp: "2026-06-21T20:10:00Z"
model: claude-opus-4-8
sequence: 5
---

## Human

That cat seems pretty cute but could we have more presets for different types?
like, have a standing cat and other cat types? [Chose: all poses — standing,
loaf, curled, pouncing — and all variety axes — builds, colorways, ears/face,
tails.]

## Assistant

## Key decisions

Turned the single hand-tuned cat into a PARAMETRIC `buildCat(params)` with a
`paramsSchema` (so `model:preview -p pose=standing` and the in-app param UI both
drive it) — one source of truth, presets are parameter bundles. This is the
proto-`F.cat`/quadruped builder (tracking #845). Default params reproduce the
polished sitting cat exactly (same labels, bbox, genus) so the existing eval is
unaffected.

**Wave 1 shipped (all pass gates, read correctly):** build knob
(kitten/slim/average/chonky), ears (pointed/folded/big), tail (curl/short/fluffy),
face (round/pointed-siamese). Solid **colorways** as sibling palette JSONs
(grey/black/white alongside orange) — a palette swap of body/lids/muzzle/iris.

**`pose: 'standing'` FAILED this pass — flagged WIP.** The agent stretched the
sitting cat vertically, so it reads as an upright biped/teddy-bear on two stubby
legs with the tail pointing up — not a four-legged cat. A real standing pose
needs a *horizontal* spine with four distinct legs to the ground + head reaching
forward; that's the quadruped-rig problem in miniature and gets its own focused
pass. Committed the parametric foundation + the working knobs now (don't lose
them); standing iterates next on the same branch.

**Deferred (tracked on #845):** patterned colorways (tabby stripes, tuxedo,
calico, siamese points) need MULTI-REGION body coloring — the single `body`
label can't express them; needs stripe/patch labels or in-code paint. Solid
coats only for now. Remaining poses loaf/curled/pouncing are Wave 2.
