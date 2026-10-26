---
session: "b1b76dd3"
timestamp: "2026-10-24T19:00:00Z"
sequence: 3
tools: [model-preview, playwright]
---

## Human

The Ned has the same problems the in-app AI's version had:
- the eyes aren't perfectly round like the model's;
- the real Ned has a particular slope and shape to his ear;
- the mouth isn't an indentation following a line: Ned has an almost
  cat-like upper lip, with depth and texture, that pushes out from the face
  like some Dr Seuss characters.

Do better.

## Assistant

## Key decisions

**Compare against the photos first.** I cropped the reference faces side by
side and listed what each feature actually looks like before changing code.
Every pass after that was judged against the photos at matching angles.

**Eyes → eyelids.** The round-eye problem had three separate causes, each
found by rendering a close-up:
1. The default aspect was non-round, and the default `hood` flattened the top
   of the eye.
2. A broad rim blob blended with k ≈ 0.68 r merged both eyes into a goggles
   plateau. That was the "mask" ridge I had earlier blamed on the skull.
3. Any opening sized from one skin depth either shows a grey socket wall or
   lets a cheek or nose bridge bite into the disc.

`C.eyes` now hugs the eyeball with a thin concentric lid shell, blended into
the face, with a round deep opening cut through it. The lid edge is
concentric with the black disc, so the eye is a perfect circle and the rim is
slim. The defaults are round with no hood.

**Mouth → `C.muzzle` (volume, not a groove).** Two puffy upper-lip pads
overhang a tucked lower lip, so the mouth line is the shadow of that overhang,
a "w" that curls up at the corners. Everything is seated on the real face at
attach time via `surfacePoint`, so the muzzle can't float or sink. It also
includes a philtrum cleft, a rounded-triangle cat nose (its own label), and
optional whisker dots. `parts` and `detail` are filled in at attach, because
they depend on where the face is.

**Ears → the subject's silhouette.**
- The outline is an asymmetric leaf: a straight top edge, a rounded lobe near
  the root (`belly`), and a straight run to a pointed tip.
- It's cupped across its width with a cylinder shell. A sphere cup smaller
  than the leaf fell away before the tip and squared it off.
- The membrane starts outside the skull, so its root edge is clean.

For Ned the ears stick out nearly level (lift 8), with a span of about 1.7×
the head width. Too much belly squares off the tip; that's documented.

**Skull → one tapered egg.** Two overlapping skull ellipsoids leave a hood
crease. The head was also enlarged about 12% to match the photos' head/body
ratio.

**Docs.** creature.md now teaches these as rules (round lidded eyes, muzzle
as volume, ear silhouette and slope) and carries the new Ned code. The
routing text in the system prompt, ai.md and sdf.md names the new
capabilities.
