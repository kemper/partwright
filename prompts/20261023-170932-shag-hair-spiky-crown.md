---
session: "01BsPPSVZ2oFGFXTxRyBtu1M"
timestamp: "2026-10-23T16:05:00Z"
model: claude-opus-5-5
tools: [subagent, git-worktree, model-preview]
---

## Human

The owner picked hair variant C ("shaggy layered") plus variant A's crown spikes
from the Tsubasa Funko prototype round (hand-built `F.hair.cap` + `F.hair.tuft`
locks with hand-written ray-march helpers). Build it into the figure library as
a new hair style (`style: 'shag'`, messy fringe, 2–3 layered side/back locks with
a ragged hem, `crown: 'spiky' | 'tousled'`), fix the builder gaps the prototype
round exposed (notched hairline, ribbon tip-width floor, mop volume above the
ears, surface-following tuft endpoints, `F.place` height that ignores hair),
keep every existing figure byte-identical, wire `'shag'` into the Character
Creator (spec enums, codegen, panel knobs shown only when relevant), add unit +
e2e tests, and validate with v6 / spec-v2 Tsubasa builds scored by photo match.

## Assistant

## Key decisions

**Shag is a library port of prototype C + A's crown, in head-radius units.**
Every prototype constant (world units on a funko head, Rbar ≈ 22.6) was
converted to fractions of the mean head radius / head-Z, so the style scales
with any rig. Placement reuses the scalp frame (`S.on`) and a new shared
`skinAtHeight` helper (the anime style's horizontal skin march, now extracted
and reused — byte-identical math), so callers never hand-write ray marches.

**Tuning was done by photo-match score, not eyeballing.** Moving the crown
mass up (crown 3), focusing the `flare` push-out at temple height (bands 1–2),
narrowing the ear-level layer, lowering the nape hairline/hem and chunkier
crown spikes (thickness w/2.5) took the v6 Tsubasa from 0.853/0.855 to
0.887/0.885 (front/back), above v5 (0.876/0.881). A sideburn experiment
widened band 3 by 11–19% and was dropped.

**Fringe joins with a tight blend, not the layers' blend.** A hard union kept
the points but left circular creases where ribbons exit the cap edge (seen in
a 1600px close-up); a u·0.03 blend fillets those while the tips, which lie on
the skin away from the cap, stay crisp.

**Builder gaps as opt-in options so old output is untouched:** cap
`window: { notches, depth, span }` (rhombus-prism teeth subtracted from the
window at the bisected skin hairline), ribbon `tipWidth` (only when set),
`F.hair.tuft({ from, to, via, on })` surface endpoints (`{ az, el | h, out }`),
and `F.place({ heightOf: 'body' })` (measures to `rig.joints.crown`). The seven
regression figures and the anime-haired v5 re-ran with identical stats.

**Key ownership became a table** (`keyStyles`) since `spike`/`chunk` are now
shared by anime + shag; error messages keep the old prefixes so existing
regex tests still match. `locks` on shag is a density multiplier (0.5–2), not a
count — documented as such.

**Character Creator**: `HAIR_CROWNS` enum (synced with the library via the
enum-sync test), `crown`/`layers`/`raggedness`/`flare` spec fields with
defaults that emit nothing, codegen emits shag knobs only off-default (layers
rounded to the integer the library requires), panel shows them only for shag.
