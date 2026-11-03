---
session: "01U8g7w9"
timestamp: "2026-10-27T15:15:00Z"
sequence: 10
---

## Human

Do all the remaining tasks except the catalog as I'll want to review before
that step. I know you said Armor has no bevels, ridges or rivets yet. Hats and
helmets don't flatten the hair; tall styles like the afro or mohawk poke
through a hat. Thin tops still show a soft bust point on female bodies.
Anything else?

## Assistant

## Key decisions

**Headwear presses the hair; crowns sit on it.** The hair field takes an
optional cover (a lower edge in the head frame and a thickness to keep): above
the edge the hair is clamped to a thin layer, and below it it widens back at a
fixed slope so it shows under the brim. Hats grow by that thickness. The
helmet's edge rises over the ears and drops to a nape guard. Before, the shell
followed the ear and bulged over it, so the cover follows the same edge
function. Crowns and tiaras are not covers: they are seated on the hair's
surface. The seat uses the 80th-percentile ray reach (so a ponytail passes
through the ring) and needs hair round three-quarters of it (so it never
floats above the head), rising up the hair when the fit is too loose (so on an
afro it sits on top, not round its middle).

**Armor relief is added after smoothing, on a subdivided patch.** The old rim
was added before 24 offset-smoothing passes, so it was blurred away. Relief
(bevel, rolled bead, ridges, lames) is now a separate `detail` term applied
after smoothing. Plates are split once so the relief resolves, and every
smoothing pass count is scaled ×4 on subdivided shells, since diffusion reach
goes with spacing × √passes. Without that, the cuirass showed more anatomy, not
less. Rivets are seated by walking each hem loop by arc length and climbing
the edge-distance field inward. They form their own `rivets` label, with
`rivets: false` per item.

**The bust is bridged with a morphological closing, not smoothing.**
Rise-only smoothing moved the tshirt by only 0.03 dm, because the crease is
concave along a single line. Closing the posed torso (arms excluded) with a
1.2 dm ball (about 0.5 s on a 0.06 dm lattice) gives the surface taut cloth makes. The shell's base surface is
projected onto it along the gradient, and then relaxed on it to undo fold
lines. The inner face stays on the real skin, so there is no hidden void. The
breast-point slider is softened under tops alongside the nipple sliders.

**Not done here (filed):** strapless sleeveless tops, jaw/beard separation,
blink on sculpted eyes, the Funko face's nose and mouth line, the photo fit
tested only on synthetic photos, and the cuirass neckline points. Catalog
entries were deferred by the user.
